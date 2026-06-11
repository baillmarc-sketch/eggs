import * as THREE from './three.module.js';

/* ================================================================
   EGG FRYER 3000 — Galactic Griddle
   A silly futuristic 3D egg frying game for your pocket.
   ================================================================ */

// ---------------- tuning ----------------
const ROUND_TIME = Number(new URLSearchParams(location.search).get('t')) || 60;  // seconds per round (?t= overrides, for testing)
const MAX_COMBO = 5;
const STAGE = {                 // egg age thresholds (seconds)
  GOOEY: 3,                     // < 3s : still gooey
  ALMOST: 6,                    // 3–6  : almost there
  PERFECT_END: 8,               // 6–8  : PERFECT window
  CRISPY_END: 10,               // 8–10 : bit crispy
};                              // > 10 : carbonized
const SCORES = { gooey: 10, almost: 50, perfect: 100, overEasy: 150, crispy: 40, burnt: -30 };

// GLOBAL LEADERBOARD: paste your Firebase Realtime Database URL between the
// quotes below and the Hall of Flame is shared by every phone, forever.
// Leave empty for a device-local board. Setup steps are in the README.
const FIREBASE_DB_URL = 'https://eggs-ec17c-default-rtdb.firebaseio.com';
const REMOTE_DB_URL = (new URLSearchParams(location.search).get('db') || FIREBASE_DB_URL)
  .replace(/\/$/, '');

const PERFECT_LINES = ['EGGCELLENT!', 'YOLK STAR!', 'SUNNY SIDE UP!', 'EGGSTRAORDINARY!', 'OMELETTE YOU COOK!', 'GRADE AAA+!'];
const GOOEY_LINES   = ['STILL GOOEY!', 'TOO SOON, CHEF!', 'RAW DEAL!'];
const ALMOST_LINES  = ['ALMOST!', 'SO CLOSE!'];
const CRISPY_LINES  = ['BIT CRISPY!', 'EXTRA CRUNCH!'];
const BURNT_LINES   = ['CARBONIZED!', 'EGG-SASTER!', 'THAT\'S CHARCOAL!'];
const OVEREASY_LINES = ['OVER EASY!', 'FLIP-TASTIC!', 'BOTH SIDES?! WOW!'];
const BROKEN_LINES  = ['BROKEN YOLK!', 'STILL TASTY... ISH'];
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
  white.renderOrder = 1;
  group.add(white);

  // browned edge that peeks out from under the white as it cooks
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0xdf9c3f, roughness: 0.6, transparent: true, opacity: 0 });
  const edge = new THREE.Mesh(white.geometry, edgeMat);
  edge.scale.set(1.13, 0.5, 1.13);
  edge.position.y = -0.03;
  group.add(edge);

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

  panGroup.add(group);
  return {
    group, white, edge, yolk, ring, pupils, slot,
    age: 0, alive: true, eyePhase: Math.random() * 10, bubbles: [],
    flipped: false, broken: false, flipping: false, flips: 0, hancock: false,
  };
}

// ---------------- cooking visuals ----------------
const C = {
  rawWhite: new THREE.Color(0xfff0c2), cookedWhite: new THREE.Color(0xffffff),
  crispyWhite: new THREE.Color(0xd9a05a), burntWhite: new THREE.Color(0x33200f),
  rawYolk: new THREE.Color(0xffc400), perfectYolk: new THREE.Color(0xff9d00),
  crispyYolk: new THREE.Color(0xb86b00), burntYolk: new THREE.Color(0x3d2206),
  edgeLight: new THREE.Color(0xdf9c3f), edgeDark: new THREE.Color(0x6b3c14),
  edgeBurnt: new THREE.Color(0x180e06),
  ringRaw: new THREE.Color(0x00e5ff), ringAlmost: new THREE.Color(0xb8ff5e),
  ringPerfect: new THREE.Color(0xffd34d), ringBurnt: new THREE.Color(0xff3c5a),
};

const bubbleGeo = new THREE.SphereGeometry(0.06, 8, 6);

// yolk silhouette: proud dome / over-easy bump / broken smear
const NORMAL_YOLK = [1, 0.62, 1], FLIPPED_YOLK = [1.12, 0.36, 1.12], BROKEN_YOLK = [1.5, 0.2, 1.5];

