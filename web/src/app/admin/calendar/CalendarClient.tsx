'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { adminFetch } from '@/components/admin/useAdminAuth';
import { ErrorBanner, PageHeader, PageWrap, PHIBadge } from '@/components/admin/ui';
import CalendarHeader from '@/components/admin/CalendarHeader';
import CalendarLegend from '@/components/admin/CalendarLegend';
import CalendarMonth from '@/components/admin/CalendarMonth';
import CalendarWeek from '@/components/admin/CalendarWeek';
import CalendarDay from '@/components/admin/CalendarDay';
import CalendarFilters from '@/components/admin/CalendarFilters';
import CalendarDayPanel from '@/components/admin/CalendarDayPanel';
import {
  type CalEvent,
  type StatusGroup,
  type Therapist,
  type TypeFilter,
  type ViewMode,
  FALLBACK_ROSTER,
  dayKey,
  dayRangeUTC,
  fmtDayLabelLongPT,
  fmtMonthLabelPT,
  fmtWeekLabelPT,
  monthRangeUTC,
  ptDayKey,
  statusGroupOf,
  todayPT,
  weekRangeUTC,
  weekStartPT,
} from './types';

type EventsResponse = { events?: CalEvent[] };
type TherapistsResponse = { therapists?: Therapist[] };

// The "cursor" — a single PT date that anchors whichever view is active.
// In month view we only use y/m; in week view we snap to the cursor's Sunday;
// in day view we use the exact date.
type Cursor = { y: number; m: number; d: number };

