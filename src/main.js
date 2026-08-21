// ============================================================
//  MOTO RUSH — three.js lane-dodger
//  3 lanes of oncoming traffic · lane-cutting AI · fuel management
//  difficulty ramps with distance · procedural audio (audio.js)
// ============================================================
import * as THREE from 'three';
import { AudioEngine } from './audio.js';

// ---------- constants ----------
const LANES = [-4, 0, 4];
const ROAD_W = 12.6;
const ROAD_LEN = 420;
const BASE_SPEED = 26;
const MAX_SPEED = 80;
const RAMP_RATE = 1.15;          // speed units gained per second
const FUEL_MAX = 100;
const FUEL_PICKUP = 34;
const PYLON_SPACING = 24;
const PYLON_COUNT = 18;
const PYLON_SPAN = PYLON_SPACING * PYLON_COUNT;
const SPAWN_Z = -235;
const DESPAWN_Z = 14;

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (t) => t * t * (3 - 2 * t);
const $ = (id) => document.getElementById(id);

// ---------- audio ----------
const audio = new AudioEngine();

// ---------- renderer / scene ----------
const app = $('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x38123e, 55, 250);

const camera = new THREE.PerspectiveCamera(66, window.innerWidth / window.innerHeight, 0.1, 1200);
camera.position.set(0, 3.1, 7.4);

scene.add(new THREE.HemisphereLight(0xffb37a, 0x2a0f2e, 0.95));
const dirLight = new THREE.DirectionalLight(0xffd2a8, 1.25);
dirLight.position.set(-30, 40, -60);
scene.add(dirLight);

// ---------- textures ----------
function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const roadTex = canvasTexture(256, 512, (g) => {
  g.fillStyle = '#26262e';
  g.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 1300; i++) {
    g.fillStyle = `rgba(${Math.random() > 0.5 ? '255,255,255' : '0,0,0'},${rand(0.02, 0.09)})`;
    g.fillRect(Math.random() * 256, Math.random() * 512, 2, 2);
  }
  g.fillStyle = 'rgba(228,233,255,0.8)';
  g.fillRect(10, 0, 5, 512);          // solid edge lines
  g.fillRect(241, 0, 5, 512);
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.fillRect(86, 40, 5, 224);         // lane dashes (3.5u of an 8u cycle)
  g.fillRect(167, 40, 5, 224);
});
roadTex.wrapT = THREE.RepeatWrapping;
roadTex.repeat.set(1, ROAD_LEN / 8);
roadTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

const curbTex = canvasTexture(64, 256, (g) => {
  for (let i = 0; i < 4; i++) {
    g.fillStyle = i % 2 ? '#e8e8f0' : '#d94060';
    g.fillRect(0, i * 64, 64, 64);
  }
});
curbTex.wrapT = THREE.RepeatWrapping;
curbTex.repeat.set(1, ROAD_LEN / 4);

const glowTex = canvasTexture(64, 64, (g) => {
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
});

function makeGlow(color, scale, opacity = 0.8) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  s.scale.set(scale, scale, 1);
  return s;
}

// ---------- environment ----------
// sky dome
scene.add(new THREE.Mesh(
  new THREE.SphereGeometry(560, 24, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      cTop: { value: new THREE.Color('#0d0620') },
      cMid: { value: new THREE.Color('#4a1650') },
      cBot: { value: new THREE.Color('#ff7448') },
    },
    vertexShader: `varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 vPos; uniform vec3 cTop; uniform vec3 cMid; uniform vec3 cBot;
      void main(){
        float h = normalize(vPos).y;
        vec3 col = mix(cBot, cMid, smoothstep(-0.02, 0.18, h));
        col = mix(col, cTop, smoothstep(0.18, 0.62, h));
        gl_FragColor = vec4(col, 1.0);
      }`,
  })
));

// retro striped sun + halo
const sunTex = canvasTexture(256, 256, (g) => {
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#ffe08a');
  gr.addColorStop(0.55, '#ff9e5c');
  gr.addColorStop(1, '#ff5e8a');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(128, 128, 126, 0, Math.PI * 2);
  g.fill();
  g.globalCompositeOperation = 'destination-out';
  let y = 150, th = 4;
  while (y < 256) { g.fillRect(0, y, 256, th); y += th + 14; th += 3; }
});
const sun = new THREE.Mesh(new THREE.CircleGeometry(36, 48), new THREE.MeshBasicMaterial({ map: sunTex, transparent: true, fog: false }));
sun.position.set(-34, 30, -470);
scene.add(sun);
const halo = makeGlow('#ff6b9d', 150, 0.35);
halo.position.set(-34, 30, -469);
scene.add(halo);

// mountain silhouettes (seeded jagged ridges)
function ridge(z, color, peakH, seed) {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const shape = new THREE.Shape();
  shape.moveTo(-480, -10);
  for (let x = -480; x <= 480; x += 55) {
    shape.lineTo(x + rnd() * 30, rnd() * peakH + 4);
  }
  shape.lineTo(480, -10);
  shape.closePath();
  const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color, fog: false }));
  m.position.set(0, 0, z);
  scene.add(m);
}
ridge(-455, '#61285a', 62, 1234567);
ridge(-430, '#471c49', 40, 7654321);