function updateEggLook(egg, now, dt) {
  const a = egg.age;
  const w = egg.white.material, y = egg.yolk.material, r = egg.ring.material, e = egg.edge.material;
  const yb = egg.broken ? BROKEN_YOLK : egg.flipped ? FLIPPED_YOLK : NORMAL_YOLK;
  egg.yolk.position.y = (egg.flipped || egg.broken) ? 0.07 : 0.16;

  if (a < STAGE.GOOEY) {
    // RAW: translucent, runny, spreading, wobbling like jelly
    const k = a / STAGE.GOOEY;
    w.opacity = 0.55 + 0.45 * k;
    w.color.copy(C.rawWhite).lerp(C.cookedWhite, k);
    w.emissiveIntensity = 0.5 + 0.4 * k;
    const jig = (1 - k) * 0.08;
    const spread = 0.78 + 0.22 * k;
    egg.white.scale.set(
      spread + Math.sin(now * 13 + egg.eyePhase) * jig,
      1 + Math.sin(now * 17 + egg.eyePhase) * jig * 2.5,
      spread + Math.cos(now * 11 + egg.eyePhase) * jig
    );
    egg.yolk.scale.set(yb[0] + Math.sin(now * 15) * jig, yb[1] - Math.sin(now * 15) * jig * 0.5, yb[2]);
    y.color.copy(C.rawYolk);
    y.roughness = 0.2;
    e.opacity = 0;
    r.color.copy(C.ringRaw).lerp(C.ringAlmost, k);
  } else if (a < STAGE.ALMOST) {
    // SETTING: solid white, golden edge starts creeping in
    const k = (a - STAGE.GOOEY) / (STAGE.ALMOST - STAGE.GOOEY);
    w.opacity = 1;
    w.color.copy(C.cookedWhite);
    w.emissiveIntensity = 0.9;
    egg.white.scale.set(1, 1, 1);
    egg.yolk.scale.set(yb[0], yb[1], yb[2]);
    y.color.copy(C.rawYolk).lerp(C.perfectYolk, k);
    y.roughness = 0.2 + 0.2 * k;
    e.opacity = k * 0.9;
    e.color.copy(C.edgeLight);
    r.color.copy(C.ringAlmost).lerp(C.ringPerfect, k);
  } else if (a < STAGE.PERFECT_END) {
    // PERFECT — golden edge, puffed up proud, happy jiggle, ring pulses gold
    w.opacity = 1;
    w.color.copy(C.cookedWhite);
    y.color.copy(C.perfectYolk);
    e.opacity = 1;
    e.color.copy(C.edgeLight).lerp(C.edgeDark, 0.35);
    const pulse = 0.5 + 0.5 * Math.sin(now * 10);
    egg.white.scale.setScalar(1 + 0.05 * pulse);
    egg.yolk.scale.set(yb[0], yb[1] + 0.04 * pulse, yb[2]);
    r.color.copy(C.ringPerfect);
    r.opacity = 0.6 + 0.4 * pulse;
    egg.ring.scale.setScalar(1 + 0.1 * pulse);
    egg.group.rotation.z = Math.sin(now * 12) * 0.05;
    if (Math.random() < dt * 3) {
      const p = toWorld(egg.group); p.y += 0.6;
      spawnParticle(p, 0xffd34d, new THREE.Vector3((Math.random() - 0.5) * 0.6, 1.2, 0), 0.5, 0.6, true);
    }
  } else if (a < STAGE.CRISPY_END) {
    // CRISPY: browning all over, edge darkens, yolk deflates
    const k = (a - STAGE.PERFECT_END) / (STAGE.CRISPY_END - STAGE.PERFECT_END);
    w.color.copy(C.cookedWhite).lerp(C.crispyWhite, k);
    y.color.copy(C.perfectYolk).lerp(C.crispyYolk, k);
    e.color.copy(C.edgeLight).lerp(C.edgeDark, 0.35 + 0.65 * k);
    r.color.copy(C.ringPerfect).lerp(C.ringBurnt, k);
    w.emissiveIntensity = 0.9 - 0.5 * k;
    y.emissiveIntensity = 1 - 0.6 * k;
    egg.white.scale.setScalar(1 - 0.06 * k);
    egg.yolk.scale.set(yb[0], Math.max(0.1, yb[1] - 0.1 * k), yb[2]);
    egg.ring.scale.setScalar(1);
    egg.group.rotation.z = 0;
    if (Math.random() < dt * 2 * k) spawnSmoke(egg.group);
  } else {
    // BURNT: charred, shriveled, smoking, eyes spinning dizzy
    const k = Math.min(1, (a - STAGE.CRISPY_END) / 2);
    w.color.copy(C.crispyWhite).lerp(C.burntWhite, k);
    y.color.copy(C.crispyYolk).lerp(C.burntYolk, k);
    e.color.copy(C.edgeDark).lerp(C.edgeBurnt, k);
    w.emissiveIntensity = 0.4 * (1 - k);
    y.emissiveIntensity = 0.4 * (1 - k);
    egg.white.scale.setScalar(0.94 - 0.08 * k);
    egg.yolk.scale.set(yb[0] * (1 - 0.1 * k), Math.max(0.08, yb[1] * 0.85 - 0.08 * k), yb[2] * (1 - 0.1 * k));
    r.color.copy(C.ringBurnt);
    r.opacity = 0.5 + 0.5 * Math.sin(now * 16);
    egg.group.rotation.z = Math.sin(now * 30) * 0.02 * (1 - k);
    if (Math.random() < 0.12) spawnSmoke(egg.group);
  }

  // sizzle bubbles on the white while it cooks
  if (a > 2 && a < STAGE.CRISPY_END && Math.random() < dt * 4) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xfffbee, transparent: true, opacity: 0.75 });
    const b = new THREE.Mesh(bubbleGeo, mat);
    const ang = Math.random() * Math.PI * 2, rad = 0.2 + Math.random() * 0.5;
    b.position.set(Math.cos(ang) * rad, 0.13, Math.sin(ang) * rad);
    b.scale.setScalar(0.4);
    egg.group.add(b);
    egg.bubbles.push({ m: b, life: 0.45 });
  }
  for (let i = egg.bubbles.length - 1; i >= 0; i--) {
    const b = egg.bubbles[i];
    b.life -= dt;
    b.m.scale.setScalar(0.4 + (0.45 - b.life) * 2.2);
    b.m.material.opacity = Math.max(0, b.life * 1.7);
    if (b.life <= 0) {
      egg.group.remove(b.m);
      b.m.material.dispose();
      egg.bubbles.splice(i, 1);
    }
  }

  // googly pupils: wiggle normally, spin dizzily when burnt
  for (let i = 0; i < egg.pupils.length; i++) {
    const sx = i === 0 ? -1 : 1;
    if (a >= STAGE.CRISPY_END) {
      egg.pupils[i].position.x = sx * 0.13 + Math.cos(now * 9 + i * Math.PI) * 0.05;
      egg.pupils[i].position.y = 0.35 + Math.sin(now * 9 + i * Math.PI) * 0.04;
    } else {
      egg.pupils[i].position.x = sx * 0.13 + Math.sin(now * 7 + egg.eyePhase) * 0.03;
      egg.pupils[i].position.y = 0.35 + Math.cos(now * 5.3 + egg.eyePhase) * 0.02;
    }
  }
}

