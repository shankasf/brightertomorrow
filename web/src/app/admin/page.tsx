'use client';
import { useEffect, useState } from 'react';
import AdminShell from '@/components/admin/AdminShell';
import { adminFetch } from '@/components/admin/useAdminAuth';

type Stats = {
  contacts: { total: number; today: number };
  chat: { total_sessions: number; active_sessions: number; today_sessions: number; total_messages: number };
  newsletter: { total: number; active: number };
  content: { faqs: number; blog_posts: number; published_posts: number; team_members: number };
  compliance: { purge_queue_size: number };
};

function StatCard({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="text-sm text-gray-600 mt-1">{label}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    adminFetch('/admin/stats')
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then(setStats)
      .catch(() => setError('Failed to load stats'));
  }, []);

  return (
    <AdminShell>
      <div className="p-6 max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h1>

        {error && <div className="text-red-600 mb-4">{error}</div>}

        {stats ? (
          <div className="space-y-6">
            <section>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Contacts & Chat</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="Total Contacts" value={stats.contacts.total} sub={`+${stats.contacts.today} today`} />
                <StatCard label="Chat Sessions" value={stats.chat.total_sessions} sub={`${stats.chat.active_sessions} active`} />
                <StatCard label="Today's Chats" value={stats.chat.today_sessions} />
                <StatCard label="Total Messages" value={stats.chat.total_messages} />
              </div>
            </section>

            <section>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Newsletter</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="Total Subscribers" value={stats.newsletter.total} />
                <StatCard label="Active Subscribers" value={stats.newsletter.active} />
              </div>
            </section>

            <section>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Content</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="FAQs" value={stats.content.faqs} />
                <StatCard label="Blog Posts" value={stats.content.blog_posts} sub={`${stats.content.published_posts} published`} />
                <StatCard label="Team Members" value={stats.content.team_members} />
              </div>
            </section>

            <section>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">HIPAA Compliance</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                  label="Purge Queue"
                  value={stats.compliance.purge_queue_size}
                  sub={stats.compliance.purge_queue_size > 0 ? '⚠ Records pending anonymization' : '✓ All clear'}
                />
              </div>
              {stats.compliance.purge_queue_size > 0 && (
                <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
                  <strong>Attention:</strong> {stats.compliance.purge_queue_size} record(s) have exceeded their 10-year
                  Nevada NRS 629.051 retention period. Please review the{' '}
                  <a href="/admin/audit/purge" className="underline">Purge Queue</a>.
                </div>
              )}
            </section>
          </div>
        ) : !error ? (
          <div className="text-gray-400">Loading…</div>
        ) : null}
      </div>
    </AdminShell>
  );
}