// desert floor
const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 560), new THREE.MeshStandardMaterial({ color: 0x2f1436, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.position.set(0, -0.06, -180);
scene.add(ground);

// road
const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, ROAD_LEN), new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.92 }));
road.rotation.x = -Math.PI / 2;
road.position.set(0, 0, -ROAD_LEN / 2 + 20);
scene.add(road);

// curbs
for (const x of [-6.55, 6.55]) {
  const curb = new THREE.Mesh(new THREE.PlaneGeometry(0.7, ROAD_LEN), new THREE.MeshBasicMaterial({ map: curbTex }));
  curb.rotation.x = -Math.PI / 2;
  curb.position.set(x, 0.005, -ROAD_LEN / 2 + 20);
  scene.add(curb);
}

// neon pylons lining the road (recycled)
const pylons = [];
for (let i = 0; i < PYLON_COUNT; i++) {
  const side = i % 2 ? 1 : -1;
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.BoxGeometry(0.16, 5, 0.16), new THREE.MeshStandardMaterial({ color: 0x140a26, roughness: 0.8 }));
  pole.position.y = 2.5;
  const ringColor = i % 2 ? 0x29f5ff : 0xff2d78;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.06, 8, 24).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: ringColor }));
  ring.position.y = 4.4;
  const glow = makeGlow(ringColor, 2.6, 0.5);
  glow.position.y = 4.4;
  g.add(pole, ring, glow);
  g.position.set(side * 10.5, 0, 20 - i * PYLON_SPACING);
  scene.add(g);
  pylons.push(g);
}

// ---------- player bike (nose faces -Z, away from camera) ----------
const bikeRoot = new THREE.Group();
const bikeLean = new THREE.Group();
bikeRoot.add(bikeLean);
scene.add(bikeRoot);
const bikeWheels = [];
let exhaustFlames = [];

