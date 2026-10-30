// Real-time 3D background: a wave-simulated sea, chrome spheres floating on it, and
// metal objects hovering in the air. Built with three.js (vendored in js/vendor/).
// If WebGL is unavailable, start() throws and the CSS background stays in place.

import * as THREE from './vendor/three.module.min.js';

const coarse = matchMedia('(pointer: coarse)').matches || innerWidth < 700; // phones/tablets
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- sea: sum of sine waves, shared by the GPU shader and the CPU (floating objects) ----------
// [dirX, dirZ, amplitude, wavelength] in world units
const WAVES = [
  [1, 0.3, 0.34, 14],
  [-0.6, 1, 0.22, 9],
  [0.3, -1, 0.14, 5.5],
  [1, 1, 0.08, 3.2],
];
const G = 9.8;

function waterHeight(x, z, t) {
  let h = 0;
  for (const [dx, dz, a, len] of WAVES) {
    const k = (2 * Math.PI) / len;
    h += a * Math.sin((k * (dx * x + dz * z)) / Math.hypot(dx, dz) - Math.sqrt(G * k) * t);
  }
  return h;
}

const WAVES_GLSL = /* glsl */ `
  uniform vec4 uWaves[4];
  uniform float uTime;
  float waveHeight(vec2 p) {
    float h = 0.0;
    for (int i = 0; i < 4; i++) {
      vec4 w = uWaves[i];
      float k = 6.2831853 / w.w;
      h += w.z * sin(k * dot(normalize(w.xy), p) - sqrt(9.8 * k) * uTime);
    }
    return h;
  }
  vec2 waveSlope(vec2 p) {
    vec2 g = vec2(0.0);
    for (int i = 0; i < 4; i++) {
      vec4 w = uWaves[i];
      vec2 d = normalize(w.xy);
      float k = 6.2831853 / w.w;
      g += d * (w.z * k * cos(k * dot(d, p) - sqrt(9.8 * k) * uTime));
    }
    return g;
  }
`;

const WATER_VERT = /* glsl */ `
  ${WAVES_GLSL}
  varying vec3 vWorld;
  varying vec2 vXZ;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vXZ = wp.xz;
    wp.y += waveHeight(wp.xz);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const WATER_FRAG = /* glsl */ `
  ${WAVES_GLSL}
  uniform sampler2D uSky;
  uniform vec3 uCam;
  uniform vec3 uSun;
  uniform vec3 uHorizon;
  varying vec3 vWorld;
  varying vec2 vXZ;

  vec2 dirUv(vec3 d) {
    return vec2(atan(d.z, d.x) / 6.2831853 + 0.5, asin(clamp(d.y, -1.0, 1.0)) / 3.14159265 + 0.5);
  }

  void main() {
    float dist = length(uCam - vWorld);
    // calm the small ripples with distance so the horizon doesn't shimmer
    vec2 g = waveSlope(vXZ) / (1.0 + dist * 0.012);
    vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
    vec3 V = normalize(uCam - vWorld);

    vec3 R = reflect(-V, N);
    R.y = abs(R.y);
    vec3 sky = texture2D(uSky, dirUv(R)).rgb;

    float fresnel = 0.04 + 0.96 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);
    float crest = clamp(vWorld.y * 1.6 + 0.35, 0.0, 1.0);
    vec3 body = mix(vec3(0.01, 0.28, 0.55), vec3(0.12, 0.72, 0.88), crest);
    vec3 col = mix(body, sky, fresnel);

    col += vec3(1.0, 0.96, 0.82) * pow(max(dot(R, uSun), 0.0), 350.0) * 2.0; // sun glint
    col = mix(col, vec3(1.0), smoothstep(0.55, 0.8, vWorld.y) * 0.45);       // foam on the crests
    col = mix(col, uHorizon, smoothstep(30.0, 170.0, dist));                 // haze to the horizon
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ---------- sky texture: used as background, as the water's reflection and as the metal's environment ----------
const SUN = new THREE.Vector3(-0.2, 0.35, -0.9).normalize();
const HORIZON = new THREE.Vector3(0.804, 0.945, 1.0);

