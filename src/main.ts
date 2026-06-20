// Nomaecraft entry point.
// Sets up the renderer, scene, sky, input, player, world and chunk manager,
// then runs the main loop: input -> physics -> chunk streaming -> render.

import * as THREE from 'three';
import { Block, HOTBAR, isSolid } from './blocks';
import { CHUNK_SIZE, PLAYER_HEIGHT, PLAYER_RADIUS, RENDER_DISTANCE, WORLD_HEIGHT } from './constants';
import { ChunkManager } from './chunkmanager';
import { Player, type InputState } from './player';
import { raycastVoxel } from './raycast';
import { createAtlasCanvas, createAtlasTexture } from './textures';
import { createUI } from './ui';
import { World } from './world';

const SKY_COLOR = new THREE.Color(0x8fc6ff);

function createSky(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = SKY_COLOR.clone();
  scene.fog = new THREE.Fog(SKY_COLOR.getHex(), RENDER_DISTANCE * CHUNK_SIZE * 0.55, RENDER_DISTANCE * CHUNK_SIZE * 0.95);

  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.position.set(50, 100, 30);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  return scene;
}

function createOverlay(): { overlay: HTMLElement; onStart: (cb: () => void) => void } {
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    background: 'radial-gradient(circle at 50% 40%, rgba(40,70,110,0.6), rgba(10,15,25,0.92))',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    fontFamily: 'monospace',
    zIndex: '50',
    cursor: 'pointer',
    textAlign: 'center',
    padding: '20px',
  } as Partial<CSSStyleDeclaration>);

  const title = document.createElement('h1');
  title.textContent = 'NOMAECRAFT';
  Object.assign(title.style, { fontSize: '52px', margin: '0 0 8px', letterSpacing: '4px', textShadow: '0 3px 0 #1a3a5a' });
  overlay.appendChild(title);

  const sub = document.createElement('div');
  sub.textContent = 'A tiny voxel sandbox built with Three.js';
  Object.assign(sub.style, { opacity: '0.8', marginBottom: '28px', fontSize: '14px' });
  overlay.appendChild(sub);

  const play = document.createElement('div');
  play.textContent = '▶ Click to Play';
  Object.assign(play.style, {
    fontSize: '22px', padding: '14px 36px', border: '2px solid #fff', borderRadius: '8px',
    background: 'rgba(255,255,255,0.12)', marginBottom: '28px',
  });
  overlay.appendChild(play);

  const controls = document.createElement('div');
  controls.innerHTML = [
    '<b>Move</b>: WASD &nbsp; <b>Jump</b>: Space &nbsp; <b>Sprint</b>: Ctrl',
    '<b>Look</b>: Mouse &nbsp; <b>Break</b>: Left Click &nbsp; <b>Place</b>: Right Click',
    '<b>Hotbar</b>: 1–9 / Scroll &nbsp; <b>Fly</b>: F &nbsp; <b>Debug</b>: F3 &nbsp; <b>Pause</b>: Esc',
  ].join('<br>');
  Object.assign(controls.style, { lineHeight: '1.8', fontSize: '13px', opacity: '0.9' });
  overlay.appendChild(controls);

  document.body.appendChild(overlay);

  const listeners: Array<() => void> = [];
  const trigger = () => listeners.pop()?.();
  overlay.addEventListener('click', trigger);
  return { overlay, onStart: (cb) => listeners.push(cb) };
}

