'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { adminFetch } from '@/components/admin/useAdminAuth';
import {
  Card, Button, Input, Textarea, Field, Checkbox, ErrorBanner, PageWrap,
} from '@/components/admin/ui';
import { MarkdownField } from '@/components/admin/MarkdownField';
import { LuChevronLeft, LuImage, LuImageOff } from 'react-icons/lu';

/** Live thumbnail of the cover image so the admin sees what's attached. */
function CoverPreview({ url }: { url: string }) {
  const [errored, setErrored] = useState(false);
  useEffect(() => { setErrored(false); }, [url]);

  if (!url.trim()) {
    return (
      <div className="mt-2 flex h-40 w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[#E5E5E5] bg-cream/40 text-ink/40">
        <LuImage width={22} height={22} strokeWidth={1.6} />
        <span className="text-xs">No cover image yet</span>
      </div>
    );
  }
  if (errored) {
    return (
      <div className="mt-2 flex h-40 w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-rose-200 bg-rose-50/50 text-rose-400">
        <LuImageOff width={22} height={22} strokeWidth={1.6} />
        <span className="text-xs">Image didn’t load — check the URL</span>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt="Cover preview"
      onError={() => setErrored(true)}
      className="mt-2 h-40 w-full rounded-lg object-cover ring-1 ring-inset ring-[#E5E5E5]"
    />
  );
}

type PostForm = { slug: string; title: string; excerpt: string; body_md: string; cover_url: string; author_member_id: number | null; published: boolean };
const empty: PostForm = { slug: '', title: '', excerpt: '', body_md: '', cover_url: '', author_member_id: null, published: false };

type TeamOption = { id: number; full_name: string; credentials: string | null };

export default function BlogEditPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const isNew = id === 'new';

  const [form, setForm] = useState<PostForm>(empty);
  const [members, setMembers] = useState<TeamOption[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    adminFetch('/admin/content/team/members')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => setMembers(d.members ?? []))
      .catch(() => {/* non-fatal: author picker just shows no options */});
  }, []);

  useEffect(() => {
    if (isNew) { setLoading(false); return; }
    adminFetch(`/admin/content/blog/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => setForm({
        slug: d.slug, title: d.title, excerpt: d.excerpt ?? '',
        body_md: d.body_md ?? '', cover_url: d.cover_url ?? '',
        author_member_id: d.author_member_id ?? null, published: d.published,
      }))
      .catch(() => setError('Not found or access denied'))
      .finally(() => setLoading(false));
  }, [id, isNew]);

  const save = async () => {
    setSaving(true);
    setError('');
    const body = {
      ...form,
      excerpt: form.excerpt || null,
      body_md: form.body_md || null,
      cover_url: form.cover_url || null,
      // author text is derived server-side from the linked therapist.
      author: null,
    };
    try {
      const r = isNew
        ? await adminFetch('/admin/content/blog', { method: 'POST', body: JSON.stringify(body) })
        : await adminFetch(`/admin/content/blog/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      if (!r.ok) throw new Error();
      router.push('/admin/content/blog');
    } catch {
      setError('Could not save. Check the fields and try again.');
      setSaving(false);
    }
  };

  const del = async () => {
    if (!confirm('Delete this blog post?')) return;
    setDeleting(true);
    try {
      await adminFetch(`/admin/content/blog/${id}`, { method: 'DELETE' });
      router.push('/admin/content/blog');
    } catch {
      setDeleting(false);
    }
  };

  return (
    <PageWrap max="max-w-3xl">
      <Link href="/admin/content/blog" className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-indigo-600">
        <LuChevronLeft width={14} height={14} strokeWidth={2} />
        Back to blog posts
      </Link>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {loading ? (
        <Card>
          <p className="text-sm text-slate-500">Loading…</p>
        </Card>
      ) : (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
          <Card className="border-indigo-200/70 bg-gradient-to-br from-indigo-50/40 via-white to-white">
            <h1 className="mb-4 text-lg font-semibold tracking-tight text-slate-900">{isNew ? 'New post' : 'Edit post'}</h1>
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
              <Field label="Body">
                {/* Rich Markdown editor: formatting toolbar (bold, italic, headings,
                    lists, links, etc.), auto-growing non-resizable input, live preview. */}
                <MarkdownField value={form.body_md} onChange={(v) => setForm({ ...form, body_md: v })} />
              </Field>
              <Field label="Cover image URL">
                <Input
                  value={form.cover_url}
                  onChange={(e) => setForm({ ...form, cover_url: e.target.value })}
                  placeholder="/blog/your-image.jpg"
                />
                <CoverPreview url={form.cover_url} />
              </Field>
              <Field label="Author">
                <select
                  value={form.author_member_id ?? ''}
                  onChange={(e) => setForm({ ...form, author_member_id: e.target.value ? Number(e.target.value) : null })}
                  className="w-full rounded-lg border border-[#E5E5E5] bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                >
                  <option value="">— Select therapist —</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.credentials ? `${m.full_name}, ${m.credentials}` : m.full_name}
                    </option>
                  ))}
                </select>
              </Field>
              <Checkbox label="Published" checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} />
            </div>
            <div className="mt-6 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Button onClick={save} loading={saving}>{saving ? 'Saving…' : 'Save'}</Button>
                <Button variant="secondary" onClick={() => router.push('/admin/content/blog')}>Cancel</Button>
              </div>
              {!isNew && (
                <Button variant="ghost" onClick={del} loading={deleting} className="!text-rose-600 hover:!bg-rose-50">
                  Delete
                </Button>
              )}
            </div>
          </Card>
        </motion.div>
      )}
    </PageWrap>
  );
}
