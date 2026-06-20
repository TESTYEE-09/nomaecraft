// Save/load to localStorage. Only player edits are persisted — procedural
// terrain regenerates deterministically from the world seed, so we don't
// need to store whole chunks.

import { Block } from './blocks';
import type { Inventory, ItemStack } from './inventory';
import type { Player } from './player';
import type { World } from './world';

const KEY = 'nomaecraft-save-v1';

interface SaveData {
  edits: Array<[string, Block]>;
  player: { x: number; y: number; z: number; yaw: number; pitch: number };
  inventory: Array<{ block: Block; count: number } | null>;
  time: number;
}

export function saveGame(world: World, player: Player, inventory: Inventory, time: number): void {
  const data: SaveData = {
    edits: world.exportEdits(),
    player: { x: player.position.x, y: player.position.y, z: player.position.z, yaw: player.yaw, pitch: player.pitch },
    inventory: inventory.slots.map((s) => (s ? { block: s.block, count: s.count } : null)),
    time,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch (err) {
    console.warn('[Nomaecraft] Failed to save game:', err);
  }
}

export function loadGame(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SaveData;
  } catch (err) {
    console.warn('[Nomaecraft] Failed to load save:', err);
    return null;
  }
}

export function applySave(data: SaveData, world: World, player: Player, inventory: Inventory): void {
  world.importEdits(data.edits);
  player.position.set(data.player.x, data.player.y, data.player.z);
  player.velocity.set(0, 0, 0);
  player.yaw = data.player.yaw;
  player.pitch = data.player.pitch;
  inventory.slots = data.inventory.map((s): ItemStack | null => (s ? { block: s.block, count: s.count } : null));
}
