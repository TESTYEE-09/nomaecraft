// Survival-style inventory: blocks are earned by mining and spent by placing.
// Slots 0..HOTBAR_SIZE-1 are the hotbar; the rest is backpack storage.

import { Block } from './blocks';
import { INVENTORY_SIZE, MAX_STACK } from './constants';

export interface ItemStack {
  block: Block;
  count: number;
}

export class Inventory {
  slots: Array<ItemStack | null> = new Array(INVENTORY_SIZE).fill(null);

  /** Add one block, stacking onto an existing slot before using an empty one. */
  add(block: Block): boolean {
    for (const s of this.slots) {
      if (s && s.block === block && s.count < MAX_STACK) {
        s.count++;
        return true;
      }
    }
    const empty = this.slots.indexOf(null);
    if (empty === -1) return false;
    this.slots[empty] = { block, count: 1 };
    return true;
  }

  /** Remove one block from a slot, clearing it once empty. */
  removeOne(index: number): Block | null {
    const s = this.slots[index];
    if (!s) return null;
    const block = s.block;
    s.count--;
    if (s.count <= 0) this.slots[index] = null;
    return block;
  }

  /** Swap a slot's contents with a held stack (click-to-swap UI). */
  swap(index: number, held: ItemStack | null): ItemStack | null {
    const prev = this.slots[index];
    this.slots[index] = held;
    return prev;
  }
}
