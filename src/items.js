import { BLOCK, TOOL } from './blocks.js';

// Item registry. Items are either placeable blocks (have `block`) or non-block
// items (materials, tools, food). Icons for non-block items are drawn procedurally.

export const ITEMS = {};

function reg(id, def) { ITEMS[id] = Object.assign({ id, max: 64 }, def); }

// ---- block items ----
const blockItems = [
  ['grass', BLOCK.GRASS], ['dirt', BLOCK.DIRT], ['stone', BLOCK.STONE], ['cobblestone', BLOCK.COBBLESTONE],
  ['sand', BLOCK.SAND], ['wood', BLOCK.WOOD], ['leaves', BLOCK.LEAVES], ['planks', BLOCK.PLANKS],
  ['bedrock', BLOCK.BEDROCK], ['glass', BLOCK.GLASS], ['crafting_table', BLOCK.CRAFTING_TABLE],
  ['snow', BLOCK.SNOW], ['gravel', BLOCK.GRAVEL], ['brick', BLOCK.BRICK], ['torch', BLOCK.TORCH],
  ['coal_ore', BLOCK.COAL_ORE], ['iron_ore', BLOCK.IRON_ORE], ['gold_ore', BLOCK.GOLD_ORE], ['diamond_ore', BLOCK.DIAMOND_ORE],
];
for (const [id, b] of blockItems) reg(id, { name: prettify(id), block: b });

