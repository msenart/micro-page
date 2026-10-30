import './fx.js';
import { loadPeople } from './data.js';
import { initUI, mondayOf } from './ui.js';
import { initVista } from './vista.js';

try {
  const people = await loadPeople();
  const dates = people.flatMap((p) => p.events.map((e) => e.date)).sort();
  const first = dates.length ? new Date(`${dates[0]}T00:00:00`) : new Date();
  initUI(people, mondayOf(first));
} catch (err) {
  document.getElementById('error').textContent =
    `${err.message}. If you opened index.html directly, serve the folder over HTTP instead (see README).`;
}

document.getElementById('to-top').addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));

// 3D sea + metal background; on any failure the CSS background stays.
import('./scene3d.js')
  .then((m) => initVista(m.start()))
  .catch((err) => console.warn('3D background unavailable, using the CSS one:', err));
