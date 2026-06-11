import * as THREE from './three.module.js';

/* ================================================================
   EGG FRYER 3000 — Galactic Griddle
   A silly futuristic 3D egg frying game for your pocket.
   ================================================================ */

// ---------------- tuning ----------------
const ROUND_TIME = Number(new URLSearchParams(location.search).get('t')) || 60;  // seconds per round (?t= overrides, for testing)
const MAX_COMBO = 5;
const STAGE = {                 // egg age thresholds (seconds)
  GOOEY: 6,                     // < 6s  : still gooey
  ALMOST: 8.5,                  // 6–8.5 : almost there
  PERFECT_END: 12,              // 8.5–12: PERFECT window
  CRISPY_END: 15,               // 12–15 : bit crispy
};                              // > 15  : carbonized
const SCORES = { gooey: 10, almost: 50, perfect: 100, crispy: 40, burnt: -30 };

const PERFECT_LINES = ['EGGCELLENT!', 'YOLK STAR!', 'SUNNY SIDE UP!', 'EGGSTRAORDINARY!', 'OMELETTE YOU COOK!', 'GRADE AAA+!'];
const GOOEY_LINES   = ['STILL GOOEY!', 'TOO SOON, CHEF!', 'RAW DEAL!'];
const ALMOST_LINES  = ['ALMOST!', 'SO CLOSE!'];
const CRISPY_LINES  = ['BIT CRISPY!', 'EXTRA CRUNCH!'];
const BURNT_LINES   = ['CARBONIZED!', 'EGG-SASTER!', 'THAT\'S CHARCOAL!'];
const VERDICTS = [
  [0,    'THE GRIDDLE WEEPS. 😭'],
  [200,  'SCRAMBLED ROOKIE 🥄'],
  [500,  'SHORT-ORDER CADET 🍳'],
  [900,  'YOLK COMMANDER ⭐'],
  [1400, 'GRIDDLE OVERLORD 👑'],
  [2000, 'INTERGALACTIC EGG DEITY 🌌'],
];

// ---------------- state ----------------
let state = 'menu';             // 'menu' | 'playing' | 'over'
let score = 0, combo = 1, timeLeft = ROUND_TIME;
let lastBeepSecond = -1;
const eggs = [];                // live eggs on the pan
const tweens = [];
const particles = [];
let shake = 0;

// ---------------- DOM ----------------
const $ = (id) => document.getElementById(id);
const hud = $('hud'), scoreVal = $('scoreVal'), timerVal = $('timerVal'),
      comboVal = $('comboVal'), comboBox = $('comboBox'), timerBox = $('timerBox');

// ---------------- renderer / scene ----------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0118);
scene.fog = new THREE.Fog(0x0a0118, 14, 40);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
const CAM_DIR = new THREE.Vector3(0, 7.6, 8.8).normalize();
const CAM_BASE_LEN = 11.6;
let camLen = CAM_BASE_LEN;
camera.position.copy(CAM_DIR).multiplyScalar(camLen);
camera.lookAt(0, 0.8, 0);

// pull the camera back on narrow (portrait) screens so the whole pan fits
function fitCamera() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  const halfV = THREE.MathUtils.degToRad(camera.fov / 2);
  const halfH = Math.atan(Math.tan(halfV) * camera.aspect);
  camLen = Math.max(CAM_BASE_LEN, 3.6 / Math.tan(Math.min(halfH, halfV)));
}

scene.add(new THREE.AmbientLight(0x8866ff, 0.55));
const sun = new THREE.DirectionalLight(0xfff4e0, 1.5);
sun.position.set(4, 10, 6);
scene.add(sun);
const rim = new THREE.PointLight(0xff5ef7, 28, 30);
rim.position.set(-6, 4, -6);
scene.add(rim);
const cyanLight = new THREE.PointLight(0x00e5ff, 22, 30);
cyanLight.position.set(6, 3, 5);
scene.add(cyanLight);

// ---------------- backdrop: neon grid + stars ----------------
const grid = new THREE.GridHelper(80, 50, 0xff5ef7, 0x2a1660);
grid.position.y = -2.2;
scene.add(grid);

{
  const starGeo = new THREE.BufferGeometry();
  const n = 350, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = 22 + Math.random() * 30;
    const a = Math.random() * Math.PI * 2;
    const y = Math.random() * 24 - 3;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = Math.sin(a) * r;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xaaccff, size: 0.14, fog: false })));
}