{
  const paint   = new THREE.MeshStandardMaterial({ color: 0xff2d78, roughness: 0.28, metalness: 0.5 });
  const dark    = new THREE.MeshStandardMaterial({ color: 0x14141c, roughness: 0.55, metalness: 0.35 });
  const metal   = new THREE.MeshStandardMaterial({ color: 0xb9c2d0, roughness: 0.22, metalness: 0.9 });
  const tireM   = new THREE.MeshStandardMaterial({ color: 0x0a0a10, roughness: 0.95 });
  const suit    = new THREE.MeshStandardMaterial({ color: 0x221238, roughness: 0.6 });
  const helmetM = new THREE.MeshStandardMaterial({ color: 0xf2f2f7, roughness: 0.25 });
  const visorM  = new THREE.MeshBasicMaterial({ color: 0x0c1020 });
  const neon    = new THREE.MeshBasicMaterial({ color: 0x29f5ff });

  const part = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    bikeLean.add(m);
    return m;
  };
  // capsule limb stretched between two points — for the rider's joints
  const UP = new THREE.Vector3(0, 1, 0);
  const limb = (a, b, r, mat) => {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = Math.max(0.03, d.length() - 2 * r);
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat);
    m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    m.quaternion.setFromUnitVectors(UP, d.normalize());
    bikeLean.add(m);
    return m;
  };

  // --- wheels: fat tire + rim + spokes + brake disc, spun as a group ---
  const WHEEL_R = 0.42;
  const mkWheel = (z) => {
    const g = new THREE.Group();
    // tire donut rotated onto the axle (hole axis along X) so it rolls, not tumbles
    g.add(new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.12, 12, 28).rotateY(Math.PI / 2), tireM));
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.18, 16).rotateZ(Math.PI / 2), dark));   // rim
    for (let i = 0; i < 3; i++) {                                                                          // 6 spokes
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.36, 0.06), metal);
      sp.rotation.x = (i * Math.PI) / 3;
      g.add(sp);
    }
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.22, 12).rotateZ(Math.PI / 2), metal));   // hub
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 20).rotateZ(Math.PI / 2), metal);
    disc.position.x = 0.12;
    g.add(disc);
    g.position.set(0, WHEEL_R, z);   // center at outer radius -> tire kisses the road, no sink
    bikeLean.add(g);
    bikeWheels.push(g);
  };
  mkWheel(-0.86);   // front
  mkWheel(0.86);    // rear

  // --- front end: raked forks, triple clamp, clip-ons ---
  part(new THREE.CylinderGeometry(0.045, 0.058, 0.74, 10), metal, 0.1, 0.72, -0.72, 0.42);
  part(new THREE.CylinderGeometry(0.045, 0.058, 0.74, 10), metal, -0.1, 0.72, -0.72, 0.42);
  part(new THREE.BoxGeometry(0.32, 0.1, 0.22), dark, 0, 1.02, -0.58);         // triple clamp
  part(new THREE.BoxGeometry(0.68, 0.05, 0.07), dark, 0, 1.06, -0.54);        // clip-on bar
  part(new THREE.CylinderGeometry(0.04, 0.04, 0.1, 8).rotateZ(Math.PI / 2), neon, 0.31, 1.06, -0.54);  // grips
  part(new THREE.CylinderGeometry(0.04, 0.04, 0.1, 8).rotateZ(Math.PI / 2), neon, -0.31, 1.06, -0.54);

  // --- bodywork: extruded supersport side profile, nose toward -Z ---
  const fs = new THREE.Shape();
  fs.moveTo(-1.08, 0.98);      // tail tip
  fs.lineTo(-0.7, 1.06);       // tail hump
  fs.lineTo(-0.32, 0.96);      // seat dip
  fs.lineTo(0.05, 1.06);       // tank rise
  fs.lineTo(0.36, 1.1);        // tank peak
  fs.lineTo(0.8, 1.0);         // cockpit
  fs.lineTo(1.16, 0.82);       // nose tip
  fs.lineTo(1.1, 0.62);        // under nose
  fs.lineTo(0.45, 0.56);       // belly
  fs.lineTo(-0.3, 0.6);
  fs.lineTo(-0.9, 0.72);       // under-tail
  const fairingGeo = new THREE.ExtrudeGeometry(fs, {
    depth: 0.3, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 3, steps: 1,
  });
  fairingGeo.translate(0, 0, -0.15);
  fairingGeo.rotateY(Math.PI / 2);          // profile X (nose +X) -> world -Z
  part(fairingGeo, paint, 0, 0, 0);

  part(new THREE.BoxGeometry(0.3, 0.06, 0.44), dark, 0, 0.99, -0.28);         // seat pad
  part(new THREE.PlaneGeometry(0.3, 0.26),
    new THREE.MeshStandardMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0.2, side: THREE.DoubleSide }),
    0, 1.24, -0.46, 0.6);                                                      // windscreen

  // swingarm + twin under-tail exhausts
  part(new THREE.BoxGeometry(0.22, 0.07, 0.62), dark, 0, 0.42, 0.5);
  part(new THREE.CylinderGeometry(0.05, 0.055, 0.5, 10).rotateX(Math.PI / 2), metal, 0.14, 0.68, 0.95);
  part(new THREE.CylinderGeometry(0.05, 0.055, 0.5, 10).rotateX(Math.PI / 2), metal, -0.14, 0.68, 0.95);

  // headlight (front, -Z) + light beam thrown down the road
  part(new THREE.SphereGeometry(0.11, 12, 12), dark, 0, 0.88, -1.06);
  part(new THREE.SphereGeometry(0.09, 12, 12), new THREE.MeshBasicMaterial({ color: 0xfff3c4 }), 0, 0.88, -1.12);
  const hGlow = makeGlow(0xfff3c4, 1.5, 0.85);
  hGlow.position.set(0, 0.88, -1.2);
  bikeLean.add(hGlow);
  const beam = new THREE.PointLight(0xffdf9e, 50, 26, 2);
  beam.position.set(0, 0.9, -1.6);
  bikeLean.add(beam);
  const beamCone = new THREE.Mesh(
    new THREE.ConeGeometry(1.5, 7, 24, 1, true).rotateX(Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  beamCone.position.set(0, 0.85, -4.5);     // apex ~z-1, opens toward -z
  bikeLean.add(beamCone);

  // taillight (rear, +Z — faces the camera)
  part(new THREE.BoxGeometry(0.2, 0.07, 0.05), new THREE.MeshBasicMaterial({ color: 0xff2222 }), 0, 1.0, 1.09);
  const tGlow = makeGlow(0xff2222, 1.1, 0.7);
  tGlow.position.set(0, 1.0, 1.16);
  bikeLean.add(tGlow);

  // exhaust flames flicker behind the bike
  const flameGeo = new THREE.ConeGeometry(0.08, 0.5, 8).rotateX(Math.PI / 2);
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  exhaustFlames = [0.14, -0.14].map((x) => {
    const f = new THREE.Mesh(flameGeo, flameMat.clone());
    f.position.set(x, 0.68, 1.28);
    bikeLean.add(f);
    return f;
  });

  // --- rider: full tuck, articulated from capsules ---
  limb([0, 1.0, -0.02], [0, 1.28, -0.34], 0.16, suit);            // torso, leaned flat
  limb([0, 1.04, -0.08], [0, 1.3, -0.36], 0.025, neon);           // glowing spine stripe
  const hump = part(new THREE.SphereGeometry(0.1, 10, 10), suit, 0, 1.26, -0.18);
  hump.scale.set(1, 0.75, 1.4);                                    // aero hump
  part(new THREE.SphereGeometry(0.175, 14, 14), helmetM, 0, 1.4, -0.44);  // helmet
  part(new THREE.BoxGeometry(0.2, 0.1, 0.12), visorM, 0, 1.39, -0.58);    // visor
  part(new THREE.BoxGeometry(0.02, 0.09, 0.18), paint, 0, 1.53, -0.38);   // helmet fin
  for (const s of [-1, 1]) {
    limb([s * 0.18, 1.3, -0.3], [s * 0.24, 1.07, -0.56], 0.06, suit);     // arm to clip-on
    part(new THREE.SphereGeometry(0.055, 8, 8), dark, s * 0.25, 1.06, -0.57);  // glove
    limb([s * 0.14, 0.98, 0.0], [s * 0.22, 0.84, -0.34], 0.08, suit);     // thigh
    limb([s * 0.22, 0.84, -0.34], [s * 0.17, 0.6, -0.05], 0.06, suit);    // shin
    part(new THREE.BoxGeometry(0.09, 0.08, 0.2), dark, s * 0.17, 0.58, -0.02);  // boot
  }

  // blob shadow
  const sh = new THREE.Mesh(new THREE.CircleGeometry(1, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
  sh.rotation.x = -Math.PI / 2;
  sh.scale.set(0.75, 1.9, 1);
  sh.position.y = 0.015;
  bikeRoot.add(sh);
}

// ---------- traffic ----------
const CAR_COLORS = ['#e0485e', '#3f8fd9', '#e8b23a', '#63b46a', '#a06bd9', '#d9d3e0', '#e07b39'];
const carGeo = {
  wheel: new THREE.CylinderGeometry(0.34, 0.34, 0.3, 10).rotateZ(Math.PI / 2),
  blob: new THREE.CircleGeometry(1, 18).rotateX(-Math.PI / 2),
  light: new THREE.SphereGeometry(0.1, 8, 8),
  blinker: new THREE.BoxGeometry(0.14, 0.12, 0.3),
};
const glassMat = new THREE.MeshStandardMaterial({ color: 0x0e1420, roughness: 0.15, metalness: 0.6 });
const tireMat = new THREE.MeshStandardMaterial({ color: 0x0a0a10, roughness: 0.9 });
const headMat = new THREE.MeshBasicMaterial({ color: 0xfffbd8 });
const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2222 });

const CAR_TYPES = {
  sedan:  { w: 1.9, h: 0.62, l: 4.4, vMin: 10, vMax: 16, canCut: true },
  sports: { w: 1.9, h: 0.5,  l: 4.2, vMin: 18, vMax: 26, canCut: true },
  truck:  { w: 2.3, h: 2.1,  l: 8.6, vMin: 6,  vMax: 9,  canCut: false },
};

function makeCar(type) {
  const t = CAR_TYPES[type];
  const g = new THREE.Group();
  const color = CAR_COLORS[(Math.random() * CAR_COLORS.length) | 0];
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.4 });
  const yBody = 0.36 + t.h / 2;

  const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(t.w, t.h, t.l), bodyMat);
  bodyMesh.position.y = yBody;
  g.add(bodyMesh);

  if (type === 'truck') {
    const cab = new THREE.Mesh(new THREE.BoxGeometry(t.w * 0.95, t.h * 0.55, 1.9), bodyMat);
    cab.position.set(0, yBody + t.h * 0.32, t.l / 2 - 1.1);
    const box = new THREE.Mesh(new THREE.BoxGeometry(t.w * 1.02, t.h * 1.05, t.l - 2.6), new THREE.MeshStandardMaterial({ color: 0xcfd3dd, roughness: 0.6 }));
    box.position.set(0, yBody + t.h * 0.55 / 2 + 0.15, -0.7);
    g.add(cab, box);
  } else {
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(t.w * 0.84, t.h * 0.78, t.l * 0.44), glassMat);
    cabin.position.set(0, yBody + t.h * 0.36, -t.l * 0.06);
    g.add(cabin);
  }

  // wheels
  const wheels = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const w = new THREE.Mesh(carGeo.wheel, tireMat);
    w.position.set(sx * (t.w / 2 - 0.08), 0.34, sz * t.l * 0.32);
    g.add(w);
    wheels.push(w);
  }

  // lights: oncoming traffic faces the player (+z = front)
  for (const sx of [-1, 1]) {
    const h = new THREE.Mesh(carGeo.light, headMat);
    h.position.set(sx * t.w * 0.3, yBody, t.l / 2 + 0.02);
    const hg = makeGlow(0xfffbd8, 1.7, 0.9);
    hg.position.set(sx * t.w * 0.3, yBody, t.l / 2 + 0.15);
    const tl = new THREE.Mesh(carGeo.light, tailMat);
    tl.position.set(sx * t.w * 0.3, yBody, -t.l / 2 - 0.02);
    g.add(h, hg, tl);
  }

  // blinkers (left/right pairs) — flash before a lane cut
  const blinkL = new THREE.MeshBasicMaterial({ color: 0x552a00 });
  const blinkR = new THREE.MeshBasicMaterial({ color: 0x552a00 });
  for (const sz of [-1, 1]) {
    const bl = new THREE.Mesh(carGeo.blinker, blinkL);
    bl.position.set(-t.w / 2 - 0.03, yBody, sz * t.l * 0.34);
    const br = new THREE.Mesh(carGeo.blinker, blinkR);
    br.position.set(t.w / 2 + 0.03, yBody, sz * t.l * 0.34);
    g.add(bl, br);
  }

  // blob shadow
  const blob = new THREE.Mesh(carGeo.blob, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
  blob.scale.set(t.w * 0.62, 1, t.l * 0.56);
  blob.position.y = 0.012;
  g.add(blob);

  return {
    mesh: g, type, halfW: t.w / 2, halfL: t.l / 2, wheels,
    speed: rand(t.vMin, t.vMax), lane: 0, x: 0,
    cutIn: false, phase: 'none', triggerZ: 0, sigT: 0,
    cutT: 0, cutFrom: 0, cutTo: 0, cutLaneIdx: 0, blinkSide: 1,
    blinkL, blinkR, scored: false,
  };
}

