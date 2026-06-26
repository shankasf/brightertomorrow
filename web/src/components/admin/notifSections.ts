// Canonical list of badge-able admin sections, shared by the sidebar badges
// (AdminNav), the notification drawer (NotificationPanel) and the
// mark-seen-on-navigation logic (AdminShell). Keys match the gateway's
// /admin/api/notifications/counts response.
//
// HIPAA: these are section labels + routes only — no PHI. The notification
// surfaces show aggregate counts and link to the existing list pages, which
// audit PHI access on detail views (§164.312(b)).
export type NotifSection = {
  section: string;
  href: string;
  label: string;
  // Plain-English description of what "new" means for this section.
  blurb: string;
};

export const NOTIF_SECTIONS: NotifSection[] = [
  { section: 'appointments', href: '/admin/appointments', label: 'Appointment Requests', blurb: 'new appointment requests' },
  { section: 'insurance_checks', href: '/admin/insurance-checks', label: 'Insurance Checks', blurb: 'new insurance checks' },
  { section: 'callbacks', href: '/admin/callbacks', label: 'Callback Requests', blurb: 'new callback requests' },
  { section: 'contacts', href: '/admin/contacts', label: 'Website Enquiries', blurb: 'new website enquiries' },
  { section: 'chat', href: '/admin/chat', label: 'Chat Sessions', blurb: 'new chat sessions' },
  { section: 'newsletter', href: '/admin/newsletter', label: 'Newsletter Sign-ups', blurb: 'new newsletter sign-ups' },
];

// Maps a current pathname to its notification section key (so opening the page
// clears that badge), or null if the route isn't a badged section.
export function sectionForPath(pathname: string): string | null {
  const m = NOTIF_SECTIONS.find(
    (s) => pathname === s.href || pathname.startsWith(s.href + '/'),
  );
  return m ? m.section : null;
}

// Total unread across all sections — drives the bell badge.
export function totalUnread(counts: Record<string, number>): number {
  return NOTIF_SECTIONS.reduce((sum, s) => sum + (counts[s.section] ?? 0), 0);
}
