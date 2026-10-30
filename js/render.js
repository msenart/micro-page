import { commonFreeSlots, fmt, toMin } from './freetime.js';

export const PX_PER_HOUR = 48;
const STACK_OFFSET = 7; // px each person is shifted in stacked mode
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
 * Builds the week grid with the classes of *every* person (so that showing or hiding
 * someone later is just a class change that CSS can animate). `selected` is the set of
 * visible person ids, `mode` is 'stacked' or 'side'.
 */
export function renderWeek(root, { monday, people, selected, mode, dayStart, dayEnd }) {
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

  let n = 0; // staggers the pop-in animation
  dates.forEach((d) => {
    const date = isoDate(d);
    const col = el('div', 'day');
    col.style.height = `${height}px`;
    col.style.backgroundSize = `100% ${PX_PER_HOUR}px`;

    people.forEach((p) => {
      p.events
        .filter((e) => e.date === date)
        .forEach((e) => {
          const s = Math.max(toMin(e.start), dayStart);
          const en = Math.min(toMin(e.end), dayEnd);
          if (en <= s) return;
          const b = el('div', 'event');
          b.style.top = `${top(s, dayStart)}px`;
          b.style.height = `${top(en, dayStart) - top(s, dayStart)}px`;
          b.style.setProperty('--c', p.color);
          b.style.setProperty('--i', n++);
          if (selected.has(p.id)) b.classList.add('enter');
          Object.assign(b.dataset, {
            pid: p.id, person: p.name, title: e.title, time: `${e.start}–${e.end}`,
            location: e.location ?? '', color: p.color,
          });
          b.append(el('b', '', e.title), el('span', '', `${e.start}–${e.end}`));
          if (e.location) b.append(el('span', '', e.location));
          col.append(b);
        });
    });
    body.append(col);
  });

  root.append(head, body);
  applyLayout(root, people, selected, mode);
}

/**
 * Positions the classes for the current selection and view mode. Hidden people get
 * `.gone`; the others get a new left/width, which CSS transitions smoothly.
 */
export function applyLayout(root, people, selected, mode) {
  const shown = people.filter((p) => selected.has(p.id)).map((p) => p.id);
  const count = shown.length;
  root.querySelectorAll('.event').forEach((b) => {
    const i = shown.indexOf(b.dataset.pid);
    b.classList.toggle('gone', i < 0);
    if (i < 0) return; // keep its last position so it fades out in place
    if (mode === 'side') {
      b.style.left = `${(i / count) * 100}%`;
      b.style.width = `${100 / count}%`;
      b.style.zIndex = 1;
    } else {
      // Stacked: same slot for everyone, each person shifted a little like a pile of cards.
      b.style.left = `${i * STACK_OFFSET}px`;
      b.style.width = `calc(100% - ${(count - 1) * STACK_OFFSET}px)`;
      b.style.zIndex = i + 1;
    }
    b.classList.toggle('stacked', mode !== 'side' && count > 1);
  });
}

/** Common free slots of `people` for each day of the week starting at `monday`. */
export function freeSlotsForWeek(people, monday, dayStart, dayEnd, minDuration) {
  return weekDates(monday).map((date) => ({
    date,
    free: people.length ? commonFreeSlots(people, isoDate(date), dayStart, dayEnd, minDuration) : [],
  }));
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