// ---------------- the hover-pan ----------------
const panGroup = new THREE.Group();
panGroup.position.y = 1.1;
scene.add(panGroup);

const PAN_R = 2.7;
const panBody = new THREE.Mesh(
  new THREE.CylinderGeometry(PAN_R, PAN_R * 0.86, 0.42, 48),
  new THREE.MeshStandardMaterial({ color: 0x3b3f4d, metalness: 0.85, roughness: 0.35 })
);
panGroup.add(panBody);

const panSurface = new THREE.Mesh(
  new THREE.CylinderGeometry(PAN_R * 0.93, PAN_R * 0.93, 0.06, 48),
  new THREE.MeshStandardMaterial({ color: 0x2a2d3a, metalness: 0.6, roughness: 0.5 })
);
panSurface.position.y = 0.22;
panGroup.add(panSurface);

const panRim = new THREE.Mesh(
  new THREE.TorusGeometry(PAN_R, 0.13, 14, 48),
  new THREE.MeshStandardMaterial({ color: 0x00e5ff, emissive: 0x00e5ff, emissiveIntensity: 0.7, metalness: 0.4, roughness: 0.3 })
);
panRim.rotation.x = Math.PI / 2;
panRim.position.y = 0.18;
panGroup.add(panRim);

const handle = new THREE.Group();
const handleBar = new THREE.Mesh(
  new THREE.CapsuleGeometry(0.17, 2.2, 6, 14),
  new THREE.MeshStandardMaterial({ color: 0x3b3f4d, metalness: 0.8, roughness: 0.4 })
);
handleBar.rotation.z = Math.PI / 2;
handleBar.position.x = PAN_R + 1.25;
handle.add(handleBar);
const handleTip = new THREE.Mesh(
  new THREE.SphereGeometry(0.26, 16, 12),
  new THREE.MeshStandardMaterial({ color: 0xff5ef7, emissive: 0xff5ef7, emissiveIntensity: 0.9 })
);
handleTip.position.x = PAN_R + 2.45;
handle.add(handleTip);
handle.rotation.y = 0.9;
panGroup.add(handle);

// hover thrusters
const thrusters = [];
for (let i = 0; i < 3; i++) {
  const a = (i / 3) * Math.PI * 2 + 0.5;
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.28, 1.0, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x7df9ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  cone.position.set(Math.cos(a) * 1.6, -0.75, Math.sin(a) * 1.6);
  cone.rotation.x = Math.PI;
  panGroup.add(cone);
  thrusters.push(cone);
}
const underGlow = new THREE.PointLight(0x00e5ff, 14, 8);
underGlow.position.y = -1.2;
panGroup.add(underGlow);

// egg slots on the pan (local coords)
const SLOTS = [
  { x: -1.18, z: -0.92 }, { x: 1.18, z: -0.92 },
  { x: -1.18, z: 0.92 },  { x: 1.18, z: 0.92 },
].map(s => ({ ...s, taken: false }));

// ---------------- egg factory ----------------
function makeWhiteGeometry() {
  // wobbly cartoon splat outline
  const pts = [];
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 0.56 + Math.random() * 0.26;
    pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
  }
  const shape = new THREE.Shape();
  shape.moveTo(pts[0].x, pts[0].y);
  shape.splineThru(pts.slice(1));
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.1, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.1, bevelSegments: 3, curveSegments: 6,
  });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function makeEgg(slot) {
  const group = new THREE.Group();
  group.position.set(slot.x, 0.26, slot.z);

  const whiteMat = new THREE.MeshStandardMaterial({
    color: 0xfff7e0, roughness: 0.45, metalness: 0.05, transparent: true, opacity: 0.78,
    emissive: 0x6b6356, emissiveIntensity: 0.9,
  });
  const white = new THREE.Mesh(makeWhiteGeometry(), whiteMat);
  group.add(white);

  const yolkMat = new THREE.MeshStandardMaterial({ color: 0xffc400, roughness: 0.3, metalness: 0.1, emissive: 0x7a4d00, emissiveIntensity: 1 });
  const yolk = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 14), yolkMat);
  yolk.scale.set(1, 0.62, 1);
  yolk.position.y = 0.16;
  group.add(yolk);

  // googly eyes — mandatory silliness hardware
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const pupilMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
  const eyes = new THREE.Group();
  const pupils = [];
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), eyeMat);
    eye.position.set(sx * 0.13, 0.34, 0.2);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.042, 8, 6), pupilMat);
    pupil.position.set(sx * 0.13, 0.35, 0.27);
    eyes.add(eye, pupil);
    pupils.push(pupil);
  }
  group.add(eyes);

  // doneness ring
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 0.98, 36), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  group.add(ring);

  // fat-finger invisible hit target
  const hit = new THREE.Mesh(
    new THREE.CylinderGeometry(0.95, 0.95, 1.4, 10),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false })
  );
  hit.position.y = 0.5;
  group.add(hit);

  panGroup.add(group);
  return { group, white, yolk, ring, hit, pupils, slot, age: 0, alive: true, eyePhase: Math.random() * 10 };
}

