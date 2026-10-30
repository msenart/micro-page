// Pure helpers: busy intervals -> common free slots. Times are minutes since midnight.

export const toMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export const fmt = (min) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Merge overlapping/touching [start, end] intervals. */
export function mergeIntervals(intervals) {
  const sorted = intervals.map(([s, e]) => [s, e]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/**
 * Slots within [dayStart, dayEnd] where nobody in `people` has an event on `date`.
 * Returns [{start, end}] in minutes, keeping only slots of at least `minDuration` minutes.
 */
export function commonFreeSlots(people, date, dayStart, dayEnd, minDuration = 0) {
  const busy = mergeIntervals(
    people.flatMap((p) =>
      p.events.filter((e) => e.date === date).map((e) => [toMin(e.start), toMin(e.end)])
    )
  );
  const slots = [];
  let cursor = dayStart;
  for (const [s, e] of busy) {
    if (s > cursor) slots.push({ start: cursor, end: Math.min(s, dayEnd) });
    cursor = Math.max(cursor, e);
    if (cursor >= dayEnd) break;
  }
  if (cursor < dayEnd) slots.push({ start: cursor, end: dayEnd });
  return slots.filter((s) => s.end > s.start && s.end - s.start >= minDuration);
}
