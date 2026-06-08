import * as THREE from 'three';
import { BLOCK, blockDefs, TOOL, buildAtlas } from './blocks.js';
import { World, CHUNK, HEIGHT, SEA } from './world.js';
import { Player } from './player.js';
import { Inventory, matchRecipe } from './inventory.js';
import { ITEMS } from './items.js';
import { MobManager } from './mobs.js';
import { Net } from './multiplayer.js';
import { RemotePlayer } from './remoteplayer.js';
import * as Audio from './audio.js';
import { DropManager } from './drops.js';

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 2000);
const RENDER_DIST = 9; // chunks
const SHARED_SEED = 20260607; // fixed seed for the global world so terrain is always consistent

const DAY_BLUE = new THREE.Color(0x87ceeb);
const NIGHT_BLUE = new THREE.Color(0x0a0e1a);
const SUNSET = new THREE.Color(0xff9d5c);
scene.fog = new THREE.Fog(DAY_BLUE.getHex(), CHUNK * (RENDER_DIST - 2.5), CHUNK * (RENDER_DIST + 0.5));

const hemi = new THREE.HemisphereLight(0xffffff, 0x555555, 0.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.0);
scene.add(sun);
const ambient = new THREE.AmbientLight(0xffffff, 0.35);
scene.add(ambient);

// sun/moon billboards
const sunSprite = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial({ color: 0xfff3b0, fog: false }));
const moonSprite = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshBasicMaterial({ color: 0xdfe6ff, fog: false }));
scene.add(sunSprite); scene.add(moonSprite);

// Build atlas + world
const atlas = buildAtlas(THREE);
let world, player, mobs, net = null;
let myName = 'Steve';
let multiplayer = false;
let dayTime = 240; // start mid-morning (phase ~0.4)
const DAY_LEN = 600; // seconds for a full cycle

const inventory = new Inventory(36);
const remotePlayers = new Map(); // peerId -> RemotePlayer

// torch lights (pooled)
const torchSet = new Set();      // "x,y,z"
const torchPool = [];
for (let i = 0; i < 16; i++) { const l = new THREE.PointLight(0xffb24d, 0, 9, 2); l.visible = false; scene.add(l); torchPool.push(l); }

// block selection highlight (wireframe) + breaking overlay
const highlightBox = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
  new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthTest: true })
);
highlightBox.visible = false; scene.add(highlightBox);
// Breaking overlay: a single textured plane that always faces the camera,
// positioned at the targeted block's center. 4 stages of crack tiles, swapped
// based on breakProgress. Using a billboard plane (instead of a 6-face box)
// avoids the z-fighting / transparent-sorted nightmares we had before.
const crackPlane = new THREE.Mesh(
  new THREE.BoxGeometry(1.02, 1.02, 1.02),
  new THREE.MeshBasicMaterial({
    map: atlas.texture, transparent: true, alphaTest: 0.05,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  })
);
crackPlane.visible = false;
crackPlane.renderOrder = 999;
scene.add(crackPlane);
let currentCrackStage = -1; // tracks last-applied stage so we only swap UVs on change

// First-person arm mesh (attached to camera)
const armGroup = new THREE.Group();
const armSkin = 0xd4a574;
const armMat = new THREE.MeshLambertMaterial({ color: armSkin });
// forearm
const armMesh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.55, 0.18), armMat);
armMesh.position.set(0, -0.12, 0);
armGroup.add(armMesh);
// hand (slightly wider block at the end)
const handMesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.2), armMat);
handMesh.position.set(0, -0.42, 0);
armGroup.add(handMesh);
armGroup.position.set(0.42, -0.38, -0.55);
camera.add(armGroup);
scene.add(camera); // needed so camera children render
let armSwingT = 0; // continuous swing timer when mining

// ---------------------------------------------------------------------------
// First-person held-tool models (pickaxe / axe / shovel / sword, all 5 tiers)
// Built once, parented to the camera, only the active one is visible per
// frame. Without this, picking a slot that has a tool just shows the bare
// arm — players had no idea their tool was selected. Each (kind, tier) gets
// its own Group with a stick handle plus a head shaped/colored for that
// tool and tier.
// ---------------------------------------------------------------------------
const TOOL_TIERS = ['wood', 'stone', 'iron', 'gold', 'diamond'];
const TOOL_TIER_COLORS = {
  wood: 0x9a7440, stone: 0x888888, iron: 0xd9c4b0, gold: 0xf3d23a, diamond: 0x4fe6dd,
};
const TOOL_TIER_HEAD_MAT = {}; // built below
for (const t of TOOL_TIERS) {
  TOOL_TIER_HEAD_MAT[t] = new THREE.MeshLambertMaterial({ color: TOOL_TIER_COLORS[t] });
}
const TOOL_HANDLE_MAT = new THREE.MeshLambertMaterial({ color: 0x6a4a25 });
// dark accent stripe along the handle — also used for axe eye / sword guard
const TOOL_TRIM_MAT = new THREE.MeshLambertMaterial({ color: 0x4a3318 });

// toolGroup contains every (kind, tier) model. Each is positioned so the
// hand-grip end of the handle is at the hand bone (matches bare-arm hand
// position) and the head extends forward+up in front of the camera.
const toolGroup = new THREE.Group();
toolGroup.position.set(0.42, -0.38, -0.55);
camera.add(toolGroup);
const toolMeshes = new Map(); // "kind|tier" -> Group

function buildToolModel(kind, tier) {
  const g = new THREE.Group();
  // handle — a 0.06 × 0.42 × 0.06 stick, oriented along Y. The bottom of
  // the handle sits at y=0 (hand position); the head sits above at y≈0.5.
  const handleLen = 0.42, handleW = 0.06;
  const handle = new THREE.Mesh(new THREE.BoxGeometry(handleW, handleLen, handleW), TOOL_HANDLE_MAT);
  handle.position.y = handleLen / 2;
  g.add(handle);
  // trim ring near the bottom of the handle
  const trim = new THREE.Mesh(new THREE.BoxGeometry(handleW * 1.25, 0.02, handleW * 1.25), TOOL_TRIM_MAT);
  trim.position.y = 0.06;
  g.add(trim);

  const headMat = TOOL_TIER_HEAD_MAT[tier];
  if (kind === 'pickaxe') {
    // head: horizontal bar across +Z, like a real pickaxe
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.34), headMat);
    bar.position.y = handleLen + 0.04;
    g.add(bar);
    // a tiny peak sticking forward — distinguishes it from a hammer
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.07), headMat);
    tip.position.set(0, handleLen + 0.04, -0.18);
    g.add(tip);
  } else if (kind === 'axe') {
    // axe head: chunky blade on the +Z side, sits flush with the handle
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.18), headMat);
    blade.position.set(0, handleLen + 0.08, 0.04);
    g.add(blade);
    // eye / socket — a darker block where the head meets the handle
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.05), TOOL_TRIM_MAT);
    eye.position.set(0, handleLen + 0.0, 0.02);
    g.add(eye);
  } else if (kind === 'shovel') {
    // shovel head: flat blade tilted slightly forward
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.18, 0.04), headMat);
    blade.position.set(0, handleLen + 0.10, 0.04);
    blade.rotation.x = -0.25;
    g.add(blade);
    // socket block where blade meets handle
    const socket = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.06), TOOL_TRIM_MAT);
    socket.position.set(0, handleLen + 0.02, 0.02);
    g.add(socket);
  } else if (kind === 'sword') {
    // blade: long thin box tilted slightly forward
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.55, 0.05), headMat);
    blade.position.y = handleLen + 0.32;
    blade.rotation.x = 0.08;
    g.add(blade);
    // crossguard: horizontal bar just above the handle
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, 0.06), TOOL_TRIM_MAT);
    guard.position.set(0, handleLen + 0.02, 0.0);
    g.add(guard);
    // pommel: small block at the bottom of the handle
    const pommel = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.07), TOOL_TRIM_MAT);
    pommel.position.y = -0.01;
    g.add(pommel);
  }
  g.visible = false;
  return g;
}
for (const kind of ['pickaxe', 'axe', 'shovel', 'sword']) {
  for (const tier of TOOL_TIERS) {
    const m = buildToolModel(kind, tier);
    toolGroup.add(m);
    toolMeshes.set(kind + '|' + tier, m);
  }
}

