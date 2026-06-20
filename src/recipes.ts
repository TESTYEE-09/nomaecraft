// Crafting recipes for the 3x3 table grid. Recipes are either shaped
// (the pattern must match, trimmed to its bounding box) or shapeless
// (only the multiset of ingredients matters).

import { Block } from './blocks';
import type { ItemStack } from './inventory';

export interface Recipe {
  /** Rows top-to-bottom; letters map via `key`, spaces are empty cells. */
  pattern: string[];
  key: Record<string, Block>;
  result: ItemStack;
  /** If true, ingredient position/shape doesn't matter — only counts do. */
  shapeless?: boolean;
}

export const RECIPES: Recipe[] = [
  {
    pattern: ['W'],
    key: { W: Block.Wood },
    result: { block: Block.Planks, count: 4 },
    shapeless: true,
  },
  {
    pattern: ['PP', 'PP'],
    key: { P: Block.Planks },
    result: { block: Block.CraftingTable, count: 1 },
  },
  {
    pattern: ['S'],
    key: { S: Block.Sand },
    result: { block: Block.Glass, count: 1 },
    shapeless: true,
  },
];

type Cell = Block | null;

interface CompiledRecipe {
  shapeless: boolean;
  result: ItemStack;
  shape: Cell[][];
  counts: Map<Block, number>;
}

function compile(r: Recipe): CompiledRecipe {
  const shape = r.pattern.map((row) => [...row].map((ch) => (ch === ' ' ? null : r.key[ch] ?? null)));
  const counts = new Map<Block, number>();
  for (const row of shape) {
    for (const b of row) {
      if (b === null) continue;
      counts.set(b, (counts.get(b) ?? 0) + 1);
    }
  }
  return { shapeless: !!r.shapeless, result: r.result, shape, counts };
}

const COMPILED = RECIPES.map(compile);

function gridToCells(grid: Array<ItemStack | null>): Cell[][] {
  const cells: Cell[][] = [[null, null, null], [null, null, null], [null, null, null]];
  for (let i = 0; i < 9 && i < grid.length; i++) {
    cells[Math.floor(i / 3)][i % 3] = grid[i] ? grid[i]!.block : null;
  }
  return cells;
}

function trim(cells: Cell[][]): Cell[][] {
  let top = 0, bottom = cells.length - 1, left = 0, right = cells[0].length - 1;
  const rowEmpty = (r: number) => cells[r].every((c) => c === null);
  const colEmpty = (c: number) => cells.every((row) => row[c] === null);
  while (top <= bottom && rowEmpty(top)) top++;
  while (bottom >= top && rowEmpty(bottom)) bottom--;
  if (top > bottom) return [];
  while (left <= right && colEmpty(left)) left++;
  while (right >= left && colEmpty(right)) right--;
  const out: Cell[][] = [];
  for (let r = top; r <= bottom; r++) out.push(cells[r].slice(left, right + 1));
  return out;
}

function shapesEqual(a: Cell[][], b: Cell[][]): boolean {
  if (a.length !== b.length) return false;
  for (let r = 0; r < a.length; r++) {
    if (a[r].length !== b[r].length) return false;
    for (let c = 0; c < a[r].length; c++) if (a[r][c] !== b[r][c]) return false;
  }
  return true;
}

/** Match the crafting grid against known recipes, returning the result (or null). */
export function matchRecipe(grid: Array<ItemStack | null>): ItemStack | null {
  const trimmed = trim(gridToCells(grid));
  if (trimmed.length === 0) return null;

  const counts = new Map<Block, number>();
  for (const stack of grid) {
    if (!stack) continue;
    counts.set(stack.block, (counts.get(stack.block) ?? 0) + 1);
  }

  for (const cr of COMPILED) {
    if (cr.shapeless) {
      if (cr.counts.size !== counts.size) continue;
      let ok = true;
      for (const [b, n] of cr.counts) if (counts.get(b) !== n) { ok = false; break; }
      if (ok) return { ...cr.result };
    } else if (shapesEqual(trimmed, cr.shape)) {
      return { ...cr.result };
    }
  }
  return null;
}

/** Consume one ingredient from every occupied grid slot (all current recipes need 1 per cell). */
export function consumeForRecipe(grid: Array<ItemStack | null>): void {
  for (let i = 0; i < 9 && i < grid.length; i++) {
    const s = grid[i];
    if (!s) continue;
    s.count--;
    if (s.count <= 0) grid[i] = null;
  }
}
