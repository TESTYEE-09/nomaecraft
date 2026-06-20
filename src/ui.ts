// Lightweight DOM UI: crosshair, hotbar, mining progress, inventory panel,
// instruction overlay, and a small debug readout. No framework — plain
// elements created and styled in code.

import { BLOCKS, Block } from './blocks';
import { ATLAS_TILES, HOTBAR_SIZE, INVENTORY_SIZE, MAX_STACK } from './constants';
import { Inventory, type ItemStack } from './inventory';
import { matchRecipe, consumeForRecipe } from './recipes';

export const CRAFT_GRID_SIZE = 9;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style: Partial<CSSStyleDeclaration>,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node.style, style);
  if (text !== undefined) node.textContent = text;
  return node;
}

export interface UI {
  setSelected: (i: number) => void;
  setDebug: (text: string) => void;
  setMiningProgress: (p: number | null) => void;
  renderInventory: (inv: Inventory) => void;
  openInventory: (inv: Inventory) => void;
  openCrafting: (inv: Inventory, craftGrid: Array<ItemStack | null>) => void;
  closeInventory: () => void;
  isInventoryOpen: () => boolean;
  onInventoryChange: (cb: () => void) => void;
}

/** Render a single block icon (top face) clipped from the atlas. */
function blockIcon(block: Block, atlas: HTMLCanvasElement, size: number): HTMLCanvasElement {
  const def = BLOCKS[block];
  const tile = def.tiles[0]; // top face
  const tx = tile % ATLAS_TILES;
  const ty = Math.floor(tile / ATLAS_TILES);
  const tilePx = 16;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(atlas, tx * tilePx, ty * tilePx, tilePx, tilePx, 0, 0, size, size);
  return c;
}

/** A single inventory/hotbar slot: icon + optional count badge. */
function makeSlot(size: number): { root: HTMLElement; setStack: (stack: ItemStack | null, atlas: HTMLCanvasElement) => void } {
  const root = el('div', {
    width: `${size}px`,
    height: `${size}px`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(255,255,255,0.08)',
    border: '2px solid rgba(255,255,255,0.15)',
    borderRadius: '4px',
    boxSizing: 'border-box',
    position: 'relative',
    cursor: 'pointer',
  });
  let icon: HTMLCanvasElement | null = null;
  const count = el('div', {
    position: 'absolute',
    bottom: '1px',
    right: '3px',
    fontSize: '11px',
    fontWeight: 'bold',
    textShadow: '1px 1px 0 #000',
    display: 'none',
  });
  root.appendChild(count);
  return {
    root,
    setStack(stack, atlas) {
      if (icon) { icon.remove(); icon = null; }
      if (stack) {
        icon = blockIcon(stack.block, atlas, size - 8);
        icon.style.imageRendering = 'pixelated';
        root.insertBefore(icon, count);
        count.textContent = stack.count > 1 ? String(stack.count) : '';
        count.style.display = stack.count > 1 ? 'block' : 'none';
      } else {
        count.style.display = 'none';
      }
    },
  };
}

