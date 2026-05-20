"""Crawl brightertomorrowtherapy.com, chunk the text, embed it, and store
the chunks in the bt.kb_documents pgvector table.

Run as a one-shot:
    python -m app.ingest
or as a Kubernetes Job using the same image as the AI service.
"""
from __future__ import annotations

import asyncio
import hashlib
import os
import re
import sys
import xml.etree.ElementTree as ET
from urllib.parse import urljoin, urlparse

import httpx
import tiktoken
from bs4 import BeautifulSoup
from openai import OpenAI

from ..core.db import conn

ROOT = "https://brightertomorrowtherapy.com"
EMBED_MODEL = os.environ.get("OPENAI_EMBED_MODEL", "text-embedding-3-small")
EMBED_DIM = 1536
CHUNK_TOKENS = 350
CHUNK_OVERLAP = 60
MAX_PAGES = int(os.environ.get("INGEST_MAX_PAGES", "60"))

USER_AGENT = "BrighterTomorrowKB/1.0 (+admin@brightertomorrowtherapy.com)"

_enc = tiktoken.get_encoding("cl100k_base")


# ---------- crawl ----------

async def discover_urls(client: httpx.AsyncClient) -> list[str]:
    urls: set[str] = {ROOT + "/"}

    # Try sitemaps first
    for sm in ("/sitemap.xml", "/sitemap_index.xml", "/wp-sitemap.xml"):
        try:
            r = await client.get(ROOT + sm, timeout=15)
            if r.status_code != 200 or "xml" not in r.headers.get("content-type", "").lower():
                continue
            root = ET.fromstring(r.text)
            ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
            # Sitemap index?
            for loc in root.findall(".//sm:sitemap/sm:loc", ns):
                if loc.text:
                    sub = await client.get(loc.text, timeout=15)
                    if sub.status_code == 200:
                        sub_root = ET.fromstring(sub.text)
                        for u in sub_root.findall(".//sm:url/sm:loc", ns):
                            if u.text and ROOT in u.text:
                                urls.add(u.text)
            for u in root.findall(".//sm:url/sm:loc", ns):
                if u.text and ROOT in u.text:
                    urls.add(u.text)
        except Exception as e:
            print(f"sitemap {sm}: {e}", file=sys.stderr)

    # Fallback: pull links from homepage if sitemap was empty
    if len(urls) < 5:
        try:
            r = await client.get(ROOT + "/", timeout=15)
            soup = BeautifulSoup(r.text, "lxml")
            for a in soup.select("a[href]"):
                href = urljoin(ROOT, a["href"]).split("#")[0]
                if urlparse(href).netloc.endswith("brightertomorrowtherapy.com"):
                    urls.add(href)
        except Exception as e:
            print(f"home crawl: {e}", file=sys.stderr)

    # Filter out media/feed/auth/cart paths
    bad = re.compile(r"\.(jpg|jpeg|png|webp|gif|pdf|zip|mp4|mp3|svg)$|/(feed|wp-json|cart|checkout|wp-admin|wp-login)", re.I)
    cleaned = sorted({u for u in urls if not bad.search(u)})
    return cleaned[:MAX_PAGES]


# ---------- extract ----------

def extract_main_text(html: str) -> tuple[str, str]:
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "noscript", "svg", "iframe", "form"]):
        tag.decompose()
    title = (soup.title.string or "").strip() if soup.title else ""

    candidates = soup.select("main, article, .entry-content, .elementor, .site-content, #content, body")
    node = candidates[0] if candidates else soup.body or soup
    text = node.get_text(separator="\n", strip=True)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return title, text


def chunk_tokens(text: str, size: int = CHUNK_TOKENS, overlap: int = CHUNK_OVERLAP) -> list[str]:
    toks = _enc.encode(text)
    if not toks:
        return []
    chunks: list[str] = []
    step = max(1, size - overlap)
    for i in range(0, len(toks), step):
        window = toks[i : i + size]
        if not window:
            break
        chunks.append(_enc.decode(window).strip())
        if i + size >= len(toks):
            break
    return [c for c in chunks if len(c) > 80]


# ---------- embed + store ----------

def sha256(*parts: str) -> str:
    h = hashlib.sha256()
    for p in parts:
        h.update(p.encode("utf-8"))
        h.update(b"\x00")
    return h.hexdigest()


def to_vec_literal(v: list[float]) -> str:
    """pgvector accepts a string literal like '[0.1,0.2,...]'."""
    return "[" + ",".join(f"{x:.7f}" for x in v) + "]"


def embed_batch(client: OpenAI, texts: list[str]) -> list[list[float]]:
    resp = client.embeddings.create(model=EMBED_MODEL, input=texts)
    return [d.embedding for d in resp.data]


async def main() -> None:
    if not os.environ.get("OPENAI_API_KEY"):
        print("OPENAI_API_KEY missing", file=sys.stderr)
        sys.exit(2)

    openai_client = OpenAI()

    async with httpx.AsyncClient(headers={"user-agent": USER_AGENT}, follow_redirects=True) as client:
        urls = await discover_urls(client)
        print(f"Discovered {len(urls)} URLs")

        pending: list[tuple[str, str, int, str, str]] = []  # url, title, idx, text, hash

        for url in urls:
            try:
                r = await client.get(url, timeout=20)
                if r.status_code != 200 or "html" not in r.headers.get("content-type", "").lower():
                    continue
                title, text = extract_main_text(r.text)
                if not text:
                    continue
                for i, chunk in enumerate(chunk_tokens(text)):
                    h = sha256(url, str(i), chunk)
                    pending.append((url, title, i, chunk, h))
                print(f"  ok {url} -> {len([p for p in pending if p[0]==url])} chunks")
            except Exception as e:
                print(f"  fail {url}: {e}", file=sys.stderr)

        if not pending:
            print("Nothing to ingest")
            return

        # Skip chunks already stored
        with conn() as c, c.cursor() as cur:
            cur.execute(
                "SELECT source_hash FROM kb_documents WHERE source_hash = ANY(%s)",
                ([p[4] for p in pending],),
            )
            existing = {row[0] for row in cur.fetchall()}
        to_embed = [p for p in pending if p[4] not in existing]
        print(f"{len(to_embed)} new chunks to embed (skipped {len(pending) - len(to_embed)} already stored)")

        # Batch-embed and insert
        BATCH = 64
        with conn() as c, c.cursor() as cur:
            for start in range(0, len(to_embed), BATCH):
                batch = to_embed[start : start + BATCH]
                vecs = embed_batch(openai_client, [b[3] for b in batch])
                for (url, title, idx, text, h), v in zip(batch, vecs):
                    cur.execute(
                        """
                        INSERT INTO kb_documents (url, title, chunk_idx, content, token_count,
                                                  embedding, source_hash)
                        VALUES (%s, %s, %s, %s, %s, %s::vector, %s)
                        ON CONFLICT (source_hash) DO NOTHING
                        """,
                        (url, title, idx, text, len(_enc.encode(text)), to_vec_literal(v), h),
                    )
                print(f"  inserted batch {start//BATCH + 1} ({len(batch)} chunks)")

        with conn() as c, c.cursor() as cur:
            cur.execute("SELECT count(*) FROM kb_documents")
            print(f"Total kb_documents: {cur.fetchone()[0]}")


if __name__ == "__main__":
    asyncio.run(main())