// ---------------- cooking visuals ----------------
const C = {
  rawWhite: new THREE.Color(0xfff7e0), cookedWhite: new THREE.Color(0xffffff),
  crispyWhite: new THREE.Color(0xd9a05a), burntWhite: new THREE.Color(0x3a2412),
  rawYolk: new THREE.Color(0xffc400), perfectYolk: new THREE.Color(0xff9d00),
  crispyYolk: new THREE.Color(0xb86b00), burntYolk: new THREE.Color(0x4a2a08),
  ringRaw: new THREE.Color(0x00e5ff), ringAlmost: new THREE.Color(0xb8ff5e),
  ringPerfect: new THREE.Color(0xffd34d), ringBurnt: new THREE.Color(0xff3c5a),
};
const tmpColor = new THREE.Color();

function updateEggLook(egg, now) {
  const a = egg.age;
  const w = egg.white.material, y = egg.yolk.material, r = egg.ring.material;

  if (a < STAGE.GOOEY) {
    const k = a / STAGE.GOOEY;
    w.opacity = 0.78 + 0.22 * k;
    w.color.copy(C.rawWhite).lerp(C.cookedWhite, k);
    y.color.copy(C.rawYolk);
    r.color.copy(C.ringRaw).lerp(C.ringAlmost, k);
  } else if (a < STAGE.ALMOST) {
    const k = (a - STAGE.GOOEY) / (STAGE.ALMOST - STAGE.GOOEY);
    w.opacity = 1;
    w.color.copy(C.cookedWhite);
    y.color.copy(C.rawYolk).lerp(C.perfectYolk, k);
    r.color.copy(C.ringAlmost).lerp(C.ringPerfect, k);
  } else if (a < STAGE.PERFECT_END) {
    // PERFECT — ring pulses gold, egg does a happy jiggle
    w.opacity = 1;
    w.color.copy(C.cookedWhite);
    y.color.copy(C.perfectYolk);
    const pulse = 0.5 + 0.5 * Math.sin(now * 10);
    r.color.copy(C.ringPerfect);
    r.opacity = 0.6 + 0.4 * pulse;
    egg.ring.scale.setScalar(1 + 0.1 * pulse);
    egg.group.rotation.z = Math.sin(now * 12) * 0.05;
  } else if (a < STAGE.CRISPY_END) {
    const k = (a - STAGE.PERFECT_END) / (STAGE.CRISPY_END - STAGE.PERFECT_END);
    w.color.copy(C.cookedWhite).lerp(C.crispyWhite, k);
    y.color.copy(C.perfectYolk).lerp(C.crispyYolk, k);
    r.color.copy(C.ringPerfect).lerp(C.ringBurnt, k);
    w.emissiveIntensity = 0.9 - 0.5 * k;
    y.emissiveIntensity = 1 - 0.6 * k;
    egg.ring.scale.setScalar(1);
    egg.group.rotation.z = 0;
  } else {
    // burnt: smoking sad lump
    const k = Math.min(1, (a - STAGE.CRISPY_END) / 2);
    w.color.copy(C.crispyWhite).lerp(C.burntWhite, k);
    y.color.copy(C.crispyYolk).lerp(C.burntYolk, k);
    w.emissiveIntensity = 0.4 * (1 - k);
    y.emissiveIntensity = 0.4 * (1 - k);
    r.color.copy(C.ringBurnt);
    r.opacity = 0.5 + 0.5 * Math.sin(now * 16);
    if (Math.random() < 0.12) spawnSmoke(egg.group);
  }

  // googly pupil wiggle
  const wig = Math.sin(now * 7 + egg.eyePhase) * 0.03;
  const wig2 = Math.cos(now * 5.3 + egg.eyePhase) * 0.02;
  for (let i = 0; i < egg.pupils.length; i++) {
    const sx = i === 0 ? -1 : 1;
    egg.pupils[i].position.x = sx * 0.13 + wig;
    egg.pupils[i].position.y = 0.35 + wig2;
  }
}

