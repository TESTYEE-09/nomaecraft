import { Slot, matchRecipe } from "./Inventory";
import { Player } from "./Player";
import { ITEMS, getItemIcon } from "./Items";

export class InventoryUI {
  private craftSlots: (Slot | null)[] = new Array(9).fill(null);
  private draggedSlot: Slot | null = null;

  constructor(private player: Player, private onUpdate: () => void) {
    this.initListeners();
  }

  private initListeners() {
    // Mouse movement to drag items visually
    document.addEventListener("mousemove", (e) => {
      const dragEl = document.getElementById("drag-item");
      if (dragEl && this.draggedSlot) {
        dragEl.style.left = `${e.clientX + 10}px`;
        dragEl.style.top = `${e.clientY + 10}px`;
      }
    });

    // Close inventory on ESC or E (handled in Player.ts, but let's clear dragging state on close)
    const invPanel = document.getElementById("inventory-panel");
    if (invPanel) {
      const observer = new MutationObserver(() => {
        if (invPanel.style.display === "none") {
          this.returnDraggedItems();
        } else {
          this.render();
        }
      });
      observer.observe(invPanel, { attributes: true, attributeFilter: ["style"] });
    }
  }

  private returnDraggedItems() {
    if (this.draggedSlot) {
      // Put dragged item back to player inventory
      this.player.inventory.add(this.draggedSlot.id, this.draggedSlot.count);
      this.draggedSlot = null;
      this.updateDragElement();
      this.onUpdate();
    }
  }

  render() {
    this.renderInventory();
    this.renderHotbar();
    this.renderCrafting();
    this.updateDragElement();
  }

  private renderInventory() {
    const grid = document.getElementById("inv-grid");
    if (!grid) return;
    grid.innerHTML = "";

    // Slots 9 to 35
    for (let i = 9; i < 36; i++) {
      const slotEl = this.createSlotElement(this.player.inventory.slots[i], (e, isRight) => {
        this.handleSlotClick(i, "inventory", isRight);
      });
      grid.appendChild(slotEl);
    }
  }

  private renderHotbar() {
    const grid = document.getElementById("inv-hotbar");
    if (!grid) return;
    grid.innerHTML = "";

    // Slots 0 to 8
    for (let i = 0; i < 9; i++) {
      const slotEl = this.createSlotElement(this.player.inventory.slots[i], (e, isRight) => {
        this.handleSlotClick(i, "inventory", isRight);
      });
      grid.appendChild(slotEl);
    }
  }

  private renderCrafting() {
    const grid = document.getElementById("craft-grid");
    if (!grid) return;
    grid.innerHTML = "";

    // 3x3 crafting grid
    for (let i = 0; i < 9; i++) {
      const slotEl = this.createSlotElement(this.craftSlots[i], (e, isRight) => {
        this.handleSlotClick(i, "craft", isRight);
      });
      slotEl.className = "craft-slot";
      grid.appendChild(slotEl);
    }

    // Crafting result slot
    const resultGrid = document.getElementById("craft-result");
    if (!resultGrid) return;
    resultGrid.innerHTML = "";

    // match recipe uses grid IDs (strings)
    const recipeGrid = this.craftSlots.map((s) => s?.id ?? null);
    const result = matchRecipe(recipeGrid, 3);

    if (result) {
      const resultSlot: Slot = { id: result.out, count: result.count };
      const slotEl = this.createSlotElement(resultSlot, (e, isRight) => {
        if (isRight) return; // Right click on result is ignored
        this.handleCraftResultClick(resultSlot);
      });
      resultGrid.appendChild(slotEl);
    }
  }

  private createSlotElement(slot: Slot | null, onClick: (e: MouseEvent, isRight: boolean) => void): HTMLElement {
    const slotEl = document.createElement("div");
    slotEl.className = "inv-slot";

    if (slot) {
      const icon = document.createElement("div");
      icon.className = "slot-icon";
      icon.style.backgroundImage = `url('${getItemIcon(slot.id)}')`;
      slotEl.appendChild(icon);

      if (slot.count > 1) {
        const count = document.createElement("div");
        count.className = "slot-count";
        count.textContent = String(slot.count);
        slotEl.appendChild(count);
      }
    }

    slotEl.addEventListener("mousedown", (e) => {
      e.preventDefault();
      onClick(e, e.button === 2);
    });

    slotEl.addEventListener("contextmenu", (e) => e.preventDefault());

    return slotEl;
  }

