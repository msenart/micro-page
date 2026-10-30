// Detail bubble for a class: shown on mouse hover, and on tap for touch screens.

export function initTip(grid) {
  const tip = document.getElementById('tip');
  const hide = () => { tip.hidden = true; };

  const line = (tag, text) => {
    const n = document.createElement(tag);
    n.textContent = text;
    return n;
  };

  function show(ev) {
    const d = ev.dataset;
    tip.replaceChildren(line('b', d.title), line('span', `${d.person} · ${d.time}`));
    if (d.location) tip.append(line('span', d.location));
    tip.style.setProperty('--c', d.color);
    tip.hidden = false;
    const r = ev.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const left = Math.min(Math.max(8, r.left + r.width / 2 - t.width / 2), innerWidth - t.width - 8);
    const above = r.top - t.height - 8;
    tip.style.left = `${left}px`;
    tip.style.top = `${above >= 8 ? above : r.bottom + 8}px`;
  }

  grid.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const ev = e.target.closest('.event');
    ev ? show(ev) : hide();
  });
  grid.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
  document.addEventListener('click', (e) => {
    const ev = e.target.closest('.event');
    if (ev && e.pointerType !== 'mouse') show(ev);
    else if (!ev) hide();
  });
  addEventListener('scroll', hide, { passive: true });
  return hide;
}
