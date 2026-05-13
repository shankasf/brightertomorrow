import type { Metadata } from 'next';
import CalendarClient from './CalendarClient';

export const metadata: Metadata = {
  title: 'Calendar — Admin · Brighter Tomorrow Therapy',
  robots: { index: false, follow: false },
};

// Server component shell — the client island handles all state, fetching,
// and motion. Keeps the route bundle lean and matches the rest of admin/*.
export default function AdminCalendarPage() {
  return <CalendarClient />;
}
