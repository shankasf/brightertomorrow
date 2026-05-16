'use client';
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { adminFetch } from '@/components/admin/useAdminAuth';
import {
  PageHeader, PageWrap, TableCard, THead, TH, TD,
  Pill, Pagination, EmptyState, Input, SkeletonRows, Button,
} from '@/components/admin/ui';
import { formatPTDate } from '@/lib/time-pt';
import { LuSearch, LuNewspaper } from 'react-icons/lu';

type Subscriber = {
  id: number; email: string; created_at: string;
  unsubscribed_at: string | null; deletion_requested_at: string | null;
};

type Filter = 'all' | 'active' | 'unsubscribed' | 'deletion';

export default function AdminNewsletterPage() {
  const [data, setData] = useState<{ data: Subscriber[]; total: number } | null>(null);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<Record<number, boolean>>({});
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const load = () => {
    setData(null);
    adminFetch(`/admin/newsletter?page=${page}&limit=50`).then((r) => r.json()).then(setData);
  };
  useEffect(load, [page]);

  const unsubscribe = async (id: number) => {
    if (!confirm('Mark this subscriber as unsubscribed?')) return;
    setBusy((b) => ({ ...b, [id]: true }));
    await adminFetch(`/admin/newsletter/${id}`, { method: 'DELETE' });
    setBusy((b) => ({ ...b, [id]: false }));
    load();
  };
  const requestDeletion = async (id: number) => {
    if (!confirm('Mark this email for deletion (Nevada NRS 603A)?')) return;
    setBusy((b) => ({ ...b, [id]: true }));
    await adminFetch(`/admin/newsletter/${id}/request-deletion`, { method: 'POST' });
    setBusy((b) => ({ ...b, [id]: false }));
    load();
  };

  const filtered = useMemo(() => {
    if (!data) return null;
    let rows = data.data;
    if (query.trim()) rows = rows.filter((s) => s.email.toLowerCase().includes(query.toLowerCase()));
    if (filter === 'active') rows = rows.filter((s) => !s.unsubscribed_at && !s.deletion_requested_at);
    if (filter === 'unsubscribed') rows = rows.filter((s) => s.unsubscribed_at && !s.deletion_requested_at);
    if (filter === 'deletion') rows = rows.filter((s) => s.deletion_requested_at);
    return rows;
  }, [data, query, filter]);

  const counts = useMemo(() => {
    if (!data) return { all: 0, active: 0, unsubscribed: 0, deletion: 0 };
    return {
      all: data.data.length,
      active: data.data.filter((s) => !s.unsubscribed_at && !s.deletion_requested_at).length,
      unsubscribed: data.data.filter((s) => s.unsubscribed_at && !s.deletion_requested_at).length,
      deletion: data.data.filter((s) => s.deletion_requested_at).length,
    };
  }, [data]);

  const FilterChip = ({ value, label, count, tone }: { value: Filter; label: string; count: number; tone?: string }) => {
    const active = filter === value;
    return (
      <button
        onClick={() => setFilter(value)}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all ${
          active
            ? 'bg-slate-900 text-white shadow-sm ring-1 ring-slate-900'
            : 'bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:ring-slate-300'
        }`}
      >
        {label}
        <span className={`rounded-full px-1.5 py-0 text-[10px] tabular-nums ${active ? 'bg-white/20' : tone ?? 'bg-slate-100'}`}>
          {count}
        </span>
      </button>
    );
  };

  return (
      <PageWrap>
        <PageHeader
          title="Newsletter subscribers"
          subtitle="Manage opt-ins, unsubscribes, and right-to-erasure requests (Nevada NRS 603A)."
          action={
            <div className="relative">
              <LuSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" strokeWidth={2} />
              <Input placeholder="Search email…" value={query} onChange={(e) => setQuery(e.target.value)} className="!w-60 !pl-9" />
            </div>
          }
        />

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <FilterChip value="all" label="All" count={counts.all} />
          <FilterChip value="active" label="Active" count={counts.active} />
          <FilterChip value="unsubscribed" label="Unsubscribed" count={counts.unsubscribed} />
          <FilterChip value="deletion" label="Deletion requested" count={counts.deletion} />
        </div>

        {!data ? (
          <SkeletonRows rows={6} cols={4} />
        ) : filtered && filtered.length === 0 ? (
          <EmptyState
            title={query || filter !== 'all' ? 'No matches' : 'No subscribers yet'}
            description={query || filter !== 'all' ? 'Try a different search or filter.' : 'New newsletter signups will appear here.'}
            icon={<LuNewspaper width={22} height={22} strokeWidth={1.8} />}
          />
        ) : (
          <>
            <TableCard>
              <THead>
                <tr>
                  <TH>Email</TH>
                  <TH className="bt-col-hide-md">Subscribed</TH>
                  <TH>Status</TH>
                  <TH className="bt-col-hide-sm text-right">Actions</TH>
                </tr>
              </THead>
              <motion.tbody initial="initial" animate="animate" variants={{ animate: { transition: { staggerChildren: 0.012 } } }}>
                {filtered!.map((s) => (
                  <motion.tr
                    key={s.id}
                    variants={{ initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 } }}
                    className="group"
                  >
                    <TD className="break-all">{s.email}</TD>
                    <TD className="bt-col-hide-md tabular-nums whitespace-nowrap text-[12.5px] text-ink-soft">
                      {formatPTDate(s.created_at)}
                    </TD>
                    <TD>
                      {s.deletion_requested_at ? (
                        <Pill tone="red" dot>Deletion requested</Pill>
                      ) : s.unsubscribed_at ? (
                        <Pill tone="slate">Unsubscribed</Pill>
                      ) : (
                        <Pill tone="green" dot>Active</Pill>
                      )}
                    </TD>
                    <TD className="bt-col-hide-sm text-right">
                      <div className="flex flex-wrap justify-end gap-1.5 opacity-80 transition-opacity group-hover:opacity-100">
                        {!s.unsubscribed_at && !s.deletion_requested_at && (
                          <Button variant="ghost" size="sm" disabled={busy[s.id]} onClick={() => unsubscribe(s.id)}>
                            Unsubscribe
                          </Button>
                        )}
                        {!s.deletion_requested_at && (
                          <Button variant="ghost" size="sm" disabled={busy[s.id]} onClick={() => requestDeletion(s.id)} className="!text-rose-700 hover:!bg-rose-50">
                            Request deletion
                          </Button>
                        )}
                      </div>
                    </TD>
                  </motion.tr>
                ))}
              </motion.tbody>
            </TableCard>
            <Pagination page={page} total={data.total} pageSize={50} onChange={setPage} />
          </>
        )}
      </PageWrap>
  );
}
