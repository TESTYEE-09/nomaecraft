// World constants shared across modules.

/** Number of blocks along each axis inside a single chunk. */
export const CHUNK_SIZE = 16;
/** Number of chunks generated around the player on each axis (half-extent). */
export const RENDER_DISTANCE = 6;
/** Height of the world in blocks (top y is one less than this). */
export const WORLD_HEIGHT = 64;
/** Sea level: blocks at or below this y are considered underwater terrain. */
export const SEA_LEVEL = 24;

/** Fixed grid size of the texture atlas in tiles (NxN). */
export const ATLAS_TILES = 16;
/** Voxel size in world units. */
export const BLOCK = 1;
/** Player AABB half-extents (player ~0.6 wide, ~1.8 tall). */
export const PLAYER_RADIUS = 0.3;
export const PLAYER_HEIGHT = 1.8;
/** Physics tuning. */
export const GRAVITY = 28; // blocks/s^2
export const JUMP_SPEED = 8.4; // gives ~1.25 block jump
export const WALK_SPEED = 4.7; // blocks/s
export const SPRINT_SPEED = 7.0; // blocks/s
export const FLY_SPEED = 9.0; // blocks/s (creative fly)
export const TERMINAL_VELOCITY = 55; // max fall speed

/** Inventory layout: 9 hotbar slots + 27 backpack slots. */
export const HOTBAR_SIZE = 9;
export const INVENTORY_SIZE = 36;
export const MAX_STACK = 64;
