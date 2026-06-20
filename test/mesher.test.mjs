// Smoke test: generate a small world and confirm the mesher emits triangles.
// Run with: node --experimental-vm-modules test/mesher.test.mjs
// This doesn't need WebGL — it validates the data path (world -> mesh buffers).

import { buildChunkMesh } from '../src/mesher.ts';
import { World } from '../src/world.ts';
import { CHUNK_SIZE } from '../src/constants.ts';
import { Block } from '../src/blocks.ts';

let failures = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failures++; }
  else console.log('ok  :', msg);
}

const world = new World();

// Force generation around origin.
const chunk = world.ensureChunk(0, 0);
assert(chunk.generated, 'chunk (0,0) generates');

// There should be at least one solid block in a freshly generated chunk.
let solidCount = 0;
for (let y = 0; y < 64; y++)
  for (let z = 0; z < CHUNK_SIZE; z++)
    for (let x = 0; x < CHUNK_SIZE; x++)
      if (chunk.getLocal(x, y, z) !== Block.Air) solidCount++;
assert(solidCount > 0, `chunk has solid blocks (${solidCount})`);

// Build the mesh and its neighbours (needed for cross-chunk culling/AO).
world.ensureChunk(1, 0); world.ensureChunk(-1, 0);
world.ensureChunk(0, 1); world.ensureChunk(0, -1);
const buf = buildChunkMesh(world, 0, 0);
assert(buf.solid !== null, 'mesher emits a solid vertex buffer');
assert(buf.solidIndex !== null, 'mesher emits a solid index buffer');
assert(buf.solid.length % 9 === 0, `solid verts aligned to 9-float stride (${buf.solid.length})`);
assert(buf.solidIndex.length % 6 === 0, `solid indices are whole quads (${buf.solidIndex.length})`);
assert(buf.solidIndex.length >= 6, `mesher emits at least one triangle (${buf.solidIndex.length / 6} quads)`);

// Index values must reference existing vertices.
const vertexCount = buf.solid.length / 9;
let maxIdx = 0;
for (let i = 0; i < buf.solidIndex.length; i++) maxIdx = Math.max(maxIdx, buf.solidIndex[i]);
assert(maxIdx < vertexCount, `indices in range (max ${maxIdx} < ${vertexCount} vertices)`);

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