// ---- material items ----
function matIcon(color, shape = 'lump') {
  return (ctx) => {
    ctx.clearRect(0, 0, 32, 32);
    if (shape === 'lump') {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.ellipse(16, 18, 9, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.beginPath(); ctx.ellipse(13, 15, 3, 2, 0, 0, Math.PI * 2); ctx.fill();
    } else if (shape === 'stick') {
      ctx.fillStyle = color; ctx.save(); ctx.translate(16, 16); ctx.rotate(-Math.PI / 4); ctx.fillRect(-2, -10, 4, 20); ctx.restore();
    } else if (shape === 'ingot') {
      ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(8, 22); ctx.lineTo(24, 22); ctx.lineTo(22, 12); ctx.lineTo(10, 12); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(11, 13, 10, 2);
    } else if (shape === 'gem') {
      ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(16, 6); ctx.lineTo(26, 16); ctx.lineTo(16, 26); ctx.lineTo(6, 16); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.moveTo(16, 8); ctx.lineTo(12, 16); ctx.lineTo(16, 14); ctx.closePath(); ctx.fill();
    }
  };
}
reg('coal', { name: 'Coal', draw: matIcon('#1c1c1c', 'lump') });
reg('iron', { name: 'Iron Ingot', draw: matIcon('#d9c4b0', 'ingot') });
reg('gold', { name: 'Gold Ingot', draw: matIcon('#f3d23a', 'ingot') });
reg('diamond', { name: 'Diamond', draw: matIcon('#4fe6dd', 'gem') });
reg('stick', { name: 'Stick', draw: matIcon('#7a5a30', 'stick') });
// String — spider drop. Drawn as a small white tangled loop.
reg('string', { name: 'String', max: 64, draw: (ctx) => {
  ctx.clearRect(0, 0, 32, 32);
  ctx.strokeStyle = '#f0f0f0'; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
  // two interleaving loops
  ctx.beginPath();
  ctx.ellipse(16, 16, 9, 6, 0, 0, Math.PI * 2);
  ctx.ellipse(16, 16, 7, 9, Math.PI / 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#f0f0f0'; ctx.beginPath(); ctx.arc(10, 12, 1.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(22, 18, 1.2, 0, Math.PI * 2); ctx.fill();
}});

// ---- food ----
function appleIcon(ctx) {
  ctx.clearRect(0, 0, 32, 32);
  ctx.fillStyle = '#d33'; ctx.beginPath(); ctx.ellipse(16, 18, 8, 9, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#6a3'; ctx.fillRect(15, 7, 2, 5);
  ctx.fillStyle = '#5a2'; ctx.beginPath(); ctx.ellipse(20, 9, 3, 2, 0.6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.beginPath(); ctx.ellipse(13, 14, 2, 3, 0, 0, Math.PI * 2); ctx.fill();
}
function meatIcon(cooked) {
  return (ctx) => {
    ctx.clearRect(0, 0, 32, 32);
    ctx.fillStyle = cooked ? '#8a5a30' : '#c46'; ctx.beginPath(); ctx.ellipse(16, 17, 9, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#eee'; ctx.fillRect(13, 22, 6, 4);
  };
}
reg('apple', { name: 'Apple', max: 64, draw: appleIcon, food: { hunger: 4, sat: 2.4 } });
reg('raw_meat', { name: 'Raw Meat', max: 64, draw: meatIcon(false), food: { hunger: 2, sat: 0.6 } });
reg('cooked_meat', { name: 'Cooked Meat', max: 64, draw: meatIcon(true), food: { hunger: 8, sat: 6 } });
reg('bread', { name: 'Bread', max: 64, draw: (ctx) => { ctx.clearRect(0,0,32,32); ctx.fillStyle='#c79a4a'; ctx.beginPath(); ctx.ellipse(16,17,10,6,0,0,Math.PI*2); ctx.fill(); ctx.fillStyle='#a87a30'; for(let i=0;i<3;i++)ctx.fillRect(10+i*4,13,1,8); }, food: { hunger: 5, sat: 6 } });

// ---- tools ----
const TIER = { wood: { mult: 2, level: 1, dura: 59, color: '#9a7440' }, stone: { mult: 4, level: 2, dura: 131, color: '#888' }, iron: { mult: 6, level: 3, dura: 250, color: '#d9c4b0' }, gold: { mult: 12, level: 1, dura: 32, color: '#f3d23a' }, diamond: { mult: 8, level: 4, dura: 1561, color: '#4fe6dd' } };

function toolIcon(kind, color) {
  return (ctx) => {
    ctx.clearRect(0, 0, 32, 32);
    // handle
    ctx.strokeStyle = '#6a4a25'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(10, 24); ctx.lineTo(20, 10); ctx.stroke();
    ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 4;
    if (kind === 'pickaxe') { ctx.beginPath(); ctx.moveTo(13, 7); ctx.quadraticCurveTo(20, 5, 27, 9); ctx.stroke(); }
    else if (kind === 'axe') { ctx.beginPath(); ctx.moveTo(19, 6); ctx.lineTo(27, 9); ctx.lineTo(24, 15); ctx.lineTo(18, 11); ctx.closePath(); ctx.fill(); }
    else if (kind === 'shovel') { ctx.beginPath(); ctx.ellipse(22, 8, 5, 6, 0.6, 0, Math.PI * 2); ctx.fill(); }
    else if (kind === 'sword') { ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(11, 25); ctx.lineTo(25, 7); ctx.stroke(); ctx.strokeStyle = '#6a4a25'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(9, 22); ctx.lineTo(15, 27); ctx.stroke(); }
  };
}

for (const tname of ['wood', 'stone', 'iron', 'gold', 'diamond']) {
  const tier = TIER[tname];
  for (const kind of ['pickaxe', 'axe', 'shovel', 'sword']) {
    reg(`${tname}_${kind}`, {
      name: `${prettify(tname)} ${prettify(kind)}`,
      max: 1,
      draw: toolIcon(kind, tier.color),
      tool: { type: kind === 'sword' ? TOOL.SWORD : (kind === 'pickaxe' ? TOOL.PICKAXE : kind === 'axe' ? TOOL.AXE : TOOL.SHOVEL), mult: tier.mult, level: tier.level, dura: tier.dura, attack: kind === 'sword' ? tier.level + 3 : (kind === 'axe' ? tier.level + 2 : 1) },
    });
  }
}

// ---- guns ------------------------------------------------------------------
function gunIcon(ctx) {
  ctx.clearRect(0, 0, 32, 32);
  // body
  ctx.fillStyle = '#3a3a40'; ctx.fillRect(5, 13, 20, 6);
  // barrel
  ctx.fillStyle = '#55555c'; ctx.fillRect(22, 14, 7, 3);
  // grip
  ctx.fillStyle = '#2a2a2e'; ctx.save(); ctx.translate(9, 18); ctx.rotate(0.35); ctx.fillRect(0, 0, 6, 11); ctx.restore();
  // sight + highlight
  ctx.fillStyle = '#1f1f22'; ctx.fillRect(8, 11, 3, 2);
  ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(6, 13, 18, 1);
}
reg('pistol', {
  name: 'Pistol', max: 1, draw: gunIcon,
  gun: { damage: 6, mag: 12, reload: 1.2, fireCD: 0.14, range: 70, spread: 0.012, kb: 4 },
});

function prettify(s) { return s.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' '); }

// ---- crafting recipes ----
// Shaped recipes use a pattern (array of 3 strings, 3 chars each, ' ' = empty) with a key map.
// Shapeless recipes just need the listed ingredients in any arrangement.
export const RECIPES = [];
function shaped(out, count, pattern, keymap) { RECIPES.push({ type: 'shaped', out, count, pattern, keymap }); }
function shapeless(out, count, ingredients) { RECIPES.push({ type: 'shapeless', out, count, ingredients }); }

shapeless('planks', 4, ['wood']);
shapeless('stick', 4, ['planks', 'planks']);
shaped('crafting_table', 1, ['PP ', 'PP ', '   '], { P: 'planks' });
shaped('torch', 4, ['C  ', 'S  ', '   '], { C: 'coal', S: 'stick' });
shaped('glass', 1, ['SS ', 'SS ', '   '], { S: 'sand' }); // (sand "smelting" shortcut)
shaped('brick', 4, ['CC ', 'CC ', '   '], { C: 'cobblestone' });

// tools
for (const tname of ['wood', 'stone', 'iron', 'gold', 'diamond']) {
  const M = tname === 'wood' ? 'planks' : tname === 'stone' ? 'cobblestone' : tname;
  shaped(`${tname}_pickaxe`, 1, ['MMM', ' S ', ' S '], { M, S: 'stick' });
  shaped(`${tname}_axe`, 1, ['MM ', 'MS ', ' S '], { M, S: 'stick' });
  shaped(`${tname}_shovel`, 1, ['M  ', 'S  ', 'S  '], { M, S: 'stick' });
  shaped(`${tname}_sword`, 1, ['M  ', 'M  ', 'S  '], { M, S: 'stick' });
}
shapeless('bread', 1, ['wood']); // placeholder simple food craft from leaves later? keep wood->bread? no
// remove that odd one — replace with apple from leaves grind (fun, simple)
RECIPES.pop();
shapeless('cooked_meat', 1, ['raw_meat', 'coal']); // "cook" meat with coal as fuel

export function itemIcon(id) { return ITEMS[id]; }
