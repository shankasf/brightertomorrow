'use client';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { adminFetch } from '@/components/admin/useAdminAuth';
import {
  PageHeader, PageWrap, TableCard, THead, TH, TD,
  EmptyState, SkeletonRows, Button, ErrorBanner,
} from '@/components/admin/ui';
import { formatPTDate } from '@/lib/time-pt';
import { LuCheck } from 'react-icons/lu';

type PurgeItem = { source: string; row_id: string; retain_until: string };

export default function PurgeQueuePage() {
  const [items, setItems] = useState<PurgeItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = () => {
    adminFetch('/admin/audit/purge-queue').then((r) => r.json()).then((d) => setItems(d.items));
  };
  useEffect(load, []);

  const purge = async (item: PurgeItem) => {
    if (!confirm(`Anonymize ${item.source} #${item.row_id}? This cannot be undone.`)) return;
    const key = `${item.source}:${item.row_id}`;
    setBusy(key);
    setError('');
    const path =
      item.source === 'contact_submissions'
        ? `/admin/audit/purge/contact/${item.row_id}`
        : `/admin/audit/purge/chat/${item.row_id}`;
    const res = await adminFetch(path, { method: 'POST' });
    setBusy(null);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? 'Purge failed');
    } else {
      load();
    }
  };

  return (
      <PageWrap>
        <PageHeader
          title="Purge queue"
          subtitle="Records that have exceeded their 10-year Nevada NRS 629.051 retention period. Anonymizing invokes the right-to-erasure procedure (Nevada NRS 603A) — irreversible and logged."
        />

        {error && <ErrorBanner>{error}</ErrorBanner>}

        {items === null ? (
          <SkeletonRows rows={4} cols={4} />
        ) : items.length === 0 ? (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <div className="rounded-2xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50 via-white to-emerald-50/30 p-8 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 ring-1 ring-inset ring-emerald-200">
                <LuCheck width={22} height={22} strokeWidth={2.5} />
              </div>
              <h3 className="text-base font-semibold text-emerald-900">All clear</h3>
              <p className="mt-1 text-sm text-emerald-700/80">No records require purging — every retention period is within compliance.</p>
            </div>
          </motion.div>
        ) : (
          <TableCard>
            <THead>
              <tr>
                <TH>Source</TH>
                <TH className="bt-col-hide-md">Row ID</TH>
                <TH className="bt-col-hide-sm">Retain until</TH>
                <TH className="text-right">Action</TH>
              </tr>
            </THead>
            <motion.tbody initial="initial" animate="animate" variants={{ animate: { transition: { staggerChildren: 0.02 } } }}>
              {items.map((item) => {
                const key = `${item.source}:${item.row_id}`;
                return (
                  <motion.tr
                    key={key}
                    variants={{ initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 } }}
                  >
                    <TD className="font-mono text-[13px]">{item.source}</TD>
                    <TD className="bt-col-hide-md font-mono text-[12.5px] text-ink-soft">{item.row_id}</TD>
                    <TD className="bt-col-hide-sm">
                      <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-rose-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                        {formatPTDate(item.retain_until)}
                      </span>
                    </TD>
                    <TD className="text-right">
                      <Button variant="danger" size="sm" disabled={busy === key} onClick={() => purge(item)}>
                        {busy === key ? 'Processing…' : 'Anonymize'}
                      </Button>
                    </TD>
                  </motion.tr>
                );
              })}
            </motion.tbody>
          </TableCard>
        )}
      </PageWrap>
  );
}