  private handleSlotClick(idx: number, type: "inventory" | "craft", isRight: boolean) {
    const slots = type === "inventory" ? this.player.inventory.slots : this.craftSlots;
    const target = slots[idx];

    if (!isRight) {
      // LEFT CLICK - Swap or place stack
      if (!this.draggedSlot) {
        // Pick up stack
        if (target) {
          this.draggedSlot = target;
          slots[idx] = null;
        }
      } else {
        // Place stack
        if (!target) {
          slots[idx] = this.draggedSlot;
          this.draggedSlot = null;
        } else if (target.id === this.draggedSlot.id) {
          // Merge stacks
          const max = ITEMS[target.id]?.max ?? 64;
          const transfer = Math.min(this.draggedSlot.count, max - target.count);
          target.count += transfer;
          this.draggedSlot.count -= transfer;
          if (this.draggedSlot.count <= 0) {
            this.draggedSlot = null;
          }
        } else {
          // Swap stacks
          slots[idx] = this.draggedSlot;
          this.draggedSlot = target;
        }
      }
    } else {
      // RIGHT CLICK - Pick up half or place single item
      if (!this.draggedSlot) {
        if (target) {
          const half = Math.ceil(target.count / 2);
          this.draggedSlot = { id: target.id, count: half };
          target.count -= half;
          if (target.count <= 0) {
            slots[idx] = null;
          }
        }
      } else {
        // Place single item
        if (!target) {
          slots[idx] = { id: this.draggedSlot.id, count: 1 };
          this.draggedSlot.count -= 1;
        } else if (target.id === this.draggedSlot.id) {
          const max = ITEMS[target.id]?.max ?? 64;
          if (target.count < max) {
            target.count += 1;
            this.draggedSlot.count -= 1;
          }
        }

        if (this.draggedSlot.count <= 0) {
          this.draggedSlot = null;
        }
      }
    }

    this.render();
    this.onUpdate();
  }

  private handleCraftResultClick(resultSlot: Slot) {
    // Determine if we can pick up the item
    if (!this.draggedSlot) {
      this.draggedSlot = { id: resultSlot.id, count: resultSlot.count };
    } else if (this.draggedSlot.id === resultSlot.id) {
      const max = ITEMS[resultSlot.id]?.max ?? 64;
      if (this.draggedSlot.count + resultSlot.count <= max) {
        this.draggedSlot.count += resultSlot.count;
      } else {
        return; // No space in dragged slot
      }
    } else {
      return; // Dragged slot occupied by different item
    }

    // Consume 1 item from each slot in the crafting grid
    for (let i = 0; i < 9; i++) {
      const cs = this.craftSlots[i];
      if (cs) {
        cs.count -= 1;
        if (cs.count <= 0) {
          this.craftSlots[i] = null;
        }
      }
    }

    this.render();
    this.onUpdate();
  }

  private updateDragElement() {
    const dragEl = document.getElementById("drag-item");
    if (!dragEl) return;

    if (this.draggedSlot) {
      dragEl.style.display = "block";
      dragEl.style.backgroundImage = `url('${getItemIcon(this.draggedSlot.id)}')`;
      
      let countEl = dragEl.querySelector(".slot-count") as HTMLElement | null;
      if (this.draggedSlot.count > 1) {
        if (!countEl) {
          countEl = document.createElement("div");
          countEl.className = "slot-count";
          dragEl.appendChild(countEl);
        }
        countEl.textContent = String(this.draggedSlot.count);
      } else if (countEl) {
        countEl.textContent = "";
      }
    } else {
      dragEl.style.display = "none";
      dragEl.style.backgroundImage = "";
    }
  }
}
