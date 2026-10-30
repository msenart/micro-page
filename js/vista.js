// Last screen of the page: nothing but the 3D background, plus the time-of-day controls.

const pad = (n) => String(n).padStart(2, '0');
const clock = (h) => {
  const m = Math.round(h * 60) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
};

export function initVista(scene) {
  const $ = (id) => document.getElementById(id);
  const range = $('tod-range');
  const label = $('tod-clock');
  const buttons = { live: $('tod-live'), lapse: $('tod-lapse') };
  let dragging = false;

  // highlight the active mode; while the slider is in control ('manual') neither is
  const showMode = (m) => {
    Object.entries(buttons).forEach(([key, btn]) => {
      btn.classList.toggle('off', key !== m);
      btn.setAttribute('aria-pressed', key === m);
    });
  };

  scene.onTime((h) => {
    if (!dragging) range.value = h;
    label.textContent = clock(h);
  });
  range.value = scene.hour;
  label.textContent = clock(scene.hour);
  showMode(scene.mode);

  range.addEventListener('pointerdown', () => { dragging = true; });
  addEventListener('pointerup', () => { dragging = false; });
  range.addEventListener('input', () => {
    scene.setTime(+range.value);
    label.textContent = clock(+range.value);
    showMode('manual');
  });

  Object.entries(buttons).forEach(([key, btn]) => {
    btn.addEventListener('click', () => {
      scene.setMode(key);
      showMode(scene.mode);
    });
  });
  if (scene.calm) buttons.lapse.hidden = true;
}
