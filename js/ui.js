import { applyLayout, freeSlotsForWeek, renderFreeList, renderWeek, isoDate } from './render.js';
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
    mode: 'stacked',
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
      refresh();
    });
    label.append(box, p.name);
    chips.append(label);
  });

  document.querySelectorAll('[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.mode = btn.dataset.mode;
      document.querySelectorAll('[data-mode]').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('off', !on);
        b.setAttribute('aria-pressed', on);
      });
      refresh();
    });
  });

  const shift = (days) => {
    const m = state.monday;
    state.monday = new Date(m.getFullYear(), m.getMonth(), m.getDate() + days);
    draw(Math.sign(days));
  };
  $('prev').addEventListener('click', () => shift(-7));
  $('next').addEventListener('click', () => shift(7));
  $('today').addEventListener('click', () => { state.monday = mondayOf(new Date()); draw(1); });

  const selectedPeople = () => allPeople.filter((p) => state.selected.has(p.id));

  // Selection or view mode changed: classes stay in the DOM and glide to their new place.
  function refresh() {
    hideTip();
    applyLayout(grid, allPeople, state.selected, state.mode);
    updateFreeList();
  }

  function updateFreeList() {
    const people = selectedPeople();
    const free = freeSlotsForWeek(people, state.monday, DAY_START, DAY_END, MIN_SLOT);
    renderFreeList($('free-list'), free, people);
  }

  // dir: 1 / -1 plays a 3D page-turn on the grid; 0 redraws without it.
  function draw(dir = 0) {
    hideTip();
    const m = state.monday;
    const sunday = new Date(m.getFullYear(), m.getMonth(), m.getDate() + 6);
    $('week-label').textContent = `${isoDate(m)} → ${isoDate(sunday)}`;

    grid.classList.remove('flip-next', 'flip-prev');
    if (dir) {
      void grid.offsetWidth; // restart the animation
      grid.classList.add(dir > 0 ? 'flip-next' : 'flip-prev');
    }
    renderWeek(grid, {
      monday: m, people: allPeople, selected: state.selected, mode: state.mode,
      dayStart: DAY_START, dayEnd: DAY_END,
    });
    updateFreeList();
  }
  draw();
}
