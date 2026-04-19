'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import AdminShell from '@/components/admin/AdminShell';
import { adminFetch } from '@/components/admin/useAdminAuth';

type ContactDetail = {
  id: number; full_name: string; email: string; phone: string | null;
  subject: string | null; message: string; source: string | null;
  created_at: string; retain_until: string | null; purged_at: string | null;
};

export default function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [contact, setContact] = useState<ContactDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    adminFetch(`/admin/contacts/${id}`)
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then(setContact)
      .catch(() => setError('Not found or access denied'));
  }, [id]);

  return (
    <AdminShell>
      <div className="p-6 max-w-2xl">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/admin/contacts" className="text-blue-600 hover:underline text-sm">← Back to Contacts</Link>
        </div>

        <div className="flex items-start justify-between mb-2">
          <h1 className="text-2xl font-bold text-gray-900">Contact #{id}</h1>
          <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full border border-amber-200">
            PHI Access Logged
          </span>
        </div>
        <p className="text-xs text-gray-500 mb-6">
          This page view has been recorded in the HIPAA admin access log per §164.312(b).
        </p>

        {error && <div className="text-red-600 bg-red-50 rounded-lg p-4">{error}</div>}

        {contact && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 divide-y divide-gray-50">
            {[
              ['Full Name', contact.full_name],
              ['Email', contact.email],
              ['Phone', contact.phone ?? '—'],
              ['Subject', contact.subject ?? '—'],
              ['Source', contact.source ?? '—'],
              ['Received', contact.created_at.slice(0, 16).replace('T', ' ')],
              ['Retain Until', contact.retain_until ? contact.retain_until.slice(0, 10) : '—'],
              ['Anonymized', contact.purged_at ? contact.purged_at.slice(0, 16) : 'No'],
            ].map(([label, value]) => (
              <div key={label} className="flex px-5 py-3">
                <span className="w-36 text-sm text-gray-500 shrink-0">{label}</span>
                <span className="text-sm text-gray-900">{value}</span>
              </div>
            ))}
            <div className="px-5 py-4">
              <div className="text-sm text-gray-500 mb-2">Message</div>
              <div className="text-sm text-gray-900 whitespace-pre-wrap bg-gray-50 rounded-lg p-3">
                {contact.purged_at ? '[REDACTED — record has been anonymized]' : contact.message}
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminShell>
  );
}
