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

  // Backward-compatible: 2-tuple [id, count] is the v1 format; 3-tuple
  // [id, count, dura] is the v2 format and preserves tool durability.
  serialize() { return this.slots.map(s => { if (!s) return null; const t = [s.id, s.count]; if (s.dura !== undefined) t.push(s.dura); if (s.ammo !== undefined) { if (t.length < 3) t.push(undefined); t.push(s.ammo); } return t; }); }
  load(arr) { if (arr) this.slots = arr.map(s => { if (!s) return null; const o = { id: s[0], count: s[1] }; if (s[2] !== undefined) o.dura = s[2]; if (s[3] !== undefined) o.ammo = s[3]; return o; }); }
}

// Crafting: grid is an array of length 4 (2x2) or 9 (3x3) of item ids or null.
// matchRecipe() returns either null or { out, count, consume } where consume
// is an array of item-id strings — the *exact* ingredients to remove from
// the grid when the user takes the result. Sum of consume === recipe size.
export function matchRecipe(grid, size /* 2 or 3 */) {
  for (const r of RECIPES) {
    if (r.type === 'shapeless') {
      // Shapeless recipes require an EXACT ingredient match (like vanilla):
      // the grid must contain precisely the listed ingredients and nothing
      // else. The old "extras allowed" rule was a critical bug — putting 4
      // planks in the grid to make a crafting table matched the stick recipe
      // first (2 planks needed, extra planks "allowed"), so you could never
      // craft a table and were blocked from all tools.
      const have = grid.filter(Boolean);
      // Recipe requirement as a multiset.
      const need = Object.create(null);
      for (const id of r.ingredients) need[id] = (need[id] ?? 0) + 1;
      // Fast reject: total item count must equal the recipe's ingredient count.
      if (have.length !== r.ingredients.length) continue;
      // Build a multiset of what the grid actually contains.
      const counts = Object.create(null);
      for (const id of have) counts[id] = (counts[id] ?? 0) + 1;
      // Every id must match exactly (same keys, same counts). Since totals
      // are already equal, checking that each needed id has the right count
      // is sufficient to guarantee no extras of any other id.
      let ok = true;
      for (const id in need) {
        if ((counts[id] ?? 0) !== need[id]) { ok = false; break; }
      }
      if (ok) {
        // Build the consume list (one entry per ingredient, by id) so
        // takeCraft() knows exactly which slots to decrement.
        const consume = [];
        for (const id in need) for (let k = 0; k < need[id]; k++) consume.push(id);
        return { out: r.out, count: r.count, consume };
      }
    } else {
      // shaped: try all offsets so a 2x2 recipe fits in a 3x3 grid
      const consume = tryShapedConsume(r, grid, size);
      if (consume) return { out: r.out, count: r.count, consume };
    }
  }
  return null;
}

// shaped recipe: returns the trimmed pattern as the consume list (one item-id
// string per filled cell), or null if it doesn't fit. We return the pattern
// directly (not slot indices) so it doesn't depend on grid layout.
function tryShapedConsume(r, grid, size) {
  const pat = r.pattern; // 3 rows of 3
  let minR = 3, maxR = -1, minC = 3, maxC = -1;
  for (let rr = 0; rr < 3; rr++) for (let cc = 0; cc < 3; cc++) {
    if (pat[rr][cc] !== ' ') { minR = Math.min(minR, rr); maxR = Math.max(maxR, rr); minC = Math.min(minC, cc); maxC = Math.max(maxC, cc); }
  }
  if (maxR < 0) return null;
  const ph = maxR - minR + 1, pw = maxC - minC + 1;
  if (ph > size || pw > size) return null;
  for (let oy = 0; oy + ph <= size; oy++) {
    for (let ox = 0; ox + pw <= size; ox++) {
      const consume = matchesAt(r, grid, size, ox, oy, minR, minC, ph, pw);
      if (consume) return consume;
    }
  }
  return null;
}

function matchesAt(r, grid, size, ox, oy, minR, minC, ph, pw) {
  const consume = [];
  for (let gy = 0; gy < size; gy++) {
    for (let gx = 0; gx < size; gx++) {
      const cell = grid[gy * size + gx] || null;
      const inPat = gy >= oy && gy < oy + ph && gx >= ox && gx < ox + pw;
      let want = null;
      if (inPat) {
        const pc = r.pattern[minR + (gy - oy)][minC + (gx - ox)];
        want = pc === ' ' ? null : r.keymap[pc];
      }
      if (want !== cell) return null;
      if (want) consume.push(want);
    }
  }
  return consume;
}
