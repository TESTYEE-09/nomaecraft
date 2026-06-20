// ChunkManager builds and tracks Three.js meshes for every chunk within render
// distance of the player, disposing far chunks to keep memory bounded. Dirty
// chunks (after a block edit) are remeshed on the next update.

import * as THREE from 'three';
import { CHUNK_SIZE, RENDER_DISTANCE } from './constants';
import { buildChunkMesh, buildGeometry, buildTransparentGeometry } from './mesher';
import { createChunkMaterial } from './material';
import type { World } from './world';

interface ChunkMeshes {
  solid?: THREE.Mesh;
  transparent?: THREE.Mesh;
}

export class ChunkManager {
  readonly group = new THREE.Group();
  private meshes = new Map<string, ChunkMeshes>();
  private dirty = new Set<string>();
  private solidMat: THREE.ShaderMaterial;
  private transMat: THREE.ShaderMaterial;

  constructor(
    private world: World,
    map: THREE.Texture,
    fogColor: THREE.Color,
  ) {
    this.solidMat = createChunkMaterial({
      map,
      fogColor,
      fogNear: RENDER_DISTANCE * CHUNK_SIZE * 0.55,
      fogFar: RENDER_DISTANCE * CHUNK_SIZE * 0.95,
    });
    this.transMat = createChunkMaterial({
      map,
      fogColor,
      fogNear: RENDER_DISTANCE * CHUNK_SIZE * 0.55,
      fogFar: RENDER_DISTANCE * CHUNK_SIZE * 0.95,
      transparent: true,
    });
  }

  private key(cx: number, cz: number): string {
    return cx + ',' + cz;
  }

  /** Mark a chunk (and neighbours if the edit was on a border) for remeshing. */
  invalidate(cx: number, cz: number): void {
    this.dirty.add(this.key(cx, cz));
    // Border edits affect adjacent chunk meshes too.
    this.dirty.add(this.key(cx + 1, cz));
    this.dirty.add(this.key(cx - 1, cz));
    this.dirty.add(this.key(cx, cz + 1));
    this.dirty.add(this.key(cx, cz - 1));
  }

  /** Rebuild at most `budget` dirty chunks per call to spread cost over frames. */
  update(px: number, pz: number, budget = 2): void {
    const pcx = Math.floor(px / CHUNK_SIZE);
    const pcz = Math.floor(pz / CHUNK_SIZE);

    // 1) Unload chunks outside render distance.
    for (const [k, meshes] of this.meshes) {
      const [cx, cz] = k.split(',').map(Number);
      if (Math.abs(cx - pcx) > RENDER_DISTANCE + 1 || Math.abs(cz - pcz) > RENDER_DISTANCE + 1) {
        this.disposeMeshes(meshes);
        this.meshes.delete(k);
      }
    }

    // 2) Ensure chunks within render distance exist & are meshed; collect work
    //    sorted by distance to the player (nearest first).
    const work: Array<{ cx: number; cz: number; dist: number }> = [];
    for (let dz = -RENDER_DISTANCE; dz <= RENDER_DISTANCE; dz++) {
      for (let dx = -RENDER_DISTANCE; dx <= RENDER_DISTANCE; dx++) {
        const cx = pcx + dx;
        const cz = pcz + dz;
        const dist = dx * dx + dz * dz;
        if (dist > RENDER_DISTANCE * RENDER_DISTANCE) continue;
        const k = this.key(cx, cz);
        if (!this.meshes.has(k) || this.dirty.has(k)) {
          work.push({ cx, cz, dist });
        }
      }
    }
    work.sort((a, b) => a.dist - b.dist);

    let built = 0;
    for (const w of work) {
      if (built >= budget) break;
      this.buildChunk(w.cx, w.cz);
      this.dirty.delete(this.key(w.cx, w.cz));
      built++;
    }
  }

  private buildChunk(cx: number, cz: number): void {
    const k = this.key(cx, cz);
    // Make sure this chunk and its neighbours are generated (cross-chunk AO).
    this.world.ensureChunk(cx, cz);
    this.world.ensureChunk(cx + 1, cz);
    this.world.ensureChunk(cx - 1, cz);
    this.world.ensureChunk(cx, cz + 1);
    this.world.ensureChunk(cx, cz - 1);

    const old = this.meshes.get(k);
    if (old) this.disposeMeshes(old);

    const buffers = buildChunkMesh(this.world, cx, cz);
    const meshes: ChunkMeshes = {};

    const solidGeo = buildGeometry(buffers);
    if (solidGeo) {
      const m = new THREE.Mesh(solidGeo, this.solidMat);
      m.frustumCulled = true;
      meshes.solid = m;
      this.group.add(m);
    }
    const transGeo = buildTransparentGeometry(buffers);
    if (transGeo) {
      const m = new THREE.Mesh(transGeo, this.transMat);
      m.frustumCulled = true;
      meshes.transparent = m;
      this.group.add(m);
    }
    this.meshes.set(k, meshes);
  }

  private disposeMeshes(meshes: ChunkMeshes): void {
    if (meshes.solid) {
      this.group.remove(meshes.solid);
      meshes.solid.geometry.dispose();
    }
    if (meshes.transparent) {
      this.group.remove(meshes.transparent);
      meshes.transparent.geometry.dispose();
    }
  }

  get solidMaterial(): THREE.ShaderMaterial {
    return this.solidMat;
  }
}