// Pulled out of selectedTool()'s id to drive the held-tool swap.
function parseToolId(id) {
  if (!id) return null;
  for (const tier of TOOL_TIERS) {
    for (const kind of ['pickaxe', 'axe', 'shovel', 'sword']) {
      if (id === tier + '_' + kind) return { kind, tier };
    }
  }
  return null;
}

// First-person gun model (attached to camera, shown when pistol is selected)
const gunGroup = new THREE.Group();
const gunMetal = new THREE.MeshLambertMaterial({ color: 0x2a2a2a });
const gunDark = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
const gunGrip = new THREE.MeshLambertMaterial({ color: 0x3d2b1a });
const gunAccent = new THREE.MeshLambertMaterial({ color: 0x444444 });
// slide (top part — the main barrel body)
const slide = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.08, 0.38), gunMetal);
slide.position.set(0, 0.04, -0.05);
gunGroup.add(slide);
// barrel (extends forward from the slide)
const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.055, 0.08), gunDark);
barrel.position.set(0, 0.035, -0.27);
gunGroup.add(barrel);
// muzzle hole
const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.015), new THREE.MeshBasicMaterial({ color: 0x000000 }));
muzzle.position.set(0, 0.035, -0.315);
gunGroup.add(muzzle);
// frame (lower receiver)
const frame = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.05, 0.24), gunAccent);
frame.position.set(0, -0.02, -0.01);
gunGroup.add(frame);
// trigger guard
const guard = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.08), gunMetal);
guard.position.set(0, -0.06, -0.04);
gunGroup.add(guard);
// trigger
const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.035, 0.02), gunAccent);
trigger.position.set(0, -0.045, -0.04);
gunGroup.add(trigger);
// grip (handle, angled slightly back)
const grip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.16, 0.09), gunGrip);
grip.position.set(0, -0.12, 0.06);
grip.rotation.x = 0.15;
gunGroup.add(grip);
// grip texture lines
for (let i = 0; i < 3; i++) {
  const line = new THREE.Mesh(new THREE.BoxGeometry(0.092, 0.008, 0.06), gunDark);
  line.position.set(0, -0.07 - i * 0.035, 0.06);
  line.rotation.x = 0.15;
  gunGroup.add(line);
}
// rear sight
const rearSight = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.025, 0.015), gunDark);
rearSight.position.set(0, 0.09, 0.1);
gunGroup.add(rearSight);
// front sight
const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, 0.015), gunDark);
frontSight.position.set(0, 0.09, -0.2);
gunGroup.add(frontSight);
// magazine base plate (visible at bottom of grip)
const magBase = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.015, 0.07), gunMetal);
magBase.position.set(0, -0.205, 0.075);
magBase.rotation.x = 0.15;
gunGroup.add(magBase);

gunGroup.position.set(0.38, -0.32, -0.52);
gunGroup.rotation.set(0, 0, 0);
gunGroup.visible = false;
camera.add(gunGroup);
let gunRecoilT = 0; // recoil animation timer
function applyCrackStage(stage) {
  if (!atlas.crackUVs || atlas.crackUVs.length === 0) return;
  const cu = atlas.crackUVs[stage] || atlas.crackUVs[atlas.crackUVs.length - 1];
  // PlaneGeometry has 4 verts in order: TL, TR, BL, BR → (u0,v0)(u1,v0)(u0,v1)(u1,v1)
  const uvAttr = crackPlane.geometry.attributes.uv;
  // BoxGeometry has 24 uvs (4 per face) — map the crack tile onto every face.
  for (let f = 0; f < 6; f++) {
    const o = f * 4;
    uvAttr.setXY(o + 0, cu.u0, cu.v1);
    uvAttr.setXY(o + 1, cu.u1, cu.v1);
    uvAttr.setXY(o + 2, cu.u0, cu.v0);
    uvAttr.setXY(o + 3, cu.u1, cu.v0);
  }
  uvAttr.needsUpdate = true;
}
let currentTarget = null; // {hit, place, block} from per-frame raycast

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const input = { forward: 0, back: 0, left: 0, right: 0, jump: 0, sneak: 0, sprint: 0, mouseDX: 0, mouseDY: 0 };
let mining = false, placing = false, locked = false, paused = true, invOpen = false;
let breakTarget = null, breakProgress = 0;
let eatCD = 0, placeCD = 0, attackAnim = 0, sprintTapT = 0;
let stepCD = 0;  // footstep throttle (seconds)
let gunCD = 0, reloading = false, reloadT = 0;  // FPS gun state
let hitMarkerT = 0;  // hit-marker flash timer

const keymap = {
  KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right',
  Space: 'jump', ShiftLeft: 'sneak', ShiftRight: 'sneak',
};

addEventListener('keydown', (e) => {
  if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) return;
  Audio.resumeAudio(); // first user gesture also unlocks the audio context
  if (e.code in keymap) { input[keymap[e.code]] = 1; if (e.code === 'KeyW') { const now = performance.now(); if (now - sprintTapT < 280) input.sprint = 1; sprintTapT = now; } }
  if (e.code === 'ControlLeft' || e.code === 'ControlRight') input.sprint = 1;
  if (e.code.startsWith('Digit')) { const n = +e.code.slice(5); if (n >= 1 && n <= 9) selectHotbar(n - 1); }
  if (e.code === 'KeyE') { e.preventDefault(); toggleInventory(); }
  if (e.code === 'KeyF') { player.flying = !player.flying; player.vel.set(0, 0, 0); flash('Fly: ' + (player.flying ? 'ON' : 'OFF')); }
  if (e.code === 'KeyT' && !invOpen && !paused) { e.preventDefault(); openChat(); }
  if (e.code === 'KeyQ' && !invOpen && !paused) { e.preventDefault(); dropOneFromHotbar(); }
  if (e.code === 'KeyR' && !invOpen && !paused) { e.preventDefault(); startReload(); }
  if (e.code === 'Escape') { if (invOpen) toggleInventory(); }
});
addEventListener('keyup', (e) => {
  if (e.code in keymap) input[keymap[e.code]] = 0;
  if (e.code === 'ControlLeft' || e.code === 'ControlRight') input.sprint = 0;
  if (e.code === 'KeyW') { /* keep sprint until movement stops */ if (!input.forward) input.sprint = 0; }
});

canvas.addEventListener('click', () => { if (!paused && !invOpen && !locked) canvas.requestPointerLock(); });
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; });
document.addEventListener('mousemove', (e) => { if (locked) { input.mouseDX += e.movementX; input.mouseDY += e.movementY; } });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousedown', (e) => {
  if (paused || invOpen) return;
  Audio.resumeAudio();
  if (!locked) { canvas.requestPointerLock(); return; }
  if (e.button === 0) { mining = true; if (isGunSelected()) fireGun(); else swingAttack(); }
  if (e.button === 2) { placing = true; useItem(); }
});
addEventListener('mouseup', (e) => { if (e.button === 0) { mining = false; breakTarget = null; breakProgress = 0; } if (e.button === 2) placing = false; });
addEventListener('wheel', (e) => { if (paused || invOpen) return; selectHotbar((inventory.selected + (e.deltaY > 0 ? 1 : 8)) % 9); }, { passive: true });
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

