// A small tropical island: sand and grass, a swaying palm tree, and an old beige PC on a crate.
// Built from primitive meshes; createIsland() returns { group, update(t) }.

import * as THREE from './vendor/three.module.min.js';

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...extra });
const UP = new THREE.Vector3(0, 1, 0);

// ---------- textures drawn on canvases ----------
function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  return new THREE.CanvasTexture(c);
}

function screenTexture() {
  return canvasTexture(256, 192, (g) => {
    const sky = g.createLinearGradient(0, 0, 0, 192); // blue sky and green hill wallpaper
    sky.addColorStop(0, '#1d74dd');
    sky.addColorStop(1, '#a9e2ff');
    g.fillStyle = sky;
    g.fillRect(0, 0, 256, 192);
    g.fillStyle = 'rgba(255,255,255,.85)';
    [[50, 40, 22], [75, 34, 18], [190, 52, 20], [212, 46, 14]].forEach(([x, y, r]) => {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    });
    const hill = g.createLinearGradient(0, 110, 0, 192);
    hill.addColorStop(0, '#6fd25a');
    hill.addColorStop(1, '#2a8a3a');
    g.fillStyle = hill;
    g.beginPath();
    g.ellipse(120, 215, 230, 110, 0, 0, Math.PI * 2);
    g.fill();

    g.fillStyle = '#d4d0c8'; // a little dialog window
    g.fillRect(48, 58, 160, 70);
    g.strokeStyle = '#fff';
    g.strokeRect(48.5, 58.5, 159, 69);
    const bar = g.createLinearGradient(50, 0, 206, 0);
    bar.addColorStop(0, '#0a246a');
    bar.addColorStop(1, '#a6caf0');
    g.fillStyle = bar;
    g.fillRect(50, 60, 156, 14);
    g.textBaseline = 'middle';
    g.fillStyle = '#fff';
    g.font = 'bold 10px sans-serif';
    g.fillText('free_time.exe', 55, 67);
    g.fillStyle = '#000';
    g.font = '10px sans-serif';
    g.fillText('Looking for free time...', 58, 90);
    g.fillStyle = '#fff';
    g.fillRect(58, 100, 140, 12);
    g.strokeStyle = '#808080';
    g.strokeRect(58.5, 100.5, 139, 11);
    g.fillStyle = '#1c9a3c';
    for (let i = 0; i < 9; i++) g.fillRect(60 + i * 10, 102, 8, 8);

    g.fillStyle = '#c9c5bb'; // taskbar
    g.fillRect(0, 176, 256, 16);
    g.fillStyle = '#2da64a';
    g.fillRect(2, 178, 44, 12);
    g.fillStyle = '#fff';
    g.font = 'bold 9px sans-serif';
    g.fillText('start', 12, 185);
  });
}

function keyboardTexture() {
  return canvasTexture(256, 96, (g) => {
    g.fillStyle = '#c9c0a4';
    g.fillRect(0, 0, 256, 96);
    g.fillStyle = '#ece5cf';
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 15; col++) {
        const wide = row === 4 && col > 2 && col < 10;
        if (row === 4 && col > 2 && col < 10 && col !== 3) continue; // one long space bar
        g.fillRect(8 + col * 16.2, 8 + row * 16.5, wide ? 80 : 13, 13);
      }
    }
  });
}

