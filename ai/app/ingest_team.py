"""Discover therapist profile URLs from the four team pages on the live site,
fetch each profile, parse out name + credentials + bio, and upsert into
bt.team_members. Run as a Kubernetes Job using the same image as the AI service.
"""
from __future__ import annotations

import asyncio
import re
import sys
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

from .db import conn

ROOT = "https://brightertomorrowtherapy.com"
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

TEAM_PAGES: list[tuple[str, str]] = [
    ("telehealth",  f"{ROOT}/telehealth-team/"),
    ("e-russell",   f"{ROOT}/e-russell-team/"),
    ("n-durango",   f"{ROOT}/n-durango-team/"),
    ("students",    f"{ROOT}/studenttherapists-team/"),
]

# Slugs of pages that aren't therapist profiles but appear in sidebar/footer.
NON_PROFILE = {
    "", "about-us", "about", "adhd-testing", "affordable-therapy", "anxiety",
    "blog", "career", "careers", "child", "contact", "couples", "couples-therapy",
    "depression", "e-russell-team", "esa-letters",
    "emotional-support-animal-esa-letters-in-las-vegas", "fees-insurance",
    "faqs", "geriatric", "grief", "individual-therapy", "journal", "lgbtqia",
    "life-transitions", "n-durango-team", "our-approach", "our-story",
    "privacy-policy", "rates", "reiki", "relationship", "services",
    "specialities", "specialties", "story", "studenttherapists-team",
    "team", "teen", "teletherapy", "therapists-match-quiz", "trauma-ptsd",
    "appointments", "book-an-appointment", "book", "contact-us",
}


def discover_profiles(html: str) -> list[str]:
    soup = BeautifulSoup(html, "lxml")
    out: set[str] = set()
    for a in soup.select("a[href]"):
        href = urljoin(ROOT, a["href"]).split("#")[0].split("?")[0].rstrip("/") + "/"
        u = urlparse(href)
        if not u.netloc.endswith("brightertomorrowtherapy.com"):
            continue
        slug = u.path.strip("/").split("/")[0]
        if not slug or slug in NON_PROFILE:
            continue
        if slug.startswith(("category", "tag", "wp-", "page")):
            continue
        # Heuristic: profile slugs look like "first-last" with at least one hyphen.
        if "-" not in slug:
            continue
        if any(slug.startswith(p) for p in ("category-", "tag-", "page-")):
            continue
        out.add(href)
    return sorted(out)


def parse_profile(url: str, html: str) -> dict | None:
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "noscript", "svg", "iframe", "form", "header", "footer", "nav"]):
        tag.decompose()

    # Title text — strip the site suffix
    raw_title = (soup.title.string or "").strip() if soup.title else ""
    raw_title = re.sub(r"\s*[-|–]\s*Brighter Tomorrow.*$", "", raw_title, flags=re.I).strip()

    # Try to find an h1/h2 with the person's name; fall back to <title>
    name = ""
    creds = None
    for sel in ["h1", "h2"]:
        for h in soup.select(sel):
            t = re.sub(r"\s+", " ", h.get_text(" ", strip=True)).strip()
            if not t or len(t) > 80:
                continue
            if re.search(r"\b(LCSW|LMFT|LMHC|LPC|LCPC|MSW|MFT|PhD|PsyD|CSW|CADC|MA|MS|LMSW|Intern)\b", t, re.I) \
               or re.fullmatch(r"[A-Z][a-zA-Z'\-\.]+(?:\s+[A-Z][a-zA-Z'\-\.]+){1,3}", t):
                name = t
                break
        if name:
            break
    if not name:
        name = raw_title

    # Split off credentials after a comma
    m = re.match(r"^(.+?)[,]\s*(.+)$", name)
    if m:
        name, creds = m.group(1).strip(), m.group(2).strip()

    # Photo: first content-area img
    photo = None
    img = soup.select_one("article img, main img, .entry-content img, .elementor-widget-image img")
    if img and img.get("src"):
        photo = urljoin(ROOT, img["src"])

    # Bio: longest paragraph in main content
    body_node = soup.select_one("main, article, .entry-content, .elementor, body") or soup
    paragraphs = [re.sub(r"\s+", " ", p.get_text(" ", strip=True)) for p in body_node.select("p")]
    paragraphs = [p for p in paragraphs if 60 <= len(p) <= 800]
    bio = max(paragraphs, key=len) if paragraphs else None

    if not name or len(name) < 3 or len(name.split()) < 2:
        return None

    # Reject page-heading junk that isn't a person's name.
    JUNK = {
        "find your therapist here", "who she helps", "telehealth team",
        "e russell team", "n durango team", "student therapists team",
        "student therapists", "brighter tomorrow counseling",
        "about brighter tomorrow counseling", "our therapists",
        "meet our experienced therapists", "meet the team",
    }
    if name.lower().strip() in JUNK:
        return None
    # Reject ALL-CAPS shouty headings (real names are title-case).
    if name == name.upper() and sum(1 for c in name if c.isalpha()) > 3:
        return None
    # Require first two words to look like capitalized name parts.
    parts = [p for p in re.split(r"\s+", name) if p]
    if not (parts[0][:1].isupper() and parts[1][:1].isupper()):
        return None

    return {
        "url": url,
        "full_name": name,
        "credentials": creds,
        "bio": bio,
        "photo_url": photo,
    }


