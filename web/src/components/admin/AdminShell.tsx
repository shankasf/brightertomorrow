'use client';
import { usePathname } from 'next/navigation';
import { useAdminAuth } from './useAdminAuth';
import AdminNav from './AdminNav';
import { BTSpinner } from './Spinner';

function ChromedShell({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAdminAuth();

  if (loading) {
    return (
      <div className="grid h-screen place-items-center bg-gradient-to-br from-[#192735] via-[#1f2c3c] to-[#253A4D]">
        <BTSpinner size="lg" label="Loading admin" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-cream-alt font-sans text-ink antialiased">
      <AdminNav user={user} onLogout={logout} />
      <main className="relative flex-1 overflow-y-auto">
        {/* Warm ambient gradient backdrop */}
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-0 h-72 bg-gradient-to-b from-brand-50/70 via-cream-alt/0 to-transparent" />
        <div className="pointer-events-none absolute -right-40 -top-40 -z-0 h-80 w-80 rounded-full bg-brand-100/50 blur-3xl" />
        <div className="pointer-events-none absolute -left-32 top-1/3 -z-0 h-72 w-72 rounded-full bg-[#fbe8eb]/40 blur-3xl" />
        <div className="relative z-10">{children}</div>
      </main>
    </div>
  );
}

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === '/admin/login') return <>{children}</>;
  return <ChromedShell>{children}</ChromedShell>;
}
