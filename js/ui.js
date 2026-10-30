import { renderFreeList, renderWeek, isoDate } from './render.js';

export const mondayOf = (d) => {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
};

const hourOptions = (sel, from, to, value) => {
  for (let h = from; h <= to; h++) {
    const o = new Option(`${String(h).padStart(2, '0')}:00`, h * 60);
    o.selected = h * 60 === value;
    sel.add(o);
  }
};

export function initUI(allPeople, startMonday) {
  const $ = (id) => document.getElementById(id);
  const state = {
    monday: startMonday,
    selected: new Set(allPeople.map((p) => p.id)),
    dayStart: 8 * 60,
    dayEnd: 21 * 60,
    minDuration: 60,
  };

  const chips = $('people');
  allPeople.forEach((p) => {
    const label = document.createElement('label');
    label.className = 'chip';
    label.style.setProperty('--c', p.color);
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = true;
    box.addEventListener('change', () => {
      box.checked ? state.selected.add(p.id) : state.selected.delete(p.id);
      draw();
    });
    label.append(box, p.name);
    chips.append(label);
  });

  hourOptions($('day-start'), 6, 20, state.dayStart);
  hourOptions($('day-end'), 7, 23, state.dayEnd);
  $('day-start').addEventListener('change', (e) => { state.dayStart = +e.target.value; draw(); });
  $('day-end').addEventListener('change', (e) => { state.dayEnd = +e.target.value; draw(); });
  $('min-duration').value = String(state.minDuration);
  $('min-duration').addEventListener('change', (e) => { state.minDuration = +e.target.value; draw(); });

  const shift = (days) => {
    const m = state.monday;
    state.monday = new Date(m.getFullYear(), m.getMonth(), m.getDate() + days);
    draw();
  };
  $('prev').addEventListener('click', () => shift(-7));
  $('next').addEventListener('click', () => shift(7));
  $('today').addEventListener('click', () => { state.monday = mondayOf(new Date()); draw(); });

  function draw() {
    if (state.dayEnd <= state.dayStart) return;
    const people = allPeople.filter((p) => state.selected.has(p.id));
    const m = state.monday;
    const sunday = new Date(m.getFullYear(), m.getMonth(), m.getDate() + 6);
    $('week-label').textContent = `${isoDate(m)} → ${isoDate(sunday)}`;
    const free = renderWeek($('grid'), { ...state, people });
    renderFreeList($('free-list'), free, people);
  }
  draw();
}
