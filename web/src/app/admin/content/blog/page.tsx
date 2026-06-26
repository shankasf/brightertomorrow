'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { adminFetch } from '@/components/admin/useAdminAuth';
import { PageHeader, PageWrap, Button, Pill, EmptyState } from '@/components/admin/ui';
import { LuPencil } from 'react-icons/lu';

type Post = { id: number; slug: string; title: string; excerpt: string | null; cover_url: string | null; author: string | null; published: boolean; published_at: string };

type Filter = 'review' | 'published' | 'all';

export default function BlogPage() {
  const router = useRouter();
  const [posts, setPosts] = useState<Post[]>([]);
  const [filter, setFilter] = useState<Filter>('review');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [publishing, setPublishing] = useState<null | 'publish' | 'unpublish'>(null);

  const load = () => adminFetch('/admin/content/blog').then((r) => r.json()).then((d) => setPosts(d.posts));
  useEffect(() => { load(); }, []);

  const counts = useMemo(() => ({
    review: posts.filter((p) => p.published === false).length,
    published: posts.filter((p) => p.published === true).length,
    all: posts.length,
  }), [posts]);

  const visible = useMemo(() => {
    if (filter === 'review') return posts.filter((p) => p.published === false);
    if (filter === 'published') return posts.filter((p) => p.published === true);
    return posts;
  }, [posts, filter]);

  // Keep selection scoped to what is currently visible.
  useEffect(() => {
    setSelected((prev) => {
      const visibleIds = new Set(visible.map((p) => p.id));
      const next = new Set<number>();
      for (const id of prev) if (visibleIds.has(id)) next.add(id);
      return next.size === prev.size ? prev : next;
    });
  }, [visible]);

  const allVisibleSelected = visible.length > 0 && visible.every((p) => selected.has(p.id));
  const someVisibleSelected = visible.some((p) => selected.has(p.id));

  const toggleRow = (id: number) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected(() => (allVisibleSelected ? new Set<number>() : new Set(visible.map((p) => p.id))));
  const clearSelection = () => setSelected(new Set());

  const openEditor = (id: number | 'new') => router.push(`/admin/content/blog/${id}`);

  const setPublishedBulk = async (published: boolean) => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setPublishing(published ? 'publish' : 'unpublish');
    try {
      await adminFetch('/admin/content/blog/publish', {
        method: 'POST',
        body: JSON.stringify({ ids, published }),
      });
      clearSelection();
      await load();
    } finally {
      setPublishing(null);
    }
  };

  const tabs: { key: Filter; label: string; count: number }[] = [
    { key: 'review', label: 'In review', count: counts.review },
    { key: 'published', label: 'Published', count: counts.published },
    { key: 'all', label: 'All', count: counts.all },
  ];

  return (
      <PageWrap max="max-w-5xl">
        <PageHeader
          title="Blog posts"
          subtitle="Long-form articles published on the public blog. Drafts stay in review until you post them."
          action={<Button onClick={() => openEditor('new')}>＋ New post</Button>}
        />

        {/* Status filter — segmented control */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div role="tablist" aria-label="Filter posts by status" className="inline-flex items-center gap-0.5 rounded-xl border border-[#E5E5E5] bg-cream/60 p-0.5">
            {tabs.map((t) => {
              const active = filter === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilter(t.key)}
                  className={`relative rounded-lg px-3 py-1.5 text-xs font-medium tracking-tight transition-colors ${
                    active ? 'text-ink' : 'text-ink/55 hover:text-ink/80'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="blog-filter-pill"
                      transition={{ type: 'spring', stiffness: 480, damping: 38 }}
                      className="absolute inset-0 rounded-lg bg-white shadow-[0_1px_2px_rgba(15,23,42,0.06)] ring-1 ring-inset ring-[#E5E5E5]"
                    />
                  )}
                  <span className="relative">
                    {t.label} <span className="tabular-nums text-ink/45">({t.count})</span>
                  </span>
                </button>
              );
            })}
          </div>

          {visible.length > 0 && (
            <label className="inline-flex cursor-pointer select-none items-center gap-2 text-xs text-ink/60">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                ref={(el) => { if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected; }}
                onChange={toggleAll}
                className="h-4 w-4 rounded border-[#D9D9D9] text-brand-600 focus:ring-brand/40"
              />
              Select all
            </label>
          )}
        </div>

        {posts.length === 0 ? (
          <EmptyState
            title="No blog posts yet"
            description="Publish your first post to start building the blog."
            action={<Button onClick={() => openEditor('new')}>＋ New post</Button>}
            icon={<LuPencil width={22} height={22} strokeWidth={1.8} />}
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title={filter === 'review' ? 'Nothing in review' : filter === 'published' ? 'Nothing published yet' : 'No posts'}
            description={filter === 'review' ? 'New drafts awaiting review will land here.' : undefined}
            icon={<LuPencil width={22} height={22} strokeWidth={1.8} />}
          />
        ) : (
          <motion.div initial="initial" animate="animate" variants={{ animate: { transition: { staggerChildren: 0.025 } } }} className="space-y-2">
            {visible.map((p) => {
              const checked = selected.has(p.id);
              return (
              <motion.div
                key={p.id}
                variants={{ initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 } }}
                whileHover={{ y: -1 }}
                className={`group flex items-start gap-3 rounded-2xl border bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-shadow hover:shadow-[0_8px_20px_rgba(15,23,42,0.05)] ${
                  checked ? 'border-brand/40 ring-1 ring-inset ring-brand/20' : 'border-slate-200/70'
                }`}
              >
                <input
                  type="checkbox"
                  aria-label={`Select ${p.title}`}
                  checked={checked}
                  onChange={() => toggleRow(p.id)}
                  className="mt-1.5 h-4 w-4 shrink-0 rounded border-[#D9D9D9] text-brand-600 focus:ring-brand/40"
                />
                {/* Whole card body is a button → opens the dedicated edit page. */}
                <button
                  type="button"
                  onClick={() => openEditor(p.id)}
                  className="flex min-w-0 flex-1 items-start gap-3 text-left"
                >
                  {p.cover_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.cover_url} alt="" className="h-16 w-16 shrink-0 rounded-xl object-cover ring-1 ring-inset ring-slate-200" />
                  ) : (
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-50 to-cyan-50 text-indigo-400 ring-1 ring-inset ring-slate-200">
                      <LuPencil width={20} height={20} strokeWidth={1.8} />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      {p.published ? <Pill tone="green" dot>Published</Pill> : <Pill tone="amber">In review</Pill>}
                      <span className="text-xs tabular-nums text-slate-500">{p.published_at.slice(0, 10)}</span>
                      {p.author && <span className="text-xs text-slate-500">· {p.author}</span>}
                    </div>
                    <p className="text-sm font-semibold text-slate-900 group-hover:text-indigo-700">{p.title}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-slate-400">/{p.slug}</p>
                  </div>
                </button>
              </motion.div>
              );
            })}
          </motion.div>
        )}

        {/* Bulk action bar */}
        <AnimatePresence>
          {selected.size > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 24 }}
              transition={{ type: 'spring', stiffness: 420, damping: 36 }}
              className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-3"
            >
              <div className="pointer-events-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#E5E5E5] bg-white/95 px-4 py-3 shadow-[0_12px_40px_rgba(15,23,42,0.16)] backdrop-blur">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-brand-50 px-2 text-xs font-semibold tabular-nums text-brand-700 ring-1 ring-inset ring-brand-100">
                    {selected.size}
                  </span>
                  <span className="text-sm font-medium text-ink">selected</span>
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="ml-1 text-xs text-ink/45 underline-offset-2 hover:text-ink/70 hover:underline"
                  >
                    Clear
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => setPublishedBulk(false)}
                    loading={publishing === 'unpublish'}
                    disabled={publishing !== null}
                  >
                    Unpublish
                  </Button>
                  <Button
                    onClick={() => setPublishedBulk(true)}
                    loading={publishing === 'publish'}
                    disabled={publishing !== null}
                  >
                    {publishing === 'publish' ? 'Posting…' : 'Post now'}
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </PageWrap>
  );
}