// ---------------------------------------------------------------------------
// Item icon rendering (cached)
// ---------------------------------------------------------------------------
const iconCache = new Map();
function itemCanvas(id) {
  if (iconCache.has(id)) return iconCache.get(id);
  const cv = document.createElement('canvas'); cv.width = 32; cv.height = 32;
  const ctx = cv.getContext('2d'); ctx.imageSmoothingEnabled = false;
  const def = ITEMS[id];
  if (def?.block !== undefined) {
    const f = atlas.faces[def.block];
    const tile = f.top ?? f.all ?? 0;
    const TILE = atlas.TILE; const cols = atlas.ATLAS_COLS;
    const sx = (tile % cols) * TILE, sy = Math.floor(tile / cols) * TILE;
    ctx.clearRect(0, 0, 32, 32);
    ctx.drawImage(atlas.canvas, sx, sy, TILE, TILE, 0, 0, 32, 32);
  } else if (def?.draw) { def.draw(ctx); }
  iconCache.set(id, cv);
  return cv;
}

// dropped-item entities (mining/mob drops + Q-throw from hotbar)
const dropMgr = new DropManager(THREE, scene, itemCanvas);

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
const hud = document.getElementById('hud');
const hotbarEl = document.getElementById('hotbar');
const healthEl = document.getElementById('health');
const hungerEl = document.getElementById('hunger');
const airEl = document.getElementById('air');

function heartSVG(fill) { // fill 0..1
  const c = fill >= 1 ? '#e23' : fill > 0 ? '#e23' : '#400';
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><path d='M8 14 1 7a3.5 3.5 0 0 1 5-5l2 2 2-2a3.5 3.5 0 0 1 5 5z' fill='${c}' stroke='black' stroke-width='1'/>${fill > 0 && fill < 1 ? "<rect x='8' y='0' width='8' height='16' fill='%23400' opacity='0.0'/>" : ''}</svg>`)}`;
}
function emptyHeart() { return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><path d='M8 14 1 7a3.5 3.5 0 0 1 5-5l2 2 2-2a3.5 3.5 0 0 1 5 5z' fill='%23300' stroke='black' stroke-width='1'/></svg>`)}`; }
function legSVG(c) { return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><ellipse cx='8' cy='9' rx='6' ry='4' fill='${c}' stroke='black'/><rect x='6' y='12' width='4' height='3' fill='white'/></svg>`)}`; }
function bubbleSVG() { return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><circle cx='8' cy='8' r='6' fill='%237ec8ff' stroke='black'/></svg>`)}`; }

function renderHUD() {
  // health: 10 hearts = 20 hp
  let h = '';
  for (let i = 0; i < 10; i++) {
    const hp = player.health - i * 2;
    if (hp >= 2) h += `<div class="icon" style="background-image:url(${heartSVG(1)})"></div>`;
    else if (hp === 1) h += `<div class="icon" style="background-image:url(${heartSVG(0.5)})"></div>`;
    else h += `<div class="icon" style="background-image:url(${emptyHeart()})"></div>`;
  }
  healthEl.innerHTML = h;
  let g = '';
  for (let i = 0; i < 10; i++) g += `<div class="icon" style="background-image:url(${legSVG(player.hunger - i * 2 >= 1 ? '%23b5651d' : '%23332')})"></div>`;
  hungerEl.innerHTML = g;
  // air only when underwater
  if (player.headInWater() && player.air < 10) {
    let a = '';
    for (let i = 0; i < 10; i++) a += player.air - i >= 1 ? `<div class="icon" style="background-image:url(${bubbleSVG()})"></div>` : '';
    airEl.innerHTML = a;
  } else airEl.innerHTML = '';
}

function renderHotbar() {
  hotbarEl.innerHTML = '';
  for (let i = 0; i < 9; i++) {
    const s = inventory.slots[i];
    const div = document.createElement('div');
    div.className = 'slot' + (i === inventory.selected ? ' sel' : '');
    if (s) div.appendChild(slotInner(s));
    hotbarEl.appendChild(div);
  }
  saveSoon();
}
function slotInner(s) {
  const frag = document.createDocumentFragment();
  const cv = itemCanvas(s.id).cloneNode(true);
  const ctx = cv.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.drawImage(itemCanvas(s.id), 0, 0);
  frag.appendChild(cv);
  if (s.count > 1) { const c = document.createElement('span'); c.className = 'count'; c.textContent = s.count; frag.appendChild(c); }
  if (s.dura !== undefined && ITEMS[s.id]?.tool) { const d = document.createElement('div'); d.className = 'dura'; const i = document.createElement('i'); i.style.width = (100 * s.dura / ITEMS[s.id].tool.dura) + '%'; d.appendChild(i); frag.appendChild(d); }
  return frag;
}
function selectHotbar(i) { inventory.selected = i; reloading = false; renderHotbar(); updateAmmoHUD(); saveSoon(); }

// ---------------------------------------------------------------------------
// Block break / place
// ---------------------------------------------------------------------------
function selectedTool() {
  const s = inventory.selectedItem();
  if (s && ITEMS[s.id]?.tool) return { item: s, ...ITEMS[s.id].tool };
  return { type: TOOL.HAND, mult: 1, level: 0, attack: 1, item: null };
}

function breakTime(blockId, tool) {
  const d = blockDefs[blockId];
  let hardness = d.hardness;
  const correct = tool.type === d.tool && tool.type !== TOOL.HAND;
  let t = correct ? hardness * 1.5 / tool.mult : hardness * 1.8;
  return Math.max(0.05, t);
}

function blockToItem(blockId) {
  for (const id in ITEMS) if (ITEMS[id].block === blockId) return id;
  return null;
}

function dropsFor(blockId, tool) {
  const d = blockDefs[blockId];
  if (d.needs) { // requires proper tool & level to yield drops
    if (!(tool.type === d.tool && tool.level >= d.needs)) return [];
  }
  if (blockId === BLOCK.LEAVES) {
    const out = []; if (Math.random() < 0.06) out.push(['apple', 1]); if (Math.random() < 0.08) out.push(['stick', 1]); return out;
  }
  let dropId;
  if (typeof d.drops === 'string') dropId = d.drops;
  else if (typeof d.drops === 'number') dropId = blockToItem(d.drops);
  else dropId = blockToItem(blockId);
  return dropId ? [[dropId, 1]] : [];
}

function setBlockShared(x, y, z, b, broadcast = true) {
  world.setBlock(x, y, z, b);
  if (b === BLOCK.TORCH) torchSet.add(x + ',' + y + ',' + z);
  else torchSet.delete(x + ',' + y + ',' + z);
  if (broadcast && multiplayer && net) net.sendBlock(x, y, z, b);
  if (!multiplayer) saveSoon();
}

// recompute the block the player is aiming at, and update the highlight box
function updateTarget() {
  const origin = camera.position;
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  currentTarget = world.raycast(origin, dir, 6);
  if (currentTarget) {
    const h = currentTarget.hit;
    highlightBox.position.set(h.x + 0.5, h.y + 0.5, h.z + 0.5);
    highlightBox.visible = true;
  } else { highlightBox.visible = false; }
}

function mineUpdate(dt) {
  if (isGunSelected()) { crackPlane.visible = false; breakTarget = null; breakProgress = 0; return; }
  if (!mining || !currentTarget) {
    crackPlane.visible = false;
    if (!mining) { breakTarget = null; breakProgress = 0; currentCrackStage = -1; }
    return;
  }
  const hit = currentTarget;
  const d = blockDefs[hit.block];
  if (d.unbreakable) { breakTarget = null; crackPlane.visible = false; return; }
  const key = hit.hit.x + ',' + hit.hit.y + ',' + hit.hit.z;
  if (key !== breakTarget) { breakTarget = key; breakProgress = 0; currentCrackStage = -1; }
  const tool = selectedTool();
  breakProgress += dt / breakTime(hit.block, tool);
  // progressive crack overlay — pick one of 4 stages based on progress
  const stage = Math.min(3, Math.floor(breakProgress * 4));
  if (stage !== currentCrackStage) {
    applyCrackStage(stage);
    currentCrackStage = stage;
    // throttled mining "thunk" once per stage advance (~4× per break)
    Audio.playMine(Audio.blockMaterial(hit.block));
  }
  crackPlane.position.set(hit.hit.x + 0.5, hit.hit.y + 0.5, hit.hit.z + 0.5);
  crackPlane.visible = true;
  if (breakProgress >= 1) {
    breakProgress = 0; breakTarget = null; crackPlane.visible = false; currentCrackStage = -1;
    setBlockShared(hit.hit.x, hit.hit.y, hit.hit.z, BLOCK.AIR);
    // spawn drops after block removal so ground scan finds the right floor
    for (const [id, n] of dropsFor(hit.block, tool)) {
      dropMgr.spawn(id, n, { x: hit.hit.x + 0.5, y: hit.hit.y + 0.9, z: hit.hit.z + 0.5 },
                            { x: (Math.random() - 0.5) * 1.4, y: 1.5, z: (Math.random() - 0.5) * 1.4 });
    }
    Audio.playBreak(Audio.blockMaterial(hit.block));
    if (tool.item && tool.type !== TOOL.HAND) {
      tool.item.dura = (tool.item.dura ?? ITEMS[tool.item.id].tool.dura) - 1;
      if (tool.item.dura <= 0) inventory.removeSelected(1);
    }
    player._hungerT += 0.6;
    renderHotbar();
  }
}

