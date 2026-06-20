// Procedurally generates a texture atlas on a canvas so the game ships with
// zero binary image assets. Each tile is 16x16 pixels drawn with deterministic
// per-tile noise for that hand-painted blocky look.

import * as THREE from 'three';
import { ATLAS_TILES } from './constants';

export const TILE = 16; // pixels per tile
export const ATLAS_PX = TILE * ATLAS_TILES;

// Seeded PRNG (mulberry32) so the atlas is identical every build.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shade(hex: string, amt: number): string {
  const c = parseInt(hex.slice(1), 16);
  let r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  r = Math.max(0, Math.min(255, Math.round(r + amt)));
  g = Math.max(0, Math.min(255, Math.round(g + amt)));
  b = Math.max(0, Math.min(255, Math.round(b + amt)));
  return `rgb(${r},${g},${b})`;
}

type Painter = (ctx: CanvasRenderingContext2D, x0: number, y0: number) => void;

function noisePainter(base: string, variance: number, seed: number): Painter {
  const rand = mulberry32(seed);
  return (ctx, x0, y0) => {
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const n = (rand() - 0.5) * 2 * variance;
        ctx.fillStyle = shade(base, n);
        ctx.fillRect(x0 + x, y0 + y, 1, 1);
      }
    }
  };
}

// Speckled noise plus a few darker clumps — good for stone/cobble/dirt.
function clumpPainter(base: string, variance: number, clumps: number, seed: number): Painter {
  const rand = mulberry32(seed);
  return (ctx, x0, y0) => {
    noisePainter(base, variance, seed)(ctx, x0, y0);
    for (let i = 0; i < clumps; i++) {
      const cx = Math.floor(rand() * TILE);
      const cy = Math.floor(rand() * TILE);
      const r = 1 + Math.floor(rand() * 2);
      ctx.fillStyle = shade(base, -25 - rand() * 20);
      for (let y = -r; y <= r; y++) {
        for (let x = -r; x <= r; x++) {
          if (x * x + y * y <= r * r) ctx.fillRect(x0 + cx + x, y0 + cy + y, 1, 1);
        }
      }
    }
  };
}

function grassTop(): Painter {
  return (ctx, x0, y0) => {
    noisePainter('#5fae3a', 22, 11)(ctx, x0, y0);
    // scatter a few lighter blades
    const rand = mulberry32(31);
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = shade('#5fae3a', 30 + rand() * 20);
      ctx.fillRect(x0 + Math.floor(rand() * TILE), y0 + Math.floor(rand() * TILE), 1, 1);
    }
  };
}

function grassSide(): Painter {
  return (ctx, x0, y0) => {
    // dirt body
    noisePainter('#7a5236', 18, 7)(ctx, x0, y0);
    // grass overhang on top rows
    const rand = mulberry32(19);
    for (let x = 0; x < TILE; x++) {
      const h = 2 + Math.floor(rand() * 3);
      for (let y = 0; y < h; y++) {
        ctx.fillStyle = shade('#5fae3a', (rand() - 0.5) * 30);
        ctx.fillRect(x0 + x, y0 + y, 1, 1);
      }
    }
  };
}

function logSide(): Painter {
  return (ctx, x0, y0) => {
    noisePainter('#6e522b', 12, 23)(ctx, x0, y0);
    // vertical bark streaks
    const rand = mulberry32(41);
    for (let x = 0; x < TILE; x += 1) {
      if (rand() < 0.3) {
        ctx.fillStyle = shade('#6e522b', -22);
        for (let y = 0; y < TILE; y++) ctx.fillRect(x0 + x, y0 + y, 1, 1);
      }
    }
  };
}

function planksPainter(): Painter {
  return (ctx, x0, y0) => {
    noisePainter('#9a6b3f', 10, 5)(ctx, x0, y0);
    ctx.fillStyle = shade('#9a6b3f', -34);
    // horizontal plank seams every 4px
    for (let y = 3; y < TILE; y += 4) {
      ctx.fillRect(x0, y0 + y, TILE, 1);
    }
    // vertical seams offset per row
    ctx.fillRect(x0 + 7, y0 + 0, 1, 4);
    ctx.fillRect(x0 + 3, y0 + 4, 1, 4);
    ctx.fillRect(x0 + 11, y0 + 8, 1, 4);
    ctx.fillRect(x0 + 5, y0 + 12, 1, 4);
  };
}

function leavesPainter(): Painter {
  return (ctx, x0, y0) => {
    const rand = mulberry32(67);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const v = rand();
        // punch transparent holes for a fluffy canopy
        if (v < 0.12) {
          ctx.clearRect(x0 + x, y0 + y, 1, 1);
        } else {
          ctx.fillStyle = shade('#3a7a22', (v - 0.5) * 50);
          ctx.fillRect(x0 + x, y0 + y, 1, 1);
        }
      }
    }
  };
}

function waterPainter(): Painter {
  return (ctx, x0, y0) => {
    noisePainter('#3a6dea', 14, 3)(ctx, x0, y0);
  };
}

