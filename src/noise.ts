// Deterministic 2D value-noise with fractal Brownian motion (fBm).
// Value noise is cheap, artifact-free for terrain, and seedable — good enough
// for a voxel sandbox without pulling in a noise library.

function hash2(ix: number, iz: number, seed: number): number {
  let h = (ix * 374761393 + iz * 668265263 + seed * 2147483647) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177) | 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296; // [0,1)
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Single-octave 2D value noise, returns [0,1). */
export function valueNoise2D(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const xf = x - x0;
  const zf = z - z0;
  const v00 = hash2(x0, z0, seed);
  const v10 = hash2(x0 + 1, z0, seed);
  const v01 = hash2(x0, z0 + 1, seed);
  const v11 = hash2(x0 + 1, z0 + 1, seed);
  const u = smooth(xf);
  const v = smooth(zf);
  return lerp(lerp(v00, v10, u), lerp(v01, v11, u), v);
}

/** Fractal sum of value noise. Returns roughly [0,1). */
export function fbm2D(
  x: number,
  z: number,
  seed: number,
  octaves = 4,
  frequency = 1,
  persistence = 0.5,
  lacunarity = 2,
): number {
  let amp = 1;
  let freq = frequency;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise2D(x * freq, z * freq, seed + o * 1013);
    norm += amp;
    amp *= persistence;
    freq *= lacunarity;
  }
  return sum / norm;
}
