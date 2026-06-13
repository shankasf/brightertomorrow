import Link from "next/link";
import { FiChevronLeft, FiChevronRight } from "react-icons/fi";

const WINE = "#66202A";

// Build a compact page list with ellipses, e.g. 1 … 4 5 [6] 7 8 … 13
function pageWindow(current: number, total: number): (number | "...")[] {
  const out: (number | "...")[] = [];
  const push = (n: number | "...") => out.push(n);
  const lo = Math.max(2, current - 1);
  const hi = Math.min(total - 1, current + 1);
  push(1);
  if (lo > 2) push("...");
  for (let i = lo; i <= hi; i++) push(i);
  if (hi < total - 1) push("...");
  if (total > 1) push(total);
  return out;
}

function href(basePath: string, page: number): string {
  return page <= 1 ? basePath : `${basePath}?page=${page}`;
}

export default function Pagination({
  currentPage,
  totalPages,
  basePath,
}: {
  currentPage: number;
  totalPages: number;
  basePath: string;
}) {
  if (totalPages <= 1) return null;
  const pages = pageWindow(currentPage, totalPages);

  const base =
    "inline-flex items-center justify-center min-w-10 h-10 px-3 rounded-full text-[14px] font-semibold transition border";

  return (
    <nav
      className="mt-14 flex flex-wrap items-center justify-center gap-2"
      aria-label="Blog pagination"
    >
      {currentPage > 1 ? (
        <Link
          href={href(basePath, currentPage - 1)}
          rel="prev"
          aria-label="Previous page"
          className={`${base} border-surface-line text-ink/80 hover:border-brand-700 hover:text-ink`}
        >
          <FiChevronLeft size={16} />
        </Link>
      ) : (
        <span aria-hidden className={`${base} border-surface-line/60 text-ink/25 cursor-not-allowed`}>
          <FiChevronLeft size={16} />
        </span>
      )}

      {pages.map((p, i) =>
        p === "..." ? (
          <span key={`e${i}`} className="px-2 text-ink/40 select-none">
            …
          </span>
        ) : p === currentPage ? (
          <span
            key={p}
            aria-current="page"
            className={`${base} border-transparent text-white`}
            style={{ backgroundColor: WINE }}
          >
            {p}
          </span>
        ) : (
          <Link
            key={p}
            href={href(basePath, p)}
            aria-label={`Page ${p}`}
            className={`${base} border-surface-line text-ink/80 hover:border-brand-700 hover:text-ink`}
          >
            {p}
          </Link>
        ),
      )}

      {currentPage < totalPages ? (
        <Link
          href={href(basePath, currentPage + 1)}
          rel="next"
          aria-label="Next page"
          className={`${base} border-surface-line text-ink/80 hover:border-brand-700 hover:text-ink`}
        >
          <FiChevronRight size={16} />
        </Link>
      ) : (
        <span aria-hidden className={`${base} border-surface-line/60 text-ink/25 cursor-not-allowed`}>
          <FiChevronRight size={16} />
        </span>
      )}
    </nav>
  );
}