function useItem() {
  if (placeCD > 0) return;
  const s = inventory.selectedItem();
  if (!s) return;
  const def = ITEMS[s.id];
  // eat food
  if (def.food) {
    if (player.hunger < player.maxHunger || player.health < player.maxHealth) {
      player.eat(def.food);
      if (s.id === 'cooked_meat' || s.id === 'bread') player.heal(1);
      inventory.removeSelected(1);
      eatCD = 0.8; placeCD = 0.8; renderHotbar(); flash('Yum!');
      Audio.playEat();
    }
    return;
  }
  const hit = currentTarget;
  // place block
  if (def.block !== undefined && hit) {
    const p = hit.place;
    // don't place inside the player
    const px = player.pos.x, py = player.pos.y, pz = player.pos.z;
    const overlap = (p.x === Math.floor(px) || p.x === Math.floor(px - 0.3) || p.x === Math.floor(px + 0.3)) &&
                    (p.z === Math.floor(pz) || p.z === Math.floor(pz - 0.3) || p.z === Math.floor(pz + 0.3)) &&
                    (p.y === Math.floor(py) || p.y === Math.floor(py + 1));
    if (overlap && blockDefs[def.block].solid) return;
    if (world.getBlock(p.x, p.y, p.z) === BLOCK.AIR || world.getBlock(p.x, p.y, p.z) === BLOCK.WATER) {
      setBlockShared(p.x, p.y, p.z, def.block);
      inventory.removeSelected(1);
      placeCD = 0.18; attackAnim = 0.2; renderHotbar();
      Audio.playPlace(Audio.blockMaterial(def.block));
    }
  }
}

function swingAttack() {
  attackAnim = 0.25;
  const tool = selectedTool();
  const dmg = tool.attack || 1;
  const m = mobs.attack(camera, player, dmg);
  if (m) {
    Audio.playMobHurt();
    if (tool.item && tool.type !== TOOL.HAND) { tool.item.dura = (tool.item.dura ?? ITEMS[tool.item.id].tool.dura) - 1; if (tool.item.dura <= 0) { inventory.removeSelected(1); renderHotbar(); } }
  }
}

// ---------------------------------------------------------------------------
// Guns (FPS mode)
// ---------------------------------------------------------------------------
function isGunSelected() { const s = inventory.selectedItem(); return !!(s && ITEMS[s.id]?.gun); }

function giveGun() {
  inventory.add('pistol', 1);
  // the freshly added pistol has no ammo field yet — load a full magazine
  for (const s of inventory.slots) if (s && s.id === 'pistol' && s.ammo === undefined) s.ammo = ITEMS.pistol.gun.mag;
  renderHotbar();
  updateAmmoHUD();
  flash('🔫 Pistol acquired! Left-click to fire · R to reload.');
  Audio.playReload();
}

function startReload() {
  const s = inventory.selectedItem(); const def = ITEMS[s?.id];
  if (!def?.gun || reloading) return;
  if ((s.ammo ?? def.gun.mag) >= def.gun.mag) return; // already full
  reloading = true; reloadT = def.gun.reload;
  Audio.playReload();
  updateAmmoHUD();
}

function fireGun() {
  const s = inventory.selectedItem(); const def = ITEMS[s?.id];
  if (!def?.gun || reloading || gunCD > 0) return;
  if (s.ammo === undefined) s.ammo = def.gun.mag; // migrated / loaded gun
  if (s.ammo <= 0) { Audio.playDryFire(); startReload(); return; }
  gunCD = def.gun.fireCD;
  s.ammo--;
  attackAnim = 0.1; // recoil flick on the held item
  Audio.playGunShot();
  // shot direction with a little spread
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  if (def.gun.spread) {
    dir.x += (Math.random() - 0.5) * def.gun.spread;
    dir.y += (Math.random() - 0.5) * def.gun.spread;
    dir.z += (Math.random() - 0.5) * def.gun.spread;
    dir.normalize();
  }
  const origin = camera.position;
  // clip the shot at the first solid block so you can't hit through walls
  let maxDist = def.gun.range;
  const vox = world.raycast(origin, dir, def.gun.range);
  if (vox) {
    const dx = vox.hit.x + 0.5 - origin.x, dy = vox.hit.y + 0.5 - origin.y, dz = vox.hit.z + 0.5 - origin.z;
    maxDist = Math.min(maxDist, Math.sqrt(dx * dx + dy * dy + dz * dz));
  }
  const r = mobs.raycastMob(origin, dir, maxDist);
  if (r) {
    const killed = mobs.hitMob(r.mob, def.gun.damage, dir, def.gun.kb || 3);
    r.mob.hurtT = 0.2;
    Audio.playMobHurt();
    showHitMarker(killed);
  }
  updateAmmoHUD();
  renderHotbar();
  if (s.ammo <= 0) startReload();
}

function showHitMarker(kill) {
  const el = document.getElementById('hitmarker');
  el.className = kill ? 'show kill' : 'show';
  hitMarkerT = kill ? 0.4 : 0.18;
}

function updateAmmoHUD() {
  const el = document.getElementById('ammo');
  const s = inventory.selectedItem(); const def = ITEMS[s?.id];
  if (!def?.gun) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const ammo = s.ammo ?? def.gun.mag;
  el.textContent = reloading ? 'RELOADING…' : `🔫 ${ammo} / ${def.gun.mag}`;
}

// Drop one item from the currently selected hotbar slot. Spawns it in front
// of the player with a small forward / upward throw velocity, then plays a
// "whoosh" sound. Empty hands = nothing.
function dropOneFromHotbar() {
  const s = inventory.selectedItem();
  if (!s) return;
  const def = ITEMS[s.id];
  if (!def) return;
  // forward direction from the camera, flattened
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir); dir.y = 0; dir.normalize();
  const sideJitter = (Math.random() - 0.5) * 1.2;
  const right = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(sideJitter);
  const start = { x: player.pos.x + dir.x * 0.6, y: player.pos.y + 1.2, z: player.pos.z + dir.z * 0.6 };
  const vel = { x: dir.x * 2.0 + right.x, y: 1.8, z: dir.z * 2.0 + right.z };
  dropMgr.spawn(s.id, 1, start, vel);
  inventory.removeSelected(1);
  renderHotbar();
  Audio.playDrop();
}

// ---------------------------------------------------------------------------
// Inventory + crafting UI
// ---------------------------------------------------------------------------
const invPanel = document.getElementById('inventory');
const craftGrid = document.getElementById('craft-grid');
const craftOut = document.getElementById('craft-out');
const craftTitle = document.getElementById('craft-title');
const invMain = document.getElementById('inv-main');
const invHotbar = document.getElementById('inv-hotbar');
let craftSlots = new Array(9).fill(null);
let craftSize = 2;
let held = null; // {id,count,dura} being moved
let craftResult = null;

function nearCraftingTable() {
  const p = player.pos;
  for (let dx = -2; dx <= 2; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -2; dz <= 2; dz++)
    if (world.getBlock(Math.floor(p.x) + dx, Math.floor(p.y) + dy, Math.floor(p.z) + dz) === BLOCK.CRAFTING_TABLE) return true;
  return false;
}