function gradeEgg(egg) {
  const a = egg.age;
  if (a < STAGE.GOOEY)       return { pts: SCORES.gooey,  lines: GOOEY_LINES,  color: '#7df9ff', perfect: false, burnt: false };
  if (a < STAGE.ALMOST)      return { pts: SCORES.almost, lines: ALMOST_LINES, color: '#b8ff5e', perfect: false, burnt: false };
  if (a < STAGE.PERFECT_END) {
    if (egg.broken) return { pts: SCORES.almost, lines: BROKEN_LINES, color: '#b8ff5e', perfect: false, burnt: false };
    if (egg.flipped) return { pts: SCORES.overEasy, lines: OVEREASY_LINES, color: '#ffd34d', perfect: true, burnt: false };
    return { pts: SCORES.perfect, lines: PERFECT_LINES, color: '#ffd34d', perfect: true, burnt: false };
  }
  if (a < STAGE.CRISPY_END)  return { pts: SCORES.crispy, lines: CRISPY_LINES, color: '#ffb347', perfect: false, burnt: false };
  return { pts: SCORES.burnt, lines: BURNT_LINES, color: '#ff3c5a', perfect: false, burnt: true };
}

// ---------------- falling shell eggs + crack animation ----------------
const drops = [];
const shellBits = [];

function makeShellHalf(top) {
  // hemisphere with open rim so the cracked halves look hollow
  const geo = new THREE.SphereGeometry(0.42, 18, 9, 0, Math.PI * 2, top ? 0 : Math.PI / 2, Math.PI / 2);
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color: 0xfdf3dc, roughness: 0.5, side: THREE.DoubleSide, transparent: true,
  }));
}

