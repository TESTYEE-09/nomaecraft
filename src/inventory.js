import { ITEMS, RECIPES } from './items.js';

export class Inventory {
  constructor(size = 36) {
    this.size = size;
    this.slots = new Array(size).fill(null); // {id, count}
    this.selected = 0; // hotbar index 0..8
  }

  selectedItem() { return this.slots[this.selected]; }

  add(id, count = 1) {
    const max = ITEMS[id]?.max ?? 64;
    // stack into existing
    for (let i = 0; i < this.size; i++) {
      const s = this.slots[i];
      if (s && s.id === id && s.count < max) {
        const add = Math.min(count, max - s.count);
        s.count += add; count -= add;
        if (count <= 0) return 0;
      }
    }
    // new slots (hotbar first then main)
    for (let i = 0; i < this.size; i++) {
      if (!this.slots[i]) {
        const add = Math.min(count, max);
        this.slots[i] = { id, count: add }; count -= add;
        if (count <= 0) return 0;
      }
    }
    return count; // leftover (no room)
  }

  removeSelected(n = 1) {
    const s = this.slots[this.selected];
    if (!s) return;
    s.count -= n;
    if (s.count <= 0) this.slots[this.selected] = null;
  }

  count(id) {
    let c = 0;
    for (const s of this.slots) if (s && s.id === id) c += s.count;
    return c;
  }

  serialize() { return this.slots.map(s => s ? [s.id, s.count] : null); }
  load(arr) { if (arr) this.slots = arr.map(s => s ? { id: s[0], count: s[1] } : null); }
}

// Crafting: grid is an array of length 4 (2x2) or 9 (3x3) of item ids or null.
export function matchRecipe(grid, size /* 2 or 3 */) {
  for (const r of RECIPES) {
    if (r.type === 'shapeless') {
      const need = [...r.ingredients];
      const have = grid.filter(Boolean);
      if (have.length !== need.length) continue;
      const pool = [...have];
      let ok = true;
      for (const n of need) {
        const i = pool.indexOf(n);
        if (i === -1) { ok = false; break; }
        pool.splice(i, 1);
      }
      if (ok) return { out: r.out, count: r.count };
    } else {
      // shaped: try all offsets so a 2x2 recipe fits in a 3x3 grid
      if (tryShaped(r, grid, size)) return { out: r.out, count: r.count };
    }
  }
  return null;
}

function tryShaped(r, grid, size) {
  // trim recipe pattern to bounding box
  const pat = r.pattern; // 3 rows of 3
  let minR = 3, maxR = -1, minC = 3, maxC = -1;
  for (let rr = 0; rr < 3; rr++) for (let cc = 0; cc < 3; cc++) {
    if (pat[rr][cc] !== ' ') { minR = Math.min(minR, rr); maxR = Math.max(maxR, rr); minC = Math.min(minC, cc); maxC = Math.max(maxC, cc); }
  }
  if (maxR < 0) return false;
  const ph = maxR - minR + 1, pw = maxC - minC + 1;
  if (ph > size || pw > size) return false;
  for (let oy = 0; oy + ph <= size; oy++) {
    for (let ox = 0; ox + pw <= size; ox++) {
      if (matchesAt(r, grid, size, ox, oy, minR, minC, ph, pw)) return true;
    }
  }
  return false;
}

function matchesAt(r, grid, size, ox, oy, minR, minC, ph, pw) {
  for (let gy = 0; gy < size; gy++) {
    for (let gx = 0; gx < size; gx++) {
      const cell = grid[gy * size + gx] || null;
      const inPat = gy >= oy && gy < oy + ph && gx >= ox && gx < ox + pw;
      let want = null;
      if (inPat) {
        const pc = r.pattern[minR + (gy - oy)][minC + (gx - ox)];
        want = pc === ' ' ? null : r.keymap[pc];
      }
      if (want !== cell) return false;
    }
  }
  return true;
}
