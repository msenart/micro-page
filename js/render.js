import { commonFreeSlots, fmt, toMin } from './freetime.js';

export const PX_PER_HOUR = 48;
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const isoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function weekDates(monday) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return d;
  });
}

export const dayLabel = (d) => `${DAYS[(d.getDay() + 6) % 7]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

const top = (min, dayStart) => ((min - dayStart) / 60) * PX_PER_HOUR;

/**
 * Draws the week grid. Each selected person gets a lane inside every day column;
 * common free slots are painted behind the events across the full column width.
 * Returns the free slots per day for the text list.
 */
export function renderWeek(root, { monday, people, dayStart, dayEnd, minDuration }) {
  root.replaceChildren();
  const dates = weekDates(monday);
  const height = ((dayEnd - dayStart) / 60) * PX_PER_HOUR;

  const head = el('div', 'grid-head');
  head.append(el('div', 'corner'));
  dates.forEach((d) => head.append(el('div', 'day-title', dayLabel(d))));

  const body = el('div', 'grid-body');
  const axis = el('div', 'axis');
  axis.style.height = `${height}px`;
  for (let m = Math.ceil(dayStart / 60) * 60; m <= dayEnd; m += 60) {
    const tick = el('div', 'tick', fmt(m));
    tick.style.top = `${top(m, dayStart)}px`;
    axis.append(tick);
  }
  body.append(axis);

  const freeByDay = [];
  dates.forEach((d) => {
    const date = isoDate(d);
    const col = el('div', 'day');
    col.style.height = `${height}px`;
    col.style.backgroundSize = `100% ${PX_PER_HOUR}px`;

    const free = people.length ? commonFreeSlots(people, date, dayStart, dayEnd, minDuration) : [];
    freeByDay.push({ date: d, free });
    free.forEach((s) => {
      const b = el('div', 'free');
      b.style.top = `${top(s.start, dayStart)}px`;
      b.style.height = `${top(s.end, dayStart) - top(s.start, dayStart)}px`;
      b.title = `Everyone free ${fmt(s.start)}–${fmt(s.end)}`;
      col.append(b);
    });

    people.forEach((p, i) => {
      p.events
        .filter((e) => e.date === date)
        .forEach((e) => {
          const s = Math.max(toMin(e.start), dayStart);
          const en = Math.min(toMin(e.end), dayEnd);
          if (en <= s) return;
          const b = el('div', 'event');
          b.style.top = `${top(s, dayStart)}px`;
          b.style.height = `${top(en, dayStart) - top(s, dayStart)}px`;
          b.style.left = `${(i / people.length) * 100}%`;
          b.style.width = `${100 / people.length}%`;
          b.style.setProperty('--c', p.color);
          b.title = `${p.name}: ${e.title}\n${e.start}–${e.end}${e.location ? `\n${e.location}` : ''}`;
          b.append(el('b', '', e.title), el('span', '', `${e.start}–${e.end}`));
          if (e.location) b.append(el('span', '', e.location));
          col.append(b);
        });
    });
    body.append(col);
  });

  root.append(head, body);
  return freeByDay;
}

export function renderFreeList(root, freeByDay, people) {
  root.replaceChildren();
  if (!people.length) {
    root.append(el('p', 'muted', 'Select at least one person.'));
    return;
  }
  let any = false;
  freeByDay.forEach(({ date, free }) => {
    free.forEach((s) => {
      any = true;
      const h = (s.end - s.start) / 60;
      const dur = h >= 1 ? `${+h.toFixed(2)}h` : `${s.end - s.start}min`;
      root.append(el('li', '', `${dayLabel(date)}  ${fmt(s.start)}–${fmt(s.end)}  (${dur})`));
    });
  });
  if (!any) root.append(el('p', 'muted', 'No common free slot this week with these settings.'));
}