function gradeEgg(egg) {
  const a = egg.age;
  if (a < STAGE.GOOEY)       return { pts: SCORES.gooey,  lines: GOOEY_LINES,  color: '#7df9ff', perfect: false, burnt: false };
  if (a < STAGE.ALMOST)      return { pts: SCORES.almost, lines: ALMOST_LINES, color: '#b8ff5e', perfect: false, burnt: false };
  if (a < STAGE.PERFECT_END) return { pts: SCORES.perfect, lines: PERFECT_LINES, color: '#ffd34d', perfect: true, burnt: false };
  if (a < STAGE.CRISPY_END)  return { pts: SCORES.crispy, lines: CRISPY_LINES, color: '#ffb347', perfect: false, burnt: false };
  return { pts: SCORES.burnt, lines: BURNT_LINES, color: '#ff3c5a', perfect: false, burnt: true };
}

// ---------------- falling shell eggs ----------------
const drops = [];
function dropEgg(slot) {
  slot.taken = true;
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 18, 14),
    new THREE.MeshStandardMaterial({ color: 0xfdf3dc, roughness: 0.5 })
  );
  shell.scale.set(1, 1.3, 1);
  shell.position.set(slot.x, 8, slot.z);
  panGroup.add(shell);
  drops.push({ shell, slot, vy: 0 });
  sfx.whoosh();
}

function landEgg(drop) {
  panGroup.remove(drop.shell);
  disposeObject(drop.shell);
  const egg = makeEgg(drop.slot);
  eggs.push(egg);
  // splat: squash & stretch in
  egg.group.scale.set(0.01, 0.01, 0.01);
  tween(0.5, (k) => {
    const e = easeOutElastic(k);
    egg.group.scale.set(e, Math.max(0.05, e * (1 - 0.3 * Math.sin(k * Math.PI))), e);
  });
  burstParticles(toWorld(egg.group), 0xfff7e0, 10, 2.2);
  shake = Math.max(shake, 0.12);
  sfx.crack();
}

// ---------------- particles (sparks / smoke / confetti) ----------------
const particleGeo = new THREE.SphereGeometry(0.07, 6, 5);
function spawnParticle(worldPos, color, vel, life, size, additive) {
  const m = new THREE.Mesh(particleGeo, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.95,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false,
  }));
  m.position.copy(worldPos);
  m.scale.setScalar(size);
  scene.add(m);
  particles.push({ m, vel, life, maxLife: life });
}

function burstParticles(worldPos, color, count, speed) {
  for (let i = 0; i < count; i++) {
    const v = new THREE.Vector3((Math.random() - 0.5) * speed, Math.random() * speed, (Math.random() - 0.5) * speed);
    spawnParticle(worldPos, color, v, 0.5 + Math.random() * 0.4, 0.7 + Math.random(), true);
  }
}

function spawnSmoke(obj) {
  const p = toWorld(obj);
  p.x += (Math.random() - 0.5) * 0.5;
  p.z += (Math.random() - 0.5) * 0.5;
  spawnParticle(p, 0x555566, new THREE.Vector3((Math.random() - 0.5) * 0.3, 1 + Math.random(), 0), 1.2, 1.6 + Math.random(), false);
}

function sizzleSparks(dt) {
  // ambient sizzle sparks around cooking eggs
  for (const egg of eggs) {
    if (Math.random() < dt * 6) {
      const p = toWorld(egg.group);
      p.x += (Math.random() - 0.5) * 1.4;
      p.z += (Math.random() - 0.5) * 1.4;
      p.y += 0.1;
      spawnParticle(p, 0xfffb96, new THREE.Vector3(0, 1.5 + Math.random() * 1.5, 0), 0.3, 0.5, true);
    }
  }
}

const _wv = new THREE.Vector3();
function toWorld(obj) { return obj.getWorldPosition(_wv).clone(); }

// ---------------- tweens ----------------
function tween(dur, fn, done) { tweens.push({ t: 0, dur, fn, done }); }
function easeOutElastic(t) {
  if (t === 0 || t === 1) return t;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1;
}