export function createUI(atlas: HTMLCanvasElement): UI {
  const root = el('div', {
    position: 'fixed',
    inset: '0',
    pointerEvents: 'none',
    fontFamily: 'monospace',
    color: '#fff',
    zIndex: '10',
  });

  // Crosshair
  const cross = el('div', {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: '22px',
    height: '22px',
    transform: 'translate(-50%, -50%)',
    opacity: '0.85',
    mixBlendMode: 'difference',
  });
  cross.innerHTML =
    '<div style="position:absolute;left:50%;top:0;width:2px;height:100%;background:#fff;transform:translateX(-50%);"></div>' +
    '<div style="position:absolute;top:50%;left:0;height:2px;width:100%;background:#fff;transform:translateY(-50%);"></div>';
  root.appendChild(cross);

  // Mining progress bar, just under the crosshair.
  const miningBar = el('div', {
    position: 'absolute',
    left: '50%',
    top: '56%',
    width: '80px',
    height: '6px',
    transform: 'translateX(-50%)',
    background: 'rgba(255,255,255,0.15)',
    border: '1px solid rgba(255,255,255,0.4)',
    borderRadius: '3px',
    overflow: 'hidden',
    display: 'none',
  });
  const miningFill = el('div', { height: '100%', width: '0%', background: '#fff' });
  miningBar.appendChild(miningFill);
  root.appendChild(miningBar);

  // Hotbar (always visible, mirrors inventory slots 0..HOTBAR_SIZE-1).
  const hotbar = el('div', {
    position: 'absolute',
    left: '50%',
    bottom: '18px',
    transform: 'translateX(-50%)',
    display: 'flex',
    gap: '4px',
    padding: '4px',
    background: 'rgba(0,0,0,0.45)',
    borderRadius: '8px',
    border: '2px solid rgba(255,255,255,0.25)',
  });
  const hotbarSlots: ReturnType<typeof makeSlot>[] = [];
  for (let i = 0; i < HOTBAR_SIZE; i++) {
    const slot = makeSlot(44);
    const num = el('div', { position: 'absolute', top: '1px', left: '3px', fontSize: '10px', opacity: '0.7' }, String(i + 1));
    slot.root.appendChild(num);
    hotbarSlots.push(slot);
    hotbar.appendChild(slot.root);
  }
  root.appendChild(hotbar);

  // Debug readout (top-left)
  const debug = el('div', {
    position: 'absolute',
    left: '10px',
    top: '10px',
    fontSize: '12px',
    lineHeight: '1.4',
    background: 'rgba(0,0,0,0.4)',
    padding: '6px 8px',
    borderRadius: '4px',
    whiteSpace: 'pre',
    display: 'none',
  });
  root.appendChild(debug);

  // ---- Inventory panel (toggled with E) ------------------------------------
  const panel = el('div', {
    position: 'fixed',
    inset: '0',
    background: 'rgba(0,0,0,0.55)',
    display: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'auto',
    zIndex: '20',
  });
  const card = el('div', {
    background: 'rgba(20,20,24,0.95)',
    border: '2px solid rgba(255,255,255,0.25)',
    borderRadius: '10px',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    alignItems: 'center',
  });
  const title = el('div', { fontSize: '16px', opacity: '0.85' }, 'INVENTORY');
  card.appendChild(title);

  // Personal 2x2 crafting grid — always available, no table needed. This is
  // how basic recipes (and the table recipe itself) get bootstrapped; the
  // 3x3 table grid below is for bigger recipes only.
  const PERSONAL_SLOTS = [0, 1, 3, 4]; // top-left 2x2 of a 3x3 grid
  const personalGrid: Array<ItemStack | null> = new Array(9).fill(null);
  const personalRow = el('div', { display: 'flex', alignItems: 'center', gap: '12px' });
  const personalGridEl = el('div', {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 44px)',
    gap: '4px',
  });
  const personalSlots: ReturnType<typeof makeSlot>[] = [];
  for (const idx of PERSONAL_SLOTS) {
    const slot = makeSlot(44);
    personalSlots.push(slot);
    personalGridEl.appendChild(slot.root);
    slot.root.addEventListener('click', () => {
      leftClickSlot(personalGrid, idx);
      renderAll();
      changeCb?.();
    });
    slot.root.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      rightClickSlot(personalGrid, idx);
      renderAll();
      changeCb?.();
    });
  }
  personalRow.appendChild(personalGridEl);
  personalRow.appendChild(el('div', { fontSize: '20px', opacity: '0.7' }, '→'));
  const personalOutputSlot = makeSlot(44);
  personalRow.appendChild(personalOutputSlot.root);
  personalOutputSlot.root.addEventListener('click', () => {
    if (held) return;
    const result = matchRecipe(personalGrid);
    if (!result) return;
    consumeForRecipe(personalGrid);
    held = result;
    renderAll();
    changeCb?.();
  });
  card.appendChild(el('div', { fontSize: '13px', opacity: '0.85' }, 'CRAFT'));
  card.appendChild(personalRow);

  // Crafting area (3x3 grid + arrow + output), only shown near a table.
  const craftSection = el('div', {
    display: 'none',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
  });
  const craftRow = el('div', { display: 'flex', alignItems: 'center', gap: '12px' });
  const craftGridEl = el('div', {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 44px)',
    gap: '4px',
  });
  const craftGridSlots: ReturnType<typeof makeSlot>[] = [];
  for (let i = 0; i < CRAFT_GRID_SIZE; i++) {
    const slot = makeSlot(44);
    craftGridSlots.push(slot);
    craftGridEl.appendChild(slot.root);
  }
  craftRow.appendChild(craftGridEl);
  craftRow.appendChild(el('div', { fontSize: '20px', opacity: '0.7' }, '→'));
  const craftOutputSlot = makeSlot(44);
  craftRow.appendChild(craftOutputSlot.root);
  craftSection.appendChild(el('div', { fontSize: '13px', opacity: '0.85' }, 'CRAFTING TABLE'));
  craftSection.appendChild(craftRow);
  card.insertBefore(craftSection, title.nextSibling);

  const grid = el('div', {
    display: 'grid',
    gridTemplateColumns: 'repeat(9, 44px)',
    gap: '4px',
  });
  const panelMainSlots: ReturnType<typeof makeSlot>[] = [];
  for (let i = HOTBAR_SIZE; i < INVENTORY_SIZE; i++) {
    const slot = makeSlot(44);
    panelMainSlots.push(slot);
    grid.appendChild(slot.root);
  }
  card.appendChild(grid);

  const panelHotbar = el('div', {
    display: 'grid',
    gridTemplateColumns: 'repeat(9, 44px)',
    gap: '4px',
  });
  const panelHotbarSlots: ReturnType<typeof makeSlot>[] = [];
  for (let i = 0; i < HOTBAR_SIZE; i++) {
    const slot = makeSlot(44);
    panelHotbarSlots.push(slot);
    panelHotbar.appendChild(slot.root);
  }
  card.appendChild(panelHotbar);

  const hint = el('div', { fontSize: '11px', opacity: '0.6' }, 'Left-click: pick up/place/stack a whole slot. Right-click: move one item at a time. E to close.');
  card.appendChild(hint);

  panel.appendChild(card);
  root.appendChild(panel);

  // Floating held-stack icon that follows the cursor while the panel is open.
  const heldIcon = el('div', {
    position: 'fixed',
    width: '40px',
    height: '40px',
    pointerEvents: 'none',
    zIndex: '21',
    display: 'none',
  });
  document.body.appendChild(heldIcon);

  document.body.appendChild(root);

  let currentInventory: Inventory | null = null;
  let currentCraftGrid: Array<ItemStack | null> | null = null;
  let held: ItemStack | null = null;
  let isOpen = false;
  let changeCb: (() => void) | null = null;

  function renderAll(): void {
    if (!currentInventory) return;
    const inv = currentInventory;
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      hotbarSlots[i].setStack(inv.slots[i], atlas);
      panelHotbarSlots[i].setStack(inv.slots[i], atlas);
    }
    for (let i = HOTBAR_SIZE; i < INVENTORY_SIZE; i++) {
      panelMainSlots[i - HOTBAR_SIZE].setStack(inv.slots[i], atlas);
    }
    if (currentCraftGrid) {
      for (let i = 0; i < CRAFT_GRID_SIZE; i++) craftGridSlots[i].setStack(currentCraftGrid[i], atlas);
      craftOutputSlot.setStack(matchRecipe(currentCraftGrid), atlas);
    }
    PERSONAL_SLOTS.forEach((idx, i) => personalSlots[i].setStack(personalGrid[idx], atlas));
    personalOutputSlot.setStack(matchRecipe(personalGrid), atlas);
    heldIcon.innerHTML = '';
    if (held) {
      heldIcon.style.display = 'block';
      const icon = blockIcon(held.block, atlas, 32);
      icon.style.imageRendering = 'pixelated';
      heldIcon.appendChild(icon);
    } else {
      heldIcon.style.display = 'none';
    }
  }

  // Left click: pick up/place a whole stack, or merge onto a matching stack
  // (capped at MAX_STACK). Right click: pick up/place one item at a time.
  function leftClickSlot(arr: Array<ItemStack | null>, index: number): void {
    const cur = arr[index];
    if (!held) {
      arr[index] = null;
      held = cur;
    } else if (!cur) {
      arr[index] = held;
      held = null;
    } else if (cur.block === held.block) {
      const space = MAX_STACK - cur.count;
      const move = Math.min(space, held.count);
      cur.count += move;
      held.count -= move;
      if (held.count <= 0) held = null;
    } else {
      arr[index] = held;
      held = cur;
    }
  }

  function rightClickSlot(arr: Array<ItemStack | null>, index: number): void {
    const cur = arr[index];
    if (!held) {
      if (!cur) return;
      const take = Math.ceil(cur.count / 2);
      held = { block: cur.block, count: take };
      cur.count -= take;
      if (cur.count <= 0) arr[index] = null;
    } else {
      if (!cur) {
        arr[index] = { block: held.block, count: 1 };
        held.count--;
      } else if (cur.block === held.block && cur.count < MAX_STACK) {
        cur.count++;
        held.count--;
      } else {
        return;
      }
      if (held.count <= 0) held = null;
    }
  }

  function bindSlotInteract(slot: ReturnType<typeof makeSlot>, getArr: () => Array<ItemStack | null> | null, index: number): void {
    slot.root.addEventListener('click', () => {
      const arr = getArr();
      if (!arr) return;
      leftClickSlot(arr, index);
      renderAll();
      changeCb?.();
    });
    slot.root.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const arr = getArr();
      if (!arr) return;
      rightClickSlot(arr, index);
      renderAll();
      changeCb?.();
    });
  }
  for (let i = 0; i < HOTBAR_SIZE; i++) {
    bindSlotInteract(hotbarSlots[i], () => currentInventory?.slots ?? null, i);
    bindSlotInteract(panelHotbarSlots[i], () => currentInventory?.slots ?? null, i);
  }
  for (let i = HOTBAR_SIZE; i < INVENTORY_SIZE; i++) {
    bindSlotInteract(panelMainSlots[i - HOTBAR_SIZE], () => currentInventory?.slots ?? null, i);
  }
  craftGridSlots.forEach((slot, i) => {
    bindSlotInteract(slot, () => currentCraftGrid, i);
  });
  craftOutputSlot.root.addEventListener('click', () => {
    if (!currentCraftGrid || held) return;
    const result = matchRecipe(currentCraftGrid);
    if (!result) return;
    consumeForRecipe(currentCraftGrid);
    held = result;
    renderAll();
    changeCb?.();
  });

  document.addEventListener('mousemove', (e) => {
    heldIcon.style.left = `${e.clientX + 8}px`;
    heldIcon.style.top = `${e.clientY + 8}px`;
  });

  return {
    setSelected(i) {
      hotbarSlots.forEach((s, idx) => {
        s.root.style.border = idx === i ? '2px solid #fff' : '2px solid rgba(255,255,255,0.15)';
        s.root.style.background = idx === i ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.08)';
      });
    },
    setDebug(text) {
      debug.textContent = text;
      debug.style.display = text ? 'block' : 'none';
    },
    setMiningProgress(p) {
      if (p === null) {
        miningBar.style.display = 'none';
      } else {
        miningBar.style.display = 'block';
        miningFill.style.width = `${Math.max(0, Math.min(1, p)) * 100}%`;
      }
    },
    renderInventory(inv) {
      currentInventory = inv;
      renderAll();
    },
    openInventory(inv) {
      currentInventory = inv;
      currentCraftGrid = null;
      craftSection.style.display = 'none';
      isOpen = true;
      panel.style.display = 'flex';
      renderAll();
    },
    openCrafting(inv, craftGrid) {
      currentInventory = inv;
      currentCraftGrid = craftGrid;
      craftSection.style.display = 'flex';
      isOpen = true;
      panel.style.display = 'flex';
      renderAll();
    },
    closeInventory() {
      isOpen = false;
      panel.style.display = 'none';
      // Drop anything still held or sitting in the craft grid back into the
      // inventory rather than losing it.
      if (currentInventory) {
        if (held) {
          for (let i = 0; i < held.count; i++) currentInventory.add(held.block);
          held = null;
        }
        if (currentCraftGrid) {
          for (const s of currentCraftGrid) {
            if (s) for (let i = 0; i < s.count; i++) currentInventory.add(s.block);
          }
          currentCraftGrid.fill(null);
        }
        for (const s of personalGrid) {
          if (s) for (let i = 0; i < s.count; i++) currentInventory.add(s.block);
        }
        personalGrid.fill(null);
        renderAll();
        changeCb?.();
      }
      currentCraftGrid = null;
    },
    isInventoryOpen() {
      return isOpen;
    },
    onInventoryChange(cb) {
      changeCb = cb;
    },
  };
}
