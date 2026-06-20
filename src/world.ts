// World data: chunk storage, terrain generation and block lookups.
// The world is divided into CHUNK_SIZE columns. Chunks are generated lazily
// from deterministic noise so terrain is stable across reloads.

import { Block } from './blocks';
import { fbm2D, valueNoise2D } from './noise';
import { CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from './constants';

export const WORLD_SEED = 1337;

const enum Biome {
  Plains,
  Desert,
  Snow,
}

function biomeAt(wx: number, wz: number): { biome: Biome; moisture: number } {
  // Two slow noise channels carve out biome regions.
  const temp = fbm2D(wx * 0.0045, wz * 0.0045, WORLD_SEED + 9001, 3);
  const moist = fbm2D(wx * 0.006, wz * 0.006, WORLD_SEED + 4242, 3);
  let biome = Biome.Plains;
  if (temp < 0.32) biome = Biome.Snow;
  else if (temp > 0.62 && moist < 0.45) biome = Biome.Desert;
  return { biome, moisture: moist };
}

/** Surface height (top solid block y) at a world x,z. */
function heightAt(wx: number, wz: number): number {
  // Large rolling hills + medium detail + small bumps.
  const base = fbm2D(wx * 0.012, wz * 0.012, WORLD_SEED, 4, 1, 0.5, 2); // [0,1)
  const hills = fbm2D(wx * 0.04, wz * 0.04, WORLD_SEED + 555, 3); // [0,1)
  let h = SEA_LEVEL + (base - 0.5) * 26 + (hills - 0.5) * 6;
  return Math.max(1, Math.min(WORLD_HEIGHT - 6, Math.floor(h)));
}

function stoneDepth(wx: number, wz: number): number {
  // 3-5 blocks of dirt below the surface, stone underneath.
  return 3 + Math.floor(fbm2D(wx * 0.07, wz * 0.07, WORLD_SEED + 13, 2) * 3);
}

/** Sparse, deterministic tree planter — same coords => same trees. */
function treeAt(wx: number, wz: number): boolean {
  // Use a coarse hash so trees are spaced out roughly every few chunks.
  const r = valueNoise2D(wx * 0.9 + 0.13, wz * 0.9 + 0.27, WORLD_SEED + 777);
  // Sub-sample on a jittered grid to avoid adjacent trees.
  const cell = 4;
  const cx = Math.floor(wx / cell);
  const cz = Math.floor(wz / cell);
  const jx = valueNoise2D(cx * 12.9898, cz * 78.233, WORLD_SEED + 5);
  const jz = valueNoise2D(cx * 39.346, cz * 11.135, WORLD_SEED + 6);
  const ox = Math.floor(jx * cell);
  const oz = Math.floor(jz * cell);
  const lx = ((wx % cell) + cell) % cell;
  const lz = ((wz % cell) + cell) % cell;
  if (lx !== ox || lz !== oz) return false;
  return r > 0.86;
}

export class Chunk {
  /** Flat Uint8Array of CHUNK_SIZE*WORLD_HEIGHT*CHUNK_SIZE block ids. */
  readonly data: Uint8Array;
  /** Set to true once terrain has been filled in. */
  generated = false;

  constructor() {
    this.data = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT);
  }

  static index(lx: number, y: number, lz: number): number {
    return (y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx;
  }

  getLocal(lx: number, y: number, lz: number): Block {
    if (y < 0 || y >= WORLD_HEIGHT) return Block.Air;
    return this.data[Chunk.index(lx, y, lz)] as Block;
  }

  setLocal(lx: number, y: number, lz: number, b: Block): void {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    this.data[Chunk.index(lx, y, lz)] = b;
  }
}

export class World {
  readonly chunks = new Map<string, Chunk>();
  /** Blocks the player has edited, keyed "x,y,z" -> block id. */
  private edits = new Map<string, Block>();

  key(cx: number, cz: number): string {
    return cx + ',' + cz;
  }

  getChunk(cx: number, cz: number): Chunk | undefined {
    return this.chunks.get(this.key(cx, cz));
  }

  ensureChunk(cx: number, cz: number): Chunk {
    const k = this.key(cx, cz);
    let c = this.chunks.get(k);
    if (!c) {
      c = new Chunk();
      this.chunks.set(k, c);
    }
    if (!c.generated) {
      this.generate(c, cx, cz);
      // Replay any player edits that fall in this chunk.
      for (const [ek, ev] of this.edits) {
        const [ex, ey, ez] = ek.split(',').map(Number);
        if (Math.floor(ex / CHUNK_SIZE) === cx && Math.floor(ez / CHUNK_SIZE) === cz) {
          c.setLocal(ex - cx * CHUNK_SIZE, ey, ez - cz * CHUNK_SIZE, ev);
        }
      }
    }
    return c;
  }

  /** World-coordinate block getter that generates neighbour chunks lazily. */
  getBlock(x: number, y: number, z: number): Block {
    if (y < 0 || y >= WORLD_HEIGHT) return Block.Air;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const chunk = this.ensureChunk(cx, cz);
    const lx = x - cx * CHUNK_SIZE;
    const lz = z - cz * CHUNK_SIZE;
    return chunk.getLocal(lx, y, lz);
  }

  /** Persistent edit: writes through to the chunk and remembers it. */
  setBlock(x: number, y: number, z: number, b: Block): void {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const chunk = this.ensureChunk(cx, cz);
    const lx = x - cx * CHUNK_SIZE;
    const lz = z - cz * CHUNK_SIZE;
    chunk.setLocal(lx, y, lz, b);
    this.edits.set(x + ',' + y + ',' + z, b);
  }

  /** All player edits, for saving. Procedural terrain is regenerated from the seed, not stored. */
  exportEdits(): Array<[string, Block]> {
    return [...this.edits.entries()];
  }

  /** Restore edits before any chunks are generated, so they replay correctly. */
  importEdits(data: Array<[string, Block]>): void {
    this.edits = new Map(data);
  }

  private generate(chunk: Chunk, cx: number, cz: number): void {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = cx * CHUNK_SIZE + lx;
        const wz = cz * CHUNK_SIZE + lz;
        const h = heightAt(wx, wz);
        const { biome } = biomeAt(wx, wz);
        const dirtDepth = stoneDepth(wx, wz);
        for (let y = 0; y <= h; y++) {
          let b: Block = Block.Stone;
          if (y === 0) {
            b = Block.Bedrock;
          } else if (y === h) {
            if (biome === Biome.Desert || h <= SEA_LEVEL + 1) b = Block.Sand;
            else if (biome === Biome.Snow) b = Block.Snow;
            else b = Block.Grass;
          } else if (y >= h - dirtDepth) {
            b = biome === Biome.Desert ? Block.Sand : Block.Dirt;
          } else {
            b = this.oreAt(wx, y, wz);
          }
          chunk.setLocal(lx, y, lz, b);
        }
        // Fill water up to sea level.
        if (h < SEA_LEVEL) {
          for (let y = h + 1; y <= SEA_LEVEL; y++) {
            chunk.setLocal(lx, y, lz, Block.Water);
          }
        }
        // Trees only on land grass above water, not in deserts.
        if (
          biome === Biome.Plains &&
          h > SEA_LEVEL + 1 &&
          chunk.getLocal(lx, h, lz) === Block.Grass &&
          treeAt(wx, wz)
        ) {
          this.placeTree(chunk, lx, h + 1, lz);
        }
      }
    }
    chunk.generated = true;
  }

  private oreAt(wx: number, y: number, wz: number): Block {
    // Rare coal/iron veins via thresholded noise; mostly stone.
    const n = fbm2D(wx * 0.1, wz * 0.1, WORLD_SEED + y * 0.017, 2);
    if (y < 14 && n > 0.78) return Block.Cobblestone; // deep "ore" pocket (cobble stand-in)
    return Block.Stone;
  }

  private placeTree(chunk: Chunk, lx: number, baseY: number, lz: number): void {
    const trunk = 4 + (valueNoise2D(lx * 3.1, lz * 7.7, WORLD_SEED) > 0.5 ? 1 : 0);
    const top = baseY + trunk;
    // Trunk
    for (let y = baseY; y < top; y++) {
      if (this.inLocal(lx) && this.inLocal(lz)) chunk.setLocal(lx, y, lz, Block.Wood);
    }
    // Leaf canopy: two layers wide, then narrowing.
    const layers: Array<{ dy: number; r: number }> = [
      { dy: -1, r: 2 },
      { dy: 0, r: 2 },
      { dy: 1, r: 1 },
      { dy: 2, r: 1 },
    ];
    for (const layer of layers) {
      const y = top + layer.dy;
      if (y < 0 || y >= WORLD_HEIGHT) continue;
      for (let dz = -layer.r; dz <= layer.r; dz++) {
        for (let dx = -layer.r; dx <= layer.r; dx++) {
          if (Math.abs(dx) === layer.r && Math.abs(dz) === layer.r && layer.r === 2) continue; // round corners
          if (dx === 0 && dz === 0 && layer.dy <= 0) continue; // keep trunk
          const nx = lx + dx;
          const nz = lz + dz;
          if (!this.inLocal(nx) || !this.inLocal(nz)) continue;
          if (chunk.getLocal(nx, y, nz) === Block.Air) {
            chunk.setLocal(nx, y, nz, Block.Leaves);
          }
        }
      }
    }
  }

  private inLocal(v: number): boolean {
    return v >= 0 && v < CHUNK_SIZE;
  }

  /** Highest non-air, non-water block y at a column, for spawn placement. */
  surfaceY(wx: number, wz: number): number {
    for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
      const b = this.getBlock(wx, y, wz);
      if (b !== Block.Air && b !== Block.Water) return y;
    }
    return SEA_LEVEL;
  }
}
