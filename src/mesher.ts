// Chunk meshing: converts a chunk's voxel data into an interleaved vertex
// buffer for Three.js, with back-face culling, ambient occlusion and a
// separate transparent pass for water/leaves/glass.
//
// Each vertex packs: position(3) uv(2) normal(3) packedLight(1)
// where packedLight encodes face shade + 4-corner AO into a single byte to
// keep the buffer small and the shader branchless.

import * as THREE from 'three';
import { BLOCKS, Block, isOpaque } from './blocks';
import { CHUNK_SIZE, WORLD_HEIGHT } from './constants';
import { tileUV } from './textures';
import { World } from './world';

// Face definitions: for each of the 6 cube faces, the four corner offsets
// (counter-clockwise when viewed from outside), the normal, and the tangent
// directions used to walk the neighbours for AO.
interface Face {
  normal: [number, number, number];
  corners: Array<[number, number, number]>;
  // The two in-plane axes, used to look up the three neighbour voxels for AO.
  side1: [number, number, number];
  side2: [number, number, number];
  tileFace: 'top' | 'side' | 'bottom';
}

// Each face's four corners are ordered counter-clockwise when viewed from
// outside (i.e. looking along -normal), so FrontSide culling shows them.
// This was verified per-face: cross((c1-c0),(c2-c0)) == +normal.
// side1/side2 are the in-plane axes (with side1 x side2 == +normal) used for AO.
const FACES: Face[] = [
  {
    // +X (east)
    normal: [1, 0, 0],
    corners: [
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
      [1, 0, 1],
    ],
    side1: [0, 1, 0],
    side2: [0, 0, 1],
    tileFace: 'side',
  },
  {
    // -X (west)
    normal: [-1, 0, 0],
    corners: [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
    ],
    side1: [0, 0, 1],
    side2: [0, 1, 0],
    tileFace: 'side',
  },
  {
    // +Y (top)
    normal: [0, 1, 0],
    corners: [
      [0, 1, 0],
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
    ],
    side1: [0, 0, 1],
    side2: [1, 0, 0],
    tileFace: 'top',
  },
  {
    // -Y (bottom)
    normal: [0, -1, 0],
    corners: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
    side1: [1, 0, 0],
    side2: [0, 0, 1],
    tileFace: 'bottom',
  },
  {
    // +Z (south)
    normal: [0, 0, 1],
    corners: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
    side1: [1, 0, 0],
    side2: [0, 1, 0],
    tileFace: 'side',
  },
  {
    // -Z (north)
    normal: [0, 0, -1],
    corners: [
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
      [1, 0, 0],
    ],
    side1: [0, 1, 0],
    side2: [1, 0, 0],
    tileFace: 'side',
  },
];

// Face base shading (top brightest, bottom darkest) for fake directional light.
const FACE_SHADE = [0.82, 0.82, 1.0, 0.55, 0.7, 0.7];

export interface MeshBuffers {
  solid: Float32Array | null;
  solidIndex: Uint32Array | null;
  transparent: Float32Array | null;
  transparentIndex: Uint32Array | null;
}

// AO: 0 = darkest, 3 = brightest. Standard voxel AO from neighbour occupancy.
function aoLevel(side1: boolean, side2: boolean, corner: boolean): number {
  if (side1 && side2) return 0;
  return 3 - (Number(side1) + Number(side2) + Number(corner));
}

function aoShade(level: number): number {
  return [0.5, 0.7, 0.85, 1.0][level];
}