const dirToUv = (d) => [Math.atan2(d.z, d.x) / (2 * Math.PI) + 0.5, Math.asin(d.y) / Math.PI + 0.5];

function makeSkyTexture(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');

  const sky = g.createLinearGradient(0, 0, 0, h / 2); // zenith -> horizon
  [[0, '#0b56bd'], [0.33, '#1380e0'], [0.62, '#2d9cf0'], [0.83, '#8adbfc'], [1, '#cdf1ff']]
    .forEach(([s, col]) => sky.addColorStop(s, col));
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h / 2);

  const sea = g.createLinearGradient(0, h / 2, 0, h); // what chrome reflects below the horizon
  [[0, '#8fd8f2'], [0.3, '#2aa0dc'], [1, '#064f96']].forEach(([s, col]) => sea.addColorStop(s, col));
  g.fillStyle = sea;
  g.fillRect(0, h / 2, w, h / 2);

  const blob = (x, y, rx, ry, alpha, inner, outer) => {
    g.save();
    g.translate(x, y);
    g.scale(rx / ry, 1);
    const r = g.createRadialGradient(0, 0, 0, 0, 0, ry);
    r.addColorStop(0, inner.replace('A', alpha));
    r.addColorStop(1, outer);
    g.fillStyle = r;
    g.beginPath();
    g.arc(0, 0, ry, 0, Math.PI * 2);
    g.fill();
    g.restore();
  };

  // soft clouds (fixed pseudo-random layout so every load looks the same)
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 14; i++) {
    const cx = (0.02 + rnd() * 0.5) * w;
    const cy = (0.5 - (0.04 + rnd() * 0.12)) * h; // 7-30 degrees above the horizon
    const s = (0.02 + rnd() * 0.03) * w;
    for (let j = 0; j < 5; j++) {
      blob(cx + (rnd() - 0.5) * s * 2.2, cy + (rnd() - 0.5) * s * 0.3, s * (0.8 + rnd()), s * 0.45,
        0.55, 'rgba(255,255,255,A)', 'rgba(255,255,255,0)');
    }
  }

  const [su, sv] = dirToUv(SUN); // sun glow
  blob(su * w, (1 - sv) * h, w * 0.2, w * 0.2, 0.55, 'rgba(255,250,215,A)', 'rgba(255,240,170,0)');
  blob(su * w, (1 - sv) * h, w * 0.03, w * 0.03, 1, 'rgba(255,255,255,A)', 'rgba(255,255,255,0)');

  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

