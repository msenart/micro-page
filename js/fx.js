// Mouse parallax for the 3D background: exposes the pointer position (-0.5..0.5)
// as --px / --py. Skipped on touch devices and when the user prefers reduced motion.

const canHover = matchMedia('(hover: hover) and (pointer: fine)').matches;
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

if (canHover && !calm) {
  const root = document.documentElement;
  addEventListener(
    'pointermove',
    (e) => {
      root.style.setProperty('--px', (e.clientX / innerWidth - 0.5).toFixed(3));
      root.style.setProperty('--py', (e.clientY / innerHeight - 0.5).toFixed(3));
    },
    { passive: true }
  );
}
