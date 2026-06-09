import { ITEMS, RECIPES, Recipe } from "./Items";

export interface Slot {
  id: string;
  count: number;
  dura?: number;
  ammo?: number;
}

export class Inventory {
  size: number;
  slots: (Slot | null)[];
  selected = 0;

  constructor(size = 36) {
    this.size = size;
    this.slots = new Array(size).fill(null);
  }

  selectedItem(): Slot | null {
    return this.slots[this.selected];
  }

  add(id: string, count = 1): number {
    const max = ITEMS[id]?.max ?? 64;
    for (let i = 0; i < this.size; i++) {
      const s = this.slots[i];
      if (s && s.id === id && s.count < max) {
        const add = Math.min(count, max - s.count);
        s.count += add;
        count -= add;
        if (count <= 0) return 0;
      }
    }
    for (let i = 0; i < this.size; i++) {
      if (!this.slots[i]) {
        const add = Math.min(count, max);
        this.slots[i] = { id, count: add };
        count -= add;
        if (count <= 0) return 0;
      }
    }
    return count;
  }

  removeSelected(n = 1) {
    const s = this.slots[this.selected];
    if (!s) return;
    s.count -= n;
    if (s.count <= 0) this.slots[this.selected] = null;
  }

  count(id: string): number {
    let c = 0;
    for (const s of this.slots) if (s && s.id === id) c += s.count;
    return c;
  }

  serialize(): (
    | [string, number]
    | [string, number, number | undefined]
    | [string, number, number | undefined, number]
    | null
  )[] {
    return this.slots.map((s) => {
      if (!s) return null;
      const t: [string, number, number?, number?] = [s.id, s.count];
      if (s.dura !== undefined) t.push(s.dura);
      if (s.ammo !== undefined) {
        if (t.length < 3) t.push(undefined);
        t.push(s.ammo);
      }
      return t as any;
    });
  }

  load(arr: any[]) {
    if (!arr) return;
    this.slots = arr.map((s: any) => {
      if (!s) return null;
      const o: Slot = { id: s[0], count: s[1] };
      if (s[2] != null) o.dura = s[2];
      if (s[3] != null) o.ammo = s[3];
      return o;
    });
  }
}

export interface CraftResult {
  out: string;
  count: number;
  consume: string[];
}

export function matchRecipe(
  grid: (string | null)[],
  size: number
): CraftResult | null {
  for (const r of RECIPES) {
    if (r.type === "shapeless") {
      const have = grid.filter(Boolean) as string[];
      const need: Record<string, number> = Object.create(null);
      for (const id of r.ingredients!) need[id] = (need[id] ?? 0) + 1;
      if (have.length !== r.ingredients!.length) continue;
      const counts: Record<string, number> = Object.create(null);
      for (const id of have) counts[id] = (counts[id] ?? 0) + 1;
      let ok = true;
      for (const id in need) {
        if ((counts[id] ?? 0) !== need[id]) {
          ok = false;
          break;
        }
      }
      if (ok) {
        const consume: string[] = [];
        for (const id in need)
          for (let k = 0; k < need[id]; k++) consume.push(id);
        return { out: r.out, count: r.count, consume };
      }
    } else {
      const consume = tryShapedConsume(r, grid, size);
      if (consume) return { out: r.out, count: r.count, consume };
    }
  }
  return null;
}

function tryShapedConsume(
  r: Recipe,
  grid: (string | null)[],
  size: number
): string[] | null {
  const pat = r.pattern!;
  let minR = 3,
    maxR = -1,
    minC = 3,
    maxC = -1;
  for (let rr = 0; rr < 3; rr++)
    for (let cc = 0; cc < 3; cc++) {
      if (pat[rr][cc] !== " ") {
        minR = Math.min(minR, rr);
        maxR = Math.max(maxR, rr);
        minC = Math.min(minC, cc);
        maxC = Math.max(maxC, cc);
      }
    }
  if (maxR < 0) return null;
  const ph = maxR - minR + 1,
    pw = maxC - minC + 1;
  if (ph > size || pw > size) return null;
  for (let oy = 0; oy + ph <= size; oy++) {
    for (let ox = 0; ox + pw <= size; ox++) {
      const consume = matchesAt(r, grid, size, ox, oy, minR, minC, ph, pw);
      if (consume) return consume;
    }
  }
  return null;
}

function matchesAt(
  r: Recipe,
  grid: (string | null)[],
  size: number,
  ox: number,
  oy: number,
  minR: number,
  minC: number,
  ph: number,
  pw: number
): string[] | null {
  const consume: string[] = [];
  for (let gy = 0; gy < size; gy++) {
    for (let gx = 0; gx < size; gx++) {
      const cell = grid[gy * size + gx] || null;
      const inPat = gy >= oy && gy < oy + ph && gx >= ox && gx < ox + pw;
      let want: string | null = null;
      if (inPat) {
        const pc = r.pattern![minR + (gy - oy)][minC + (gx - ox)];
        want = pc === " " ? null : r.keymap![pc];
      }
      if (want !== cell) return null;
      if (want) consume.push(want);
    }
  }
  return consume;
}