// ---------- palm tree ----------
function frondGeometry(L = 2.3, W = 0.55, S = 8) {
  const pos = [];
  const col = [];
  const idx = [];
  const dark = new THREE.Color('#1f8a3c');
  const light = new THREE.Color('#7ad65a');
  const c = new THREE.Color();
  for (let i = 0; i <= S; i++) {
    const v = i / S;
    const x = v * L;
    const y = -0.45 * L * v * v; // the frond arches and droops
    const w = W * Math.pow(Math.sin(Math.PI * (0.08 + 0.92 * v)), 0.7); // pointed tip
    const fold = 0.35 * w; // V-shaped cross-section
    pos.push(x, y - fold, -w, x, y, 0, x, y - fold, w);
    c.lerpColors(dark, light, v);
    for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
    if (i < S) {
      const a = i * 3;
      const b = (i + 1) * 3;
      idx.push(a, a + 1, b + 1, a, b + 1, b, a + 1, a + 2, b + 2, a + 1, b + 2, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function makePalm() {
  const palm = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.3, 1.2, 0.05),
    new THREE.Vector3(0.75, 2.6, 0),
    new THREE.Vector3(0.8, 3.9, -0.1),
  ]);
  const pts = curve.getPoints(12);
  const rings = [mat('#8a5a2b'), mat('#7a4e25')]; // alternating bands read as the bark rings
  for (let i = 0; i < 12; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dir = b.clone().sub(a);
    const len = dir.length();
    const r0 = 0.22 - 0.09 * (i / 12);
    const r1 = 0.22 - 0.09 * ((i + 1) / 12);
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len * 1.02, 8), rings[i % 2]);
    seg.position.copy(a).add(b).multiplyScalar(0.5);
    seg.quaternion.setFromUnitVectors(UP, dir.normalize());
    palm.add(seg);
  }

  const crown = new THREE.Group();
  crown.position.copy(pts[12]);
  palm.add(crown);

  const frondMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.65 });
  const frondGeo = frondGeometry();
  const fronds = [];
  const COUNT = 9;
  for (let k = 0; k < COUNT; k++) {
    const pivot = new THREE.Group();
    pivot.rotation.y = (k / COUNT) * Math.PI * 2 + (k % 2) * 0.2;
    const frond = new THREE.Mesh(frondGeo, frondMat);
    const tilt = 0.45 - (k % 3) * 0.22; // some fronds point up, some hang lower
    frond.rotation.z = tilt;
    frond.scale.setScalar(0.85 + (k % 3) * 0.12);
    pivot.add(frond);
    crown.add(pivot);
    fronds.push({ frond, tilt, phase: k });
  }

  const nutMat = mat('#5a3a1c', { roughness: 0.6 });
  const nuts = [[0.12, -0.12, 0.1], [-0.1, -0.14, 0.08], [0.02, -0.15, -0.14]].map(([x, y, z]) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10), nutMat);
    mesh.position.set(x, y, z);
    crown.add(mesh);
    return { mesh, home: mesh.position.clone(), state: 'attached', vy: 0, vx: 0, timer: 0 };
  });

  return { palm, fronds, nuts };
}

// ---------- old PC: CRT monitor, tower, keyboard, on a wooden crate ----------
function makePC() {
  const pc = new THREE.Group();
  const beige = mat('#d9d0b6', { roughness: 0.55 });
  const dark = mat('#2a2d33', { roughness: 0.5 });
  const grey = mat('#9a978c', { roughness: 0.5 });
  const wood = mat('#a9743f', { roughness: 0.85 });
  const add = (geo, material, x, y, z) => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    pc.add(m);
    return m;
  };

  add(new THREE.BoxGeometry(2.9, 0.5, 1.6), wood, 0.2, 0.25, 0.1); // crate
  add(new THREE.BoxGeometry(0.7, 0.14, 0.6), beige, -0.35, 0.57, 0); // monitor stand
  add(new THREE.BoxGeometry(1.7, 1.4, 0.4), beige, -0.35, 1.37, 0); // CRT front
  add(new THREE.BoxGeometry(1.3, 1.05, 0.8), beige, -0.35, 1.37, -0.6); // CRT back
  add(new THREE.BoxGeometry(1.4, 1.1, 0.05), dark, -0.35, 1.37, 0.2); // bezel
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(1.3, 0.98),
    new THREE.MeshBasicMaterial({ map: screenTexture(), toneMapped: false }), // glows on its own, even at night
  );
  screen.position.set(-0.35, 1.37, 0.23);
  pc.add(screen);

  add(new THREE.BoxGeometry(0.7, 1.5, 1.2), beige, 1.05, 1.25, -0.1); // tower
  add(new THREE.BoxGeometry(0.56, 0.12, 0.02), grey, 1.05, 1.78, 0.51); // CD drive
  add(new THREE.BoxGeometry(0.4, 0.03, 0.02), dark, 1.05, 1.52, 0.51); // floppy slot
  add(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 14).rotateX(Math.PI / 2), grey, 1.05, 1.1, 0.51); // power button
  const led = add(new THREE.BoxGeometry(0.06, 0.04, 0.02), new THREE.MeshBasicMaterial({ color: '#5dff7a' }), 0.85, 1.1, 0.51);

  const keys = new THREE.MeshStandardMaterial({ map: keyboardTexture(), roughness: 0.6 });
  const kb = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.07, 0.5), [beige, beige, keys, beige, beige, beige]);
  kb.position.set(-0.35, 0.54, 0.95);
  kb.rotation.x = 0.08;
  pc.add(kb);

  return { pc, led, screen };
}

