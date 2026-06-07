import { BLOCK, blockDefs } from './blocks.js';
import { makeNoise } from './noise.js';

export const CHUNK = 16;
export const HEIGHT = 64;
export const SEA = 24;

const idx = (x, y, z) => (y * CHUNK + z) * CHUNK + x;
const key = (cx, cz) => cx + ',' + cz;

export class World {
  constructor(THREE, atlas, seed = 1337) {
    this.THREE = THREE;
    this.atlas = atlas;
    this.seed = seed;
    this.noise = makeNoise(seed);
    this.treeNoise = makeNoise(seed + 99);
    this.chunks = new Map();     // key -> { data:Uint8Array, cx, cz, mesh, tmesh, dirty }
    this.edits = new Map();      // "x,y,z" -> blockId   (player/multiplayer modifications)
    this.group = new THREE.Group();
    this.dirtyQueue = [];

    // shared materials
    this.opaqueMat = new THREE.MeshLambertMaterial({ map: atlas.texture, vertexColors: true });
    this.transMat = new THREE.MeshLambertMaterial({ map: atlas.texture, vertexColors: true, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
  }

  // ---- terrain generation --------------------------------------------------
  genHeight(x, z) {
    const n = this.noise;
    const cont = n.fbm(x * 0.004, z * 0.004, 4) * 0.5 + 0.5;     // continent shape 0..1
    const hills = n.fbm(x * 0.02, z * 0.02, 4);                  // -1..1
    let h = SEA - 6 + cont * 30 + hills * 6;
    // mountains where continent high
    if (cont > 0.6) h += (cont - 0.6) * 60 * (n.fbm(x * 0.01, z * 0.01, 3) * 0.5 + 0.5);
    return Math.max(2, Math.min(HEIGHT - 6, Math.floor(h)));
  }

  biomeTop(h, x, z) {
    if (h <= SEA + 1) return BLOCK.SAND;
    if (h > SEA + 26) return BLOCK.SNOW;
    return BLOCK.GRASS;
  }

  generateChunk(cx, cz) {
    const data = new Uint8Array(CHUNK * HEIGHT * CHUNK);
    const n = this.noise;
    for (let lx = 0; lx < CHUNK; lx++) {
      for (let lz = 0; lz < CHUNK; lz++) {
        const wx = cx * CHUNK + lx, wz = cz * CHUNK + lz;
        const h = this.genHeight(wx, wz);
        const top = this.biomeTop(h, wx, wz);
        for (let y = 0; y <= Math.max(h, SEA); y++) {
          let b = BLOCK.AIR;
          if (y === 0) b = BLOCK.BEDROCK;
          else if (y < h - 4) {
            b = BLOCK.STONE;
            // ore distribution by depth
            const ore = n.noise2(wx * 0.1 + y * 0.3, wz * 0.1 - y * 0.2);
            if (y < 14 && ore > 0.85) b = BLOCK.DIAMOND_ORE;
            else if (y < 22 && ore > 0.82) b = BLOCK.GOLD_ORE;
            else if (ore > 0.78) b = BLOCK.IRON_ORE;
            else if (ore < -0.8) b = BLOCK.COAL_ORE;
            else if (ore < -0.86) b = BLOCK.GRAVEL;
          } else if (y < h) b = (top === BLOCK.SAND) ? BLOCK.SAND : BLOCK.DIRT;
          else if (y === h) b = top;
          else if (y <= SEA) b = BLOCK.WATER;
          data[idx(lx, y, lz)] = b;
        }
        // trees on grass above sea
        if (top === BLOCK.GRASS && h > SEA + 1) {
          const t = this.treeNoise.noise2(wx * 0.9, wz * 0.9);
          if (t > 0.94 && lx > 1 && lx < CHUNK - 2 && lz > 1 && lz < CHUNK - 2) {
            this.placeTree(data, lx, h + 1, lz);
          }
        }
      }
    }
    return data;
  }

  placeTree(data, x, y, z) {
    const trunk = 4 + ((this.treeNoise.noise2(x * 3, z * 3) + 1) * 1.5 | 0);
    for (let i = 0; i < trunk; i++) if (y + i < HEIGHT) data[idx(x, y + i, z)] = BLOCK.WOOD;
    const cy = y + trunk - 1;
    for (let dy = -2; dy <= 1; dy++) {
      const r = dy <= 0 ? 2 : 1;
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (dx === 0 && dz === 0 && dy < 1) continue;
        const xx = x + dx, yy = cy + dy, zz = z + dz;
        if (xx < 0 || xx >= CHUNK || zz < 0 || zz >= CHUNK || yy < 0 || yy >= HEIGHT) continue;
        if (Math.abs(dx) === r && Math.abs(dz) === r && Math.random() > 0.5) continue;
        if (data[idx(xx, yy, zz)] === BLOCK.AIR) data[idx(xx, yy, zz)] = BLOCK.LEAVES;
      }
    }
  }

  getChunk(cx, cz, create = true) {
    const k = key(cx, cz);
    let c = this.chunks.get(k);
    if (!c && create) {
      const data = this.generateChunk(cx, cz);
      c = { data, cx, cz, mesh: null, tmesh: null, dirty: true };
      this.chunks.set(k, c);
      // apply any pending edits in this chunk
      for (const [ek, bid] of this.edits) {
        const [ex, ey, ez] = ek.split(',').map(Number);
        if (Math.floor(ex / CHUNK) === cx && Math.floor(ez / CHUNK) === cz) {
          const lx = ((ex % CHUNK) + CHUNK) % CHUNK, lz = ((ez % CHUNK) + CHUNK) % CHUNK;
          if (ey >= 0 && ey < HEIGHT) data[idx(lx, ey, lz)] = bid;
        }
      }
    }
    return c;
  }

  getBlock(x, y, z) {
    y = Math.floor(y);
    if (y < 0 || y >= HEIGHT) return BLOCK.AIR;
    x = Math.floor(x); z = Math.floor(z);
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const c = this.chunks.get(key(cx, cz));
    if (!c) return BLOCK.AIR;
    const lx = ((x % CHUNK) + CHUNK) % CHUNK, lz = ((z % CHUNK) + CHUNK) % CHUNK;
    return c.data[idx(lx, y, lz)];
  }

  // set block locally; record edit; mark neighbor chunks dirty
  setBlock(x, y, z, b, record = true) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (y < 0 || y >= HEIGHT) return;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const c = this.getChunk(cx, cz);
    const lx = ((x % CHUNK) + CHUNK) % CHUNK, lz = ((z % CHUNK) + CHUNK) % CHUNK;
    c.data[idx(lx, y, lz)] = b;
    if (record) this.edits.set(x + ',' + y + ',' + z, b);
    c.dirty = true;
    // dirty neighbors if on border
    if (lx === 0) this.markDirty(cx - 1, cz);
    if (lx === CHUNK - 1) this.markDirty(cx + 1, cz);
    if (lz === 0) this.markDirty(cx, cz - 1);
    if (lz === CHUNK - 1) this.markDirty(cx, cz + 1);
  }

