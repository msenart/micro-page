// Real-time 3D background: a wave-simulated sea, chrome spheres floating on it, metal objects
// hovering in the air, and a sun / moon that travel across the sky through a day-night cycle.
// Built with three.js (vendored in js/vendor/). If WebGL is unavailable, start() throws and the
// CSS background stays in place.

import * as THREE from './vendor/three.module.min.js';
import { createIsland } from './island.js';
import { createInteraction } from './interact.js';

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
// Seven waves with unrelated directions and wavelengths, so the pattern never visibly repeats.
// Each wave's height is also scaled by a slowly drifting envelope (0.3 - 1.0) that varies along the
// wave crest, which breaks them into patches and gusts instead of uniform rows.
const WAVES = [
  [1, 0.3, 0.3, 19.3],
  [-0.6, 1, 0.22, 13.1],
  [0.3, -1, 0.16, 9.7],
  [1, 1, 0.1, 7.1],
  [-1, 0.2, 0.06, 5.3],
  [0.15, 1, 0.035, 4.1],
  [-0.7, -0.8, 0.02, 3.1],
];
const G = 9.8;
const N_WAVES = WAVES.length;
// The mesh only has a vertex every ~2.5 units, so only the long waves (>= 9.7) can be shown by moving
// vertices; shorter ones would alias into a square grid. The fragment shader adds all of them per pixel.
const N_LOW = 3;

function waterHeight(x, z, t) { // matches the displaced mesh, so floating objects sit on the visible surface
  let h = 0;
  WAVES.slice(0, N_LOW).forEach(([dx, dz, a, len], i) => {
    const l = Math.hypot(dx, dz);
    const k = (2 * Math.PI) / len;
    const env = 0.55 + 0.45 * Math.sin(0.037 * ((-dz * x + dx * z) / l) + 0.17 * t + i * 1.7);
    h += a * env * Math.sin((k * (dx * x + dz * z)) / l - Math.sqrt(G * k) * t);
  });
  return h;
}