export function createIsland({ coarse = false } = {}) {
  const group = new THREE.Group();
  const seg = coarse ? [28, 14] : [48, 24];

  const sand = new THREE.Mesh(new THREE.SphereGeometry(1, ...seg), mat('#efd9a0'));
  sand.scale.set(3.4, 1.5, 3.0);
  group.add(sand);
  const grass = new THREE.Mesh(new THREE.SphereGeometry(1, ...seg), mat('#52c24c', { roughness: 0.8 }));
  grass.scale.set(2.4, 0.5, 2.1);
  grass.position.y = 1.15;
  group.add(grass);
  [[-2.7, 0.6, 1.2, 0.35], [2.5, 0.5, 1.4, 0.28]].forEach(([x, y, z, s]) => {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), mat('#8c8f94', { roughness: 0.8 }));
    rock.position.set(x, y, z);
    group.add(rock);
  });

  const { palm, fronds, nuts } = makePalm();
  palm.position.set(1.3, 1.45, -0.5);
  group.add(palm);

  const { pc, led, screen } = makePC();
  pc.scale.setScalar(0.7);
  pc.position.set(-0.9, 1.5, 0.5);
  pc.rotation.y = 0.45; // turned a little toward the viewer
  group.add(pc);

  // ----- interaction state -----
  let powerTarget = 1; // PC on
  let power = 1; // 0..1, eased so the screen fades and collapses like a CRT
  const sway = { x: 0, vx: 0, z: 0, vz: 0 }; // extra swing of the whole tree, driven by shake()
  const GROUND = -3.58; // coconut resting height, in crown space

  /** Switch the old PC on or off. */
  function togglePower() {
    powerTarget = powerTarget ? 0 : 1;
    return !!powerTarget;
  }

  /** Shake the palm; sometimes a coconut comes loose. */
  function shake(strength = 1) {
    sway.vz += (Math.random() < 0.5 ? -1 : 1) * 0.9 * strength;
    sway.vx += (Math.random() - 0.5) * 0.9 * strength;
    const attached = nuts.filter((n) => n.state === 'attached');
    if (attached.length) {
      const nut = attached[Math.floor(Math.random() * attached.length)];
      nut.state = 'falling';
      nut.vy = 0;
      nut.vx = (nut.home.x >= 0 ? 1 : -1) * 0.8; // drifts outward so it clears the trunk
    }
  }

  function update(t, dt = 0) {
    // palm: spring-damper swing on top of the gentle idle sway
    const K = 18;
    const C = 1.6;
    sway.vz += (-K * sway.z - C * sway.vz) * dt;
    sway.z += sway.vz * dt;
    sway.vx += (-K * sway.x - C * sway.vx) * dt;
    sway.x += sway.vx * dt;
    palm.rotation.z = Math.sin(t * 0.7) * 0.025 + sway.z;
    palm.rotation.x = sway.x;
    const energy = Math.min(1, Math.abs(sway.vz) + Math.abs(sway.vx) + (Math.abs(sway.z) + Math.abs(sway.x)) * 2);
    fronds.forEach(({ frond, tilt, phase }) => {
      frond.rotation.z = tilt + Math.sin(t * 1.3 + phase) * 0.05 + Math.sin(t * 9 + phase * 2) * 0.12 * energy; // rustle when shaken
    });

    // coconuts: fall, bounce, rest on the ground for a while, then grow back on the tree
    nuts.forEach((n) => {
      if (n.state === 'falling') {
        n.vy -= 14 * dt;
        n.mesh.position.y += n.vy * dt;
        n.mesh.position.x += n.vx * dt;
        if (n.mesh.position.y < GROUND) {
          n.mesh.position.y = GROUND;
          n.vy *= -0.35;
          n.vx *= 0.5;
          if (Math.abs(n.vy) < 1) { n.state = 'resting'; n.timer = 3.5; }
        }
      } else if (n.state === 'resting') {
        n.timer -= dt;
        if (n.timer <= 0) {
          n.state = 'growing';
          n.timer = 0;
          n.mesh.position.copy(n.home);
          n.mesh.scale.setScalar(0.01);
        }
      } else if (n.state === 'growing') {
        n.timer += dt * 2;
        n.mesh.scale.setScalar(Math.min(1, n.timer));
        if (n.timer >= 1) n.state = 'attached';
      }
    });

    // old PC: the screen fades and collapses to a line when switched off
    power += (powerTarget - power) * (1 - Math.exp(-8 * dt));
    screen.material.color.setScalar(power);
    screen.scale.y = 0.03 + 0.97 * THREE.MathUtils.smoothstep(power, 0.15, 1);
    screen.visible = power > 0.02;
    led.visible = power > 0.5 && Math.sin(t * 5) > -0.6; // drive activity light
  }

  return { group, palm, pc, update, togglePower, shake };
}