// ---------- fuel cans ----------
const fuelGeoCan = new THREE.BoxGeometry(0.55, 0.72, 0.32);
const fuelGeoCap = new THREE.BoxGeometry(0.18, 0.12, 0.18);
const fuelCanMat = new THREE.MeshStandardMaterial({ color: 0xe03434, roughness: 0.4, metalness: 0.2, emissive: 0x5a0e0e });
const fuelRingGeo = new THREE.TorusGeometry(0.8, 0.05, 8, 28).rotateX(Math.PI / 2);

function makeFuel() {
  const g = new THREE.Group();
  const can = new THREE.Mesh(fuelGeoCan, fuelCanMat);
  can.position.y = 0.36;
  const cap = new THREE.Mesh(fuelGeoCap, new THREE.MeshStandardMaterial({ color: 0x8a1d1d }));
  cap.position.set(0.12, 0.76, 0);
  const ring = new THREE.Mesh(fuelRingGeo, new THREE.MeshBasicMaterial({ color: 0x52ffa8 }));
  ring.position.y = 0.1;
  const glow = makeGlow(0x52ffa8, 2.4, 0.55);
  glow.position.y = 0.5;
  g.add(can, cap, ring, glow);
  return { mesh: g, ring, phase: Math.random() * Math.PI * 2 };
}

