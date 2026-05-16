'use client';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { adminFetch } from '@/components/admin/useAdminAuth';
import {
  PageHeader, PageWrap, Card, Button, Input, Textarea, Field,
  Pill, EmptyState, Checkbox,
} from '@/components/admin/ui';
import { LuPencil } from 'react-icons/lu';

type Post = { id: number; slug: string; title: string; excerpt: string | null; cover_url: string | null; author: string | null; published: boolean; published_at: string };
type PostForm = { slug: string; title: string; excerpt: string; body_md: string; cover_url: string; author: string; published: boolean };
const empty: PostForm = { slug: '', title: '', excerpt: '', body_md: '', cover_url: '', author: '', published: false };

export default function BlogPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [editing, setEditing] = useState<Post | null>(null);
  const [form, setForm] = useState<PostForm>(empty);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = () => adminFetch('/admin/content/blog').then((r) => r.json()).then((d) => setPosts(d.posts));
  useEffect(() => { load(); }, []);

  const startNew = () => { setEditing(null); setForm(empty); setOpen(true); };
  const startEdit = async (p: Post) => {
    const r = await adminFetch(`/admin/content/blog/${p.id}`);
    const d = await r.json();
    setEditing(p);
    setForm({
      slug: d.slug, title: d.title, excerpt: d.excerpt ?? '',
      body_md: d.body_md ?? '', cover_url: d.cover_url ?? '',
      author: d.author ?? '', published: d.published,
    });
    setOpen(true);
  };
  const close = () => { setOpen(false); setEditing(null); setForm(empty); };

  const save = async () => {
    setSaving(true);
    const body = { ...form, excerpt: form.excerpt || null, body_md: form.body_md || null, cover_url: form.cover_url || null, author: form.author || null };
    if (editing) await adminFetch(`/admin/content/blog/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) });
    else await adminFetch('/admin/content/blog', { method: 'POST', body: JSON.stringify(body) });
    setSaving(false);
    close();
    load();
  };

  const del = async (id: number) => {
    if (!confirm('Delete this blog post?')) return;
    await adminFetch(`/admin/content/blog/${id}`, { method: 'DELETE' });
    load();
  };

  return (
      <PageWrap max="max-w-5xl">
        <PageHeader
          title="Blog posts"
          subtitle="Long-form articles published on the public blog."
          action={<Button onClick={startNew}>＋ New post</Button>}
        />

        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: -6, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, y: -6, height: 0 }}
              transition={{ duration: 0.22 }}
              className="mb-6 overflow-hidden"
            >
              <Card className="border-indigo-200/70 bg-gradient-to-br from-indigo-50/40 via-white to-white">
                <h2 className="mb-4 text-sm font-semibold text-slate-900">{editing ? 'Edit post' : 'New post'}</h2>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Title">
                      <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                    </Field>
                    <Field label="Slug">
                      <Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} className="font-mono" />
                    </Field>
                  </div>
                  <Field label="Excerpt">
                    <Textarea rows={2} value={form.excerpt} onChange={(e) => setForm({ ...form, excerpt: e.target.value })} />
                  </Field>
                  <Field label="Body (Markdown)">
                    <Textarea rows={10} value={form.body_md} onChange={(e) => setForm({ ...form, body_md: e.target.value })} className="font-mono text-xs" />
                  </Field>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Cover URL">
                      <Input value={form.cover_url} onChange={(e) => setForm({ ...form, cover_url: e.target.value })} />
                    </Field>
                    <Field label="Author">
                      <Input value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} />
                    </Field>
                  </div>
                  <Checkbox label="Published" checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} />
                </div>
                <div className="mt-5 flex items-center gap-2">
                  <Button onClick={save} loading={saving}>{saving ? "Saving…" : "Save"}</Button>
                  <Button variant="secondary" onClick={close}>Cancel</Button>
                </div>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {posts.length === 0 ? (
          <EmptyState
            title="No blog posts yet"
            description="Publish your first post to start building the blog."
            action={<Button onClick={startNew}>＋ New post</Button>}
            icon={<LuPencil width={22} height={22} strokeWidth={1.8} />}
          />
        ) : (
          <motion.div initial="initial" animate="animate" variants={{ animate: { transition: { staggerChildren: 0.025 } } }} className="space-y-2">
            {posts.map((p) => (
              <motion.div
                key={p.id}
                variants={{ initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 } }}
                whileHover={{ y: -1 }}
                className="group flex items-start justify-between gap-4 rounded-2xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-shadow hover:shadow-[0_8px_20px_rgba(15,23,42,0.05)]"
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
                    {p.published ? <Pill tone="green" dot>Published</Pill> : <Pill tone="slate">Draft</Pill>}
                    <span className="text-xs tabular-nums text-slate-500">{p.published_at.slice(0, 10)}</span>
                    {p.author && <span className="text-xs text-slate-500">· {p.author}</span>}
                  </div>
                  <p className="text-sm font-semibold text-slate-900">{p.title}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-slate-400">/{p.slug}</p>
                </div>
                <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button variant="ghost" size="sm" onClick={() => startEdit(p)}>Edit</Button>
                  <Button variant="ghost" size="sm" onClick={() => del(p.id)} className="!text-rose-600 hover:!bg-rose-50">Delete</Button>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </PageWrap>
  );
}