// ---------------- sound (synth, no assets) ----------------
const sfx = (() => {
  let ac = null, noiseBuf = null, sizzleGain = null;
  function ctx() {
    if (!ac) {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      const len = ac.sampleRate;
      noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      // looping sizzle bed
      const src = ac.createBufferSource();
      src.buffer = noiseBuf; src.loop = true;
      const f = ac.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = 5200; f.Q.value = 0.5;
      sizzleGain = ac.createGain(); sizzleGain.gain.value = 0;
      src.connect(f); f.connect(sizzleGain); sizzleGain.connect(ac.destination);
      src.start();
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  function tone(freq, dur, type = 'square', vol = 0.1, delay = 0, slide = 0) {
    const a = ctx();
    const t0 = a.currentTime + delay;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(a.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(dur, vol = 0.25, freq = 1800, delay = 0) {
    const a = ctx();
    const t0 = a.currentTime + delay;
    const src = a.createBufferSource();
    src.buffer = noiseBuf;
    const f = a.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.8;
    const g = a.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(a.destination);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }
  return {
    unlock: () => ctx(),
    setSizzle(level) { if (sizzleGain) sizzleGain.gain.setTargetAtTime(level, ac.currentTime, 0.2); },
    whoosh: () => noise(0.3, 0.12, 900),
    crack() { noise(0.12, 0.4, 2500); tone(140, 0.12, 'sine', 0.25, 0, -60); },
    perfect() { tone(880, 0.09, 'square', 0.12); tone(1318, 0.14, 'square', 0.12, 0.09); tone(1760, 0.18, 'square', 0.1, 0.18); },
    good() { tone(660, 0.1, 'square', 0.1); tone(880, 0.12, 'square', 0.1, 0.1); },
    meh() { tone(330, 0.12, 'triangle', 0.12); },
    burnt() { tone(220, 0.18, 'sawtooth', 0.14, 0, -100); tone(140, 0.3, 'sawtooth', 0.14, 0.15, -60); noise(0.4, 0.2, 500); },
    beep: () => tone(1200, 0.07, 'square', 0.08),
    gameover() { tone(523, 0.15, 'square', 0.12); tone(392, 0.15, 'square', 0.12, 0.16); tone(330, 0.3, 'square', 0.12, 0.32); },
    start() { tone(523, 0.1, 'square', 0.1); tone(659, 0.1, 'square', 0.1, 0.1); tone(784, 0.18, 'square', 0.12, 0.2); },
  };
})();

// ---------------- input ----------------
const raycaster = new THREE.Raycaster();
const tapNDC = new THREE.Vector2();

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (state !== 'playing') return;
  tapNDC.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(tapNDC, camera);

  // 1) did we tap an egg?
  const hitMeshes = eggs.filter(eg => eg.alive).map(eg => eg.hit);
  const eggHits = raycaster.intersectObjects(hitMeshes, false);
  if (eggHits.length) {
    const egg = eggs.find(eg => eg.hit === eggHits[0].object);
    if (egg) serveEgg(egg, e.clientX, e.clientY);
    return;
  }

  // 2) did we tap the pan? → crack a new egg into the nearest free slot
  const panHits = raycaster.intersectObject(panSurface, false);
  if (panHits.length) {
    const local = panGroup.worldToLocal(panHits[0].point.clone());
    let best = null, bestD = Infinity;
    for (const s of SLOTS) {
      if (s.taken) continue;
      const d = (s.x - local.x) ** 2 + (s.z - local.z) ** 2;
      if (d < bestD) { bestD = d; best = s; }
    }
    if (best) dropEgg(best);
    else {
      popup(e.clientX, e.clientY, 'PAN FULL!', '#ff9df5', 16);
      sfx.meh();
    }
  }
}, { passive: true });

document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

// ---------------- serving ----------------
function serveEgg(egg, sx, sy) {
  if (!egg.alive) return;
  egg.alive = false;
  const grade = gradeEgg(egg);

  if (grade.perfect) {
    combo = Math.min(MAX_COMBO, combo + 1);
    comboBox.classList.remove('bump'); void comboBox.offsetWidth; comboBox.classList.add('bump');
    sfx.perfect();
  } else {
    combo = 1;
    if (grade.burnt) { sfx.burnt(); shake = Math.max(shake, 0.35); }
    else if (grade.pts >= SCORES.almost) sfx.good();
    else sfx.meh();
  }

  const pts = grade.perfect ? grade.pts * combo : grade.pts;
  score = Math.max(0, score + pts);
  updateHUD();

  const line = grade.lines[Math.floor(Math.random() * grade.lines.length)];
  popup(sx, sy - 30, line, grade.color, 20);
  popup(sx, sy + 14, (pts >= 0 ? '+' : '') + pts + (grade.perfect && combo > 1 ? '  ×' + combo : ''), grade.color, 26);

  const wp = toWorld(egg.group);
  burstParticles(wp, grade.burnt ? 0x555566 : 0xffd34d, grade.perfect ? 18 : 10, grade.perfect ? 3.2 : 2);
  if (navigator.vibrate) navigator.vibrate(grade.perfect ? [20, 30, 20] : 15);

  // launch the egg off the pan
  const slot = egg.slot;
  tween(0.45, (k) => {
    egg.group.position.y = 0.26 + k * 5 * (1 - k * 0.4);
    egg.group.rotation.x = k * Math.PI * 2;
    const s = 1 - k;
    egg.group.scale.setScalar(Math.max(0.01, s));
  }, () => {
    panGroup.remove(egg.group);
    disposeObject(egg.group);
    slot.taken = false;
  });
  eggs.splice(eggs.indexOf(egg), 1);
}

// ---------------- popups ----------------
function popup(x, y, text, color, size) {
  const el = document.createElement('div');
  el.className = 'popup';
  el.textContent = text;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.style.color = color;
  el.style.fontSize = size + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

// ---------------- HUD ----------------
function updateHUD() {
  scoreVal.textContent = score;
  comboVal.textContent = '×' + combo;
  timerVal.textContent = Math.max(0, Math.ceil(timeLeft));
  timerBox.classList.toggle('hurry', state === 'playing' && timeLeft <= 10);
}

// ---------------- leaderboard ----------------
const LS_KEY = 'eggfryer3000.halloflame';
function loadBoard() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; }
  catch { return []; }
}
function saveScore(name, pts) {
  const board = loadBoard();
  const entry = { name, pts, date: Date.now() };
  board.push(entry);
  board.sort((a, b) => b.pts - a.pts);
  board.length = Math.min(board.length, 10);
  localStorage.setItem(LS_KEY, JSON.stringify(board));
  return entry;
}
function renderBoard(el, highlight) {
  const board = loadBoard();
  if (!board.length) {
    el.innerHTML = '<div class="board-empty">No fry-lords yet. Be the first! 🥇</div>';
    return;
  }
  const medals = ['🥇', '🥈', '🥉'];
  el.innerHTML = board.map((r, i) => {
    const me = highlight && r.name === highlight.name && r.pts === highlight.pts && r.date === highlight.date;
    return `<div class="board-row${me ? ' me' : ''}">
      <span class="rank">${medals[i] || (i + 1) + '.'}</span>
      <span class="name">${escapeHTML(r.name)}</span>
      <span class="pts">${r.pts}</span>
    </div>`;
  }).join('');
}
function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------- game flow ----------------
const startScreen = $('startScreen'), overScreen = $('overScreen');

function startGame() {
  sfx.unlock();
  sfx.start();
  // clear leftovers
  for (const egg of eggs) { panGroup.remove(egg.group); disposeObject(egg.group); }
  eggs.length = 0;
  for (const d of drops) { panGroup.remove(d.shell); disposeObject(d.shell); }
  drops.length = 0;
  for (const s of SLOTS) s.taken = false;

  score = 0; combo = 1; timeLeft = ROUND_TIME; lastBeepSecond = -1;
  state = 'playing';
  startScreen.classList.remove('show');
  overScreen.classList.remove('show');
  hud.style.display = 'flex';
  updateHUD();
}

function endGame() {
  state = 'over';
  sfx.gameover();
  sfx.setSizzle(0);
  hud.style.display = 'none';

  // poof away remaining eggs
  for (const egg of eggs) {
    burstParticles(toWorld(egg.group), 0xffd34d, 6, 2);
    panGroup.remove(egg.group);
    disposeObject(egg.group);
  }
  eggs.length = 0;
  for (const d of drops) { panGroup.remove(d.shell); disposeObject(d.shell); }
  drops.length = 0;
  for (const s of SLOTS) s.taken = false;

  $('finalScore').textContent = score;
  let verdict = VERDICTS[0][1];
  for (const [min, label] of VERDICTS) if (score >= min) verdict = label;
  $('verdict').textContent = verdict;
  $('overEmoji').textContent = score >= 900 ? '👨‍🍳' : score >= 200 ? '🍽️' : '🧯';

  $('nameEntry').style.display = 'flex';
  $('overBoardTitle').style.display = 'none';
  $('overBoard').style.display = 'none';
  const savedName = localStorage.getItem('eggfryer3000.name');
  if (savedName) $('nameInput').value = savedName;
  overScreen.classList.add('show');
}

$('startBtn').addEventListener('click', startGame);
$('againBtn').addEventListener('click', startGame);
$('saveBtn').addEventListener('click', () => {
  const name = ($('nameInput').value.trim() || 'CHEF').toUpperCase().slice(0, 8);
  localStorage.setItem('eggfryer3000.name', name);
  const entry = saveScore(name, score);
  $('nameEntry').style.display = 'none';
  $('overBoardTitle').style.display = 'block';
  $('overBoard').style.display = 'block';
  renderBoard($('overBoard'), entry);
  $('nameInput').blur();
  sfx.good();
});
$('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('saveBtn').click(); });

renderBoard($('startBoard'));

// ---------------- cleanup helper ----------------
function disposeObject(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material.dispose();
    }
  });
}