function dropEgg(slot) {
  slot.taken = true;
  const shell = new THREE.Group();
  shell.add(makeShellHalf(true), makeShellHalf(false));
  shell.scale.set(1, 1.3, 1);
  shell.position.set(slot.x, 8, slot.z);
  panGroup.add(shell);
  drops.push({ shell, slot, vy: 0 });
  sfx.whoosh();
}

const crackingShells = [];
function landEgg(drop) {
  const { shell, slot } = drop;
  crackingShells.push(shell);
  shell.position.y = 0.55;
  shell.rotation.set(0, 0, 0);
  sfx.crack();
  shake = Math.max(shake, 0.12);

  // 1) the shell squashes against the pan...
  tween(0.1, (k) => {
    shell.scale.set(1 + 0.3 * k, 1.3 * (1 - 0.4 * k), 1 + 0.3 * k);
  }, () => {
    // 2) ...then bursts into two halves that fly apart
    const halves = shell.children.slice();
    for (let i = 0; i < halves.length; i++) {
      const half = halves[i];
      const side = i === 0 ? 1 : -1;
      shell.remove(half);
      half.scale.set(1, 1.3, 1);
      half.position.set(slot.x, 0.55 + (i === 0 ? 0.25 : 0), slot.z);
      panGroup.add(half);
      shellBits.push({
        m: half,
        vel: new THREE.Vector3(side * (1.2 + Math.random()), 3.2 + Math.random() * 1.5, (Math.random() - 0.5) * 2),
        angVel: new THREE.Vector3(side * (6 + Math.random() * 6), Math.random() * 4, side * 5),
        life: 0.9,
      });
    }
    panGroup.remove(shell);
    crackingShells.splice(crackingShells.indexOf(shell), 1);
    sfx.pop();

    // 3) and the fried egg splats in underneath
    const egg = makeEgg(slot);
    eggs.push(egg);
    egg.group.scale.set(0.01, 0.01, 0.01);
    tween(0.5, (k) => {
      const e = easeOutElastic(k);
      egg.group.scale.set(e, Math.max(0.05, e * (1 - 0.3 * Math.sin(k * Math.PI))), e);
    });
    burstParticles(toWorld(egg.group), 0xfff7e0, 10, 2.2);
  });
}

