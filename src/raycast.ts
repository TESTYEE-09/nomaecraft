// Voxel raycasting using the classic Amanatides & Woo DDA algorithm.
// Returns the first solid block hit and the normal of the face entered, so
// the caller can place a block adjacent to it.

import * as THREE from 'three';
import { isSolid, Block } from './blocks';
import type { World } from './world';

export interface RayHit {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
}

const EPS = 1e-9;

/**
 * March a ray from `origin` in `dir` (normalized) up to `maxDist` blocks.
 * Returns the first solid (non-air, non-liquid) voxel, or null.
 */
export function raycastVoxel(
  world: World,
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  maxDist = 6,
): RayHit | null {
  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);

  const stepX = dir.x > 0 ? 1 : dir.x < 0 ? -1 : 0;
  const stepY = dir.y > 0 ? 1 : dir.y < 0 ? -1 : 0;
  const stepZ = dir.z > 0 ? 1 : dir.z < 0 ? -1 : 0;

  const tDeltaX = stepX !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dir.z) : Infinity;

  // Distance to the first voxel boundary along each axis.
  const nextBoundary = (o: number, s: number, cell: number): number => {
    if (s > 0) return cell + 1 - o;
    if (s < 0) return o - cell;
    return Infinity;
  };
  let tMaxX = stepX !== 0 ? nextBoundary(origin.x, stepX, x) * tDeltaX : Infinity;
  let tMaxY = stepY !== 0 ? nextBoundary(origin.y, stepY, y) * tDeltaY : Infinity;
  let tMaxZ = stepZ !== 0 ? nextBoundary(origin.z, stepZ, z) * tDeltaZ : Infinity;

  let nx = 0, ny = 0, nz = 0;
  let dist = 0;

  while (dist <= maxDist) {
    const b = world.getBlock(x, y, z);
    if (isSolid(b as Block)) {
      return { x, y, z, nx, ny, nz };
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX;
      dist = tMaxX;
      tMaxX += tDeltaX;
      nx = -stepX; ny = 0; nz = 0;
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      dist = tMaxY;
      tMaxY += tDeltaY;
      nx = 0; ny = -stepY; nz = 0;
    } else {
      z += stepZ;
      dist = tMaxZ;
      tMaxZ += tDeltaZ;
      nx = 0; ny = 0; nz = -stepZ;
    }
  }
  void EPS;
  return null;
}