// ---------------- resize ----------------
window.addEventListener('resize', () => {
  fitCamera();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
fitCamera();

// ---------------- main loop ----------------
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = clock.elapsedTime;

  // pan hover bob + sway
  panGroup.position.y = 1.1 + Math.sin(now * 1.7) * 0.12;
  panGroup.rotation.z = Math.sin(now * 1.3) * 0.02;
  panGroup.rotation.x = Math.cos(now * 1.1) * 0.015;

  // thruster flicker
  for (let i = 0; i < thrusters.length; i++) {
    const s = 0.8 + Math.sin(now * 20 + i * 2.1) * 0.2 + Math.random() * 0.15;
    thrusters[i].scale.set(1, s, 1);
    thrusters[i].material.opacity = 0.35 + Math.random() * 0.3;
  }

  // grid scroll illusion
  grid.position.z = (now * 1.5) % 1.6;

  // camera: lazy sway + shake
  shake = Math.max(0, shake - dt * 1.2);
  camera.position.x = CAM_DIR.x * camLen + Math.sin(now * 0.4) * 0.35 + (Math.random() - 0.5) * shake;
  camera.position.y = CAM_DIR.y * camLen + Math.sin(now * 0.6) * 0.15 + (Math.random() - 0.5) * shake;
  camera.position.z = CAM_DIR.z * camLen + (Math.random() - 0.5) * shake * 0.5;
  camera.lookAt(0, 0.8, 0);

  // gameplay
  if (state === 'playing') {
    timeLeft -= dt;
    if (timeLeft <= 5 && Math.ceil(timeLeft) !== lastBeepSecond && timeLeft > 0) {
      lastBeepSecond = Math.ceil(timeLeft);
      sfx.beep();
    }
    updateHUD();
    if (timeLeft <= 0) endGame();

    for (const egg of eggs) {
      egg.age += dt;
      updateEggLook(egg, now);
    }
    sizzleSparks(dt);
    sfx.setSizzle(Math.min(0.16, eggs.length * 0.045));
  }

  // falling shells
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    d.vy -= 30 * dt;
    d.shell.position.y += d.vy * dt;
    d.shell.rotation.x += dt * 6;
    if (d.shell.position.y <= 0.55) {
      drops.splice(i, 1);
      landEgg(d);
    }
  }

  // tweens
  for (let i = tweens.length - 1; i >= 0; i--) {
    const t = tweens[i];
    t.t += dt;
    const k = Math.min(1, t.t / t.dur);
    t.fn(k);
    if (k >= 1) { tweens.splice(i, 1); if (t.done) t.done(); }
  }

  // particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      scene.remove(p.m);
      p.m.material.dispose();
      particles.splice(i, 1);
      continue;
    }
    p.vel.y -= (p.vel.y > 0 ? 1.5 : 4) * dt;
    p.m.position.addScaledVector(p.vel, dt);
    p.m.material.opacity = 0.95 * (p.life / p.maxLife);
  }

  renderer.render(scene, camera);
}
animate();
