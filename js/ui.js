import { renderFreeList, renderWeek, isoDate } from './render.js';

const DAY_START = 8 * 60;
const DAY_END = 21 * 60;
// Gaps shorter than this between classes aren't worth listing as free time.
const MIN_SLOT = 30;

export const mondayOf = (d) => {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
};

export function initUI(allPeople, startMonday) {
  const $ = (id) => document.getElementById(id);
  const state = {
    monday: startMonday,
    selected: new Set(allPeople.map((p) => p.id)),
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

  const shift = (days) => {
    const m = state.monday;
    state.monday = new Date(m.getFullYear(), m.getMonth(), m.getDate() + days);
    draw();
  };
  $('prev').addEventListener('click', () => shift(-7));
  $('next').addEventListener('click', () => shift(7));
  $('today').addEventListener('click', () => { state.monday = mondayOf(new Date()); draw(); });

  function draw() {
    const people = allPeople.filter((p) => state.selected.has(p.id));
    const m = state.monday;
    const sunday = new Date(m.getFullYear(), m.getMonth(), m.getDate() + 6);
    $('week-label').textContent = `${isoDate(m)} → ${isoDate(sunday)}`;
    const free = renderWeek($('grid'), {
      monday: m, people, dayStart: DAY_START, dayEnd: DAY_END, minDuration: MIN_SLOT,
    });
    renderFreeList($('free-list'), free, people);
  }
  draw();
}
