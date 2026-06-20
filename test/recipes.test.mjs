// Smoke test for crafting recipe matching (shaped + shapeless).
// Run with: node --experimental-vm-modules test/recipes.test.mjs (via esbuild bundle)

import { matchRecipe, consumeForRecipe } from '../src/recipes.ts';
import { Block } from '../src/blocks.ts';

let failures = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failures++; }
  else console.log('ok  :', msg);
}

function grid(map) {
  const g = new Array(9).fill(null);
  for (const [i, block, count] of map) g[i] = { block, count: count ?? 1 };
  return g;
}

// Shapeless: a single Wood anywhere -> 4 Planks.
{
  const g = grid([[4, Block.Wood]]);
  const r = matchRecipe(g);
  assert(r && r.block === Block.Planks && r.count === 4, 'wood -> 4 planks (shapeless, off-center)');
}

// Shaped: 2x2 planks anywhere in the 3x3 -> crafting table.
{
  const g = grid([[0, Block.Planks], [1, Block.Planks], [3, Block.Planks], [4, Block.Planks]]);
  const r = matchRecipe(g);
  assert(r && r.block === Block.CraftingTable && r.count === 1, '2x2 planks (top-left) -> crafting table');
}
{
  // Same shape, shifted to bottom-right of the 3x3.
  const g = grid([[4, Block.Planks], [5, Block.Planks], [7, Block.Planks], [8, Block.Planks]]);
  const r = matchRecipe(g);
  assert(r && r.block === Block.CraftingTable, '2x2 planks (bottom-right) -> crafting table');
}
{
  // Wrong shape: planks in an L, not a 2x2 square.
  const g = grid([[0, Block.Planks], [1, Block.Planks], [2, Block.Planks]]);
  const r = matchRecipe(g);
  assert(r === null, 'planks in a row (not 2x2) does not match crafting table recipe');
}

// Shapeless: sand -> glass.
{
  const g = grid([[8, Block.Sand]]);
  const r = matchRecipe(g);
  assert(r && r.block === Block.Glass, 'sand -> glass (shapeless)');
}

// Empty grid -> no match.
{
  assert(matchRecipe(new Array(9).fill(null)) === null, 'empty grid has no recipe');
}

// Mixed ingredients that match no recipe.
{
  const g = grid([[0, Block.Stone], [1, Block.Dirt]]);
  assert(matchRecipe(g) === null, 'unrelated ingredients have no recipe');
}

// consumeForRecipe decrements/clears occupied cells.
{
  const g = grid([[0, Block.Planks, 2], [1, Block.Planks, 1]]);
  consumeForRecipe(g);
  assert(g[0] && g[0].count === 1, 'consume leaves count-1 in a stack with count 2');
  assert(g[1] === null, 'consume clears a stack that hits 0');
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