  markDirty(cx, cz) { const c = this.chunks.get(key(cx, cz)); if (c) c.dirty = true; }

  isSolid(x, y, z) {
    const b = this.getBlock(x, y, z);
    const d = blockDefs[b];
    return d ? d.solid : false;
  }

  // ---- meshing -------------------------------------------------------------
  isOpaqueNeighbor(b) {
    if (b === BLOCK.AIR) return false;
    const d = blockDefs[b];
    return d && !d.transparent;
  }

  buildMesh(c) {
    const THREE = this.THREE;
    const { uv, faces } = this.atlas;
    const op = { pos: [], norm: [], uv: [], col: [], idx: [] };
    const tr = { pos: [], norm: [], uv: [], col: [], idx: [] };

    const baseX = c.cx * CHUNK, baseZ = c.cz * CHUNK;
    const faceDefs = [
      { n: [1, 0, 0], v: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]], kind: 'side', sh: 0.8 },
      { n: [-1,0, 0], v: [[0,0,1],[0,1,1],[0,1,0],[0,0,0]], kind: 'side', sh: 0.8 },
      { n: [0, 1, 0], v: [[0,1,0],[0,1,1],[1,1,1],[1,1,0]].map(p=>[p[0],p[1],p[2]]), kind: 'top', sh: 1.0 },
      { n: [0,-1, 0], v: [[0,0,1],[0,0,0],[1,0,0],[1,0,1]], kind: 'bottom', sh: 0.5 },
      { n: [0, 0, 1], v: [[1,0,1],[1,1,1],[0,1,1],[0,0,1]], kind: 'side', sh: 0.9 },
      { n: [0, 0,-1], v: [[0,0,0],[0,1,0],[1,1,0],[1,0,0]], kind: 'side', sh: 0.7 },
    ];

    for (let y = 0; y < HEIGHT; y++) {
      for (let lz = 0; lz < CHUNK; lz++) {
        for (let lx = 0; lx < CHUNK; lx++) {
          const b = c.data[idx(lx, y, lz)];
          if (b === BLOCK.AIR) continue;
          const def = blockDefs[b];
          const transparent = def.transparent;
          const wx = baseX + lx, wz = baseZ + lz;
          const fmap = faces[b];
          for (const fd of faceDefs) {
            const nx = wx + fd.n[0], ny = y + fd.n[1], nz = wz + fd.n[2];
            const nb = this.getBlock(nx, ny, nz);
            // cull rule: skip face if neighbor opaque; for transparent blocks also skip between same type (e.g. water/leaves/glass)
            if (this.isOpaqueNeighbor(nb)) continue;
            if (transparent && nb === b && b !== BLOCK.LEAVES) continue;
            const tile = fmap.top !== undefined
              ? (fd.kind === 'top' ? fmap.top : fd.kind === 'bottom' ? fmap.bottom : fmap.side)
              : fmap.all;
            const t = uv(tile);
            const tgt = transparent ? tr : op;
            const start = tgt.pos.length / 3;
            // water surface lowered a touch
            const yTop = (b === BLOCK.WATER && this.getBlock(wx, y + 1, wz) !== BLOCK.WATER) ? 0.85 : 1;
            for (const vtx of fd.v) {
              const vy = vtx[1] === 1 ? yTop : 0;
              tgt.pos.push(wx + vtx[0], y + vy, wz + vtx[2]);
              tgt.norm.push(fd.n[0], fd.n[1], fd.n[2]);
              tgt.col.push(fd.sh, fd.sh, fd.sh);
            }
            tgt.uv.push(t.u0, t.v0, t.u0, t.v1, t.u1, t.v1, t.u1, t.v0);
            tgt.idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
          }
        }
      }
    }

    const make = (d, mat) => {
      if (d.pos.length === 0) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(d.norm, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(d.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(d.col, 3));
      g.setIndex(d.idx);
      const m = new THREE.Mesh(g, mat);
      m.frustumCulled = true;
      return m;
    };

    if (c.mesh) { this.group.remove(c.mesh); c.mesh.geometry.dispose(); }
    if (c.tmesh) { this.group.remove(c.tmesh); c.tmesh.geometry.dispose(); }
    c.mesh = make(op, this.opaqueMat);
    c.tmesh = make(tr, this.transMat);
    if (c.mesh) this.group.add(c.mesh);
    if (c.tmesh) this.group.add(c.tmesh);
    c.dirty = false;
  }

  // ensure chunks within radius of (px,pz) exist; rebuild dirty ones (budgeted)
  update(px, pz, radius) {
    const ccx = Math.floor(px / CHUNK), ccz = Math.floor(pz / CHUNK);
    // generate ring (closest first)
    const need = [];
    for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
      const d2 = dx * dx + dz * dz;
      if (d2 > (radius + 0.5) * (radius + 0.5)) continue;
      need.push([ccx + dx, ccz + dz, d2]);
    }
    need.sort((a, b) => a[2] - b[2]);
    let gen = 0;
    for (const [cx, cz] of need) {
      if (!this.chunks.has(key(cx, cz))) { this.getChunk(cx, cz); gen++; if (gen >= 2) break; }
    }
    // rebuild a few dirty chunks per frame
    let built = 0;
    for (const [cx, cz] of need) {
      const c = this.chunks.get(key(cx, cz));
      if (c && c.dirty) { this.buildMesh(c); if (++built >= 3) break; }
    }
    // unload far chunks
    for (const [k, c] of this.chunks) {
      if (Math.abs(c.cx - ccx) > radius + 2 || Math.abs(c.cz - ccz) > radius + 2) {
        if (c.mesh) { this.group.remove(c.mesh); c.mesh.geometry.dispose(); }
        if (c.tmesh) { this.group.remove(c.tmesh); c.tmesh.geometry.dispose(); }
        this.chunks.delete(k);
      }
    }
  }

  // raycast voxel grid (DDA). Returns {hit:{x,y,z}, place:{x,y,z}, block} or null
  raycast(origin, dir, maxDist = 6) {
    let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
    const stepX = Math.sign(dir.x), stepY = Math.sign(dir.y), stepZ = Math.sign(dir.z);
    const tDX = Math.abs(1 / dir.x), tDY = Math.abs(1 / dir.y), tDZ = Math.abs(1 / dir.z);
    let tMX = (stepX > 0 ? (x + 1 - origin.x) : (origin.x - x)) * tDX;
    let tMY = (stepY > 0 ? (y + 1 - origin.y) : (origin.y - y)) * tDY;
    let tMZ = (stepZ > 0 ? (z + 1 - origin.z) : (origin.z - z)) * tDZ;
    let face = [0, 0, 0];
    let t = 0;
    while (t <= maxDist) {
      const b = this.getBlock(x, y, z);
      if (b !== BLOCK.AIR && blockDefs[b] && blockDefs[b].solid !== undefined) {
        const d = blockDefs[b];
        if (d.solid || d.tool !== undefined && !d.liquid && b !== BLOCK.WATER) {
          if (b !== BLOCK.WATER) {
            return { hit: { x, y, z }, place: { x: x + face[0], y: y + face[1], z: z + face[2] }, block: b };
          }
        }
      }
      if (tMX < tMY && tMX < tMZ) { x += stepX; t = tMX; tMX += tDX; face = [-stepX, 0, 0]; }
      else if (tMY < tMZ) { y += stepY; t = tMY; tMY += tDY; face = [0, -stepY, 0]; }
      else { z += stepZ; t = tMZ; tMZ += tDZ; face = [0, 0, -stepZ]; }
    }
    return null;
  }
}