function toggleInventory() {
  invOpen = !invOpen;
  if (invOpen) {
    document.exitPointerLock();
    craftSize = nearCraftingTable() ? 3 : 2;
    craftSlots = new Array(craftSize * craftSize).fill(null);
    craftTitle.textContent = `Crafting (${craftSize}×${craftSize})`;
    craftGrid.classList.toggle('big', craftSize === 3);
    renderInventoryUI();
    invPanel.classList.remove('hidden');
  } else {
    // return craft grid items to inventory
    for (const c of craftSlots) if (c) inventory.add(c.id, c.count);
    if (held) { inventory.add(held.id, held.count); held = null; }
    if (heldEl) { heldEl.remove(); heldEl = null; }
    craftSlots = new Array(9).fill(null);
    invPanel.classList.add('hidden');
    renderHotbar();
  }
}

function makeUISlot(getItem, onMouseDown, onMouseUp, extraClass = '') {
  const div = document.createElement('div');
  div.className = 'slot ' + extraClass;
  const s = getItem();
  if (s) div.appendChild(slotInner(s));
  div.addEventListener('contextmenu', (e) => e.preventDefault());
  div.addEventListener('mousedown', (e) => {
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    onMouseDown(e, div);
  });
  div.addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;
    onMouseUp(e, div);
  });
  return div;
}

function renderInventoryUI() {
  // crafting grid
  craftGrid.innerHTML = '';
  craftGrid.style.gridTemplateColumns = `repeat(${craftSize}, 48px)`;
  for (let i = 0; i < craftSize * craftSize; i++) {
    craftGrid.appendChild(makeUISlot(
      () => craftSlots[i],
      (e) => slotMouseDown('craft', i, e),
      () => {},
    ));
  }
  // result
  craftResult = matchRecipe(craftSlots.map(s => s ? s.id : null), craftSize);
  craftOut.innerHTML = '';
  craftOut.appendChild(makeUISlot(
    () => craftResult ? { id: craftResult.out, count: craftResult.count } : null,
    () => { if (craftResult && (!held || held.id === craftResult.out)) takeCraft(); },
    () => {},
    'out-slot',
  ));
  // main inventory (slots 9..35)
  invMain.innerHTML = '';
  for (let i = 9; i < 36; i++) invMain.appendChild(makeUISlot(
    () => inventory.slots[i],
    (e) => slotMouseDown('inv', i, e),
    () => {},
  ));
  // hotbar (0..8)
  invHotbar.innerHTML = '';
  for (let i = 0; i < 9; i++) invHotbar.appendChild(makeUISlot(
    () => inventory.slots[i],
    (e) => slotMouseDown('inv', i, e),
    () => {},
  ));
  // held item cursor
  renderHeld();
  // inventory state changed — debounce a save so a crash doesn't lose it
  saveSoon();
}

// ---- drag-and-drop / click-to-move -----------------------------------------
// `held` (declared above) is the item riding the cursor; its source slot is
// emptied at pickup, so every move operates on `held` — never on the (now
// empty) source slot. heldSrc/heldSrcI remember where it came from so a drop
// outside any slot can return it.
function findTargetSlot(e) {
  // The mouseup fires on the document (because we wired it at the document
  // level), so we need elementFromPoint to find the slot under the cursor.
  // Fall back to walking up from event.target if that's somehow more useful.
  let el = (typeof document.elementFromPoint === 'function')
    ? document.elementFromPoint(e.clientX, e.clientY)
    : null;
  if (!el) el = e.target;
  while (el && el !== document.body) {
    if (el.classList && el.classList.contains('slot')) {
      if (el.classList.contains('out-slot')) return { kind: 'out' };
      if (el.parentElement === craftGrid) {
        const idx = Array.prototype.indexOf.call(craftGrid.children, el);
        return { kind: 'craft', i: idx };
      }
      if (el.parentElement === invMain) {
        const idx = Array.prototype.indexOf.call(invMain.children, el);
        return { kind: 'inv', i: 9 + idx };
      }
      if (el.parentElement === invHotbar) {
        const idx = Array.prototype.indexOf.call(invHotbar.children, el);
        return { kind: 'inv', i: idx };
      }
    }
    el = el.parentElement;
  }
  return null;
}

let heldSrc = null;      // 'craft' | 'inv' — where the held item came from
let heldSrcI = -1;
let dragMoved = false;   // did the cursor travel far enough to be a drag?
let dragStartX = 0, dragStartY = 0;
let dragButton = 0;      // 0 = left, 2 = right
const DRAG_THRESHOLD = 4; // px

// right-click drag distribute state
let distributing = false;
let distribSlots = [];     // [{kind, i}] slots visited during right-drag
let distribSnap = null;    // snapshot of held count at drag start

function slotsOf(kind) { return kind === 'craft' ? craftSlots : inventory.slots; }

function pickUp(kind, i) {
  const arr = slotsOf(kind);
  if (!arr[i]) return;
  held = arr[i]; arr[i] = null;
  heldSrc = kind; heldSrcI = i;
}

// Pick up half (round up) of a stack, leaving the rest.
function pickUpHalf(kind, i) {
  const arr = slotsOf(kind);
  if (!arr[i]) return;
  const s = arr[i];
  const take = Math.ceil(s.count / 2);
  held = { id: s.id, count: take };
  if (s.dura !== undefined) held.dura = s.dura;
  s.count -= take;
  if (s.count <= 0) arr[i] = null;
  heldSrc = kind; heldSrcI = i;
}

// Place one item from the held stack into (kind,i). Returns true if placed.
function placeOne(kind, i) {
  if (!held) return false;
  const arr = slotsOf(kind);
  const target = arr[i];
  if (!target) {
    arr[i] = { id: held.id, count: 1 };
    if (held.dura !== undefined) arr[i].dura = held.dura;
    held.count--;
    if (held.count <= 0) held = null;
    return true;
  } else if (target.id === held.id) {
    const max = ITEMS[target.id]?.max ?? 64;
    if (target.count < max) { target.count++; held.count--; if (held.count <= 0) held = null; return true; }
  }
  return false;
}

function dropHeldInto(kind, i) {
  if (!held) return;
  const arr = slotsOf(kind);
  const target = arr[i];
  if (!target) { arr[i] = held; held = null; }
  else if (target.id === held.id) {
    const max = ITEMS[target.id]?.max ?? 64;
    const add = Math.min(held.count, max - target.count);
    target.count += add; held.count -= add;
    if (held.count <= 0) held = null;
  } else {
    arr[i] = held; held = target; heldSrc = kind; heldSrcI = i;
  }
}

function returnHeld() {
  if (!held) return;
  const arr = slotsOf(heldSrc);
  if (heldSrc && heldSrcI >= 0 && !arr[heldSrcI]) arr[heldSrcI] = held;
  else inventory.add(held.id, held.count);
  held = null;
}

// Redistribute held items evenly across distribSlots (left-drag distribute).
function redistributeLeftDrag() {
  if (!held || distribSlots.length === 0) return;
  const total = held.count;
  const perSlot = Math.floor(total / distribSlots.length);
  if (perSlot < 1) return;
  let placed = 0;
  for (const { kind, i } of distribSlots) {
    const arr = slotsOf(kind);
    const target = arr[i];
    if (!target) {
      arr[i] = { id: held.id, count: perSlot };
      if (held.dura !== undefined) arr[i].dura = held.dura;
      placed += perSlot;
    } else if (target.id === held.id) {
      const max = ITEMS[target.id]?.max ?? 64;
      const add = Math.min(perSlot, max - target.count);
      target.count += add;
      placed += add;
    }
  }
  held.count = total - placed;
  if (held.count <= 0) held = null;
}