const flyingEggs = [];
function clearTransients() {
  for (const b of shellBits) { panGroup.remove(b.m); disposeObject(b.m); }
  shellBits.length = 0;
  for (const s of crackingShells) { panGroup.remove(s); disposeObject(s); }
  crackingShells.length = 0;
  for (const g of flyingEggs) { panGroup.remove(g); disposeObject(g); }
  flyingEggs.length = 0;
  for (const r of rainEggs) scene.remove(r.m);  // shared geometry, no dispose
  rainEggs.length = 0;
  tweens.length = 0;
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
    pop: () => { noise(0.08, 0.3, 3000); tone(420, 0.07, 'triangle', 0.15, 0, 200); },
    flip() { noise(0.2, 0.14, 1300); tone(330, 0.22, 'sine', 0.14, 0, 550); },
    thud() { noise(0.09, 0.25, 1400); tone(120, 0.1, 'sine', 0.2, 0, -40); },
    crack() { noise(0.12, 0.4, 2500); tone(140, 0.12, 'sine', 0.25, 0, -60); },
    perfect() { tone(880, 0.09, 'square', 0.12); tone(1318, 0.14, 'square', 0.12, 0.09); tone(1760, 0.18, 'square', 0.1, 0.18); },
    good() { tone(660, 0.1, 'square', 0.1); tone(880, 0.12, 'square', 0.1, 0.1); },
    meh() { tone(330, 0.12, 'triangle', 0.12); },
    burnt() { tone(220, 0.18, 'sawtooth', 0.14, 0, -100); tone(140, 0.3, 'sawtooth', 0.14, 0.15, -60); noise(0.4, 0.2, 500); },
    beep: () => tone(1200, 0.07, 'square', 0.08),
    gameover() { tone(523, 0.15, 'square', 0.12); tone(392, 0.15, 'square', 0.12, 0.16); tone(330, 0.3, 'square', 0.12, 0.32); },
    smooch() {
      // mwah!
      tone(520, 0.14, 'sine', 0.22, 0, 600);
      noise(0.06, 0.18, 1600, 0.13);
      tone(1100, 0.22, 'sine', 0.18, 0.15, -500);
      tone(659, 0.12, 'triangle', 0.12, 0.45);
      tone(880, 0.25, 'triangle', 0.12, 0.58);
    },
    hohoho() {
      // three deep belly laughs...
      for (let i = 0; i < 3; i++) {
        const t = i * 0.32;
        tone(150, 0.16, 'sawtooth', 0.16, t, -55);
        tone(95, 0.24, 'sine', 0.28, t, -25);
        noise(0.1, 0.12, 700, t);
      }
      // ...and sleigh bells
      for (let i = 0; i < 6; i++) tone(i % 2 ? 2350 : 1980, 0.09, 'triangle', 0.07, 1.05 + i * 0.11);
    },
    scribble() {
      // pen scratching out a flourish of a signature, then a ding
      for (let i = 0; i < 5; i++) noise(0.09, 0.14, 2600 + (i % 2) * 900, i * 0.13);
      tone(1568, 0.3, 'triangle', 0.14, 0.75);
      tone(2093, 0.4, 'triangle', 0.1, 0.85);
    },
    hancock() {
      // triumphant fanfare and a drumroll of falling-egg plops
      const seq = [523, 659, 784, 1047];
      seq.forEach((f, i) => tone(f, 0.12, 'square', 0.1, i * 0.09));
      tone(1319, 0.35, 'square', 0.12, 0.36);
      for (let i = 0; i < 5; i++) noise(0.07, 0.2, 1200 + i * 150, 0.5 + i * 0.12);
    },
    smackdown() {
      // crowd roar swells, the body hits the mat, then the bell
      noise(1.1, 0.16, 500);
      tone(70, 0.5, 'sine', 0.4, 0.78, -35);
      noise(0.18, 0.35, 900, 0.78);
      for (let i = 0; i < 3; i++) tone(2640, 0.22, 'square', 0.07, 1.25 + i * 0.28);
    },
    crabRave() {
      // tiny rave: plucky melody over a four-on-the-floor bass thump
      const melody = [523, 659, 784, 659, 880, 784, 659, 523, 587, 698, 880, 1047];
      for (let pass = 0; pass < 2; pass++) {
        const off = pass * melody.length * 0.16;
        melody.forEach((f, i) => tone(f, 0.13, 'square', 0.08, off + i * 0.16));
        for (let i = 0; i < 6; i++) tone(98, 0.1, 'sine', 0.3, off + i * 0.32, -10);
      }
    },
    start() { tone(523, 0.1, 'square', 0.1); tone(659, 0.1, 'square', 0.1, 0.1); tone(784, 0.18, 'square', 0.12, 0.2); },
  };
})();

// ---------------- input: tap to cook, drag to tilt the pan ----------------
const raycaster = new THREE.Raycaster();
const tapNDC = new THREE.Vector2();

let pointerHeld = false, gesture = 'none';  // 'none' | 'tilt' | 'flip'
let downTime = 0, eggAtStart = null;
const dragStart = { x: 0, y: 0 };
const tiltTarget = { x: 0, z: 0 };   // where the pan wants to lean
const tilt = { x: 0, z: 0 };         // where it actually is (springy)
const TILT_MAX = 0.32;

const panPlane = new THREE.Plane();
const planeNormal = new THREE.Vector3();
const tapPoint = new THREE.Vector3();

// project a screen point onto the (possibly tilted) pan surface plane,
// in pan-local coords — so the egg you aim at is the one you get, even
// when eggs overlap on screen
function projectToPan(x, y) {
  tapNDC.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(tapNDC, camera);
  planeNormal.set(0, 1, 0).applyQuaternion(panGroup.quaternion);
  panPlane.setFromNormalAndCoplanarPoint(planeNormal, panGroup.position);
  if (!raycaster.ray.intersectPlane(panPlane, tapPoint)) return null;
  return panGroup.worldToLocal(tapPoint.clone());
}

function eggNear(local) {
  let bestEgg = null, bestD = Infinity;
  for (const egg of eggs) {
    if (!egg.alive || egg.flipping) continue;
    const d = Math.hypot(egg.group.position.x - local.x, egg.group.position.z - local.z);
    if (d < bestD) { bestD = d; bestEgg = egg; }
  }
  return bestEgg ? { egg: bestEgg, d: bestD } : null;
}

