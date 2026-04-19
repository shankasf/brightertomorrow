'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AdminUser } from './useAdminAuth';

const nav = [
  { href: '/admin', label: 'Dashboard', icon: '⬛' },
  { href: '/admin/contacts', label: 'Contacts', icon: '✉' },
  { href: '/admin/chat', label: 'Chat Sessions', icon: '💬' },
  { href: '/admin/newsletter', label: 'Newsletter', icon: '📰' },
  { group: 'HIPAA Compliance', superadminOnly: true },
  { href: '/admin/audit/phi', label: 'PHI Audit Log', icon: '🔒', superadminOnly: true },
  { href: '/admin/audit/access', label: 'Admin Access Log', icon: '👤', superadminOnly: true },
  { href: '/admin/audit/purge', label: 'Purge Queue', icon: '🗑', superadminOnly: true },
  { group: 'Content', superadminOnly: true },
  { href: '/admin/content/settings', label: 'Site Settings', icon: '⚙', superadminOnly: true },
  { href: '/admin/content/faqs', label: 'FAQs', icon: '❓', superadminOnly: true },
  { href: '/admin/content/blog', label: 'Blog Posts', icon: '📝', superadminOnly: true },
  { href: '/admin/content/team', label: 'Team', icon: '👥', superadminOnly: true },
  { href: '/admin/content/services', label: 'Services', icon: '🩺', superadminOnly: true },
  { href: '/admin/content/testimonials', label: 'Testimonials', icon: '⭐', superadminOnly: true },
  { href: '/admin/content/locations', label: 'Locations', icon: '📍', superadminOnly: true },
  { href: '/admin/content/nav', label: 'Navigation', icon: '🔗', superadminOnly: true },
  { href: '/admin/content/stats', label: 'Stats', icon: '📊', superadminOnly: true },
];

export default function AdminNav({ user, onLogout }: { user: AdminUser; onLogout: () => void }) {
  const pathname = usePathname();
  const isSuperadmin = user.role === 'superadmin';

  return (
    <aside className="w-64 min-h-screen bg-gray-900 text-gray-100 flex flex-col">
      <div className="p-4 border-b border-gray-700">
        <div className="text-sm font-bold text-blue-400 uppercase tracking-wider">BT Admin</div>
        <div className="text-xs text-gray-400 mt-1 truncate">{user.email}</div>
        <div className="text-xs text-gray-500">{user.role}</div>
      </div>

      <nav className="flex-1 overflow-y-auto py-2">
        {nav.map((item, i) => {
          if ('group' in item) {
            if (item.superadminOnly && !isSuperadmin) return null;
            return (
              <div key={i} className="px-4 pt-4 pb-1 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                {item.group}
              </div>
            );
          }
          if (item.superadminOnly && !isSuperadmin) return null;
          const active = pathname === item.href || (item.href !== '/admin' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
                active
                  ? 'bg-blue-700 text-white'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-gray-700">
        <button
          onClick={onLogout}
          className="w-full text-left text-sm text-gray-400 hover:text-white transition-colors"
        >
          Sign out →
        </button>
      </div>
    </aside>
  );
}
