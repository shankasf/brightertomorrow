'use client';
import { useEffect, useState } from 'react';
import AdminShell from '@/components/admin/AdminShell';
import { adminFetch } from '@/components/admin/useAdminAuth';

type Post = { id: number; slug: string; title: string; excerpt: string | null; cover_url: string | null; author: string | null; published: boolean; published_at: string };
type PostForm = { slug: string; title: string; excerpt: string; body_md: string; cover_url: string; author: string; published: boolean };
const empty: PostForm = { slug: '', title: '', excerpt: '', body_md: '', cover_url: '', author: '', published: false };

export default function BlogPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [editing, setEditing] = useState<Post | null>(null);
  const [form, setForm] = useState<PostForm>(empty);
  const [saving, setSaving] = useState(false);
  const [fullPost, setFullPost] = useState<(PostForm & { id: number }) | null>(null);

  const load = () =>
    adminFetch('/admin/content/blog').then((r) => r.json()).then((d) => setPosts(d.posts));

  useEffect(() => { load(); }, []);

  const startEdit = async (p: Post) => {
    const r = await adminFetch(`/admin/content/blog/${p.id}`);
    const d = await r.json();
    setEditing(p);
    setFullPost(d);
    setForm({
      slug: d.slug, title: d.title, excerpt: d.excerpt ?? '',
      body_md: d.body_md ?? '', cover_url: d.cover_url ?? '',
      author: d.author ?? '', published: d.published,
    });
  };

  const save = async () => {
    setSaving(true);
    const body = { ...form, excerpt: form.excerpt || null, body_md: form.body_md || null, cover_url: form.cover_url || null, author: form.author || null };
    if (editing) {
      await adminFetch(`/admin/content/blog/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) });
    } else {
      await adminFetch('/admin/content/blog', { method: 'POST', body: JSON.stringify(body) });
    }
    setSaving(false);
    setEditing(null);
    setFullPost(null);
    setForm(empty);
    load();
  };

  const del = async (id: number) => {
    if (!confirm('Delete this blog post?')) return;
    await adminFetch(`/admin/content/blog/${id}`, { method: 'DELETE' });
    load();
  };

  const isEditing = editing !== null || form.title !== '';

  return (
    <AdminShell>
      <div className="p-6 max-w-5xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Blog Posts</h1>
          <button onClick={() => { setEditing(null); setFullPost(null); setForm(empty); }}
            className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700">+ New Post</button>
        </div>

        {isEditing && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6 space-y-4">
            <h2 className="font-semibold text-gray-700">{editing ? 'Edit Post' : 'New Post'}</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Title</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Slug</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Excerpt</label>
              <textarea className="w-full border rounded-lg px-3 py-2 text-sm h-16 resize-none" value={form.excerpt}
                onChange={(e) => setForm({ ...form, excerpt: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Body (Markdown)</label>
              <textarea className="w-full border rounded-lg px-3 py-2 text-sm h-48 resize-y font-mono text-xs" value={form.body_md}
                onChange={(e) => setForm({ ...form, body_md: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Cover URL</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.cover_url}
                  onChange={(e) => setForm({ ...form, cover_url: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Author</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.author}
                  onChange={(e) => setForm({ ...form, author: e.target.value })} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.published}
                onChange={(e) => setForm({ ...form, published: e.target.checked })} />
              Published
            </label>
            <div className="flex gap-2">
              <button disabled={saving} onClick={save}
                className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-40">
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => { setEditing(null); setFullPost(null); setForm(empty); }}
                className="text-sm px-4 py-2 rounded-lg border hover:bg-gray-50">Cancel</button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {posts.map((p) => (
            <div key={p.id} className="bg-white rounded-xl border border-gray-100 p-4 flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  {p.published
                    ? <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Published</span>
                    : <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Draft</span>}
                  <span className="text-xs text-gray-400">{p.published_at.slice(0, 10)}</span>
                </div>
                <p className="text-sm font-medium text-gray-900">{p.title}</p>
                <p className="text-xs text-gray-500 mt-0.5 font-mono">{p.slug}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => startEdit(p)} className="text-xs text-blue-600 hover:underline">Edit</button>
                <button onClick={() => del(p.id)} className="text-xs text-red-600 hover:underline">Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AdminShell>
  );
}