function slotMouseDown(kind, i, e) {
  dragStartX = e.clientX; dragStartY = e.clientY; dragMoved = false;
  dragButton = e.button;

  if (e.button === 2) {
    // Right-click: place one or pick up half
    if (held) {
      placeOne(kind, i);
      // start right-drag distribute mode
      distributing = true;
      distribSlots = [{ kind, i }];
    } else {
      pickUpHalf(kind, i);
    }
  } else {
    // Left-click: normal pick/place
    if (held) {
      // start left-drag distribute mode
      distributing = true;
      distribSlots = [];
      distribSnap = held.count;
      // don't drop immediately on mousedown for left — distribute on drag
      const arr = slotsOf(kind);
      const target = arr[i];
      if (!target || target.id === held.id) {
        distribSlots.push({ kind, i });
      } else {
        dropHeldInto(kind, i);
        distributing = false;
      }
    } else {
      pickUp(kind, i);
    }
  }
  renderInventoryUI();
}

// track slot entry during drag
function onDragEnterSlot(e) {
  if (!distributing || !held || !invOpen) return;
  const target = findTargetSlot(e);
  if (!target || target.kind === 'out') return;
  const already = distribSlots.some(s => s.kind === target.kind && s.i === target.i);
  if (already) return;
  const arr = slotsOf(target.kind);
  const slot = arr[target.i];
  // only distribute into empty slots or same-id slots
  if (slot && slot.id !== held.id) return;
  distribSlots.push(target);

  if (dragButton === 2) {
    // right-drag: place one per slot immediately
    placeOne(target.kind, target.i);
  }
  // left-drag redistribute is done on mouseup
  renderInventoryUI();
}

document.addEventListener('mousemove', (e) => {
  if (!invOpen) return;
  if (held) {
    if (!dragMoved) {
      const dx = e.clientX - dragStartX, dy = e.clientY - dragStartY;
      if (dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD) dragMoved = true;
    }
    if (heldEl) { heldEl.style.left = (e.clientX - 19) + 'px'; heldEl.style.top = (e.clientY - 19) + 'px'; }
    if (dragMoved && distributing) onDragEnterSlot(e);
  }
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 2) {
    // right-drag finished
    distributing = false;
    distribSlots = [];
    renderInventoryUI();
    renderHotbar();
    return;
  }
  if (e.button !== 0) return;
  if (distributing && dragMoved && held) {
    redistributeLeftDrag();
    distributing = false;
    distribSlots = [];
    renderInventoryUI();
    renderHotbar();
  } else if (dragMoved && held) {
    const target = findTargetSlot(e);
    if (target && target.kind !== 'out') dropHeldInto(target.kind, target.i);
    else returnHeld();
    distributing = false;
    distribSlots = [];
    renderInventoryUI();
    renderHotbar();
  } else {
    distributing = false;
    distribSlots = [];
  }
  dragMoved = false;
});

let heldEl = null;
function renderHeld() {
  if (heldEl) heldEl.remove(), heldEl = null;
  if (!held) return;
  heldEl = document.createElement('div');
  heldEl.style.cssText = 'position:fixed;z-index:99;pointer-events:none;width:38px;height:38px;';
  heldEl.appendChild(slotInner(held));
  document.body.appendChild(heldEl);
}

function takeCraft() {
  if (!craftResult) return;
  // Consume only the ingredients the recipe actually requires. We walk
  // `consume` (a list of item ids) and decrement the first matching slot
  // for each. Extras in the grid stay where they are.
  if (craftResult.consume) {
    for (const need of craftResult.consume) {
      for (let i = 0; i < craftSlots.length; i++) {
        const s = craftSlots[i];
        if (s && s.id === need) { s.count--; if (s.count <= 0) craftSlots[i] = null; break; }
      }
    }
  }
  const out = craftResult;
  const item = { id: out.out, count: out.count };
  if (ITEMS[out.out].tool) item.dura = ITEMS[out.out].tool.dura;
  if (held && held.id === out.out) held.count += out.count;
  else if (!held) held = item;
  else inventory.add(out.out, out.count);
  renderInventoryUI();
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------
const chatLog = document.getElementById('chat-log');
const chatInput = document.getElementById('chat-input');
function openChat() { document.exitPointerLock(); chatInput.classList.remove('hidden'); chatInput.focus(); }
function closeChat() { chatInput.classList.add('hidden'); chatInput.value = ''; }
chatInput.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.code === 'Enter') {
    const t = chatInput.value.trim();
    if (t && !handleChatCommand(t)) { addChat(myName, t); if (multiplayer && net) net.sendChat(myName, t); }
    closeChat();
  }
  else if (e.code === 'Escape') closeChat();
});
// Chat "cheat" commands. Returns true if the text was a recognized command
// (and therefore should NOT be broadcast as a normal chat message).
function handleChatCommand(t) {
  const cmd = t.toLowerCase().replace(/\s+/g, '');
  if (cmd === '-gun-' || cmd === '-gun') { giveGun(); return true; }
  return false;
}

function addChat(name, text) {
  const line = document.createElement('div');
  line.className = 'line' + (name === 'system' ? ' sys' : '');
  line.textContent = name === 'system' ? text : `${name}: ${text}`;
  chatLog.appendChild(line);
  while (chatLog.children.length > 8) chatLog.removeChild(chatLog.firstChild);
  setTimeout(() => { if (line.parentNode) line.style.opacity = '0.4'; }, 8000);
}
let flashT = 0;
function flash(text) { addChat('system', text); }

// ---------------------------------------------------------------------------
// Day / night
// ---------------------------------------------------------------------------
function updateSky() {
  const phase = (dayTime % DAY_LEN) / DAY_LEN; // 0..1
  const ang = phase * Math.PI * 2 - Math.PI / 2;
  const sx = Math.cos(ang), sy = Math.sin(ang);
  const dist = 200;
  sun.position.set(player.pos.x + sx * 80, player.pos.y + sy * 100, player.pos.z + 30);
  sun.target.position.copy(player.pos); sun.target.updateMatrixWorld();
  sunSprite.position.set(player.pos.x + sx * dist, player.pos.y + sy * dist, player.pos.z);
  moonSprite.position.set(player.pos.x - sx * dist, player.pos.y - sy * dist, player.pos.z);
  sunSprite.lookAt(camera.position); moonSprite.lookAt(camera.position);
  sunSprite.visible = sy > -0.2; moonSprite.visible = sy < 0.2;

  const day = Math.max(0, Math.min(1, (sy + 0.15) / 0.5)); // 0 night .. 1 day
  const sunsetAmt = Math.max(0, 1 - Math.abs(sy) * 4) * (sy > -0.25 ? 1 : 0);
  const sky = NIGHT_BLUE.clone().lerp(DAY_BLUE, day).lerp(SUNSET, sunsetAmt * 0.5);
  scene.background = sky;
  scene.fog.color.copy(sky);
  sun.intensity = 0.15 + day * 0.95;
  sun.color.setHex(sunsetAmt > 0.3 ? 0xffb070 : 0xffffff);
  hemi.intensity = 0.25 + day * 0.5;
  ambient.intensity = 0.18 + day * 0.32;
}
function isNight() { const phase = (dayTime % DAY_LEN) / DAY_LEN; const sy = Math.sin(phase * Math.PI * 2 - Math.PI / 2); return sy < -0.05; }

// torch lights: assign pool to nearest torches
function updateTorchLights() {
  const cam = camera.position;
  const arr = [];
  for (const k of torchSet) { const [x, y, z] = k.split(',').map(Number); const d2 = (x - cam.x) ** 2 + (y - cam.y) ** 2 + (z - cam.z) ** 2; if (d2 < 30 * 30) arr.push([d2, x, y, z]); }
  arr.sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < torchPool.length; i++) {
    if (i < arr.length) { const [, x, y, z] = arr[i]; torchPool[i].position.set(x + 0.5, y + 0.6, z + 0.5); torchPool[i].visible = true; torchPool[i].intensity = 1.2; }
    else torchPool[i].visible = false;
  }
}

