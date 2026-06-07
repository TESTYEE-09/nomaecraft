import * as THREE from 'three';
import { BLOCK, blockDefs, TOOL, buildAtlas } from './blocks.js';
import { World, CHUNK, HEIGHT, SEA } from './world.js';
import { Player } from './player.js';
import { Inventory, matchRecipe } from './inventory.js';
import { ITEMS } from './items.js';
import { MobManager } from './mobs.js';
import { Net, randomRoom } from './multiplayer.js';
import { RemotePlayer } from './remoteplayer.js';

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 1000);
const RENDER_DIST = 5; // chunks

const DAY_BLUE = new THREE.Color(0x87ceeb);
const NIGHT_BLUE = new THREE.Color(0x0a0e1a);
const SUNSET = new THREE.Color(0xff9d5c);
scene.fog = new THREE.Fog(DAY_BLUE.getHex(), CHUNK * (RENDER_DIST - 1), CHUNK * (RENDER_DIST + 0.5));

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

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const input = { forward: 0, back: 0, left: 0, right: 0, jump: 0, sneak: 0, sprint: 0, mouseDX: 0, mouseDY: 0 };
let mining = false, placing = false, locked = false, paused = true, invOpen = false;
let breakTarget = null, breakProgress = 0;
let eatCD = 0, placeCD = 0, attackAnim = 0, sprintTapT = 0;

const keymap = {
  KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right',
  Space: 'jump', ShiftLeft: 'sneak', ShiftRight: 'sneak',
};

addEventListener('keydown', (e) => {
  if (chatInput && document.activeElement === chatInput) return;
  if (e.code in keymap) { input[keymap[e.code]] = 1; if (e.code === 'KeyW') { const now = performance.now(); if (now - sprintTapT < 280) input.sprint = 1; sprintTapT = now; } }
  if (e.code === 'ControlLeft' || e.code === 'ControlRight') input.sprint = 1;
  if (e.code.startsWith('Digit')) { const n = +e.code.slice(5); if (n >= 1 && n <= 9) selectHotbar(n - 1); }
  if (e.code === 'KeyE') { e.preventDefault(); toggleInventory(); }
  if (e.code === 'KeyF') { player.flying = !player.flying; player.vel.set(0, 0, 0); flash('Fly: ' + (player.flying ? 'ON' : 'OFF')); }
  if (e.code === 'KeyT' && !invOpen && !paused) { e.preventDefault(); openChat(); }
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
  if (!locked) { canvas.requestPointerLock(); return; }
  if (e.button === 0) { mining = true; swingAttack(); }
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
function selectHotbar(i) { inventory.selected = i; renderHotbar(); }

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
  let t = correct ? hardness * 1.5 / tool.mult : hardness * 3.0;
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
}

function mineUpdate(dt) {
  if (!mining) return;
  const origin = camera.position;
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  const hit = world.raycast(origin, dir, 6);
  if (!hit) { breakTarget = null; breakProgress = 0; return; }
  const d = blockDefs[hit.block];
  if (d.unbreakable) { breakTarget = null; return; }
  const key = hit.hit.x + ',' + hit.hit.y + ',' + hit.hit.z;
  if (key !== breakTarget) { breakTarget = key; breakProgress = 0; }
  const tool = selectedTool();
  breakProgress += dt / breakTime(hit.block, tool);
  if (breakProgress >= 1) {
    breakProgress = 0; breakTarget = null;
    // drops
    for (const [id, n] of dropsFor(hit.block, tool)) inventory.add(id, n);
    setBlockShared(hit.hit.x, hit.hit.y, hit.hit.z, BLOCK.AIR);
    // tool durability
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
    }
    return;
  }
  // open crafting table
  const origin = camera.position; const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  const hit = world.raycast(origin, dir, 6);
  if (hit && hit.block === BLOCK.CRAFTING_TABLE && def.block === undefined) { return; }
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
    }
  }
}

function swingAttack() {
  attackAnim = 0.25;
  const tool = selectedTool();
  const dmg = tool.attack || 1;
  const m = mobs.attack(camera, player, dmg);
  if (m) {
    if (tool.item && tool.type !== TOOL.HAND) { tool.item.dura = (tool.item.dura ?? ITEMS[tool.item.id].tool.dura) - 1; if (tool.item.dura <= 0) { inventory.removeSelected(1); renderHotbar(); } }
  }
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
    craftSlots = new Array(9).fill(null);
    invPanel.classList.add('hidden');
    renderHotbar();
  }
}