export function buildChunkMesh(world: World, cx: number, cz: number): MeshBuffers {
  const chunk = world.ensureChunk(cx, cz);
  const baseX = cx * CHUNK_SIZE;
  const baseZ = cz * CHUNK_SIZE;

  const solidVerts: number[] = [];
  const solidIdx: number[] = [];
  const transVerts: number[] = [];
  const transIdx: number[] = [];

  // Helper to read world blocks by local->world coords (cross-chunk safe).
  const at = (lx: number, y: number, lz: number): Block => {
    if (lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE) {
      return chunk.getLocal(lx, y, lz);
    }
    return world.getBlock(baseX + lx, y, baseZ + lz);
  };

  for (let y = 0; y < WORLD_HEIGHT; y++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const id = chunk.getLocal(lx, y, lz);
        if (id === Block.Air) continue;
        const def = BLOCKS[id];
        const isTrans = !!def.transparent;

        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          const nb = at(lx + face.normal[0], y + face.normal[1], lz + face.normal[2]);
          // Cull rules:
          //  - solid block face is hidden when neighbour is opaque.
          //  - transparent block face is hidden when neighbour is the same
          //    transparent type (self-cull) or opaque.
          let visible: boolean;
          if (isTrans) {
            if (isOpaque(nb)) visible = false;
            else if (nb === id && def.selfCull) visible = false;
            else if (nb === id) visible = false; // never draw internal water faces
            else visible = true;
          } else {
            visible = !isOpaque(nb);
          }
          if (!visible) continue;

          // Tile for this face.
          const tile = def.tiles[face.tileFace === 'top' ? 0 : face.tileFace === 'side' ? 1 : 2];
          const [u0, v0, u1, v1] = tileUV(tile);

          // AO: sample the 3 neighbours around this face using side axes.
          const nx = lx + face.normal[0];
          const ny = y + face.normal[1];
          const nz = lz + face.normal[2];

          const verts = isTrans ? transVerts : solidVerts;
          const idx = isTrans ? transIdx : solidIdx;
          const start = verts.length / 9;

          // Per-corner ambient occlusion. For each corner we look at the three
          // voxels adjacent to the face that touch that corner: two "edge"
          // neighbours (along side1 and side2) and one "corner" neighbour.
          // We derive their offsets by projecting the corner's offset from the
          // block centre onto the face's two in-plane axes (side1, side2).
          const s1 = face.side1;
          const s2 = face.side2;
          const cornerAO: number[] = [];
          for (let ci = 0; ci < 4; ci++) {
            const c = face.corners[ci];
            // Corner position relative to the block's centre (0.5, 0.5, 0.5).
            const ox = c[0] - 0.5;
            const oy = c[1] - 0.5;
            const oz = c[2] - 0.5;
            // Sign of this corner along each in-plane axis.
            const d1 = Math.sign(ox * s1[0] + oy * s1[1] + oz * s1[2]);
            const d2 = Math.sign(ox * s2[0] + oy * s2[1] + oz * s2[2]);
            const occ = (ex: number, ey: number, ez: number) =>
              isOpaque(at(nx + ex, ny + ey, nz + ez));
            const side1Occ = occ(s1[0] * d1, s1[1] * d1, s1[2] * d1);
            const side2Occ = occ(s2[0] * d2, s2[1] * d2, s2[2] * d2);
            const cornerOcc = occ(
              s1[0] * d1 + s2[0] * d2,
              s1[1] * d1 + s2[1] * d2,
              s1[2] * d1 + s2[2] * d2,
            );
            cornerAO.push(aoShade(aoLevel(side1Occ, side2Occ, cornerOcc)) * FACE_SHADE[f]);
          }

          // UVs per corner: corners 0..3 walk the quad CCW, map them onto the
          // tile rect so the texture is upright and not mirrored.
          const uvMap: Array<[number, number]> = [
            [u0, v1],
            [u0, v0],
            [u1, v0],
            [u1, v1],
          ];

          for (let ci = 0; ci < 4; ci++) {
            const c = face.corners[ci];
            verts.push(c[0] + lx + baseX, c[1] + y, c[2] + lz + baseZ);
            verts.push(uvMap[ci][0], uvMap[ci][1]);
            verts.push(face.normal[0], face.normal[1], face.normal[2]);
            verts.push(cornerAO[ci]);
          }

          // Two triangles for the quad. Flip the shared diagonal based on AO
          // values to avoid the classic anisotropic-interpolation artifact.
          if (cornerAO[0] + cornerAO[2] > cornerAO[1] + cornerAO[3]) {
            idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
          } else {
            idx.push(start + 1, start + 2, start + 3, start + 1, start + 3, start);
          }
        }
      }
    }
  }

  return {
    solid: solidVerts.length ? new Float32Array(solidVerts) : null,
    solidIndex: solidIdx.length ? new Uint32Array(solidIdx) : null,
    transparent: transVerts.length ? new Float32Array(transVerts) : null,
    transparentIndex: transIdx.length ? new Uint32Array(transIdx) : null,
  };
}

function applyInterleaved(geo: THREE.BufferGeometry, data: Float32Array): void {
  const stride = 9; // pos3 uv2 normal3 light1
  const ib = new THREE.InterleavedBuffer(data, stride);
  geo.setAttribute('position', new THREE.InterleavedBufferAttribute(ib, 3, 0));
  geo.setAttribute('uv', new THREE.InterleavedBufferAttribute(ib, 2, 3));
  geo.setAttribute('normal', new THREE.InterleavedBufferAttribute(ib, 3, 5));
  geo.setAttribute('light', new THREE.InterleavedBufferAttribute(ib, 1, 8));
}

/** Creates the shared geometry layout (attributes) used by all chunk meshes. */
export function buildGeometry(buffers: MeshBuffers): THREE.BufferGeometry | null {
  if (!buffers.solid || !buffers.solidIndex) return null;
  const geo = new THREE.BufferGeometry();
  applyInterleaved(geo, buffers.solid);
  geo.setIndex(new THREE.BufferAttribute(buffers.solidIndex, 1));
  return geo;
}

export function buildTransparentGeometry(buffers: MeshBuffers): THREE.BufferGeometry | null {
  if (!buffers.transparent || !buffers.transparentIndex) return null;
  const geo = new THREE.BufferGeometry();
  applyInterleaved(geo, buffers.transparent);
  geo.setIndex(new THREE.BufferAttribute(buffers.transparentIndex, 1));
  return geo;
}
