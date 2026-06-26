'use client';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';
import {
  LuBold, LuItalic, LuHeading1, LuHeading2, LuHeading3, LuList, LuListOrdered,
  LuQuote, LuLink, LuCode, LuImage, LuMinus, LuStrikethrough, LuEye, LuPencil,
} from 'react-icons/lu';
import { inputCls } from '@/components/admin/ui';

/**
 * Markdown editor for blog bodies. Outputs Markdown (stored in body_md and
 * rendered by lib/markdown on the public site), with a formatting toolbar,
 * an auto-growing / non-resizable textarea, and a live preview toggle.
 */

type Props = { value: string; onChange: (v: string) => void };

// Mirror the server allowlist (lib/markdown.ts) so preview ≈ published output.
function renderPreview(md: string): string {
  const html = marked.parse(md || '', { async: false, gfm: true, breaks: false }) as string;
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'ul', 'ol', 'li',
      'blockquote', 'strong', 'em', 'b', 'i', 'br', 'hr', 'code', 'pre', 'img', 'del',
    ],
    ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'src', 'alt'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|\/|#)/i,
  });
}

export function MarkdownField({ value, onChange }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const pendingSel = useRef<[number, number] | null>(null);
  const [mode, setMode] = useState<'write' | 'preview'>('write');

  const autosize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  // After a toolbar edit re-renders the controlled value, restore the caret/
  // selection and re-grow the box — WITHOUT scrolling the page. Re-focusing a
  // tall auto-sized textarea otherwise makes the browser scroll it into view
  // (the page would jump to the bottom).
  useLayoutEffect(() => {
    const el = ref.current;
    const x = typeof window !== 'undefined' ? window.scrollX : 0;
    const y = typeof window !== 'undefined' ? window.scrollY : 0;
    autosize();
    if (pendingSel.current && el) {
      const [s, e] = pendingSel.current;
      el.focus({ preventScroll: true });
      el.setSelectionRange(s, e);
      pendingSel.current = null;
      if (typeof window !== 'undefined') window.scrollTo(x, y);
    }
  }, [value, mode]);

  const apply = (next: string, selStart: number, selEnd: number) => {
    pendingSel.current = [selStart, selEnd];
    onChange(next);
  };

  // Wrap the current selection with `before`/`after` (e.g. **bold**).
  const wrap = (before: string, after = before, placeholder = '') => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const sel = value.slice(s, e) || placeholder;
    const next = value.slice(0, s) + before + sel + after + value.slice(e);
    apply(next, s + before.length, s + before.length + sel.length);
  };

  // Prefix every line touched by the selection (headings, lists, quotes).
  const linePrefix = (make: (i: number) => string) => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const lineStart = value.lastIndexOf('\n', s - 1) + 1;
    let lineEnd = value.indexOf('\n', e);
    if (lineEnd === -1) lineEnd = value.length;
    const block = value.slice(lineStart, lineEnd);
    const newBlock = block.split('\n').map((ln, i) => make(i) + ln).join('\n');
    const next = value.slice(0, lineStart) + newBlock + value.slice(lineEnd);
    apply(next, lineStart, lineStart + newBlock.length);
  };

  const insert = (text: string) => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const next = value.slice(0, s) + text + value.slice(e);
    apply(next, s + text.length, s + text.length);
  };

  const link = () => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const sel = value.slice(s, e) || 'link text';
    const url = (typeof window !== 'undefined' && window.prompt('Link URL', 'https://')) || '';
    if (!url) return;
    const md = `[${sel}](${url})`;
    const next = value.slice(0, s) + md + value.slice(e);
    apply(next, s + 1, s + 1 + sel.length);
  };

  const image = () => {
    const url = (typeof window !== 'undefined' && window.prompt('Image URL', '/blog/')) || '';
    if (!url) return;
    const alt = (typeof window !== 'undefined' && window.prompt('Alt text (describe the image)', '')) || '';
    insert(`![${alt}](${url})`);
  };

  const onKeyDown = (ev: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(ev.metaKey || ev.ctrlKey)) return;
    const k = ev.key.toLowerCase();
    if (k === 'b') { ev.preventDefault(); wrap('**', '**', 'bold text'); }
    else if (k === 'i') { ev.preventDefault(); wrap('*', '*', 'italic text'); }
    else if (k === 'k') { ev.preventDefault(); link(); }
  };

  const tools = useMemo(() => ([
    { icon: LuBold, label: 'Bold (⌘B)', run: () => wrap('**', '**', 'bold text') },
    { icon: LuItalic, label: 'Italic (⌘I)', run: () => wrap('*', '*', 'italic text') },
    { icon: LuStrikethrough, label: 'Strikethrough', run: () => wrap('~~', '~~', 'struck text') },
    { sep: true as const },
    { icon: LuHeading1, label: 'Heading 1', run: () => linePrefix(() => '# ') },
    { icon: LuHeading2, label: 'Heading 2', run: () => linePrefix(() => '## ') },
    { icon: LuHeading3, label: 'Heading 3', run: () => linePrefix(() => '### ') },
    { sep: true as const },
    { icon: LuList, label: 'Bullet list', run: () => linePrefix(() => '- ') },
    { icon: LuListOrdered, label: 'Numbered list', run: () => linePrefix((i) => `${i + 1}. `) },
    { icon: LuQuote, label: 'Quote', run: () => linePrefix(() => '> ') },
    { sep: true as const },
    { icon: LuLink, label: 'Link (⌘K)', run: link },
    { icon: LuImage, label: 'Image', run: image },
    { icon: LuCode, label: 'Inline code', run: () => wrap('`', '`', 'code') },
    { icon: LuMinus, label: 'Divider', run: () => insert('\n\n---\n\n') },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), [value]);

  return (
    <div className="overflow-hidden rounded-lg border border-[#E5E5E5] bg-white shadow-sm focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/25">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-[#EDEDED] bg-cream/50 px-1.5 py-1">
        {tools.map((t, i) =>
          'sep' in t ? (
            <span key={`s${i}`} className="mx-1 h-5 w-px bg-[#E5E5E5]" />
          ) : (
            <button
              key={t.label}
              type="button"
              title={t.label}
              aria-label={t.label}
              disabled={mode === 'preview'}
              // mouseDown + preventDefault keeps the textarea focused & selected
              // (the button never steals focus), so applying a format doesn't
              // blur → re-focus → scroll-jump the page.
              onMouseDown={(ev) => { ev.preventDefault(); t.run(); }}
              className="grid h-7 w-7 place-items-center rounded-md text-ink/65 transition-colors hover:bg-white hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <t.icon width={15} height={15} strokeWidth={2} />
            </button>
          ),
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setMode('write')}
            className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors ${mode === 'write' ? 'bg-white text-ink shadow-sm ring-1 ring-inset ring-[#E5E5E5]' : 'text-ink/55 hover:text-ink'}`}
          >
            <LuPencil width={13} height={13} /> Write
          </button>
          <button
            type="button"
            onClick={() => setMode('preview')}
            className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors ${mode === 'preview' ? 'bg-white text-ink shadow-sm ring-1 ring-inset ring-[#E5E5E5]' : 'text-ink/55 hover:text-ink'}`}
          >
            <LuEye width={13} height={13} /> Preview
          </button>
        </div>
      </div>

      {mode === 'write' ? (
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => { onChange(e.target.value); autosize(); }}
          onKeyDown={onKeyDown}
          spellCheck
          placeholder="Write your post in Markdown… use the toolbar above for formatting."
          style={{ resize: 'none', overflow: 'hidden' }}
          className={inputCls('min-h-[200px] rounded-none border-0 font-mono text-xs leading-relaxed shadow-none focus:ring-0')}
        />
      ) : (
        <div
          className="blog-prose min-h-[200px] max-w-none px-4 py-3 text-sm"
          // First-party admin content, sanitized with the same allowlist as the site.
          dangerouslySetInnerHTML={{ __html: renderPreview(value) || '<p class="text-ink/40">Nothing to preview yet.</p>' }}
        />
      )}
    </div>
  );
}