function makeUISlot(getItem, onClick, extraClass = '') {
  const div = document.createElement('div');
  div.className = 'slot ' + extraClass;
  const s = getItem();
  if (s) div.appendChild(slotInner(s));
  div.onclick = (e) => { onClick(e); };
  return div;
}

function renderInventoryUI() {
  // crafting grid
  craftGrid.innerHTML = '';
  craftGrid.style.gridTemplateColumns = `repeat(${craftSize}, 48px)`;
  for (let i = 0; i < craftSize * craftSize; i++) {
    craftGrid.appendChild(makeUISlot(() => craftSlots[i], () => { clickCraft(i); }));
  }
  // result
  craftResult = matchRecipe(craftSlots.map(s => s ? s.id : null), craftSize);
  craftOut.innerHTML = '';
  craftOut.appendChild(makeUISlot(() => craftResult ? { id: craftResult.out, count: craftResult.count } : null, () => takeCraft(), 'out-slot'));
  // main inventory (slots 9..35)
  invMain.innerHTML = '';
  for (let i = 9; i < 36; i++) invMain.appendChild(makeUISlot(() => inventory.slots[i], () => clickInv(i)));
  // hotbar (0..8)
  invHotbar.innerHTML = '';
  for (let i = 0; i < 9; i++) invHotbar.appendChild(makeUISlot(() => inventory.slots[i], () => clickInv(i)));
  // held item cursor
  renderHeld();
}

let heldEl = null;
function renderHeld() {
  if (heldEl) heldEl.remove(), heldEl = null;
  if (!held) return;
  heldEl = document.createElement('div');
  heldEl.style.cssText = 'position:fixed;z-index:99;pointer-events:none;width:38px;height:38px;';
  heldEl.appendChild(slotInner(held));
  document.body.appendChild(heldEl);
}
addEventListener('mousemove', (e) => { if (heldEl) { heldEl.style.left = (e.clientX - 19) + 'px'; heldEl.style.top = (e.clientY - 19) + 'px'; } });

function clickInv(i) {
  const slot = inventory.slots[i];
  if (held) {
    if (!slot) { inventory.slots[i] = held; held = null; }
    else if (slot.id === held.id) { const max = ITEMS[slot.id].max; const add = Math.min(held.count, max - slot.count); slot.count += add; held.count -= add; if (held.count <= 0) held = null; }
    else { inventory.slots[i] = held; held = slot; }
  } else if (slot) { held = slot; inventory.slots[i] = null; }
  renderInventoryUI();
}
function clickCraft(i) {
  const slot = craftSlots[i];
  if (held) {
    if (!slot) { craftSlots[i] = { id: held.id, count: held.count, dura: held.dura }; held = null; }
    else if (slot.id === held.id) { const max = ITEMS[slot.id].max; const add = Math.min(held.count, max - slot.count); slot.count += add; held.count -= add; if (held.count <= 0) held = null; }
    else { const tmp = craftSlots[i]; craftSlots[i] = held; held = tmp; }
  } else if (slot) { held = slot; craftSlots[i] = null; }
  renderInventoryUI();
}
function takeCraft() {
  if (!craftResult) return;
  // consume one of each ingredient
  for (let i = 0; i < craftSlots.length; i++) if (craftSlots[i]) { craftSlots[i].count--; if (craftSlots[i].count <= 0) craftSlots[i] = null; }
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
  if (e.code === 'Enter') { const t = chatInput.value.trim(); if (t) { addChat(myName, t); if (multiplayer && net) net.sendChat(myName, t); } closeChat(); }
  else if (e.code === 'Escape') closeChat();
});
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
}

function startGame() {
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('loading').classList.remove('hidden');
  // pre-generate spawn chunks
  setTimeout(() => {
    world.update(player.pos.x, player.pos.z, RENDER_DIST);
    player.setSpawnToSurface();
    document.getElementById('loading').classList.add('hidden');
    hud.classList.remove('hidden');
    paused = false;
    renderHotbar();
    canvas.requestPointerLock();
    addChat('system', multiplayer ? 'Connected! Press T to chat.' : 'Welcome! Press E for inventory, F to fly.');
  }, 60);
}

