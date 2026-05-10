'use client';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { adminFetch } from '@/components/admin/useAdminAuth';
import {
  PageHeader, PageWrap, TableCard, THead, TH, TD,
  Pill, Pagination, EmptyState, SkeletonRows, PHIBadge,
} from '@/components/admin/ui';

type AuditEntry = {
  id: number; event_time: string; table_name: string;
  operation: string; row_id: string; actor: string; app_user: string | null;
};

const opTone: Record<string, 'green' | 'amber' | 'red' | 'slate'> = {
  INSERT: 'green',
  UPDATE: 'amber',
  DELETE: 'red',
};

export default function PHIAuditLogPage() {
  const [data, setData] = useState<{ data: AuditEntry[]; total: number } | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setData(null);
    adminFetch(`/admin/audit/phi?page=${page}&limit=50`).then((r) => r.json()).then(setData);
  }, [page]);

  return (
      <PageWrap>
        <PageHeader
          title="PHI audit log"
          subtitle="Append-only log of all PHI mutations (HIPAA §164.312(b)). Message content is redacted per minimum necessary. This view is also logged."
          badge={<PHIBadge />}
        />

        {!data ? (
          <SkeletonRows rows={8} cols={5} />
        ) : data.data.length === 0 ? (
          <EmptyState title="No mutations recorded" description="Inserts, updates, and deletes against PHI tables will appear here." />
        ) : (
          <>
            <TableCard>
              <THead>
                <tr>
                  <TH>Time</TH>
                  <TH>Table</TH>
                  <TH>Op</TH>
                  <TH>Row ID</TH>
                  <TH>Actor</TH>
                </tr>
              </THead>
              <motion.tbody initial="initial" animate="animate" variants={{ animate: { transition: { staggerChildren: 0.01 } } }}>
                {data.data.map((e) => (
                  <motion.tr
                    key={e.id}
                    variants={{ initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 } }}
                    className="border-t border-slate-100 hover:bg-slate-50/70"
                  >
                    <TD className="font-mono text-xs tabular-nums text-slate-500">{e.event_time.slice(0, 19).replace('T', ' ')}</TD>
                    <TD className="font-mono text-xs text-slate-700">{e.table_name}</TD>
                    <TD>
                      <Pill tone={opTone[e.operation] ?? 'slate'}>{e.operation}</Pill>
                    </TD>
                    <TD className="font-mono text-xs text-slate-600">{e.row_id}</TD>
                    <TD className="text-xs text-slate-600">{e.app_user ?? e.actor}</TD>
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
