// Mouse parallax: exposes the pointer position as CSS variables used for 3D tilt.
// Skipped on touch devices and when the user prefers reduced motion.

const canHover = matchMedia('(hover: hover) and (pointer: fine)').matches;
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

if (canHover && !calm) {
  const root = document.documentElement;
  addEventListener(
    'pointermove',
    (e) => {
      const x = e.clientX / innerWidth - 0.5;
      const y = e.clientY / innerHeight - 0.5;
      root.style.setProperty('--px', x.toFixed(3));
      root.style.setProperty('--py', y.toFixed(3));
      root.style.setProperty('--rx', `${(-y * 5).toFixed(2)}deg`);
      root.style.setProperty('--ry', `${(x * 7).toFixed(2)}deg`);
    },
    { passive: true }
  );
}