function main(): void {
  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, { display: 'block', width: '100vw', height: '100vh' });
  document.body.appendChild(canvas);
  Object.assign(document.body.style, { margin: '0', overflow: 'hidden', background: '#000' });

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  // Shader encodes to sRGB itself (see material.ts), so keep the renderer
  // output linear to avoid double colorspace conversion.
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const scene = createSky();
  const atlasCanvas = createAtlasCanvas();
  const atlas = createAtlasTexture();
  const world = new World();
  const chunkManager = new ChunkManager(world, atlas, SKY_COLOR);
  scene.add(chunkManager.group);

  // Surface shader/program compile errors in the console — without this a
  // broken shader renders nothing but the sky, silently. We check GL errors
  // after the first few frames and log any non-zero status.
  const gl = renderer.getContext();
  let glErrorsChecked = false;
  const checkGLErrors = () => {
    if (glErrorsChecked) return;
    glErrorsChecked = true;
    const err = gl.getError();
    if (err !== gl.NO_ERROR && err !== gl.CONTEXT_LOST_WEBGL) {
      console.error('[Nomaecraft] WebGL error after first render:', err);
    } else if (chunkManager.group.children.length === 0) {
      console.warn('[Nomaecraft] No chunk meshes were built — world generation may have failed.');
    } else {
      console.log('[Nomaecraft] OK —', chunkManager.group.children.length, 'chunk meshes rendering.');
    }
  };

  const player = new Player(window.innerWidth / window.innerHeight);

  // Spawn: find a grassy column near origin and stand on it.
  const spawnX = 8, spawnZ = 8;
  const sy = world.surfaceY(spawnX, spawnZ);
  player.setSpawn(spawnX, Math.min(WORLD_HEIGHT - 3, sy + 2), spawnZ);

  const ui = createUI(atlasCanvas);
  let selected = 0;
  ui.setSelected(selected);

  // ---- Input state ---------------------------------------------------------
  const input: InputState = { forward: false, back: false, left: false, right: false, jump: false, crouch: false, sprint: false };
  let locked = false;
  let showDebug = false;

  const overlay = createOverlay();
  overlay.onStart(() => {
    canvas.requestPointerLock();
  });

  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
    overlay.overlay.style.display = locked ? 'none' : 'flex';
  });

  document.addEventListener('mousemove', (e) => {
    if (!locked) return;
    player.look(e.movementX, e.movementY);
  });

  document.addEventListener('mousedown', (e) => {
    if (!locked) return;
    const dir = new THREE.Vector3();
    player.camera.getWorldDirection(dir).normalize();
    const origin = player.camera.position;
    const hit = raycastVoxel(world, origin, dir, 6);
    if (!hit) return;
    if (e.button === 0) {
      // Break
      world.setBlock(hit.x, hit.y, hit.z, Block.Air);
      chunkManager.invalidate(Math.floor(hit.x / CHUNK_SIZE), Math.floor(hit.z / CHUNK_SIZE));
    } else if (e.button === 2) {
      // Place adjacent — but not inside the player.
      const px = hit.x + hit.nx;
      const py = hit.y + hit.ny;
      const pz = hit.z + hit.nz;
      if (intersectsPlayer(px, py, pz, player)) return;
      world.setBlock(px, py, pz, HOTBAR[selected]);
      chunkManager.invalidate(Math.floor(px / CHUNK_SIZE), Math.floor(pz / CHUNK_SIZE));
    }
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  document.addEventListener('keydown', (e) => {
    switch (e.code) {
      case 'KeyW': input.forward = true; break;
      case 'KeyS': input.back = true; break;
      case 'KeyA': input.left = true; break;
      case 'KeyD': input.right = true; break;
      case 'Space': input.jump = true; break;
      case 'ShiftLeft': input.crouch = true; break;
      case 'ControlLeft': input.sprint = true; break;
      case 'KeyF':
        if (locked) { player.flying = !player.flying; player.velocity.set(0, 0, 0); }
        break;
      case 'F3':
        e.preventDefault();
        if (locked) showDebug = !showDebug;
        break;
    }
    // Hotbar number keys.
    if (e.code.startsWith('Digit')) {
      const n = parseInt(e.code.slice(5), 10) - 1;
      if (n >= 0 && n < HOTBAR.length) { selected = n; ui.setSelected(selected); }
    }
  });

  document.addEventListener('keyup', (e) => {
    switch (e.code) {
      case 'KeyW': input.forward = false; break;
      case 'KeyS': input.back = false; break;
      case 'KeyA': input.left = false; break;
      case 'KeyD': input.right = false; break;
      case 'Space': input.jump = false; break;
      case 'ShiftLeft': input.crouch = false; break;
      case 'ControlLeft': input.sprint = false; break;
    }
  });

  document.addEventListener('wheel', (e) => {
    if (!locked) return;
    const dir = e.deltaY > 0 ? 1 : -1;
    selected = (selected + dir + HOTBAR.length) % HOTBAR.length;
    ui.setSelected(selected);
  });

  window.addEventListener('resize', () => {
    player.camera.aspect = window.innerWidth / window.innerHeight;
    player.camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ---- Main loop -----------------------------------------------------------
  let last = performance.now();
  let chunkWarmup = 0;
  const frame = (now: number) => {
    const dt = (now - last) / 1000;
    last = now;

    if (locked) {
      player.update(dt, input, world);
    }

    // Stream chunks. While warming up the first batch, build more aggressively
    // so the player doesn't fall through ungenerated terrain.
    const budget = chunkWarmup < 30 ? 6 : 2;
    chunkManager.update(player.position.x, player.position.z, budget);
    chunkWarmup++;

    if (showDebug) {
      const p = player.position;
      ui.setDebug(
        `Nomaecraft\n` +
        `xyz: ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}\n` +
        `chunks: ${world.chunks.size}  meshes: ${chunkManager.group.children.length}\n` +
        `fly: ${player.flying ? 'ON' : 'off'}  ground: ${player.onGround ? 'yes' : 'no'}`,
      );
    } else {
      ui.setDebug('');
    }

    if (chunkWarmup === 5) checkGLErrors();
    renderer.render(scene, player.camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** True if a block at (x,y,z) would overlap the player's AABB. */
function intersectsPlayer(x: number, y: number, z: number, player: Player): boolean {
  const minX = player.position.x - PLAYER_RADIUS;
  const maxX = player.position.x + PLAYER_RADIUS;
  const minY = player.position.y;
  const maxY = player.position.y + PLAYER_HEIGHT;
  const minZ = player.position.z - PLAYER_RADIUS;
  const maxZ = player.position.z + PLAYER_RADIUS;
  return (
    x + 1 > minX && x < maxX &&
    y + 1 > minY && y < maxY &&
    z + 1 > minZ && z < maxZ
  );
}

// Guard against placing a block type we then treat as solid (kept simple).
void isSolid;

main();
