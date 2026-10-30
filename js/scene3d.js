// Real-time 3D background: a wave-simulated sea, chrome spheres floating on it, metal objects
// hovering in the air, and a sun / moon that travel across the sky through a day-night cycle.
// Built with three.js (vendored in js/vendor/). If WebGL is unavailable, start() throws and the
// CSS background stays in place.

import * as THREE from './vendor/three.module.min.js';

THREE.ColorManagement.enabled = false; // colours below are display colours, used as authored

const coarse = matchMedia('(pointer: coarse)').matches || innerWidth < 700; // phones/tablets
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

const CYCLE_SECONDS = 360; // one full 24 h day
const localHour = () => {
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
};
const MAX_ELEV = THREE.MathUtils.degToRad(26); // noon sun height (kept inside the frame)

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

// direction -> equirectangular sky texture coordinates (same convention as three.js)
const DIR_UV_GLSL = /* glsl */ `
  vec2 dirUv(vec3 d) {
    return vec2(atan(d.z, d.x) / 6.2831853 + 0.5, asin(clamp(d.y, -1.0, 1.0)) / 3.14159265 + 0.5);
  }
`;

// The sky is drawn by this dome rather than scene.background: three.js converts an equirect
// background to a cube map once and caches it, so a sky that changes through the day would freeze.
const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const SKY_FRAG = /* glsl */ `
  uniform sampler2D uSky;
  varying vec3 vDir;
  ${DIR_UV_GLSL}
  void main() {
    gl_FragColor = vec4(texture2D(uSky, dirUv(normalize(vDir))).rgb, 1.0);
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
  uniform vec3 uSun;      // direction of the dominant light (sun, or moon at night)
  uniform vec3 uSunCol;   // its colour, already scaled by how strong the glint should be
  uniform vec3 uHorizon;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform float uLight;   // overall daylight 0..1
  varying vec3 vWorld;
  varying vec2 vXZ;
  ${DIR_UV_GLSL}

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
    vec3 col = mix(mix(uDeep, uShallow, crest), sky, fresnel);

    col += uSunCol * pow(max(dot(R, uSun), 0.0), 350.0) * 2.0;                       // sun / moon glint
    vec3 foam = mix(vec3(0.15, 0.2, 0.32), vec3(1.0), uLight);
    col = mix(col, foam, smoothstep(0.55, 0.8, vWorld.y) * 0.45);                    // foam on the crests
    col = mix(col, uHorizon, smoothstep(30.0, 170.0, dist));                         // haze to the horizon
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ---------- time of day: everything is keyed on the sun's height above the horizon (degrees) ----------
const C = (hex) => new THREE.Color(hex);
const PALETTE = [
  { e: -14, zen: C('#010414'), mid: C('#050d2a'), hor: C('#102a55'), deep: C('#000a1c'), shal: C('#06233f'), sun: C('#ffb56b'), lit: 0.0, stars: 1 },
  { e: -5, zen: C('#0a1850'), mid: C('#2d3380'), hor: C('#c0577a'), deep: C('#031634'), shal: C('#1c3f70'), sun: C('#ff7a5a'), lit: 0.15, stars: 0.45 },
  { e: 0, zen: C('#1d4fae'), mid: C('#7b86cc'), hor: C('#ffae78'), deep: C('#0a3a72'), shal: C('#3d86b8'), sun: C('#ffb56b'), lit: 0.6, stars: 0.08 },
  { e: 9, zen: C('#1366c8'), mid: C('#58a6ea'), hor: C('#ffe3b0'), deep: C('#04508f'), shal: C('#2aa6cf'), sun: C('#ffe2a0'), lit: 0.9, stars: 0 },
  { e: 20, zen: C('#0b56bd'), mid: C('#2d9cf0'), hor: C('#cdf1ff'), deep: C('#034a8c'), shal: C('#1fb8e0'), sun: C('#fff6d8'), lit: 1.0, stars: 0 },
];
const COLOR_KEYS = ['zen', 'mid', 'hor', 'deep', 'shal', 'sun'];
const P = { zen: C('#000'), mid: C('#000'), hor: C('#000'), deep: C('#000'), shal: C('#000'), sun: C('#000'), lit: 1, stars: 0 };
const MOON_COLOR = C('#bcd0ff');

function paletteAt(eDeg) {
  let i = 0;
  while (i < PALETTE.length - 2 && eDeg > PALETTE[i + 1].e) i++;
  const a = PALETTE[i];
  const b = PALETTE[i + 1];
  const t = THREE.MathUtils.clamp((eDeg - a.e) / (b.e - a.e), 0, 1);
  const s = t * t * (3 - 2 * t);
  COLOR_KEYS.forEach((k) => P[k].copy(a[k]).lerp(b[k], s));
  P.lit = a.lit + (b.lit - a.lit) * s;
  P.stars = a.stars + (b.stars - a.stars) * s;
}

// ---------- sky texture: background, the water's reflection and the metal's environment ----------
const css = (c) => `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
const tmp = new THREE.Color();