// ---------- game state ----------
let state = 'menu';           // menu | playing | coasting | crashing | over
let paused = false;
let speed = BASE_SPEED;
let dist = 0, bonus = 0, fuel = FUEL_MAX;
let laneIdx = 1, targetX = 0, px = 0;
let timeScale = 1, crashT = 0, fallSide = 1, shake = 0;
let spawnT = 1.2, fuelT = 2.4, warnT = 0;
let nearMisses = 0, tGlobal = 0;
let hiScore = 0;
try { hiScore = parseInt(localStorage.getItem('motoRushHi') || '0', 10) || 0; } catch (e) {}

const cars = [];
const fuels = [];
const speed01 = () => clamp((speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED), 0, 1);
const score = () => Math.floor(dist + bonus);

// ---------- HUD ----------
const el = {
  hud: $('hud'), speed: $('speedVal'), scoreV: $('scoreVal'), dist: $('distVal'), hi: $('hiVal'),
  fuelFill: $('fuelFill'), fuelPct: $('fuelPct'), fuelWrap: $('fuelWrap'),
  popups: $('popups'), menu: $('menuOv'), over: $('overOv'), pause: $('pauseOv'),
  reason: $('reasonTxt'), finalScore: $('finalScore'), bestLine: $('bestLine'),
  stats: $('statsLine'), mute: $('muteBtn'), playsVal: $('playsVal'), playsValOver: $('playsValOver'),
};
el.hi.textContent = hiScore;
if (audio.muted) el.mute.textContent = '🔇';

// ---------- contact & global play tracking ----------
// EDIT THESE before deploying: your real links/handles
const CONTACT = {
  github: 'https://github.com/devsingh2213',
  x: 'https://x.com/journeyvialens',
  email: 'mailto:developersingh2213@gmail.com',
  handle: '@journeyvialens',
};
// Free anonymous hit counter (CountAPI successor) — namespace must be unique
// across all Abacus users, so keep the random-ish suffix. Key = metric name.
const COUNTER = { api: 'https://abacus.jasoncameron.dev', ns: 'moto-rush-saini-v1', key: 'plays' };

for (const a of document.querySelectorAll('.ct-github')) a.href = CONTACT.github;
for (const a of document.querySelectorAll('.ct-x')) { a.href = CONTACT.x; a.textContent = 'X'; }
for (const a of document.querySelectorAll('.ct-email')) a.href = CONTACT.email;

function localPlays() {
  try { return parseInt(localStorage.getItem('motoRushPlays') || '0', 10) || 0; } catch (e) { return 0; }
}
function renderPlays(n, suffix = '') {
  const txt = `${(n || 0).toLocaleString()}${suffix}`;
  if (el.playsVal) el.playsVal.textContent = txt;
  if (el.playsValOver) el.playsValOver.textContent = (n || 0).toLocaleString();
}
// fetch with a hard timeout so the UI can never hang on "…"
function fetchCounter(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4500);
  return fetch(url, { signal: ctrl.signal }).then((r) => {
    clearTimeout(timer);
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  });
}
function fetchGlobalPlays() {
  // read-only lookup of the current global count; falls back to per-device count
  fetchCounter(`${COUNTER.api}/get/${COUNTER.ns}/${COUNTER.key}`)
    .then((j) => renderPlays(j.value))
    .catch(() => renderPlays(localPlays(), ' on this device'));
}
function countPlay() {
  try { localStorage.setItem('motoRushPlays', String(localPlays() + 1)); } catch (e) {}
  renderPlays(localPlays(), ' on this device'); // instant feedback, upgraded if the hit succeeds
  fetchCounter(`${COUNTER.api}/hit/${COUNTER.ns}/${COUNTER.key}`)
    .then((j) => renderPlays(j.value))
    .catch(() => {}); // offline is fine — local count already recorded
}
fetchGlobalPlays();