export default function CalendarClient() {
  const today = todayPT();
  const [cursor, setCursor] = useState<Cursor>(today);
  const [view, setView] = useState<ViewMode>('week');
  const [direction, setDirection] = useState<1 | -1>(1);

  const [therapists, setTherapists] = useState<Therapist[]>(FALLBACK_ROSTER);
  const [selectedStaff, setSelectedStaff] = useState<Set<number>>(
    () => new Set(FALLBACK_ROSTER.map((t) => t.staffId)),
  );

  // Filters — status, type, free-text. All applied client-side over the
  // already-fetched event set so chip changes feel instant.
  const [statusFilter, setStatusFilter] = useState<StatusGroup>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [search, setSearch] = useState('');

  const [events, setEvents] = useState<CalEvent[] | null>(null);
  const [eventsError, setEventsError] = useState('');
  const [loadingEvents, setLoadingEvents] = useState(true);

  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const selectedDateRef = useRef<Date | null>(null);

  // -------------------- therapists fetch (once) --------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await adminFetch('/admin/api/calendar/therapists');
        if (!r.ok) throw new Error(`${r.status}`);
        const body = (await r.json()) as TherapistsResponse;
        if (cancelled) return;
        if (Array.isArray(body.therapists) && body.therapists.length > 0) {
          setTherapists(body.therapists);
          setSelectedStaff((prev) => {
            const next = new Set(prev);
            for (const t of body.therapists ?? []) {
              if (!next.has(t.staffId)) next.add(t.staffId);
            }
            return next;
          });
        }
      } catch {
        // Falls back to FALLBACK_ROSTER — UI still works.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // -------------------- events fetch (view + cursor aware) --------------------
  const loadEvents = useCallback(async (v: ViewMode, c: Cursor, signal?: AbortSignal) => {
    setLoadingEvents(true);
    setEventsError('');
    const { fromISO, toISO } =
      v === 'day' ? dayRangeUTC(c.y, c.m, c.d)
      : v === 'week' ? (() => {
          const ws = weekStartPT(c.y, c.m, c.d);
          return weekRangeUTC(ws.y, ws.m, ws.d);
        })()
      : monthRangeUTC(c.y, c.m); // month + list both use month range
    try {
      const r = await adminFetch(
        `/admin/api/calendar/events?from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISO)}`,
        { signal },
      );
      if (!r.ok) throw new Error(`${r.status}`);
      const body = (await r.json()) as EventsResponse;
      setEvents(Array.isArray(body.events) ? body.events : []);
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') return; // superseded fetch — leave state alone
      setEvents([]);
      setEventsError('Could not load calendar events. The team has been notified.');
    } finally {
      setLoadingEvents(false);
    }
  }, []);

  // AbortController guards against React StrictMode's double-mount (and rapid
  // view/cursor changes) firing two GETs — each GET is an audited access write,
  // so a duplicate fetch produced duplicate "viewed Calendar Events" audit rows.
  useEffect(() => {
    const ctrl = new AbortController();
    loadEvents(view, cursor, ctrl.signal);
    return () => ctrl.abort();
  }, [view, cursor, loadEvents]);

  // -------------------- derived --------------------
  const therapistsById = useMemo(() => {
    const m = new Map<number, Therapist>();
    for (const t of therapists) m.set(t.staffId, t);
    return m;
  }, [therapists]);

  // Therapist filter first — counts shown on the chips reflect what would be
  // visible if the user clicked through after toggling staff.
  const staffFiltered = useMemo(() => {
    if (!events) return [];
    return events.filter((e) => selectedStaff.has(e.staffId));
  }, [events, selectedStaff]);

  const filteredEvents = useMemo(() => {
    let out = staffFiltered;
    if (statusFilter !== 'all') {
      out = out.filter((e) => e.type !== 'hold' && statusGroupOf(e.status) === statusFilter);
    }
    if (typeFilter !== 'all') {
      out = out.filter((e) => e.type === typeFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((e) => e.summary.toLowerCase().includes(q));
    }
    return out;
  }, [staffFiltered, statusFilter, typeFilter, search]);

  const chipCounts = useMemo(() => {
    let confirmed = 0, tentative = 0, cancelled = 0;
    let appointment = 0, shift = 0, hold = 0;
    for (const e of staffFiltered) {
      if (e.type === 'appointment') appointment += 1;
      else if (e.type === 'shift') shift += 1;
      else if (e.type === 'hold') hold += 1;

      if (e.type === 'hold') continue;
      const g = statusGroupOf(e.status);
      if (g === 'confirmed') confirmed += 1;
      else if (g === 'cancelled') cancelled += 1;
      else tentative += 1;
    }
    return {
      statusAll: staffFiltered.filter((e) => e.type !== 'hold').length,
      confirmed, tentative, cancelled,
      typeAll: staffFiltered.length,
      appointment, shift, hold,
    };
  }, [staffFiltered]);

  // Day panel events — only used when a day is selected. Uses the
  // fully-filtered set so it agrees with the chips above.
  const dayEvents = useMemo(() => {
    if (!selectedDayKey) return [];
    return filteredEvents
      .filter((e) => ptDayKey(e.startISO) === selectedDayKey)
      .sort((a, b) => Date.parse(a.startISO) - Date.parse(b.startISO));
  }, [filteredEvents, selectedDayKey]);

  const title = useMemo(() => {
    if (view === 'day') return fmtDayLabelLongPT(cursor.y, cursor.m, cursor.d);
    if (view === 'week') {
      const ws = weekStartPT(cursor.y, cursor.m, cursor.d);
      return fmtWeekLabelPT(ws);
    }
    return fmtMonthLabelPT(cursor.y, cursor.m);
  }, [view, cursor]);

  const filterSummary = useMemo(() => {
    const connectedCount = therapists.filter((t) => t.feedConnected).length;
    const activeConnected = therapists.filter((t) => t.feedConnected && selectedStaff.has(t.staffId)).length;
    const therapistLine =
      activeConnected === connectedCount ? `All ${connectedCount} therapists`
      : activeConnected === 0 ? 'No therapists'
      : `${activeConnected} of ${connectedCount} therapists`;
    const filterCount = [
      statusFilter !== 'all',
      typeFilter !== 'all',
      search.trim().length > 0,
    ].filter(Boolean).length;
    return filterCount === 0
      ? therapistLine
      : `${therapistLine} · ${filterCount} active filter${filterCount === 1 ? '' : 's'}`;
  }, [therapists, selectedStaff, statusFilter, typeFilter, search]);

  // -------------------- handlers --------------------
  const stepCursor = useCallback((delta: 1 | -1) => {
    setDirection(delta);
    setCursor((c) => {
      if (view === 'day') {
        const probe = new Date(Date.UTC(c.y, c.m, c.d + delta, 20));
        return { y: probe.getUTCFullYear(), m: probe.getUTCMonth(), d: probe.getUTCDate() };
      }
      if (view === 'week') {
        const ws = weekStartPT(c.y, c.m, c.d);
        const probe = new Date(Date.UTC(ws.y, ws.m, ws.d + delta * 7, 20));
        return { y: probe.getUTCFullYear(), m: probe.getUTCMonth(), d: probe.getUTCDate() };
      }
      // month
      const m = c.m + delta;
      if (m < 0) return { y: c.y - 1, m: 11, d: c.d };
      if (m > 11) return { y: c.y + 1, m: 0, d: c.d };
      return { y: c.y, m, d: c.d };
    });
  }, [view]);

  const onPrev = useCallback(() => stepCursor(-1), [stepCursor]);
  const onNext = useCallback(() => stepCursor(1), [stepCursor]);

  const onToday = useCallback(() => {
    const t = todayPT();
    setCursor((c) => {
      const goingFwd =
        t.y > c.y || (t.y === c.y && t.m > c.m) || (t.y === c.y && t.m === c.m && t.d > c.d);
      setDirection(goingFwd ? 1 : -1);
      return t;
    });
    const k = dayKey(t.y, t.m, t.d);
    setSelectedDayKey(k);
    selectedDateRef.current = new Date(Date.UTC(t.y, t.m, t.d, 12));
  }, []);

  const onViewChange = useCallback((next: ViewMode) => {
    setView(next);
    // Closing the side panel when switching to week/day avoids redundant data
    // (events are already shown in the grid).
    if (next === 'week' || next === 'day') setSelectedDayKey(null);
  }, []);

  const onToggleStaff = useCallback((staffId: number) => {
    setSelectedStaff((prev) => {
      const next = new Set(prev);
      if (next.has(staffId)) next.delete(staffId);
      else next.add(staffId);
      return next;
    });
  }, []);

  const onSelectDay = useCallback((key: string, date: Date) => {
    setSelectedDayKey((prev) => (prev === key ? null : key));
    selectedDateRef.current = date;
  }, []);

  const onSelectDayInGrid = useCallback((key: string, date: Date) => {
    // In week/day views, clicking a date in the header jumps the cursor and
    // (for week) switches to day view — matches Cal.com / Google Calendar UX.
    const p = key.split('-').map(Number);
    if (p.length === 3) {
      setCursor({ y: p[0], m: p[1] - 1, d: p[2] });
    }
    if (view === 'week') {
      setView('day');
    }
    selectedDateRef.current = date;
  }, [view]);

  const onCloseDay = useCallback(() => setSelectedDayKey(null), []);

  const onClearFilters = useCallback(() => {
    setStatusFilter('all');
    setTypeFilter('all');
    setSearch('');
  }, []);

  const canClearFilters = statusFilter !== 'all' || typeFilter !== 'all' || search.trim().length > 0;

  const weekAnchor = useMemo(
    () => weekStartPT(cursor.y, cursor.m, cursor.d),
    [cursor.y, cursor.m, cursor.d],
  );

  // -------------------- render --------------------
  return (
    <PageWrap max="max-w-[1480px]">
      <PageHeader
        title="Calendar"
        subtitle={
          <>
            Live view of the entire clinic — Jane appointments, soft holds, and
            shifts pulled from each therapist&apos;s iCal feed every few minutes.
            Appointment details (PHI) are fetched on demand and every read is
            recorded in the <span className="font-medium text-ink">PHI access log</span>. §164.312(b)
          </>
        }
        badge={<PHIBadge />}
      />

      {eventsError && <ErrorBanner>{eventsError}</ErrorBanner>}

      <CalendarHeader
        title={title}
        view={view}
        onViewChange={onViewChange}
        onPrev={onPrev}
        onNext={onNext}
        onToday={onToday}
        filterSummary={filterSummary}
      />

      <CalendarFilters
        status={statusFilter}
        onStatusChange={setStatusFilter}
        type={typeFilter}
        onTypeChange={setTypeFilter}
        search={search}
        onSearchChange={setSearch}
        counts={chipCounts}
        onClear={onClearFilters}
        canClear={canClearFilters}
      />

      <CalendarLegend
        therapists={therapists}
        selected={selectedStaff}
        onToggle={onToggleStaff}
      />

      <motion.div
        key={`${view}-${cursor.y}-${cursor.m}-${cursor.d}`}
        initial={{ opacity: 0, x: direction * 12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col items-stretch gap-3 lg:flex-row"
      >
        <div className="min-w-0 flex-1">
          {view === 'month' && (
            <CalendarMonth
              year={cursor.y}
              month0={cursor.m}
              direction={direction}
              loading={loadingEvents && events === null}
              events={filteredEvents}
              therapistsById={therapistsById}
              selectedKey={selectedDayKey}
              onSelectDay={onSelectDay}
            />
          )}
          {view === 'week' && (
            <CalendarWeek
              weekStart={weekAnchor}
              loading={loadingEvents && events === null}
              events={filteredEvents}
              therapistsById={therapistsById}
              selectedKey={selectedDayKey}
              onSelectDay={onSelectDayInGrid}
            />
          )}
          {view === 'day' && (
            <CalendarDay
              day={cursor}
              loading={loadingEvents && events === null}
              events={filteredEvents}
              therapistsById={therapistsById}
            />
          )}
        </div>

        {view === 'month' && (
          <CalendarDayPanel
            open={selectedDayKey !== null}
            selectedDate={selectedDateRef.current}
            events={dayEvents}
            therapistsById={therapistsById}
            onClose={onCloseDay}
          />
        )}
      </motion.div>
    </PageWrap>
  );
}
