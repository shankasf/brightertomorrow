'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { adminFetch } from '@/components/admin/useAdminAuth';
import { Card, ErrorBanner, PageWrap, PHIBadge, Pill } from '@/components/admin/ui';
import { formatPT, formatPTDate } from '@/lib/time-pt';
import { LuChevronLeft, LuMessageSquare } from 'react-icons/lu';

type ContactDetail = {
  id: number; full_name: string; email: string; phone: string | null;
  subject: string | null; message: string; source: string | null;
  created_at: string; retain_until: string | null; purged_at: string | null;
  first_name: string | null; last_name: string | null; help_topic: string | null;
  other_describe: string | null; preferred_contact_method: string | null;
  best_time: string | null; therapist_requested: string | null;
};

export default function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [contact, setContact] = useState<ContactDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    adminFetch(`/admin/contacts/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setContact)
      .catch(() => setError('Not found or access denied'));
  }, [id]);

  return (
      <PageWrap max="max-w-3xl">
        <Link href="/admin/contacts" className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-indigo-600">
          <LuChevronLeft width={14} height={14} strokeWidth={2} />
          Back to contacts
        </Link>

        {error && <ErrorBanner>{error}</ErrorBanner>}

        {contact && (
          <>
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="mb-6 flex items-start justify-between gap-4"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-cyan-500 text-base font-semibold text-white shadow-md">
                  {contact.full_name[0]?.toUpperCase() ?? '?'}
                </div>
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{contact.full_name}</h1>
                  <div className="mt-1 flex items-center gap-2 text-sm text-slate-500">
                    <span className="font-mono">#{contact.id}</span>
                    <span className="text-slate-300">·</span>
                    <a href={`mailto:${contact.email}`} className="text-indigo-600 hover:underline">{contact.email}</a>
                  </div>
                </div>
              </div>
              <PHIBadge />
            </motion.div>

            <Card padded={false} className="divide-y divide-slate-100">
              {(
                [
                  ['First name', contact.first_name ?? '—'],
                  ['Last name', contact.last_name ?? '—'],
                  ['Email', contact.email],
                  ['Phone', contact.phone ?? '—'],
                  ['Help topic', contact.help_topic ?? contact.subject ?? '—'],
                  ['Preferred contact', contact.preferred_contact_method ?? '—'],
                  ['Best time to reach', contact.best_time ?? '—'],
                  ['Therapist requested', contact.therapist_requested ?? '—'],
                  ['Source', contact.source ?? '—'],
                  ['Received', formatPT(contact.created_at)],
                  ['Retain until', formatPTDate(contact.retain_until)],
                ] as [string, string][]
              ).map(([label, value]) => (
                <div key={label} className="flex items-center px-5 py-3">
                  <span className="w-36 shrink-0 text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</span>
                  <span className="text-sm text-slate-800">{value}</span>
                </div>
              ))}
              <div className="flex items-center px-5 py-3">
                <span className="w-36 shrink-0 text-[11px] font-medium uppercase tracking-wider text-slate-500">Status</span>
                {contact.purged_at ? (
                  <Pill tone="slate">Anonymized · {formatPTDate(contact.purged_at)}</Pill>
                ) : (
                  <Pill tone="green" dot>Active</Pill>
                )}
              </div>
            </Card>

            <Card className="mt-4">
              <div className="mb-3 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-slate-500">
                <LuMessageSquare width={13} height={13} strokeWidth={2} />
                Message
              </div>
              <div className="whitespace-pre-wrap rounded-xl border border-slate-100 bg-gradient-to-br from-slate-50 to-white p-4 text-sm leading-relaxed text-slate-800">
                {contact.purged_at ? (
                  <span className="italic text-slate-400">[REDACTED — record has been anonymized]</span>
                ) : (
                  contact.message
                )}
              </div>
            </Card>
          </>
        )}
      </PageWrap>
  );
}