function makeSky(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.wrapS = THREE.RepeatWrapping;
  return { canvas, tex };
}

function drawSky({ canvas, tex }) {
  const w = canvas.width;
  const h = canvas.height;
  const g = canvas.getContext('2d');

  const sky = g.createLinearGradient(0, 0, 0, h / 2); // zenith -> horizon
  sky.addColorStop(0, css(P.zen));
  sky.addColorStop(0.33, css(tmp.copy(P.zen).lerp(P.mid, 0.5)));
  sky.addColorStop(0.62, css(P.mid));
  sky.addColorStop(0.83, css(tmp.copy(P.mid).lerp(P.hor, 0.55)));
  sky.addColorStop(1, css(P.hor));
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h / 2);

  const sea = g.createLinearGradient(0, h / 2, 0, h); // what the chrome reflects below the horizon
  sea.addColorStop(0, css(tmp.copy(P.shal).lerp(P.hor, 0.5)));
  sea.addColorStop(0.3, css(P.shal));
  sea.addColorStop(1, css(P.deep));
  g.fillStyle = sea;
  g.fillRect(0, h / 2, w, h / 2);

  let seed = 7; // fixed pseudo-random layout so every redraw puts things in the same place
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  if (P.stars > 0.02) {
    for (let i = 0; i < 320; i++) {
      const x = rnd() * w;
      const y = (1 - (Math.asin(rnd()) / Math.PI + 0.5)) * h; // uniform over the upper hemisphere
      const big = rnd() > 0.93;
      g.fillStyle = `rgba(255,255,255,${P.stars * (0.35 + 0.65 * rnd())})`;
      g.fillRect(x, y, big ? 2.5 : 1.5, big ? 2.5 : 1.5);
    }
  }

  const cloud = tmp.copy(P.hor).lerp(new THREE.Color('#ffffff'), 0.55).multiplyScalar(Math.max(0.2, P.lit));
  const cr = Math.round(cloud.r * 255);
  const cg = Math.round(cloud.g * 255);
  const cb = Math.round(cloud.b * 255);
  for (let i = 0; i < 14; i++) {
    const cx = (0.02 + rnd() * 0.5) * w;
    const cy = (0.5 - (0.04 + rnd() * 0.12)) * h; // 7-30 degrees above the horizon
    const s = (0.02 + rnd() * 0.03) * w;
    for (let j = 0; j < 5; j++) {
      const bx = cx + (rnd() - 0.5) * s * 2.2;
      const by = cy + (rnd() - 0.5) * s * 0.3;
      const rx = s * (0.8 + rnd());
      const ry = s * 0.45;
      g.save();
      g.translate(bx, by);
      g.scale(rx / ry, 1);
      const r = g.createRadialGradient(0, 0, 0, 0, 0, ry);
      r.addColorStop(0, `rgba(${cr},${cg},${cb},0.55)`);
      r.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      g.fillStyle = r;
      g.beginPath();
      g.arc(0, 0, ry, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }
  tex.needsUpdate = true;
}

function glowTexture(stops, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([s, col]) => r.addColorStop(s, col));
  g.fillStyle = r;
  g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

function moonTexture() {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const glow = g.createRadialGradient(64, 64, 10, 64, 64, 64);
  glow.addColorStop(0, 'rgba(210,225,255,.55)');
  glow.addColorStop(1, 'rgba(210,225,255,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, size, size);
  g.fillStyle = '#eef3ff';
  g.beginPath();
  g.arc(64, 64, 24, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(150,165,205,.35)'; // craters
  [[56, 56, 6], [72, 62, 5], [62, 74, 4], [74, 76, 3]].forEach(([x, y, r]) => {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  });
  return new THREE.CanvasTexture(c);
}

// ---------- scene ----------
export function start() {
  const canvas = document.getElementById('bg3d');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !coarse, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // raw colours in, raw colours out
  let dpr = Math.min(devicePixelRatio || 1, coarse ? 1.5 : 2);

  const scene = new THREE.Scene();
  const skyMap = makeSky(coarse ? 512 : 1024, coarse ? 256 : 512);
  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(500, 48, 24),
    new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: { uSky: { value: skyMap.tex } },
      side: THREE.BackSide,
      depthWrite: false,
    }),
  );
  skyDome.renderOrder = -1; // drawn first, behind everything
  skyDome.frustumCulled = false;
  scene.add(skyDome);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envTarget = null;

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 600);
  const CAM = new THREE.Vector3(0, 3.2, 14);
  const LOOK = new THREE.Vector3(0, 4.2, 0); // slight upward pitch puts the horizon a little below mid-screen
  camera.position.copy(CAM);

  // sun, moon and the light they cast
  const sunDir = new THREE.Vector3();
  const moonDir = new THREE.Vector3();
  const lightDir = new THREE.Vector3(); // whichever of the two is lighting the scene
  const lightCol = new THREE.Color();
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture([[0, 'rgba(255,255,255,1)'], [0.05, 'rgba(255,255,255,1)'], [0.1, 'rgba(255,255,255,.6)'], [0.3, 'rgba(255,255,255,.14)'], [1, 'rgba(255,255,255,0)']]),
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  }));
  sunSprite.scale.setScalar(150);
  const haloSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture([[0, 'rgba(255,255,255,.4)'], [1, 'rgba(255,255,255,0)']]),
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  }));
  haloSprite.scale.setScalar(520);
  const moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTexture(), transparent: true, depthWrite: false }));
  moonSprite.scale.setScalar(70);
  scene.add(sunSprite, haloSprite, moonSprite);
  const sunLight = new THREE.DirectionalLight(0xffffff, 1);
  scene.add(sunLight);

  // water
  const waterMat = new THREE.ShaderMaterial({
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uWaves: { value: WAVES.map(([x, z, a, l]) => new THREE.Vector4(x, z, a, l)) },
      uSky: { value: skyMap.tex },
      uCam: { value: camera.position },
      uSun: { value: lightDir },
      uSunCol: { value: new THREE.Color() },
      uHorizon: { value: P.hor },
      uDeep: { value: P.deep },
      uShallow: { value: P.shal },
      uLight: { value: 1 },
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

  const v = new THREE.Vector3();
  // The sun rises from the horizon at the left edge of the view (6:00), arcs over and sets at the
  // right edge (18:00). How far left/right that is depends on the screen width, set in layout().
  let azSpan = 0.5;

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
    const halfHFov = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
    azSpan = THREE.MathUtils.clamp(halfHFov * 0.8, 0.14, 0.66); // 80% of the half-width, so it stays on screen
    const sizeScale = Math.min(1, 0.5 + camera.aspect * 0.3); // keep objects reasonable on tall phone screens

    const halfH = (z) => Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * (CAM.z - z);
    floaters.forEach((f) => {
      f.x = f.nx * halfH(f.z) * camera.aspect * 0.85;
      f.size = f.r * sizeScale;
      f.mesh.scale.setScalar(f.size);
    });
    air.forEach((a) => {
      v.set(a.nx, a.ny, 0.5).unproject(camera).sub(camera.position).normalize();
      a.obj.position.copy(camera.position).addScaledVector(v, a.dist);
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

  // ----- time of day state -----
  // 'live' follows the clock of this device, 'lapse' is a fast day-night cycle, 'manual' is the slider
  let mode = 'live';
  let tod = localHour(); // hours, 0-24
  let eDeg = 0;
  let skyDirty = true;
  let lastSky = -1e9;
  let lastEmit = 0;
  const listeners = [];
  const SKY_INTERVAL = coarse ? 1000 : 600; // the sky texture only changes slowly; no need to redraw it every frame

  function refreshSky(now) {
    drawSky(skyMap);
    if (envTarget) envTarget.dispose();
    envTarget = pmrem.fromEquirectangular(skyMap.tex);
    scene.environment = envTarget.texture;
    lastSky = now;
    skyDirty = false;
  }

  function update(t, dt, now) {
    if (mode === 'live') {
      tod = localHour();
    } else if (mode === 'lapse' && dt > 0) {
      const nightBoost = 1 + 2 * (1 - THREE.MathUtils.smoothstep(eDeg, -14, -6)); // skip the boring dark hours faster
      tod = (tod + dt * (24 / CYCLE_SECONDS) * nightBoost) % 24;
    }

    // sun & moon
    const phi = (2 * Math.PI * (tod - 6)) / 24;
    const el = MAX_ELEV * Math.sin(phi);
    const az = -Math.cos(phi) * azSpan;
    sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    moonDir.set(-sunDir.x, -sunDir.y, sunDir.z); // mirrored, so it climbs while the sun is down
    eDeg = THREE.MathUtils.radToDeg(el);
    paletteAt(eDeg);

    let lit;
    if (sunDir.y > -0.05) {
      lightDir.copy(sunDir);
      lightCol.copy(P.sun);
      lit = P.lit;
    } else {
      lightDir.copy(moonDir);
      lightCol.copy(MOON_COLOR);
      lit = 0.3 * THREE.MathUtils.smoothstep(-eDeg, 3, 10);
    }
    sunLight.position.copy(lightDir).multiplyScalar(100);
    sunLight.color.copy(lightCol);
    sunLight.intensity = 2.5 * lit;

    waterMat.uniforms.uTime.value = t;
    waterMat.uniforms.uLight.value = Math.max(P.lit, 0.12);
    waterMat.uniforms.uSunCol.value.copy(lightCol).multiplyScalar(lit * THREE.MathUtils.smoothstep(lightDir.y, -0.02, 0.12));

    // floating and hovering objects
    floaters.forEach((f, i) => {
      const y = waterHeight(f.x, f.z, t);
      f.mesh.position.set(f.x + Math.sin(t * 0.5 + i) * 0.15, y + f.size * 0.25, f.z);
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

    // sky dome, sun and moon sit far away, centred on the camera, so they never parallax
    skyDome.position.copy(camera.position);
    sunSprite.position.copy(camera.position).addScaledVector(sunDir, 450);
    haloSprite.position.copy(sunSprite.position);
    sunSprite.material.color.copy(P.sun);
    haloSprite.material.color.copy(P.sun);
    const nearHorizon = 1 - THREE.MathUtils.clamp(eDeg / 12, 0, 1);
    sunSprite.scale.setScalar(150 * (1 + 0.45 * nearHorizon)); // the low sun looks bigger
    haloSprite.scale.setScalar(520 * (1 + 0.3 * nearHorizon));
    sunSprite.visible = haloSprite.visible = sunDir.y > -0.12; // the sea hides the part below the horizon
    moonSprite.position.copy(camera.position).addScaledVector(moonDir, 450);
    moonSprite.material.opacity = THREE.MathUtils.clamp((0.06 - sunDir.y) / 0.2, 0, 1);
    moonSprite.visible = moonSprite.material.opacity > 0.01;

    if ((skyDirty && now - lastSky > 120) || now - lastSky > SKY_INTERVAL) refreshSky(now);
    if (now - lastEmit > 200) {
      lastEmit = now;
      listeners.forEach((cb) => cb(tod));
    }
  }

  function renderStill() {
    update(1.5, 0, performance.now());
    refreshSky(performance.now());
    renderer.render(scene, camera);
  }

  layout();
  update(calm ? 1.5 : 0, 0, performance.now());
  refreshSky(performance.now());
  renderer.render(scene, camera);
  document.documentElement.classList.add('gl'); // first frame is ready: hide the CSS fallback scene

  let resizeTimer;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { layout(); if (calm) renderStill(); }, 80);
  });
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    document.documentElement.classList.remove('gl'); // fall back to the CSS scene
  });

  const controller = {
    calm,
    get hour() { return tod; },
    get mode() { return mode; },
    onTime: (cb) => listeners.push(cb),
    setMode(m) {
      mode = m === 'lapse' && calm ? 'live' : m; // the fast cycle is an animation: not with reduced motion
      skyDirty = true;
      if (calm) renderStill();
    },
    setTime(hours) { // picking a time by hand leaves live / time-lapse mode
      mode = 'manual';
      tod = ((hours % 24) + 24) % 24;
      skyDirty = true;
      if (calm) renderStill();
    },
  };

  if (calm) return controller; // reduced motion: one still frame, no animation loop

  const t0 = performance.now();
  let frames = 0;
  let acc = 0;
  let last = t0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.1); // clamp so a background tab doesn't skip a day
    update((now - t0) / 1000, dt, now);
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
  return controller;
}