function popup(text, color, small = false) {
  const d = document.createElement('div');
  d.className = 'popup' + (small ? ' small' : '');
  d.textContent = text;
  d.style.color = color;
  d.style.top = `${(el.popups.children.length % 3) * 34}px`;
  el.popups.appendChild(d);
  d.addEventListener('animationend', () => d.remove());
}

function updateHUD() {
  el.speed.textContent = Math.round(speed * 2.4);
  el.scoreV.textContent = score();
  el.dist.textContent = Math.floor(dist);
  const pct = Math.max(0, fuel);
  el.fuelFill.style.width = `${pct}%`;
  el.fuelPct.textContent = `${Math.round(pct)}%`;
  el.fuelFill.classList.toggle('warn', pct < 28 && pct >= 16);
  el.fuelFill.classList.toggle('crit', pct < 16);
  el.fuelWrap.classList.toggle('low', pct < 28);
}

// ---------- spawning ----------
function laneClear(lane, zLimit) {
  for (const c of cars) if (c.lane === lane && c.mesh.position.z < zLimit) return false;
  return true;
}

function spawnCar() {
  const lanes = [0, 1, 2].sort(() => Math.random() - 0.5);
  let lane = -1;
  for (const l of lanes) if (laneClear(l, -150)) { lane = l; break; }
  if (lane === -1) return;

  const r = Math.random();
  const type = r < 0.18 ? 'truck' : r < 0.4 ? 'sports' : 'sedan';
  const car = makeCar(type);
  car.lane = lane;
  car.x = LANES[lane];
  car.mesh.position.set(car.x, 0, SPAWN_Z);
  car.cutIn = CAR_TYPES[type].canCut && Math.random() < 0.14 + speed01() * 0.3;
  car.triggerZ = -rand(105, 150);
  scene.add(car.mesh);
  cars.push(car);
}

function spawnFuel() {
  const lanes = [0, 1, 2].sort(() => Math.random() - 0.5);
  let lane = -1;
  for (const l of lanes) if (laneClear(l, -140)) { lane = l; break; }
  if (lane === -1) return;
  const f = makeFuel();
  f.mesh.position.set(LANES[lane], 0.8, SPAWN_Z);
  scene.add(f.mesh);
  fuels.push(f);
}

// ---------- flow ----------
function reset() {
  for (const c of cars) scene.remove(c.mesh);
  cars.length = 0;
  for (const f of fuels) scene.remove(f.mesh);
  fuels.length = 0;
  speed = BASE_SPEED; dist = 0; bonus = 0; fuel = FUEL_MAX;
  laneIdx = 1; targetX = 0; px = 0;
  timeScale = 1; crashT = 0; shake = 0; fallSide = 1;
  spawnT = 1.1; fuelT = 2.2; warnT = 0; nearMisses = 0;
  bikeRoot.position.set(0, 0, 0);
  bikeRoot.rotation.set(0, 0, 0);
  bikeLean.rotation.set(0, 0, 0);
  updateHUD();
}

function startGame() {
  audio.ensure();
  audio.startEngine();
  audio.startMusic();
  countPlay();
  reset();
  state = 'playing';
  paused = false;
  el.menu.classList.add('hidden');
  el.over.classList.add('hidden');
  el.hud.classList.remove('hidden');
}

function gameOver(reason) {
  state = 'over';
  timeScale = 1;
  audio.stopMusic();
  audio.stopEngine(0.6);
  const s = score();
  const isBest = s > hiScore;
  if (isBest) {
    hiScore = s;
    try { localStorage.setItem('motoRushHi', String(hiScore)); } catch (e) {}
    el.hi.textContent = hiScore;
  }
  el.reason.textContent = reason === 'fuel' ? 'OUT OF FUEL' : 'WRECKED';
  el.finalScore.textContent = s;
  el.bestLine.textContent = (isBest ? '★ NEW BEST ★' : `BEST ${hiScore}`);
  el.stats.textContent = `${Math.floor(dist)} m · ${nearMisses} near misses · top ${Math.round(speed * 2.4)} km/h`;
  el.over.classList.remove('hidden');
}

function doCrash(carX) {
  state = 'crashing';
  crashT = 0;
  fallSide = -(Math.sign(carX - px) || 1);
  shake = 1;
  audio.crash();
  audio.updateEngine(speed01(), false);
}

function togglePause() {
  if (state !== 'playing' && state !== 'coasting') return;
  paused = !paused;
  el.pause.classList.toggle('hidden', !paused);
  if (paused) audio.suspend(); else audio.resume();
}

