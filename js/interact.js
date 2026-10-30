// Playing with the 3D background:
//  - chrome balls: drag them out of the water and throw them; a tap makes them jump
//  - the old PC: tap to switch it on / off
//  - the palm tree: tap to shake it (a coconut may fall)
//  - the shapes in the sky: drag to rotate them (they keep spinning with the momentum); a tap gives a spin
// Mouse and touch both work. Events reach the canvas only where no page panel is in the way.

import * as THREE from './vendor/three.module.min.js';

const TAP_PX = 8; // movement below this counts as a tap
const BALL = { K: 40, C: 6, G: 16 }; // buoyancy spring, damping, gravity
const ROT_PER_PX = 0.012; // radians of rotation per dragged pixel

export function createInteraction({ canvas, camera, floaters, air, island, waterHeight, wake }) {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane();
  const hitPoint = new THREE.Vector3();
  const v = new THREE.Vector3();
  const q1 = new THREE.Quaternion();
  const q2 = new THREE.Quaternion();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  floaters.forEach((f) => {
    f.mesh.userData = { kind: 'ball', ref: f };
    f.pos = new THREE.Vector3();
    f.vel = new THREE.Vector3();
    f.held = false;
    f.placed = false;
  });
  air.forEach((a) => {
    a.obj.userData = { kind: 'spin', ref: a };
    a.w = a.spin.clone(); // angular velocity (world axes, rad/s); relaxes back to the idle spin
    a.held = false;
  });
  island.palm.userData = { kind: 'palm' };
  island.pc.userData = { kind: 'pc' };
  const pickables = [...floaters.map((f) => f.mesh), ...air.map((a) => a.obj), island.palm, island.pc];

  let drag = null;
  let hover = null; // last mouse position, resolved to a cursor in update()

  function setRay(x, y) {
    ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
    camera.updateMatrixWorld();
    raycaster.setFromCamera(ndc, camera);
  }

  function pick(x, y) {
    setRay(x, y);
    for (const h of raycaster.intersectObjects(pickables, true)) {
      let o = h.object;
      while (o && !o.userData.kind) o = o.parent;
      if (o) return { kind: o.userData.kind, ref: o.userData.ref };
    }
    return null;
  }

  // point under the pointer on the camera-facing plane through the dragged ball
  function pointOnBallPlane(x, y) {
    setRay(x, y);
    return raycaster.ray.intersectPlane(plane, hitPoint);
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const h = pick(e.clientX, e.clientY);
    if (!h) return;
    canvas.setPointerCapture(e.pointerId);
    drag = {
      id: e.pointerId, kind: h.kind, ref: h.ref, moved: false,
      x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t: performance.now(),
      vel: new THREE.Vector3(), offset: new THREE.Vector3(),
    };
    if (h.kind === 'ball') {
      const f = h.ref;
      f.held = true;
      f.vel.set(0, 0, 0);
      plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(v), f.pos);
      if (pointOnBallPlane(e.clientX, e.clientY)) drag.offset.copy(f.pos).sub(hitPoint);
    } else if (h.kind === 'spin') {
      h.ref.held = true;
    }
    if (h.kind === 'ball' || h.kind === 'spin') canvas.style.cursor = 'grabbing';
    wake();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) {
      if (e.pointerType === 'mouse') { hover = { x: e.clientX, y: e.clientY }; wake(1000); }
      return;
    }
    const now = performance.now();
    const dtp = Math.max(0.008, (now - drag.t) / 1000);
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > TAP_PX) drag.moved = true;

    if (drag.moved && drag.kind === 'ball') {
      const f = drag.ref;
      if (pointOnBallPlane(e.clientX, e.clientY)) {
        tmp.copy(hitPoint).add(drag.offset);
        tmp.y = Math.max(tmp.y, waterHeight(tmp.x, tmp.z, 0) - 0.2); // can be lifted, not pushed under the sea
        drag.vel.lerp(v.copy(tmp).sub(f.pos).divideScalar(dtp), 0.4); // smoothed throw velocity
        f.pos.copy(tmp);
      }
    } else if (drag.moved && drag.kind === 'spin') {
      const a = drag.ref;
      camera.matrixWorld.extractBasis(right, up, v);
      q1.setFromAxisAngle(up, dx * ROT_PER_PX);
      q2.setFromAxisAngle(right, dy * ROT_PER_PX);
      a.obj.quaternion.premultiply(q1).premultiply(q2);
      tmp.copy(up).multiplyScalar((dx * ROT_PER_PX) / dtp).addScaledVector(right, (dy * ROT_PER_PX) / dtp);
      a.w.lerp(tmp, 0.4);
    }
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.t = now;
    wake();
  });

  function finish(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    canvas.style.cursor = '';
    const stale = performance.now() - d.t > 90; // pointer stopped before release: no throw
    if (d.kind === 'ball') {
      const f = d.ref;
      f.held = false;
      if (d.moved) f.vel.copy(stale ? tmp.set(0, 0, 0) : d.vel).clampLength(0, 25);
      else f.vel.set((Math.random() - 0.5) * 4, 8, (Math.random() - 0.5) * 2); // tap: jump
    } else if (d.kind === 'spin') {
      const a = d.ref;
      a.held = false;
      if (!d.moved) {
        tmp.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(6);
        a.w.add(tmp); // tap: a kick of spin
      } else if (stale) {
        a.w.set(0, 0, 0);
      }
      a.w.clampLength(0, 12);
    } else if (!d.moved) {
      if (d.kind === 'pc') island.togglePower();
      else if (d.kind === 'palm') island.shake();
    }
    wake(5000);
  }
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);

  // On touch screens a finger that lands on an object must not start scrolling the page.
  canvas.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    if (t && pick(t.clientX, t.clientY)) e.preventDefault();
  }, { passive: false });

  /** Per-frame physics: floating balls and spinning shapes. */
  function update(t, dt) {
    if (hover && !drag) {
      const h = pick(hover.x, hover.y);
      canvas.style.cursor = h ? (h.kind === 'pc' || h.kind === 'palm' ? 'pointer' : 'grab') : '';
      hover = null;
    }

    floaters.forEach((f, i) => {
      const homeX = f.x + Math.sin(t * 0.5 + i) * 0.15;
      const surface = waterHeight(f.pos.x, f.pos.z, t) + f.size * 0.25;
      if (!f.placed) {
        f.pos.set(homeX, surface, f.z);
        f.placed = true;
      }
      if (!f.held && dt > 0) {
        const inWater = f.pos.y <= surface + 0.05;
        if (f.pos.y > surface) f.vel.y -= BALL.G * dt; // in the air: gravity
        else f.vel.y += (BALL.K * (surface - f.pos.y) - BALL.C * f.vel.y) * dt; // in the water: buoyant spring
        const damp = Math.exp(-(inWater ? 1.6 : 0.15) * dt);
        f.vel.x *= damp;
        f.vel.z *= damp;
        if (inWater) { // drift gently back to its home spot
          f.vel.x += (homeX - f.pos.x) * 0.5 * dt;
          f.vel.z += (f.z - f.pos.z) * 0.5 * dt;
        }
        f.pos.addScaledVector(f.vel, dt);
        f.pos.x = THREE.MathUtils.clamp(f.pos.x, -45, 45);
        f.pos.z = THREE.MathUtils.clamp(f.pos.z, -40, 8);
        if (f.pos.y < surface - 3) f.pos.y = surface;
      }
      f.mesh.position.copy(f.pos);
    });

    if (dt > 0) {
      air.forEach((a) => {
        if (!a.held) a.w.lerp(a.spin, 1 - Math.exp(-0.7 * dt)); // coast back to the idle spin
        const s = a.w.length();
        if (s > 1e-4) {
          q1.setFromAxisAngle(tmp.copy(a.w).divideScalar(s), s * dt);
          a.obj.quaternion.premultiply(q1);
        }
      });
    }
  }

  return { update };
}