function onDeath() {
  document.exitPointerLock();
  document.getElementById('death-msg').textContent = isNight() ? 'The night got you.' : 'Better luck next time.';
  document.getElementById('death').classList.remove('hidden');
  // drop nothing fancy; keep items (friendly)
}
function onHurt(n) {
  const el = document.getElementById('hurt'); el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 120);
}
document.getElementById('respawn-btn').onclick = () => { document.getElementById('death').classList.add('hidden'); player.respawn(); canvas.requestPointerLock(); };

// ---------------------------------------------------------------------------
// Persistence (singleplayer)
// ---------------------------------------------------------------------------
const SAVE_KEY = 'nomaecraft_save_v1';
function save() {
  if (multiplayer) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      seed: world.seed,
      edits: Array.from(world.edits.entries()),
      inv: inventory.serialize(),
      pos: [player.pos.x, player.pos.y, player.pos.z],
      time: dayTime,
    }));
  } catch {}
}
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY); if (!raw) return false;
    const d = JSON.parse(raw);
    rebuildWorld(d.seed);
    for (const [k, b] of d.edits) { const [x, y, z] = k.split(',').map(Number); world.setBlock(x, y, z, b, true); if (b === BLOCK.TORCH) torchSet.add(k); }
    inventory.load(d.inv);
    player.pos.set(d.pos[0], d.pos[1], d.pos[2]);
    player.spawn.copy(player.pos);
    dayTime = d.time || 60;
    return true;
  } catch { return false; }
}
setInterval(save, 10000);
addEventListener('beforeunload', save);

// ---------------------------------------------------------------------------
// Menu wiring
// ---------------------------------------------------------------------------
const nameInput = document.getElementById('name-input');
const netStatus = document.getElementById('net-status');
const shareNote = document.getElementById('share-note');
nameInput.value = localStorage.getItem('nmc_name') || '';

function readName() { myName = (nameInput.value.trim() || 'Steve').slice(0, 16); localStorage.setItem('nmc_name', myName); }

document.getElementById('btn-single').onclick = () => {
  readName();
  multiplayer = false;
  if (!loadSave()) { rebuildWorld((Math.random() * 1e9) | 0); }
  startGame();
};

document.getElementById('btn-host').onclick = async () => {
  readName();
  netStatus.textContent = 'Creating room…';
  multiplayer = true;
  rebuildWorld((Math.random() * 1e9) | 0);
  net = new Net(netHandlers());
  const code = randomRoom();
  try {
    await net.host(code);
    netStatus.innerHTML = `Room created! Share this code: <b style="font-size:18px;letter-spacing:2px">${code}</b>`;
    const url = location.origin + location.pathname + '#' + code;
    shareNote.innerHTML = `Friends can join with the code, or this link:<br><b>${url}</b>`;
    try { await navigator.clipboard.writeText(url); shareNote.innerHTML += '<br>(link copied to clipboard)'; } catch {}
    setTimeout(startGame, 800);
  } catch (e) { netStatus.textContent = 'Error: ' + e.message; multiplayer = false; }
};

async function doJoin(code) {
  readName();
  code = code.trim().toUpperCase();
  if (!code) { netStatus.textContent = 'Enter a room code.'; return; }
  netStatus.textContent = 'Connecting to ' + code + '…';
  multiplayer = true;
  rebuildWorld(1337); // temporary; replaced by host's seed on init
  net = new Net(netHandlers());
  try {
    await net.join(code);
    netStatus.textContent = 'Connected!';
    setTimeout(startGame, 400);
  } catch (e) { netStatus.textContent = 'Error: ' + e.message; multiplayer = false; }
}
document.getElementById('btn-join').onclick = () => doJoin(document.getElementById('room-input').value);

// auto-fill room code from URL hash (#CODE) so shared links prefill join
if (location.hash.length > 1) {
  const code = location.hash.slice(1).toUpperCase();
  document.getElementById('room-input').value = code;
  netStatus.textContent = 'Room code filled from link — press Join (after entering your name).';
}

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
    mineUpdate(dt);
    if (placing) useItem();
  }

  dayTime += dt;
  world.update(player.pos.x, player.pos.z, RENDER_DIST);
  mobs.update(dt, player, isNight(), (id, n) => inventory.add(id, n));
  syncMultiplayer(dt);
  updateSky();
  updateTorchLights();
  renderHUD();

  // underwater overlay
  document.getElementById('underwater').classList.toggle('show', player.headInWater());

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
};