// ---------------------------------------------------------------------------
// Multiplayer handlers
// ---------------------------------------------------------------------------
function netHandlers() {
  return {
    getSeed: () => world.seed,
    getEdits: () => Array.from(world.edits.entries()),
    onInit: (seed, edits) => {
      // rebuild world with host's seed + edits
      rebuildWorld(seed);
      for (const [k, b] of edits) { const [x, y, z] = k.split(',').map(Number); world.setBlock(x, y, z, b, true); if (b === BLOCK.TORCH) torchSet.add(k); }
      player.setSpawnToSurface();
      addChat('system', 'Joined world! Synced ' + edits.length + ' changes.');
    },
    onPlayer: (id, s) => {
      if (id === net.myId) return;
      let rp = remotePlayers.get(id);
      if (!rp) { rp = new RemotePlayer(THREE, scene, s.name); remotePlayers.set(id, rp); addChat('system', (s.name || 'A player') + ' joined.'); }
      rp.setState(s);
    },
    onRemovePlayer: (id) => { const rp = remotePlayers.get(id); if (rp) { addChat('system', rp.name + ' left.'); rp.remove(); remotePlayers.delete(id); } },
    onBlock: (x, y, z, b) => { world.setBlock(x, y, z, b, true); if (b === BLOCK.TORCH) torchSet.add(x + ',' + y + ',' + z); else torchSet.delete(x + ',' + y + ',' + z); },
    onChat: (name, text) => addChat(name, text),
  };
}

let stateTimer = 0;
function syncMultiplayer(dt) {
  if (!multiplayer || !net) return;
  stateTimer += dt;
  if (stateTimer > 0.08) {
    stateTimer = 0;
    net.sendState({ x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw, name: myName, health: player.health });
  }
  for (const rp of remotePlayers.values()) rp.update(dt);
}

// ---------------------------------------------------------------------------
// World lifecycle
// ---------------------------------------------------------------------------
function rebuildWorld(seed) {
  if (world) { scene.remove(world.group); }
  world = new World(THREE, atlas, seed);
  scene.add(world.group);
  player = new Player(THREE, camera, world);
  player.onDeath = onDeath;
  player.onHurt = onHurt;
  mobs = new MobManager(THREE, world, scene);
  torchSet.clear();
  dropMgr.clear();
}

function startGame() {
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('loading').classList.remove('hidden');
  document.getElementById('loading-text').textContent = 'Generating world…';
  // pre-generate + mesh the spawn area so there's solid ground under you immediately
  setTimeout(() => {
    const ccx = Math.floor(player.pos.x / CHUNK), ccz = Math.floor(player.pos.z / CHUNK);
    const PRE = 6;
    for (let dz = -PRE; dz <= PRE; dz++) for (let dx = -PRE; dx <= PRE; dx++) world.getChunk(ccx + dx, ccz + dz); // data pass
    for (let dz = -PRE; dz <= PRE; dz++) for (let dx = -PRE; dx <= PRE; dx++) { const c = world.chunks.get((ccx + dx) + ',' + (ccz + dz)); if (c) world.buildMesh(c); } // mesh pass
    player.setSpawnToSurface();
    document.getElementById('loading').classList.add('hidden');
    hud.classList.remove('hidden');
    paused = false;
    renderHotbar();
    canvas.requestPointerLock();
    addChat('system', multiplayer ? 'You are in the shared world! Press T to chat, E for inventory.' : 'Welcome! Left-click to mine, E for inventory, F to fly.');
  }, 80);
}

function onDeath() {
  document.exitPointerLock();
  document.getElementById('death-msg').textContent = isNight() ? 'The night got you.' : 'Better luck next time.';
  document.getElementById('death').classList.remove('hidden');
  // drop nothing fancy; keep items (friendly)
}
function onHurt(n) {
  const el = document.getElementById('hurt'); el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 120);
  Audio.playHurt();
}
document.getElementById('respawn-btn').onclick = () => { document.getElementById('death').classList.add('hidden'); player.respawn(); canvas.requestPointerLock(); };

// ---------------------------------------------------------------------------
// Persistence (singleplayer)
// ---------------------------------------------------------------------------
const SAVE_KEY = 'nomaecraft_save_v2';
// Tracks whether a save is queued (debounced). Inventory / block changes
// call saveSoon() and we coalesce into one localStorage write every 800ms
// — much safer than the previous 10s fixed interval.
let _saveTimer = null;
function save() {
  if (multiplayer) return;
  if (!world || !player) return;
  try {
    // snapshot world entities (dropped items) so they survive reload
    const drops = dropMgr.drops.map(d => ({
      id: d.itemId, n: d.count, x: d.pos.x, y: d.pos.y, z: d.pos.z,
    }));
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      v: 2,
      seed: world.seed,
      edits: Array.from(world.edits.entries()),
      inv: inventory.serialize(),
      pos: [player.pos.x, player.pos.y, player.pos.z],
      time: dayTime,
      sel: inventory.selected,
      hp: player.health,
      hunger: player.hunger,
      sat: player.saturation,
      drops,
    }));
  } catch (e) {
    // localStorage full or blocked — fail silently, no crash
    console.warn('nomaecraft save failed:', e?.message);
  }
}
function saveSoon() {
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => { _saveTimer = null; save(); }, 800);
}
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY); if (!raw) return false;
    const d = JSON.parse(raw);
    rebuildWorld(d.seed);
    for (const [k, b] of d.edits) { const [x, y, z] = k.split(',').map(Number); world.setBlock(x, y, z, b, true); if (b === BLOCK.TORCH) torchSet.add(k); }
    inventory.load(d.inv);
    if (typeof d.sel === 'number') inventory.selected = d.sel;
    player.pos.set(d.pos[0], d.pos[1], d.pos[2]);
    player.spawn.copy(player.pos);
    if (typeof d.hp === 'number') player.health = d.hp;
    if (typeof d.hunger === 'number') player.hunger = d.hunger;
    if (typeof d.sat === 'number') player.saturation = d.sat;
    dayTime = d.time || 60;
    // restore world-entity dropped items
    if (Array.isArray(d.drops)) {
      for (const dr of d.drops) {
        dropMgr.spawn(dr.id, dr.n, { x: dr.x, y: dr.y, z: dr.z });
      }
    }
    return true;
  } catch (e) {
    console.warn('nomaecraft load failed:', e?.message);
    return false;
  }
}
// periodic safety net (every 30s) in case the user closes the tab
// without firing beforeunload (e.g. browser crash)
setInterval(save, 30000);
addEventListener('beforeunload', save);
// also save when the page is hidden (mobile background, tab switch)
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

// One-time migration: if a v1 save exists and no v2, copy it forward so the
// user's world isn't lost. v1 had [id, count] tuples only — v2 adds dura.
(function migrateV1Save() {
  try {
    if (localStorage.getItem(SAVE_KEY)) return; // v2 already there
    const v1 = localStorage.getItem('nomaecraft_save_v1');
    if (!v1) return;
    const d = JSON.parse(v1);
    // v1 has no `v` field, no `sel`, no `hp`, no `drops`. Forward it as v2.
    d.v = 2; if (typeof d.sel !== 'number') d.sel = 0;
    if (typeof d.hp !== 'number') d.hp = 20;
    if (typeof d.hunger !== 'number') d.hunger = 20;
    if (typeof d.sat !== 'number') d.sat = 5;
    if (!Array.isArray(d.drops)) d.drops = [];
    localStorage.setItem(SAVE_KEY, JSON.stringify(d));
    localStorage.removeItem('nomaecraft_save_v1');
  } catch {}
})();

// ---------------------------------------------------------------------------
// Menu wiring
// ---------------------------------------------------------------------------
const nameInput = document.getElementById('name-input');
const netStatus = document.getElementById('net-status');
const shareNote = document.getElementById('share-note');
nameInput.value = localStorage.getItem('nmc_name') || '';

function readName() { myName = (nameInput.value.trim() || 'Steve').slice(0, 16); localStorage.setItem('nmc_name', myName); }