function handleTap(x, y) {
  if (state !== 'playing') return;
  const local = projectToPan(x, y);
  if (!local) return;

  const near = eggNear(local);
  let bestSlot = null, bestSlotD = Infinity;
  for (const s of SLOTS) {
    if (s.taken) continue;
    const d = Math.hypot(s.x - local.x, s.z - local.z);
    if (d < bestSlotD) { bestSlotD = d; bestSlot = s; }
  }

  // serve the egg when the tap is closer to it than to any free slot —
  // no dead zones between slots, no front egg stealing back-egg taps
  if (near && near.d < 1.6 && near.d <= bestSlotD) {
    serveEgg(near.egg, x, y);
    return;
  }

  // otherwise a tap on the pan cracks a new egg into the nearest free slot
  if (Math.hypot(local.x, local.z) < PAN_R + 0.4) {
    if (bestSlot) dropEgg(bestSlot);
    else {
      popup(x, y, 'PAN FULL!', '#ff9df5', 16);
      sfx.meh();
    }
  }
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  pointerHeld = true;
  gesture = 'none';
  downTime = performance.now();
  dragStart.x = e.clientX;
  dragStart.y = e.clientY;
  if (state === 'playing') {
    const local = projectToPan(e.clientX, e.clientY);
    const near = local ? eggNear(local) : null;
    eggAtStart = near && near.d < 1.55 ? near.egg : null;
  } else {
    eggAtStart = null;
  }
}, { passive: true });

renderer.domElement.addEventListener('pointermove', (e) => {
  if (!pointerHeld) return;
  const dx = e.clientX - dragStart.x;
  const dy = e.clientY - dragStart.y;
  if (gesture === 'none') {
    const elapsed = performance.now() - downTime;
    if (eggAtStart) {
      // an upward flick that started on an egg = FLIP; the flick gets strong
      // priority, so tilt only starts for clearly sideways/downward drags
      // or once the flick window has passed
      if (dy < -28 && elapsed < 650) {
        gesture = 'flip';
        flipEgg(eggAtStart);
        return;
      }
      if ((Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) || dy > 55 ||
          (elapsed >= 650 && Math.hypot(dx, dy) > 14)) gesture = 'tilt';
    } else if (Math.hypot(dx, dy) > 14) {
      gesture = 'tilt';
    }
  }
  if (gesture === 'tilt') {
    tiltTarget.x = THREE.MathUtils.clamp(dy * 0.0024, -TILT_MAX, TILT_MAX);
    tiltTarget.z = THREE.MathUtils.clamp(-dx * 0.0024, -TILT_MAX, TILT_MAX);
  }
}, { passive: true });

function releasePointer(e) {
  if (!pointerHeld) return;
  pointerHeld = false;
  tiltTarget.x = 0;
  tiltTarget.z = 0;
  if (gesture === 'none' && e.type === 'pointerup') handleTap(e.clientX, e.clientY);
  gesture = 'none';
  eggAtStart = null;
}
renderer.domElement.addEventListener('pointerup', releasePointer, { passive: true });
renderer.domElement.addEventListener('pointercancel', releasePointer, { passive: true });

document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

// ---------------- flipping ----------------
function screenPos(obj) {
  const v = toWorld(obj).project(camera);
  return [(v.x + 1) / 2 * window.innerWidth, (-v.y + 1) / 2 * window.innerHeight];
}

// ---------------- Eggs Hancock rain ----------------
const rainEggs = [];
const rainGeo = new THREE.SphereGeometry(0.22, 10, 8);
const rainMat = new THREE.MeshStandardMaterial({ color: 0xfdf3dc, roughness: 0.5 });

function eggsHancockRain() {
  for (let i = 0; i < 24; i++) {
    const m = new THREE.Mesh(rainGeo, rainMat);
    m.scale.set(1, 1.3, 1);
    m.position.set((Math.random() - 0.5) * 11, 9 + Math.random() * 18, (Math.random() - 0.5) * 7);
    m.rotation.set(Math.random() * 3, 0, Math.random() * 3);
    scene.add(m);
    rainEggs.push({ m, vy: -Math.random() * 2, spin: 4 + Math.random() * 6 });
  }
}