// ---------- scene ----------
export function start() {
  const canvas = document.getElementById('bg3d');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !coarse, powerPreference: 'high-performance' });
  // Raw colours in, raw colours out: the sky texture and shader colours are shown as authored.
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  let dpr = Math.min(devicePixelRatio || 1, coarse ? 1.5 : 2);

  const scene = new THREE.Scene();
  const sky = makeSkyTexture(coarse ? 512 : 1024, coarse ? 256 : 512);
  scene.background = sky;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(sky).texture;

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 600);
  const CAM = new THREE.Vector3(0, 3.2, 14);
  const LOOK = new THREE.Vector3(0, 4.2, 0); // slight upward pitch puts the horizon a little below mid-screen
  camera.position.copy(CAM);

  // water
  const waterMat = new THREE.ShaderMaterial({
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uWaves: { value: WAVES.map(([x, z, a, l]) => new THREE.Vector4(x, z, a, l)) },
      uSky: { value: sky },
      uCam: { value: camera.position },
      uSun: { value: SUN },
      uHorizon: { value: HORIZON },
    },
  });
  const seg = coarse ? 100 : 170;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(420, 420, seg, seg).rotateX(-Math.PI / 2), waterMat);
  water.position.set(0, 0, -120);
  water.frustumCulled = false;
  scene.add(water);

  // metal
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.04 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0xdfe8ef, metalness: 1, roughness: 0.22 });
  const sphereGeo = new THREE.SphereGeometry(1, coarse ? 40 : 64, coarse ? 24 : 40);

  const floaters = [ // chrome spheres bobbing on the sea: [screen x (-1..1), z, radius]
    { nx: 0.6, z: -3, r: 1.6 },
    { nx: -0.68, z: 2, r: 0.85 },
    { nx: 0.05, z: -14, r: 1.1 },
  ].map((f) => ({ ...f, mesh: new THREE.Mesh(sphereGeo, chromeMat) }));
  floaters.forEach((f) => scene.add(f.mesh));

  const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(0.9, 0.28, coarse ? 110 : 180, coarse ? 16 : 24), chromeMat);
  scene.add(knot);

  const gyro = new THREE.Group(); // three steel rings spinning on different axes
  [1, 0.78, 0.56].forEach((s) => gyro.add(new THREE.Mesh(new THREE.TorusGeometry(s, 0.07, 20, coarse ? 64 : 110), steelMat)));
  scene.add(gyro);

  const air = [ // hovering objects: [screen x, screen y, distance from camera, size]
    { obj: knot, nx: -0.78, ny: 0.55, dist: 22, size: 1.2 },
    { obj: gyro, nx: 0.74, ny: 0.5, dist: 20, size: 1.7 },
  ];

  const tmp = new THREE.Vector3();
  let sizeScale = 1;

  function layout() {
    const w = innerWidth;
    const h = innerHeight;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.position.copy(CAM);
    camera.lookAt(LOOK);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    sizeScale = Math.min(1, 0.5 + camera.aspect * 0.3); // keep objects reasonable on tall phone screens

    const halfH = (z) => Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * (CAM.z - z);
    floaters.forEach((f) => {
      f.x = f.nx * halfH(f.z) * camera.aspect * 0.85;
      f.mesh.scale.setScalar(f.r * sizeScale);
    });
    air.forEach((a) => {
      tmp.set(a.nx, a.ny, 0.5).unproject(camera).sub(camera.position).normalize();
      a.obj.position.copy(camera.position).addScaledVector(tmp, a.dist);
      a.obj.scale.setScalar(a.size * sizeScale);
      a.base = a.obj.position.clone();
    });
  }

  // gentle camera sway everywhere, plus mouse parallax on desktop
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
    addEventListener('pointermove', (e) => {
      pointer.tx = e.clientX / innerWidth - 0.5;
      pointer.ty = e.clientY / innerHeight - 0.5;
    }, { passive: true });
  }

  function update(t) {
    waterMat.uniforms.uTime.value = t;
    floaters.forEach((f, i) => {
      const y = waterHeight(f.x, f.z, t);
      f.mesh.position.set(f.x + Math.sin(t * 0.5 + i) * 0.15, y + f.r * sizeScale * 0.25, f.z);
    });
    knot.rotation.set(t * 0.35, t * 0.5, 0);
    gyro.children[0].rotation.y = t * 0.8;
    gyro.children[1].rotation.x = t * 0.6;
    gyro.children[2].rotation.set(t * 0.4, 0, t * 0.7);
    air.forEach((a, i) => {
      a.obj.position.y = a.base.y + Math.sin(t * 0.7 + i * 2) * 0.35;
    });
    pointer.x += (pointer.tx - pointer.x) * 0.05;
    pointer.y += (pointer.ty - pointer.y) * 0.05;
    camera.position.set(CAM.x + Math.sin(t * 0.12) * 0.5 + pointer.x * 2.4, CAM.y - pointer.y * 0.8, CAM.z);
    camera.lookAt(LOOK);
  }

  layout();
  update(calm ? 1.5 : 0);
  renderer.render(scene, camera);
  document.documentElement.classList.add('gl'); // first frame is ready: hide the CSS fallback scene

  let resizeTimer;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { layout(); renderer.render(scene, camera); }, 80);
  });
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    document.documentElement.classList.remove('gl'); // fall back to the CSS scene
  });

  if (calm) return; // reduced motion: one still frame, no animation loop

  const t0 = performance.now();
  let frames = 0;
  let acc = 0;
  let last = t0;
  function frame(now) {
    requestAnimationFrame(frame);
    update((now - t0) / 1000);
    renderer.render(scene, camera);

    // weak device? drop to 1x resolution once
    acc += now - last;
    last = now;
    if (++frames === 90) {
      if (acc / frames > 30 && dpr > 1) { dpr = 1; layout(); }
      frames = 0;
      acc = 0;
    }
  }
  requestAnimationFrame(frame);
}