document.getElementById('btn-online').onclick = async () => {
  readName();
  // flush any pending singleplayer save before we replace the world
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  save();
  netStatus.textContent = 'Connecting…';
  multiplayer = true;
  rebuildWorld(SHARED_SEED);
  net = new Net(netHandlers());
  try {
    const role = await net.connectShared('MAIN');
    netStatus.textContent = role === 'hosting' ? 'You are hosting — friends can join now!' : 'Connected!';
    setTimeout(startGame, 400);
  } catch (e) {
    netStatus.textContent = 'Error: ' + e.message + ' Try again.';
    multiplayer = false;
  }
};

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (paused || !world) { renderer.render(scene, camera); return; }

  if (!invOpen) {
    player.update(dt, input);
    eatCD = Math.max(0, eatCD - dt); placeCD = Math.max(0, placeCD - dt); attackAnim = Math.max(0, attackAnim - dt);
    // gun timers + auto-fire while the trigger is held
    gunCD = Math.max(0, gunCD - dt);
    if (reloading) {
      reloadT -= dt;
      if (reloadT <= 0) {
        reloading = false;
        const s = inventory.selectedItem(); const def = ITEMS[s?.id];
        if (def?.gun) { s.ammo = def.gun.mag; renderHotbar(); }
        updateAmmoHUD();
      }
    }
    if (mining && isGunSelected()) fireGun();
    if (hitMarkerT > 0) { hitMarkerT -= dt; if (hitMarkerT <= 0) document.getElementById('hitmarker').className = ''; }
    updateTarget();
    try { mineUpdate(dt); } catch (err) { console.error('mineUpdate error:', err); mining = false; breakTarget = null; breakProgress = 0; }
    if (placing) useItem();
    // footstep audio: when moving on the ground
    stepCD = Math.max(0, stepCD - dt);
    const moving = (input.forward || input.back || input.left || input.right) && !player.flying;
    if (moving && player.onGround && stepCD <= 0) {
      const interval = input.sprint ? 0.32 : 0.46;
      Audio.playStep(!!input.sprint);
      stepCD = interval;
    }
  } else { highlightBox.visible = false; crackPlane.visible = false; }

  dayTime += dt;
  world.update(player.pos.x, player.pos.z, RENDER_DIST);
  mobs.update(dt, player, isNight(), (id, n, mobPos) => {
    dropMgr.spawn(id, n,
      { x: mobPos.x, y: mobPos.y + 0.5, z: mobPos.z },
      { x: (Math.random() - 0.5) * 1.2, y: 1.4, z: (Math.random() - 0.5) * 1.2 });
  });
  // dropped-item physics + pickup (plays playPickup() on successful pickup).
  // We temporarily wrap inventory.add to know whether the pickup actually
  // consumed at least one of the item before the drop decides its fate.
  let _pickedUp = false;
  const _origAdd = inventory.add.bind(inventory);
  inventory.add = (id, count) => {
    const before = inventory.count(id);
    const left = _origAdd(id, count);
    const after = inventory.count(id);
    if (after > before) { Audio.playPickup(); _pickedUp = true; }
    return left;
  };
  try { dropMgr.update(dt, player, world, inventory); }
  catch (err) { console.error('dropMgr error:', err); }
  finally { inventory.add = _origAdd; }
  if (_pickedUp) renderHotbar();
  syncMultiplayer(dt);
  updateSky();
  updateTorchLights();
  renderHUD();

  // underwater overlay
  document.getElementById('underwater').classList.toggle('show', player.headInWater());

  // first-person arm + tool + gun model
  const gunOut = isGunSelected();
  const heldTool = selectedTool();
  // A "held tool" means the selected hotbar slot has a tool item that ISN'T
  // a gun. The bare arm still shows when the player holds a block, food,
  // torch, etc.
  const heldToolInfo = !gunOut ? parseToolId(heldTool.item?.id) : null;
  armGroup.visible = !gunOut && !heldToolInfo;
  gunGroup.visible = gunOut;
  toolGroup.visible = !!heldToolInfo;
  if (heldToolInfo) {
    // Only the matching (kind, tier) mesh is visible; hide all the others.
    for (const [k, m] of toolMeshes) m.visible = (k === heldToolInfo.kind + '|' + heldToolInfo.tier);
  }

  if (gunOut) {
    // gun recoil animation
    if (attackAnim > 0) {
      const t = attackAnim / 0.1;
      gunGroup.rotation.x = -0.35 * t * t;          // kick up
      gunGroup.position.z = -0.52 + 0.06 * t;       // kick back
      gunGroup.position.y = -0.32 + 0.03 * t;       // rise
    } else {
      // ease back to rest
      gunGroup.rotation.x *= 0.82;
      gunGroup.position.z += (-0.52 - gunGroup.position.z) * 0.15;
      gunGroup.position.y += (-0.32 - gunGroup.position.y) * 0.15;
    }
    // gentle idle sway
    const sway = performance.now() * 0.001;
    gunGroup.rotation.z = Math.sin(sway * 1.1) * 0.008;
    gunGroup.rotation.y = Math.sin(sway * 0.9) * 0.005;
  } else if (heldToolInfo) {
    // held tool — same swing pattern as the bare arm, just on toolGroup.
    if (attackAnim > 0) {
      const t = 1 - (attackAnim / 0.25);
      toolGroup.rotation.x = -1.2 * (1 - t * t);
      armSwingT = 0;
    } else if (mining && currentTarget) {
      armSwingT += dt * 7;
      toolGroup.rotation.x = Math.sin(armSwingT) * 0.7;
    } else {
      toolGroup.rotation.x *= 0.85;
      armSwingT = 0;
    }
  } else {
    // arm animation
    if (attackAnim > 0) {
      const t = 1 - (attackAnim / 0.25);
      armGroup.rotation.x = -1.2 * (1 - t * t);
      armSwingT = 0;
    } else if (mining && currentTarget) {
      armSwingT += dt * 7;
      armGroup.rotation.x = Math.sin(armSwingT) * 0.7;
    } else {
      armGroup.rotation.x *= 0.85;
      armSwingT = 0;
    }
  }

  renderer.render(scene, camera);
}
requestAnimationFrame(loop);

// Small console helper (open DevTools): nomae.give('diamond_pickaxe'), nomae.time(0.5), nomae.tp(x,y,z)
window.nomae = {
  give: (id, n = 1) => { if (!ITEMS[id]) return 'unknown item: ' + id; inventory.add(id, n); renderHotbar(); if (invOpen) renderInventoryUI(); return 'gave ' + n + ' ' + id; },
  items: () => Object.keys(ITEMS),
  time: (phase) => { dayTime = phase * DAY_LEN; return 'time set'; },
  tp: (x, y, z) => { player.pos.set(x, y, z); return 'tp'; },
  heal: () => { player.health = 20; player.hunger = 20; return 'healed'; },
  aim: () => currentTarget && { block: currentTarget.block, at: currentTarget.hit },
  pos: () => [player.pos.x.toFixed(1), player.pos.y.toFixed(1), player.pos.z.toFixed(1)],
  block: (x, y, z) => world.getBlock(x, y, z),
  look: (pitch, yaw) => { player.pitch = pitch; if (yaw !== undefined) player.yaw = yaw; return 'looking'; },
  mineAimed: () => { if (!currentTarget) return 'no block in view'; const t = selectedTool(); const drops = dropsFor(currentTarget.block, t); for (const [id, n] of drops) inventory.add(id, n); const b = currentTarget.block; setBlockShared(currentTarget.hit.x, currentTarget.hit.y, currentTarget.hit.z, BLOCK.AIR); renderHotbar(); return { mined: b, got: drops }; },
  save: () => { save(); return 'saved'; },
  saveInfo: () => { const raw = localStorage.getItem(SAVE_KEY); if (!raw) return 'no save'; const d = JSON.parse(raw); return { v: d.v, seed: d.seed, edits: d.edits?.length, invItems: d.inv?.filter(Boolean).length, pos: d.pos, time: d.time?.toFixed(0), sel: d.sel, hp: d.hp, hunger: d.hunger, drops: d.drops?.length || 0, bytes: raw.length }; },
};