function flipEgg(egg) {
  if (!egg.alive || egg.flipping) return;
  const [sx, sy] = screenPos(egg.group);
  if (egg.age >= STAGE.CRISPY_END) {
    popup(sx, sy - 20, "IT'S STUCK!", '#ff3c5a', 18);
    sfx.meh();
    return;
  }
  egg.flipping = true;
  const breaks = egg.age < STAGE.GOOEY && !egg.broken;
  sfx.flip();
  if (navigator.vibrate) navigator.vibrate(10);

  tween(0.55, (k) => {
    if (!egg.alive) return;
    egg.group.position.y = 0.26 + Math.sin(k * Math.PI) * 1.7;
    egg.group.rotation.x = k * Math.PI * 2;
  }, () => {
    egg.flipping = false;
    if (!egg.alive) return;
    egg.group.position.y = 0.26;
    egg.group.rotation.x = 0;
    egg.flipped = true;
    shake = Math.max(shake, 0.1);
    sfx.thud();
    burstParticles(toWorld(egg.group), 0xfff7e0, 8, 2);
    const [lx, ly] = screenPos(egg.group);
    egg.flips++;
    if (egg.flips === 2 && !egg.hancock) {
      // double flip: the legendary EGGS HANCOCK bonus
      egg.hancock = true;
      popup(window.innerWidth / 2, window.innerHeight * 0.3, 'EGGS HANCOCK!', '#ffd34d', 30);
      sfx.hancock();
      eggsHancockRain();
      if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
      if (breaks) egg.broken = true;
    } else if (breaks) {
      egg.broken = true;
      popup(lx, ly - 30, 'YOLK BROKE!', '#ff9df5', 20);
      sfx.meh();
    } else {
      popup(lx, ly - 30, 'FLIPPED!', '#7df9ff', 18);
    }
  });
}

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

  let pts = grade.perfect ? grade.pts * combo : grade.pts;
  if (egg.hancock) {
    pts += 150;
    popup(sx, sy + 52, '🥚 HANCOCK +150', '#fffb96', 18);
  }
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
  flyingEggs.push(egg.group);
  tween(0.45, (k) => {
    egg.group.position.y = 0.26 + k * 5 * (1 - k * 0.4);
    egg.group.rotation.x = k * Math.PI * 2;
    const s = 1 - k;
    egg.group.scale.setScalar(Math.max(0.01, s));
  }, () => {
    panGroup.remove(egg.group);
    disposeObject(egg.group);
    flyingEggs.splice(flyingEggs.indexOf(egg.group), 1);
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
// Local (per-device) board always works and doubles as the offline fallback.
// When REMOTE_DB_URL is set, the remote board is the source of truth.
const LS_KEY = 'eggfryer3000.halloflame';
let lastRemotePush = Promise.resolve();

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
  if (REMOTE_DB_URL) {
    lastRemotePush = fetch(`${REMOTE_DB_URL}/scores.json`, {
      method: 'POST',
      body: JSON.stringify(entry),
    }).catch(() => {});
  }
  return entry;
}
async function fetchRemoteBoard() {
  const res = await fetch(`${REMOTE_DB_URL}/scores.json`);
  const data = await res.json();
  return Object.values(data || {})
    .filter((r) => r && typeof r.pts === 'number' && typeof r.name === 'string')
    .sort((a, b) => b.pts - a.pts)
    .slice(0, 10);
}
function renderBoard(el, highlight) {
  paintBoard(el, loadBoard(), highlight);
  if (REMOTE_DB_URL) {
    lastRemotePush
      .then(fetchRemoteBoard)
      .then((rows) => paintBoard(el, rows, highlight))
      .catch(() => {}); // offline → the local paint above stands
  }
}
function paintBoard(el, board, highlight) {
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
  clearTransients();
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
  clearTransients();
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
  $('nameInput').value = savedName && !SECRET_NAMES.includes(savedName) ? savedName : '';
  overScreen.classList.add('show');
}

$('startBtn').addEventListener('click', startGame);
$('againBtn').addEventListener('click', startGame);
// secret celebration names: they trigger their easter egg and score normally,
// but are never remembered/pre-filled — they must be typed fresh each time,
// so the secrets don't leak onto the board by accident
const SECRET_NAMES = ['ANNA', 'SANTA', 'RYAN', 'SHILLAK', 'KEMPER', 'ROGERSK', 'TWSE2000'];

$('saveBtn').addEventListener('click', () => {
  const name = ($('nameInput').value.trim() || 'CHEF').toUpperCase().slice(0, 8);
  if (!SECRET_NAMES.includes(name)) localStorage.setItem('eggfryer3000.name', name);
  const entry = saveScore(name, score);
  $('nameEntry').style.display = 'none';
  $('overBoardTitle').style.display = 'block';
  $('overBoard').style.display = 'block';
  renderBoard($('overBoard'), entry);
  $('nameInput').blur();
  if (name === 'ANNA') showSmooch();
  else if (name === 'SANTA') showSanta();
  else if (name === 'RYAN') showCrab();
  else if (name === 'SHILLAK') showShillak();
  else if (name === 'KEMPER' || name === 'ROGERSK' || name === 'TWSE2000') showWrestle();
  else sfx.good();
});

// ---------------- name-triggered easter eggs ----------------
let celebrationTimer = null;
function celebrate(el, sound, emojis, particleClass) {
  el.classList.add('show');
  // restart the CSS entrance animations (including nested dancers)
  for (const child of el.querySelectorAll('*')) {
    child.style.animation = 'none';
    void child.offsetWidth;
    child.style.animation = '';
  }
  sound();
  for (let i = 0; i < 26; i++) {
    setTimeout(() => {
      if (!el.classList.contains('show')) return;
      const p = document.createElement('div');
      p.className = particleClass;
      p.textContent = emojis[Math.floor(Math.random() * emojis.length)];
      p.style.left = Math.random() * 92 + 2 + '%';
      p.style.fontSize = 22 + Math.random() * 30 + 'px';
      p.style.animationDuration = 2.4 + Math.random() * 2 + 's';
      el.appendChild(p);
      setTimeout(() => p.remove(), 4600);
    }, i * 140);
  }
  const hide = () => {
    clearTimeout(celebrationTimer);
    el.classList.remove('show');
    el.querySelectorAll('.' + particleClass).forEach((p) => p.remove());
  };
  clearTimeout(celebrationTimer);
  celebrationTimer = setTimeout(hide, 5200);
  el.addEventListener('pointerdown', hide, { once: true });
}
const showSmooch = () => celebrate($('smooch'), sfx.smooch, ['💖', '💕', '💗', '❤️', '💘', '😘'], 'heart');
const showSanta = () => celebrate($('santa'), sfx.hohoho, ['❄️', '🎁', '⛄', '❄️', '✨', '🦌'], 'flake');
const showCrab = () => celebrate($('crab'), sfx.crabRave, ['🎵', '🎶', '🫧', '🐚', '✨', '🫧'], 'note');
const showShillak = () => celebrate($('shillak'), sfx.scribble, ['🖊️', '✒️', '📝', '✨', '✍️'], 'heart');
const showWrestle = () => celebrate($('wrestle'), sfx.smackdown, ['💥', '⭐', '👏', '🛎️', '💪'], 'heart');
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

  // pan hover bob + sway + player tilt (springy)
  tilt.x += (tiltTarget.x - tilt.x) * Math.min(1, dt * 9);
  tilt.z += (tiltTarget.z - tilt.z) * Math.min(1, dt * 9);
  panGroup.position.y = 1.1 + Math.sin(now * 1.7) * 0.12;
  panGroup.rotation.z = Math.sin(now * 1.3) * 0.02 + tilt.z;
  panGroup.rotation.x = Math.cos(now * 1.1) * 0.015 + tilt.x;

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
      updateEggLook(egg, now, dt);
      // eggs slide downhill when the pan is tilted
      egg.group.position.x += ((egg.slot.x - tilt.z * 1.6) - egg.group.position.x) * Math.min(1, dt * 4);
      egg.group.position.z += ((egg.slot.z + tilt.x * 1.6) - egg.group.position.z) * Math.min(1, dt * 4);
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

  // Eggs Hancock rain
  for (let i = rainEggs.length - 1; i >= 0; i--) {
    const r = rainEggs[i];
    r.vy -= 14 * dt;
    r.m.position.y += r.vy * dt;
    r.m.rotation.x += r.spin * dt;
    r.m.rotation.z += r.spin * 0.6 * dt;
    if (r.m.position.y < -3) {
      scene.remove(r.m);
      rainEggs.splice(i, 1);
    }
  }

  // cracked shell halves flying off
  for (let i = shellBits.length - 1; i >= 0; i--) {
    const b = shellBits[i];
    b.life -= dt;
    b.vel.y -= 22 * dt;
    b.m.position.addScaledVector(b.vel, dt);
    b.m.rotation.x += b.angVel.x * dt;
    b.m.rotation.y += b.angVel.y * dt;
    b.m.rotation.z += b.angVel.z * dt;
    b.m.material.opacity = Math.min(1, b.life * 2.5);
    if (b.life <= 0) {
      panGroup.remove(b.m);
      disposeObject(b.m);
      shellBits.splice(i, 1);
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