// ---------- input ----------
function move(dir) {
  if (state !== 'playing' && state !== 'coasting') return;
  const next = clamp(laneIdx + dir, 0, 2);
  if (next !== laneIdx) {
    laneIdx = next;
    targetX = LANES[laneIdx];
    audio.tick();
  }
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') { el.mute.textContent = audio.toggleMute() ? '🔇' : '🔊'; return; }
  if (e.code === 'KeyP') { togglePause(); return; }
  if (state === 'menu' && (e.code === 'Space' || e.code === 'Enter')) { startGame(); return; }
  if (state === 'over' && (e.code === 'KeyR' || e.code === 'Space' || e.code === 'Enter')) { startGame(); return; }
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') { move(-1); e.preventDefault(); }
  if (e.code === 'ArrowRight' || e.code === 'KeyD') { move(1); e.preventDefault(); }
  if (e.code === 'Space') e.preventDefault();
});

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (state === 'menu') { startGame(); return; }
  if (state === 'over') { startGame(); return; }
  if (state === 'playing' || state === 'coasting') {
    move(e.clientX < window.innerWidth / 2 ? -1 : 1);
  }
});

$('startBtn').addEventListener('click', startGame);
$('againBtn').addEventListener('click', startGame);
el.menu.addEventListener('pointerdown', () => { if (state === 'menu') startGame(); });
el.pause.addEventListener('pointerdown', () => { if (paused) togglePause(); });
el.mute.addEventListener('click', () => { el.mute.textContent = audio.toggleMute() ? '🔇' : '🔊'; });

