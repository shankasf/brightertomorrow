"use client";

import { useEffect, useState } from "react";
import { FaXTwitter, FaFacebookF, FaInstagram, FaLinkedinIn } from "react-icons/fa6";
import { FiCheck, FiLink } from "react-icons/fi";

export default function ShareButtons({ title }: { title: string }) {
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setUrl(window.location.href);
  }, []);

  const encodedUrl = encodeURIComponent(url);
  const encodedTitle = encodeURIComponent(title);

  const links = [
    {
      label: "Share on X",
      href: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}`,
      Icon: FaXTwitter,
    },
    {
      label: "Share on Facebook",
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
      Icon: FaFacebookF,
    },
    {
      label: "Share on LinkedIn",
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
      Icon: FaLinkedinIn,
    },
  ] as const;

  async function copyForInstagram() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("Copy this link to share on Instagram:", url);
    }
  }

  return (
    <div className="inline-flex items-center gap-3">
      <span className="text-sm font-semibold uppercase tracking-[0.18em] text-ink-muted">
        Share
      </span>
      <div className="flex items-center gap-2">
        {links.map(({ label, href, Icon }) => (
          <a
            key={label}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={label}
            className="w-9 h-9 grid place-items-center rounded-full border border-surface-line text-ink-muted hover:text-brand-700 hover:border-brand-700/60 hover:bg-brand-50 transition"
          >
            <Icon className="w-4 h-4" />
          </a>
        ))}
        <button
          type="button"
          onClick={copyForInstagram}
          aria-label="Copy link for Instagram"
          title="Copy link for Instagram"
          className="w-9 h-9 grid place-items-center rounded-full border border-surface-line text-ink-muted hover:text-brand-700 hover:border-brand-700/60 hover:bg-brand-50 transition"
        >
          <FaInstagram className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={copyForInstagram}
          aria-label="Copy article link"
          title={copied ? "Link copied!" : "Copy article link"}
          className="w-9 h-9 grid place-items-center rounded-full border border-surface-line text-ink-muted hover:text-brand-700 hover:border-brand-700/60 hover:bg-brand-50 transition"
        >
          {copied ? <FiCheck className="w-4 h-4 text-brand-700" /> : <FiLink className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