function brickPainter(): Painter {
  return (ctx, x0, y0) => {
    noisePainter('#9b4a3a', 8, 13)(ctx, x0, y0);
    ctx.fillStyle = '#cfc4b8';
    // mortar lines
    for (let y = 0; y < TILE; y += 4) ctx.fillRect(x0, y0 + y, TILE, 1);
    for (let y = 0; y < TILE; y += 4) {
      const offset = (y / 4) % 2 === 0 ? 0 : 4;
      for (let x = offset; x < TILE; x += 8) ctx.fillRect(x0 + x, y0 + y, 1, 4);
    }
  };
}

function glowstonePainter(): Painter {
  return (ctx, x0, y0) => {
    clumpPainter('#c89030', 14, 6, 97)(ctx, x0, y0);
    const rand = mulberry32(101);
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = '#ffe89a';
      ctx.fillRect(x0 + Math.floor(rand() * TILE), y0 + Math.floor(rand() * TILE), 1, 1);
    }
  };
}

function glassPainter(): Painter {
  return (ctx, x0, y0) => {
    ctx.clearRect(x0, y0, TILE, TILE);
    ctx.strokeStyle = 'rgba(220,240,255,0.85)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, TILE - 1, TILE - 1);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.moveTo(x0 + 2, y0 + 2);
    ctx.lineTo(x0 + 6, y0 + 6);
    ctx.stroke();
  };
}

function icePainter(): Painter {
  return (ctx, x0, y0) => {
    noisePainter('#9fc4f0', 10, 53)(ctx, x0, y0);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    ctx.moveTo(x0 + 3, y0 + 2);
    ctx.lineTo(x0 + 8, y0 + 9);
    ctx.lineTo(x0 + 4, y0 + 13);
    ctx.stroke();
  };
}

function snowTop(): Painter {
  return noisePainter('#f4f8ff', 8, 71);
}

function snowSide(): Painter {
  return (ctx, x0, y0) => {
    noisePainter('#7a5236', 14, 7)(ctx, x0, y0);
    noisePainter('#f4f8ff', 8, 71)(ctx, x0, y0);
    // re-clear bottom area to dirt so only the top is snowy
    const rand = mulberry32(7);
    for (let y = 4; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        ctx.fillStyle = shade('#7a5236', (rand() - 0.5) * 28);
        ctx.fillRect(x0 + x, y0 + y, 1, 1);
      }
    }
  };
}

// Order must match the tile indices documented in blocks.ts.
const PAINTERS: Painter[] = [
  grassTop(),        // 0
  grassSide(),       // 1
  clumpPainter('#7a5236', 16, 8, 7), // 2 dirt
  clumpPainter('#888888', 14, 7, 17), // 3 stone
  noisePainter('#e6d7a8', 12, 29),    // 4 sand
  logSide(),         // 5 log-top (reuse side-ish; we override below)
  logSide(),         // 6 log side
  leavesPainter(),   // 7
  waterPainter(),    // 8
  planksPainter(),   // 9
  clumpPainter('#7d7d7d', 16, 10, 37), // 10 cobblestone
  noisePainter('#3a3a3a', 8, 43),      // 11 bedrock
  snowSide(),        // 12
  glassPainter(),    // 13
  brickPainter(),    // 14
  glowstonePainter(),// 15
  icePainter(),      // 16
  snowTop(),         // 17
];

// Tile 5 should be a clean log ring top, not the side streaks.
PAINTERS[5] = (ctx, x0, y0) => {
  noisePainter('#9a7a45', 8, 5)(ctx, x0, y0);
  ctx.strokeStyle = '#6e522b';
  ctx.beginPath();
  ctx.arc(x0 + 7.5, y0 + 7.5, 3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x0 + 7.5, y0 + 7.5, 5.5, 0, Math.PI * 2);
  ctx.stroke();
};

/** Paint the atlas onto a fresh canvas and return it (for UI icons). */
export function createAtlasCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_PX;
  canvas.height = ATLAS_PX;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, ATLAS_PX, ATLAS_PX);
  for (let i = 0; i < PAINTERS.length; i++) {
    const tx = i % ATLAS_TILES;
    const ty = Math.floor(i / ATLAS_TILES);
    PAINTERS[i](ctx, tx * TILE, ty * TILE);
  }
  return canvas;
}

export function createAtlasTexture(): THREE.Texture {
  const canvas = createAtlasCanvas();
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Returns [u0, v0, u1, v1] for a given tile index in the atlas. */
export function tileUV(tile: number): [number, number, number, number] {
  const tx = tile % ATLAS_TILES;
  const ty = Math.floor(tile / ATLAS_TILES);
  const s = 1 / ATLAS_TILES;
  // Flip V because canvas top-left vs texture bottom-left.
  const u0 = tx * s;
  const u1 = (tx + 1) * s;
  const v1 = 1 - ty * s;
  const v0 = 1 - (ty + 1) * s;
  return [u0, v0, u1, v1];
}