async def fetch(client: httpx.AsyncClient, url: str, attempts: int = 4) -> httpx.Response | None:
    delay = 1.5
    for i in range(attempts):
        try:
            r = await client.get(url)
            if r.status_code == 200:
                return r
            if r.status_code in (429, 503, 508):
                await asyncio.sleep(delay)
                delay *= 2
                continue
            return r
        except Exception as e:
            print(f"  retry {url} ({i+1}/{attempts}): {e}", file=sys.stderr)
            await asyncio.sleep(delay)
            delay *= 2
    return None


async def main() -> None:
    headers = {
        "user-agent": USER_AGENT,
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
    }
    async with httpx.AsyncClient(headers=headers, follow_redirects=True, timeout=30) as client:
        # 1. Discover therapist URLs per team
        team_to_urls: dict[str, list[str]] = {}
        for slug, url in TEAM_PAGES:
            r = await fetch(client, url)
            if not r or r.status_code != 200:
                print(f"  skip {url}: HTTP {r.status_code if r else 'no-response'}", file=sys.stderr)
                continue
            profiles = discover_profiles(r.text)
            team_to_urls[slug] = profiles
            print(f"{slug}: {len(profiles)} profile URLs")
            await asyncio.sleep(1.0)

        # 2. Fetch each profile (sequentially with a small delay — be polite)
        records: list[tuple[str, dict]] = []
        seen: set[str] = set()
        for team_slug, urls in team_to_urls.items():
            for u in urls:
                if u in seen:
                    continue
                seen.add(u)
                r = await fetch(client, u)
                if not r or r.status_code != 200:
                    print(f"  skip {u}: HTTP {r.status_code if r else 'no-response'}", file=sys.stderr)
                    continue
                data = parse_profile(u, r.text)
                if not data:
                    continue
                records.append((team_slug, data))
                print(f"  ok {data['full_name']} -> {team_slug}")
                await asyncio.sleep(0.6)

    if not records:
        print("No therapist records parsed; aborting.")
        return

    # 3. Upsert into team_members. Replace placeholder rows for each team that we
    #    successfully scraped — leaves untouched any team we couldn't reach.
    with conn() as c, c.cursor() as cur:
        cur.execute("SELECT id, slug FROM team_groups")
        group_id_by_slug = {slug: gid for gid, slug in cur.fetchall()}

        teams_with_data = {ts for ts, _ in records}
        for ts in teams_with_data:
            gid = group_id_by_slug.get(ts)
            if gid is None:
                continue
            cur.execute("DELETE FROM team_members WHERE group_id = %s", (gid,))

        pos_per_group: dict[str, int] = {}
        for team_slug, d in records:
            gid = group_id_by_slug.get(team_slug)
            if gid is None:
                continue
            pos_per_group.setdefault(team_slug, 0)
            pos_per_group[team_slug] += 1
            cur.execute(
                """
                INSERT INTO team_members (group_id, full_name, credentials, role, bio,
                                          photo_url, accepts_new, position, published)
                VALUES (%s, %s, %s, %s, %s, %s, TRUE, %s, TRUE)
                """,
                (
                    gid, d["full_name"], d.get("credentials"), None,
                    d.get("bio"), d.get("photo_url"), pos_per_group[team_slug],
                ),
            )

        cur.execute("SELECT count(*) FROM team_members")
        print(f"Total team_members: {cur.fetchone()[0]}")


if __name__ == "__main__":
    asyncio.run(main())
