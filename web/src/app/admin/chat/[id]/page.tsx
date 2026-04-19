'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import AdminShell from '@/components/admin/AdminShell';
import { adminFetch } from '@/components/admin/useAdminAuth';

type Message = { id: number; role: string; content: string; tool_name: string | null; created_at: string };
type SessionDetail = {
  session: {
    id: string; visitor_id: string | null; started_at: string;
    ended_at: string | null; retain_until: string | null; purged_at: string | null;
  };
  messages: Message[];
};

const roleColor: Record<string, string> = {
  user: 'bg-blue-100 text-blue-900',
  assistant: 'bg-gray-100 text-gray-900',
  system: 'bg-purple-100 text-purple-900',
  tool: 'bg-amber-100 text-amber-900',
};

export default function ChatSessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    adminFetch(`/admin/chat/sessions/${id}`)
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then(setDetail)
      .catch(() => setError('Not found or access denied'));
  }, [id]);

  return (
    <AdminShell>
      <div className="p-6 max-w-3xl">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/admin/chat" className="text-blue-600 hover:underline text-sm">← Back to Chat Sessions</Link>
        </div>

        <div className="flex items-start justify-between mb-2">
          <h1 className="text-xl font-bold text-gray-900 font-mono">{id}</h1>
          <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full border border-amber-200">
            PHI Access Logged
          </span>
        </div>
        <p className="text-xs text-gray-500 mb-6">
          This view is recorded in the HIPAA admin access log per §164.312(b).
        </p>

        {error && <div className="text-red-600 bg-red-50 rounded-lg p-4">{error}</div>}

        {detail && (
          <>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6 grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-gray-500">Started</span><br />{detail.session.started_at.slice(0, 16).replace('T', ' ')}</div>
              <div><span className="text-gray-500">Ended</span><br />{detail.session.ended_at?.slice(0, 16).replace('T', ' ') ?? '—'}</div>
              <div><span className="text-gray-500">Retain Until</span><br />{detail.session.retain_until?.slice(0, 10) ?? '—'}</div>
              <div><span className="text-gray-500">Anonymized</span><br />{detail.session.purged_at ? detail.session.purged_at.slice(0, 10) : 'No'}</div>
            </div>

            <div className="space-y-3">
              {detail.messages.map((m) => (
                <div key={m.id} className={`rounded-lg p-4 ${roleColor[m.role] ?? 'bg-gray-50'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold uppercase tracking-wide opacity-60">{m.role}</span>
                    <span className="text-xs opacity-50">{m.created_at.slice(0, 16).replace('T', ' ')}</span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{m.content}</p>
                </div>
              ))}
              {detail.messages.length === 0 && (
                <p className="text-gray-400 text-sm">No messages in this session.</p>
              )}
            </div>
          </>
        )}
      </div>
    </AdminShell>
  );
}
