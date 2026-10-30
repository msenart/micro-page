import { renderFreeList, renderWeek, isoDate } from './render.js';
import { initTip } from './tip.js';

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
  const grid = $('grid');
  const hideTip = initTip(grid);
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
    draw(Math.sign(days));
  };
  $('prev').addEventListener('click', () => shift(-7));
  $('next').addEventListener('click', () => shift(7));
  $('today').addEventListener('click', () => { state.monday = mondayOf(new Date()); draw(1); });

  // dir: 1 / -1 plays a 3D page-turn on the grid; 0 redraws without it.
  function draw(dir = 0) {
    hideTip();
    const people = allPeople.filter((p) => state.selected.has(p.id));
    const m = state.monday;
    const sunday = new Date(m.getFullYear(), m.getMonth(), m.getDate() + 6);
    $('week-label').textContent = `${isoDate(m)} → ${isoDate(sunday)}`;

    grid.classList.remove('flip-next', 'flip-prev');
    if (dir) {
      void grid.offsetWidth; // restart the animation
      grid.classList.add(dir > 0 ? 'flip-next' : 'flip-prev');
    }
    const free = renderWeek(grid, {
      monday: m, people, dayStart: DAY_START, dayEnd: DAY_END, minDuration: MIN_SLOT,
    });
    renderFreeList($('free-list'), free, people);
  }
  draw();
}