const WAVES_GLSL = /* glsl */ `
  uniform vec4 uWaves[${N_WAVES}];
  uniform float uTime;
  float waveEnv(vec2 d, vec2 p, int i) {
    return 0.55 + 0.45 * sin(0.037 * dot(vec2(-d.y, d.x), p) + 0.17 * uTime + float(i) * 1.7);
  }
  float waveHeightLow(vec2 p) { // long waves only: used to move the mesh vertices
    float h = 0.0;
    for (int i = 0; i < ${N_LOW}; i++) {
      vec4 w = uWaves[i];
      vec2 d = normalize(w.xy);
      float k = 6.2831853 / w.w;
      h += w.z * waveEnv(d, p, i) * sin(k * dot(d, p) - sqrt(9.8 * k) * uTime);
    }
    return h;
  }
  float waveHeight(vec2 p) { // all waves: used per pixel for colour
    float h = 0.0;
    for (int i = 0; i < ${N_WAVES}; i++) {
      vec4 w = uWaves[i];
      vec2 d = normalize(w.xy);
      float k = 6.2831853 / w.w;
      h += w.z * waveEnv(d, p, i) * sin(k * dot(d, p) - sqrt(9.8 * k) * uTime);
    }
    return h;
  }
  vec2 waveSlope(vec2 p) {
    vec2 g = vec2(0.0);
    for (int i = 0; i < ${N_WAVES}; i++) {
      vec4 w = uWaves[i];
      vec2 d = normalize(w.xy);
      float k = 6.2831853 / w.w;
      g += d * (w.z * waveEnv(d, p, i) * k * cos(k * dot(d, p) - sqrt(9.8 * k) * uTime));
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

// 2D simplex noise (Ian McEwan, Ashima Arts; MIT). Unlike value noise it has no visible grid cells.
const SNOISE_GLSL = /* glsl */ `
  vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod(i, 289.0);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m;
    m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
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
    wp.y += waveHeightLow(wp.xz);
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

  ${SNOISE_GLSL}

  void main() {
    float dist = length(uCam - vWorld);
    // Chaos: a slow, large-scale warp of the wave field. Patches of sea drift out of step with each
    // other, so it reads as irregular swell instead of tidy rows. Low frequency, so it never looks rough.
    vec2 warp = vec2(snoise(vXZ * 0.03 + vec2(uTime * 0.03, 3.1)),
                     snoise(vXZ * 0.03 + vec2(7.7, -uTime * 0.025))) * 6.0;
    vec2 pw = vXZ + warp;
    vec2 g = waveSlope(pw) / (1.0 + dist * 0.012);
    // gentle low-frequency chop on top (wavelength ~4.5 units)
    vec2 q = mat2(0.8, -0.6, 0.6, 0.8) * (vXZ * 0.22) + vec2(uTime * 0.12, -uTime * 0.08); // rotated: no axis-aligned look
    float e = 0.1;
    vec2 dn = vec2(snoise(q + vec2(e, 0.0)) - snoise(q - vec2(e, 0.0)),
                   snoise(q + vec2(0.0, e)) - snoise(q - vec2(0.0, e))) / (2.0 * e);
    g += dn * 0.06 / (1.0 + dist * 0.02);
    float hgt = waveHeight(pw); // per-pixel height: the mesh is too coarse for the small waves
    vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
    vec3 V = normalize(uCam - vWorld);

    vec3 R = reflect(-V, N);
    R.y = abs(R.y);
    vec3 sky = texture2D(uSky, dirUv(R)).rgb;

    float fresnel = 0.04 + 0.96 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);
    float crest = clamp(hgt * 1.6 + 0.35, 0.0, 1.0);
    vec3 col = mix(mix(uDeep, uShallow, crest), sky, fresnel);

    col += uSunCol * pow(max(dot(R, uSun), 0.0), 350.0) * 2.0;                       // sun / moon glint
    vec3 foam = mix(vec3(0.15, 0.2, 0.32), vec3(1.0), uLight);
    col = mix(col, foam, smoothstep(0.55, 0.8, hgt) * 0.45);                    // foam on the crests
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
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ // soft glow around the sun sphere
    map: glowTexture([[0, 'rgba(255,255,255,.85)'], [0.1, 'rgba(255,255,255,.45)'], [0.3, 'rgba(255,255,255,.14)'], [1, 'rgba(255,255,255,0)']]),
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  }));
  sunSprite.scale.setScalar(150);
  const haloSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture([[0, 'rgba(255,255,255,.4)'], [1, 'rgba(255,255,255,0)']]),
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  }));
  haloSprite.scale.setScalar(520);
  const moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ // faint halo around the moon sphere
    map: glowTexture([[0, 'rgba(200,215,255,.5)'], [0.25, 'rgba(200,215,255,.18)'], [1, 'rgba(200,215,255,0)']]),
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  }));
  moonSprite.scale.setScalar(130);

  // The sun and moon themselves are plain, uniformly coloured spheres, far away (radius 11 / 9 at
  // distance 450). Their colour is always a lighter tint of the light they give off (see update()).
  const ballGeo = new THREE.SphereGeometry(1, coarse ? 32 : 48, coarse ? 16 : 24);
  const sunBall = new THREE.Mesh(ballGeo, new THREE.MeshBasicMaterial());
  const moonBall = new THREE.Mesh(ballGeo, new THREE.MeshBasicMaterial({ transparent: true }));
  const WHITE = new THREE.Color('#ffffff');
  scene.add(sunBall, moonBall, sunSprite, haloSprite, moonSprite);
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

  const island = createIsland({ coarse }); // sits on the left, a little way out to sea
  const ISLAND = { nx: -0.7, z: -8 };
  scene.add(island.group);

  const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(0.9, 0.28, coarse ? 110 : 180, coarse ? 16 : 24), chromeMat);
  scene.add(knot);

  const gyro = new THREE.Group(); // three steel rings spinning on different axes
  [1, 0.78, 0.56].forEach((s) => gyro.add(new THREE.Mesh(new THREE.TorusGeometry(s, 0.07, 20, coarse ? 64 : 110), steelMat)));
  scene.add(gyro);

  const air = [ // hovering objects: screen x / y, distance from camera, size, idle spin (rad/s about world axes)
    { obj: knot, nx: -0.78, ny: 0.55, dist: 22, size: 1.2, spin: new THREE.Vector3(0.35, 0.5, 0) },
    { obj: gyro, nx: 0.74, ny: 0.5, dist: 20, size: 1.7, spin: new THREE.Vector3(0.1, 0.18, 0.05) },
  ];

  let wake = () => {}; // set below: makes sure frames are being drawn (needed when motion is reduced)
  const interaction = createInteraction({ canvas, camera, floaters, air, island, waterHeight, wake: (ms) => wake(ms) });

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
    island.group.position.set(ISLAND.nx * halfH(ISLAND.z) * camera.aspect * 0.85, 0, ISLAND.z);
    island.group.scale.setScalar(sizeScale);
    island.group.rotation.y = 0.2;
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

  // On phones, tilting the device moves the camera just like the mouse does on desktop.
  if (coarse && !calm && typeof DeviceOrientationEvent !== 'undefined') {
    let base = null; // neutral pose: however the phone is being held
    const clamp = THREE.MathUtils.clamp;
    const onTilt = (e) => {
      if (e.gamma == null || e.beta == null) return; // no sensor (e.g. desktop browsers)
      const angle = (((screen.orientation ? screen.orientation.angle : window.orientation || 0) % 360) + 360) % 360;
      let x = e.gamma; // left-right tilt
      let y = e.beta; // front-back tilt
      if (angle === 90) { x = e.beta; y = -e.gamma; }
      else if (angle === 270) { x = -e.beta; y = e.gamma; }
      else if (angle === 180) { x = -e.gamma; y = -e.beta; }
      if (!base) base = { x, y };
      base.x += (x - base.x) * 0.002; // drift the neutral pose toward the current one over a few seconds
      base.y += (y - base.y) * 0.002;
      pointer.tx = clamp((x - base.x) / 35, -0.5, 0.5); // about 17 degrees of tilt = full range
      pointer.ty = clamp((y - base.y) / 35, -0.5, 0.5);
    };
    const listen = () => addEventListener('deviceorientation', onTilt, { passive: true });
    addEventListener('orientationchange', () => { base = null; });
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      // iOS only hands out motion data after the user agrees, and only from inside a tap
      const ask = () => {
        removeEventListener('touchend', ask);
        removeEventListener('click', ask);
        DeviceOrientationEvent.requestPermission().then((s) => { if (s === 'granted') listen(); }).catch(() => {});
      };
      addEventListener('touchend', ask);
      addEventListener('click', ask);
    } else {
      listen();
    }
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
    interaction.update(t, dt); // balls float / fly, shapes spin: physics lives in interact.js
    island.update(t, dt);
    gyro.children[0].rotation.y = t * 0.8; // the rings also spin inside the gyroscope
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
    sunSprite.visible = haloSprite.visible = sunBall.visible = sunDir.y > -0.12; // the sea hides the part below the horizon
    sunBall.position.copy(sunSprite.position);
    sunBall.scale.setScalar(11 * (1 + 0.3 * nearHorizon));
    sunBall.material.color.copy(P.sun).lerp(WHITE, 0.6); // uniform colour, lighter than the sunlight (P.sun)
    moonSprite.position.copy(camera.position).addScaledVector(moonDir, 450);
    moonBall.position.copy(moonSprite.position);
    moonBall.scale.setScalar(9);
    const moonFade = THREE.MathUtils.clamp((0.06 - sunDir.y) / 0.2, 0, 1);
    moonBall.material.color.copy(MOON_COLOR).lerp(WHITE, 0.6); // always full, lighter than the moonlight (MOON_COLOR)
    moonBall.material.opacity = moonFade;
    moonSprite.material.color.copy(MOON_COLOR);
    moonSprite.material.opacity = moonFade;
    moonSprite.visible = moonBall.visible = moonFade > 0.01;

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

  const t0 = performance.now();
  let frames = 0;
  let acc = 0;
  let last = t0;
  let running = false;
  let activeUntil = calm ? 0 : Infinity; // reduced motion: only animate for a few seconds after an interaction
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1); // clamp so a background tab doesn't skip a day
    update(calm ? 1.5 : (now - t0) / 1000, dt, now); // reduced motion keeps the sea itself still
    renderer.render(scene, camera);

    // weak device? drop to 1x resolution once
    acc += now - last;
    last = now;
    if (++frames === 90) {
      if (acc / frames > 30 && dpr > 1) { dpr = 1; layout(); }
      frames = 0;
      acc = 0;
    }
    if (now < activeUntil) requestAnimationFrame(frame);
    else running = false;
  }
  wake = (ms = 4000) => {
    activeUntil = Math.max(activeUntil, performance.now() + ms);
    if (!running) {
      running = true;
      last = performance.now();
      requestAnimationFrame(frame);
    }
  };
  if (!calm) wake();
  return controller;
}
