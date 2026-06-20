// Lightweight DOM UI: crosshair, hotbar, instruction overlay, and a small
// debug readout. No framework — plain elements created and styled in code.

import { BLOCKS, Block, HOTBAR } from './blocks';
import { ATLAS_TILES } from './constants';

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
  root: HTMLElement;
  hotbar: HTMLElement;
  slots: HTMLElement[];
  debug: HTMLElement;
  setSelected: (i: number) => void;
  setDebug: (text: string) => void;
  hideOverlay: () => void;
  showOverlay: () => void;
}

/** Render a single block icon (top face) into a slot using an atlas clip. */
function blockIcon(block: Block, atlas: HTMLCanvasElement): HTMLCanvasElement {
  const def = BLOCKS[block];
  const tile = def.tiles[0]; // top face
  const tx = tile % ATLAS_TILES;
  const ty = Math.floor(tile / ATLAS_TILES);
  const tilePx = 16;
  const size = 36;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    atlas,
    tx * tilePx, ty * tilePx, tilePx, tilePx,
    0, 0, size, size,
  );
  return c;
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

  // Hotbar
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
  const slots: HTMLElement[] = [];
  HOTBAR.forEach((block, i) => {
    const slot = el('div', {
      width: '44px',
      height: '44px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(255,255,255,0.08)',
      border: '2px solid rgba(255,255,255,0.15)',
      borderRadius: '4px',
      boxSizing: 'border-box',
      position: 'relative',
    });
    const icon = blockIcon(block, atlas);
    icon.style.imageRendering = 'pixelated';
    slot.appendChild(icon);
    const num = el('div', {
      position: 'absolute',
      top: '1px',
      left: '3px',
      fontSize: '10px',
      opacity: '0.7',
    }, String(i + 1));
    slot.appendChild(num);
    slots.push(slot);
    hotbar.appendChild(slot);
  });
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

  document.body.appendChild(root);

  return {
    root,
    hotbar,
    slots,
    debug,
    setSelected(i) {
      slots.forEach((s, idx) => {
        s.style.border = idx === i ? '2px solid #fff' : '2px solid rgba(255,255,255,0.15)';
        s.style.background = idx === i ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.08)';
      });
    },
    setDebug(text) {
      debug.textContent = text;
      debug.style.display = text ? 'block' : 'none';
    },
    hideOverlay() {},
    showOverlay() {},
  };
}
