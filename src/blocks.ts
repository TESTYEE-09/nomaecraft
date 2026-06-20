// Block type registry. Each block id maps to per-face texture tiles in the atlas.
// Air is 0 by convention; everything else is solid unless flagged otherwise.

export const enum Block {
  Air = 0,
  Grass,
  Dirt,
  Stone,
  Sand,
  Wood, // log
  Leaves,
  Water,
  Planks,
  Cobblestone,
  Bedrock,
  Snow,
  Glass,
  Brick,
  Glowstone,
  Ice,
  CraftingTable,
}

export interface BlockDef {
  id: Block;
  name: string;
  /** [top, side, bottom] tile indices in the atlas. */
  tiles: [number, number, number];
  /** Transparent blocks don't cull neighbours and render in the alpha pass. */
  transparent?: boolean;
  /** Liquids have no collision and use a slightly lowered top surface. */
  liquid?: boolean;
  /** Emits light (used for the simple block-light bake). */
  light?: number;
  /** Cross out neighbour faces that are the same transparent type (glass/ice). */
  selfCull?: boolean;
  /** Seconds of holding break to mine this block. Infinity = unbreakable. */
  hardness: number;
}

// Atlas tile layout (see textures.ts for what each tile looks like).
// 0 grass-top, 1 grass-side, 2 dirt, 3 stone, 4 sand, 5 log-top, 6 log-side,
// 7 leaves, 8 water, 9 planks, 10 cobblestone, 11 bedrock, 12 snow-side,
// 13 glass, 14 brick, 15 glowstone, 16 ice, 17 snow-top, 18 crafting-table-top,
// 19 crafting-table-side
export const BLOCKS: Record<number, BlockDef> = {
  [Block.Air]: { id: Block.Air, name: 'air', tiles: [0, 0, 0], hardness: 0 },
  [Block.Grass]: { id: Block.Grass, name: 'grass', tiles: [0, 1, 2], hardness: 0.5 },
  [Block.Dirt]: { id: Block.Dirt, name: 'dirt', tiles: [2, 2, 2], hardness: 0.5 },
  [Block.Stone]: { id: Block.Stone, name: 'stone', tiles: [3, 3, 3], hardness: 1.2 },
  [Block.Sand]: { id: Block.Sand, name: 'sand', tiles: [4, 4, 4], hardness: 0.4 },
  [Block.Wood]: { id: Block.Wood, name: 'wood', tiles: [5, 6, 5], hardness: 0.9 },
  [Block.Leaves]: { id: Block.Leaves, name: 'leaves', tiles: [7, 7, 7], transparent: true, selfCull: true, hardness: 0.3 },
  [Block.Water]: { id: Block.Water, name: 'water', tiles: [8, 8, 8], transparent: true, liquid: true, hardness: Infinity },
  [Block.Planks]: { id: Block.Planks, name: 'planks', tiles: [9, 9, 9], hardness: 0.8 },
  [Block.Cobblestone]: { id: Block.Cobblestone, name: 'cobblestone', tiles: [10, 10, 10], hardness: 1.4 },
  [Block.Bedrock]: { id: Block.Bedrock, name: 'bedrock', tiles: [11, 11, 11], hardness: Infinity },
  [Block.Snow]: { id: Block.Snow, name: 'snow', tiles: [17, 12, 2], hardness: 0.3 },
  [Block.Glass]: { id: Block.Glass, name: 'glass', tiles: [13, 13, 13], transparent: true, selfCull: true, hardness: 0.3 },
  [Block.Brick]: { id: Block.Brick, name: 'brick', tiles: [14, 14, 14], hardness: 1.3 },
  [Block.Glowstone]: { id: Block.Glowstone, name: 'glowstone', tiles: [15, 15, 15], light: 15, hardness: 0.6 },
  [Block.Ice]: { id: Block.Ice, name: 'ice', tiles: [16, 16, 16], transparent: true, selfCull: true, hardness: 0.5 },
  [Block.CraftingTable]: { id: Block.CraftingTable, name: 'crafting table', tiles: [18, 19, 9], hardness: 1.0 },
};

export function isSolid(id: Block): boolean {
  if (id === Block.Air) return false;
  const def = BLOCKS[id];
  return !def?.liquid;
}

export function isOpaque(id: Block): boolean {
  if (id === Block.Air) return false;
  return !BLOCKS[id]?.transparent;
}
