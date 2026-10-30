import './fx.js';
import { loadPeople } from './data.js';
import { initUI, mondayOf } from './ui.js';

try {
  const people = await loadPeople();
  const dates = people.flatMap((p) => p.events.map((e) => e.date)).sort();
  const first = dates.length ? new Date(`${dates[0]}T00:00:00`) : new Date();
  initUI(people, mondayOf(first));
} catch (err) {
  document.getElementById('error').textContent =
    `${err.message}. If you opened index.html directly, serve the folder over HTTP instead (see README).`;
}