document.addEventListener('visibilitychange', () => {
  if (document.hidden && (state === 'playing' || state === 'coasting') && !paused) togglePause();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- per-frame updates ----------
function updateScenery(dz) {
  roadTex.offset.y = (roadTex.offset.y + dz / 8) % 1;
  curbTex.offset.y = (curbTex.offset.y + dz / 4) % 1;
  for (const p of pylons) {
    p.position.z += dz;
    if (p.position.z > 24) p.position.z -= PYLON_SPAN;
  }
}

function updateEntities(dt) {
  const roadDz = speed * dt;
  updateScenery(roadDz);

  // --- traffic ---
  let activeCuts = 0;
  for (const c of cars) if (c.phase === 'signal' || c.phase === 'cut') activeCuts++;

  for (let i = cars.length - 1; i >= 0; i--) {
    const c = cars[i];
    c.mesh.position.z += (speed + c.speed) * dt;

    // lane-cutting AI: signal with blinkers + horn, then swerve into the player's lane
    if (c.cutIn && c.phase === 'none' && state === 'playing' &&
        c.mesh.position.z > c.triggerZ && c.mesh.position.z < -55 &&
        c.lane !== laneIdx && activeCuts < (speed01() > 0.65 ? 2 : 1)) {
      c.phase = 'signal';
      c.sigT = 0.85;
      c.blinkSide = Math.sign(LANES[laneIdx] - c.x) || 1;
      activeCuts++;
      audio.horn();
    }
    if (c.phase === 'signal') {
      c.sigT -= dt;
      if (c.sigT <= 0) {
        c.phase = 'cut';
        c.cutT = 0;
        c.cutFrom = c.x;
        c.cutTo = LANES[laneIdx];
        c.cutLaneIdx = laneIdx;
      }
    }
    if (c.phase === 'cut') {
      c.cutT = Math.min(1, c.cutT + dt / 1.05);
      const k = smooth(c.cutT);
      c.x = c.cutFrom + (c.cutTo - c.cutFrom) * k;
      c.mesh.rotation.y = k * 0.3 * Math.sign(c.cutTo - c.cutFrom);
      if (c.cutT >= 1) { c.phase = 'done'; c.lane = c.cutLaneIdx; c.mesh.rotation.y = 0; }
    }

    // blinker flash while signaling/cutting
    const flashing = c.phase === 'signal' || c.phase === 'cut';
    const on = flashing && Math.sin(tGlobal * 22) > 0;
    c.blinkL.color.setHex(on && c.blinkSide < 0 ? 0xffae00 : 0x552a00);
    c.blinkR.color.setHex(on && c.blinkSide > 0 ? 0xffae00 : 0x552a00);

    c.mesh.position.x = c.x;
    const wSpin = ((speed + c.speed) * dt) / 0.34;
    for (const w of c.wheels) w.rotation.x -= wSpin;

    if (state === 'playing') {
      const dx = Math.abs(c.x - px);
      const dz = Math.abs(c.mesh.position.z);
      // collision
      if (dx < c.halfW + 0.42 && dz < c.halfL + 0.9) {
        doCrash(c.x);
      } else if (!c.scored && c.mesh.position.z > 1.2) {
        c.scored = true;
        if (dx < 2.5) {
          // threaded the needle
          nearMisses++;
          bonus += 50;
          popup('NEAR MISS +50', '#ff2d78');
          audio.whoosh(Math.sign(c.x - px || 1) * 0.8);
        }
      }
    }

    if (c.mesh.position.z > DESPAWN_Z) {
      scene.remove(c.mesh);
      cars.splice(i, 1);
    }
  }

  // --- fuel cans ---
  for (let i = fuels.length - 1; i >= 0; i--) {
    const f = fuels[i];
    f.mesh.position.z += roadDz;
    f.mesh.position.y = 0.8 + Math.sin(tGlobal * 3 + f.phase) * 0.12;
    f.mesh.rotation.y += dt * 2.4;
    f.ring.rotation.z += dt * 3;

    if (state === 'playing' &&
        Math.abs(f.mesh.position.x - px) < 1.5 &&
        Math.abs(f.mesh.position.z) < 1.7) {
      fuel = Math.min(FUEL_MAX, fuel + FUEL_PICKUP);
      popup('+FUEL', '#52ffa8');
      audio.pickup();
      scene.remove(f.mesh);
      fuels.splice(i, 1);
      continue;
    }
    if (f.mesh.position.z > DESPAWN_Z) {
      scene.remove(f.mesh);
      fuels.splice(i, 1);
    }
  }
}

function updatePlaying(dt) {
  elapsedPlus(dt);
  speed = Math.min(MAX_SPEED, speed + RAMP_RATE * dt);
  dist += speed * dt;
  fuel -= (3.1 + speed01() * 2.2) * dt;

  // fuel warnings
  warnT -= dt;
  if (fuel < 20 && fuel > 0 && warnT <= 0) {
    popup('LOW FUEL', '#ffd23e', true);
    audio.warn();
    warnT = 2.8;
  }
  if (fuel <= 0) {
    fuel = 0;
    state = 'coasting';
    audio.sputter();
    popup('TANK EMPTY…', '#ff5e5e');
  }

  // spawning — denser and sneakier as speed climbs
  spawnT -= dt;
  if (spawnT <= 0) {
    spawnT = rand(0.62, 1.5) * (1.25 - speed01() * 0.55);
    spawnCar();
  }
  fuelT -= dt;
  if (fuelT <= 0) {
    fuelT = rand(4.2, 6.2);
    spawnFuel();
  }

  audio.setIntensity(speed01());
  audio.updateEngine(speed01(), true);
  updateHUD();
}

function elapsedPlus(dt) { /* reserved for future timed events */ }

function updateCoasting(dt, rawDt) {
  speed = Math.max(0, speed - 16 * dt);
  dist += speed * dt;
  audio.updateEngine(speed01(), false);
  updateHUD();
  if (speed <= 2 && state === 'coasting') gameOver('fuel');
}

function updateCrashing(dt, rawDt) {
  timeScale = 0.32;
  crashT += rawDt;
  speed = Math.max(0, speed - 55 * dt);
  audio.updateEngine(speed01(), false);

  // tumble
  bikeLean.rotation.z += (fallSide * 1.45 - bikeLean.rotation.z) * Math.min(1, rawDt * 6);
  bikeRoot.rotation.y += fallSide * rawDt * 2.2;
  bikeRoot.position.y = Math.max(0, Math.sin(Math.min(crashT * 6, Math.PI)) * 0.4);

  updateHUD();
  if (crashT > 1.6) {
    timeScale = 1;
    gameOver('crash');
  }
}

function updatePlayer(dt) {
  px += (targetX - px) * (1 - Math.exp(-dt * 9));
  bikeRoot.position.x = px;

  const leanTarget = clamp((targetX - px) * 0.55, -0.62, 0.62);
  bikeLean.rotation.z += (-leanTarget - bikeLean.rotation.z) * Math.min(1, dt * 10);
  bikeLean.rotation.y = -(targetX - px) * 0.05;

  const spin = speed * dt / 0.34;
  for (const w of bikeWheels) w.rotation.x -= spin;

  // exhaust flicker
  const flameOn = speed01() > 0.12 && state !== 'over';
  for (const f of exhaustFlames) {
    f.visible = flameOn;
    if (flameOn) {
      f.scale.z = 0.7 + Math.random() * 0.7;
      f.material.opacity = 0.5 + Math.random() * 0.5;
    }
  }

  // idle bob in menu
  if (state === 'menu') bikeRoot.position.y = Math.sin(tGlobal * 2.2) * 0.02;
}

function updateCamera(rawDt) {
  shake = Math.max(0, shake - rawDt * 1.6);
  const amp = shake * 0.5 + speed01() * 0.05;
  const sx = (Math.random() - 0.5) * amp;
  const sy = (Math.random() - 0.5) * amp;

  camera.position.x += (px * 0.5 + sx - camera.position.x) * Math.min(1, rawDt * 8);
  camera.position.y = 3.1 + sy + (state === 'menu' ? Math.sin(tGlobal * 0.8) * 0.05 : 0);
  camera.position.z = 7.4;
  camera.lookAt(px * 0.7, 1.1, -8);

  const targetFov = 66 + speed01() * 12;
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, rawDt * 2);
    camera.updateProjectionMatrix();
  }
}

// ---------- main loop ----------
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const rawDt = Math.min(clock.getDelta(), 0.05);
  if (paused) { renderer.render(scene, camera); return; }
  tGlobal += rawDt;
  const dt = rawDt * timeScale;

  if (state === 'playing') updatePlaying(dt);
  else if (state === 'coasting') updateCoasting(dt, rawDt);
  else if (state === 'crashing') updateCrashing(dt, rawDt);
  else if (state === 'menu') updateScenery(10 * rawDt);

  if (state !== 'menu' && state !== 'over') updateEntities(dt);
  updatePlayer(dt);
  updateCamera(rawDt);

  renderer.render(scene, camera);
}
animate();
