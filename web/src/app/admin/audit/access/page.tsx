'use client';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { adminFetch } from '@/components/admin/useAdminAuth';
import {
  PageHeader, PageWrap, TableCard, THead, TH, TD,
  Pagination, EmptyState, SkeletonRows, PHIBadge,
} from '@/components/admin/ui';

type AccessEntry = {
  id: number; event_time: string; admin_email: string;
  action: string; resource_type: string; resource_id: string | null; ip_address: string | null;
};

export default function AdminAccessLogPage() {
  const [data, setData] = useState<{ data: AccessEntry[]; total: number } | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setData(null);
    adminFetch(`/admin/audit/access?page=${page}&limit=50`).then((r) => r.json()).then(setData);
  }, [page]);

  return (
      <PageWrap>
        <PageHeader
          title="Admin access log"
          subtitle="Every admin read of PHI is recorded here per HIPAA §164.312(b). Append-only — entries cannot be modified or deleted."
          badge={<PHIBadge />}
        />

        {!data ? (
          <SkeletonRows rows={8} cols={5} />
        ) : data.data.length === 0 ? (
          <EmptyState title="No access events recorded" description="Once an admin views a PHI record, it'll show up here." />
        ) : (
          <>
            <TableCard>
              <THead>
                <tr>
                  <TH>Time</TH>
                  <TH>Admin</TH>
                  <TH>Action</TH>
                  <TH>Resource</TH>
                  <TH>IP</TH>
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
                    <TD className="text-xs text-slate-700">{e.admin_email}</TD>
                    <TD>
                      <span className="inline-flex items-center rounded-md bg-indigo-50 px-1.5 py-0.5 font-mono text-[11px] text-indigo-700 ring-1 ring-inset ring-indigo-100">
                        {e.action}
                      </span>
                    </TD>
                    <TD className="text-xs text-slate-600">
                      <span className="font-mono">{e.resource_type}</span>
                      {e.resource_id && <span className="ml-1 text-slate-400">#{e.resource_id}</span>}
                    </TD>
                    <TD className="font-mono text-xs text-slate-500">{e.ip_address ?? <span className="text-slate-300">—</span>}</TD>
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
