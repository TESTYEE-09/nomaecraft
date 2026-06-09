// Block definitions and procedural texture atlas generation.
// Every texture is drawn to a canvas so the game ships with zero external assets.

export const BLOCK = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  COBBLESTONE: 4,
  SAND: 5,
  WOOD: 6,        // log
  LEAVES: 7,
  PLANKS: 8,
  WATER: 9,
  BEDROCK: 10,
  COAL_ORE: 11,
  IRON_ORE: 12,
  GOLD_ORE: 13,
  DIAMOND_ORE: 14,
  GLASS: 15,
  CRAFTING_TABLE: 16,
  SNOW: 17,
  GRAVEL: 18,
  BRICK: 19,
  TORCH: 20,
  CACTUS: 21,
  ICE: 22,
};

// Material category drives which tool mines fastest and base hardness.
export const TOOL = { HAND: 'hand', PICKAXE: 'pickaxe', AXE: 'axe', SHOVEL: 'shovel', SWORD: 'sword' };

// faces: [px, nx, py, ny, pz, nz] texture indices into the atlas (filled at build time)
export const blockDefs = {
  [BLOCK.GRASS]:        { name: 'Grass Block', solid: true, tool: TOOL.SHOVEL, hardness: 0.6, drops: BLOCK.DIRT },
  [BLOCK.DIRT]:         { name: 'Dirt', solid: true, tool: TOOL.SHOVEL, hardness: 0.5 },
  [BLOCK.STONE]:        { name: 'Stone', solid: true, tool: TOOL.PICKAXE, hardness: 1.5, drops: BLOCK.COBBLESTONE, needs: 1 },
  [BLOCK.COBBLESTONE]:  { name: 'Cobblestone', solid: true, tool: TOOL.PICKAXE, hardness: 2.0, needs: 1 },
  [BLOCK.SAND]:         { name: 'Sand', solid: true, tool: TOOL.SHOVEL, hardness: 0.5 },
  [BLOCK.WOOD]:         { name: 'Wood Log', solid: true, tool: TOOL.AXE, hardness: 2.0 },
  [BLOCK.LEAVES]:       { name: 'Leaves', solid: true, tool: TOOL.HAND, hardness: 0.2, transparent: true },
  [BLOCK.PLANKS]:       { name: 'Planks', solid: true, tool: TOOL.AXE, hardness: 2.0 },
  [BLOCK.WATER]:        { name: 'Water', solid: false, tool: TOOL.HAND, hardness: 999, transparent: true, liquid: true },
  [BLOCK.BEDROCK]:      { name: 'Bedrock', solid: true, tool: TOOL.HAND, hardness: 9999, unbreakable: true },
  [BLOCK.COAL_ORE]:     { name: 'Coal Ore', solid: true, tool: TOOL.PICKAXE, hardness: 3.0, needs: 1, drops: 'coal' },
  [BLOCK.IRON_ORE]:     { name: 'Iron Ore', solid: true, tool: TOOL.PICKAXE, hardness: 3.0, needs: 2, drops: 'iron' },
  [BLOCK.GOLD_ORE]:     { name: 'Gold Ore', solid: true, tool: TOOL.PICKAXE, hardness: 3.0, needs: 3, drops: 'gold' },
  [BLOCK.DIAMOND_ORE]:  { name: 'Diamond Ore', solid: true, tool: TOOL.PICKAXE, hardness: 3.0, needs: 3, drops: 'diamond' },
  [BLOCK.GLASS]:        { name: 'Glass', solid: true, tool: TOOL.HAND, hardness: 0.3, transparent: true },
  [BLOCK.CRAFTING_TABLE]:{ name: 'Crafting Table', solid: true, tool: TOOL.AXE, hardness: 2.5 },
  [BLOCK.SNOW]:         { name: 'Snow', solid: true, tool: TOOL.SHOVEL, hardness: 0.4 },
  [BLOCK.GRAVEL]:       { name: 'Gravel', solid: true, tool: TOOL.SHOVEL, hardness: 0.6 },
  [BLOCK.BRICK]:        { name: 'Bricks', solid: true, tool: TOOL.PICKAXE, hardness: 2.0, needs: 1 },
  [BLOCK.TORCH]:        { name: 'Torch', solid: false, tool: TOOL.HAND, hardness: 0.1, transparent: true, light: 14, billboard: true },
  [BLOCK.CACTUS]:       { name: 'Cactus', solid: true, tool: TOOL.HAND, hardness: 0.4 },
  [BLOCK.ICE]:          { name: 'Ice', solid: true, tool: TOOL.PICKAXE, hardness: 0.5, transparent: true },
};

// ---- Procedural texture atlas -------------------------------------------------
const TILE = 16;          // texels per tile
const ATLAS_COLS = 8;     // tiles per row in atlas
let atlasCanvas = null;
let tileIndex = 0;
const tileMap = {};       // key -> tile index

function px(ctx, x, y, c) { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); }

function noiseFill(ctx, ox, oy, base, vary, seed = 1) {
  let s = seed * 9301 + 49297;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const v = (rnd() - 0.5) * vary;
    px(ctx, ox + x, oy + y, shade(base, v));
  }
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.max(0, Math.min(255, r + amt * 255));
  g = Math.max(0, Math.min(255, g + amt * 255));
  b = Math.max(0, Math.min(255, b + amt * 255));
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

function newTile(drawFn) {
  const idx = tileIndex++;
  const ox = (idx % ATLAS_COLS) * TILE;
  const oy = Math.floor(idx / ATLAS_COLS) * TILE;
  const ctx = atlasCanvas.getContext('2d');
  drawFn(ctx, ox, oy);
  return idx;
}

function blobs(ctx, ox, oy, color, count, seed) {
  let s = seed * 131 + 7;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  for (let i = 0; i < count; i++) {
    const x = (rnd() * (TILE - 2)) | 0, y = (rnd() * (TILE - 2)) | 0;
    px(ctx, ox + x, oy + y, color);
    if (rnd() > 0.5) px(ctx, ox + x + 1, oy + y, color);
    if (rnd() > 0.5) px(ctx, ox + x, oy + y + 1, color);
  }
}

// ---- Progressive crack textures --------------------------------------------
// 5 stages (0 = none, 4 = dense). Drawn on transparent backgrounds so the
// crack overlay mesh can layer on top of the block face.
const CRACK_STAGES = 5;
function drawCrackStage(ctx, ox, oy, stage) {
  // stage 0: blank (unused — caller skips drawing the overlay)
  // stages 1..4: 4..14 jagged dark lines
  const lines = stage * 3 + 2;        // 5, 8, 11, 14
  let s = stage * 7 + 1;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  ctx.lineWidth = 1;
  for (let i = 0; i < lines; i++) {
    let x = rnd() * TILE, y = rnd() * TILE;
    const segs = 3 + ((rnd() * 3) | 0);
    ctx.beginPath();
    ctx.moveTo(ox + x, oy + y);
    for (let k = 0; k < segs; k++) {
      x = Math.max(0, Math.min(TILE - 1, x + (rnd() - 0.5) * 6));
      y = Math.max(0, Math.min(TILE - 1, y + (rnd() - 0.5) * 6));
      ctx.lineTo(ox + x, oy + y);
    }
    // dark stroke with a faint highlight
    ctx.strokeStyle = `rgba(0,0,0,${0.55 + rnd() * 0.3})`;
    ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${0.1 + rnd() * 0.1})`;
    ctx.stroke();
  }
  // a couple of "chip" dark dots per stage
  const chips = stage * 2;
  for (let i = 0; i < chips; i++) {
    const cx = (rnd() * TILE) | 0, cy = (rnd() * TILE) | 0;
    ctx.fillStyle = `rgba(0,0,0,${0.5 + rnd() * 0.4})`;
    ctx.fillRect(ox + cx, oy + cy, 1, 1);
    if (rnd() > 0.5) ctx.fillRect(ox + cx + 1, oy + cy, 1, 1);
  }
}

// Build the atlas and return { texture, uv(tileIdx) -> {u0,v0,u1,v1} }
export function buildAtlas(THREE) {
  const rows = 5; // one extra row for crack stages
  atlasCanvas = document.createElement('canvas');
  atlasCanvas.width = ATLAS_COLS * TILE;
  atlasCanvas.height = rows * TILE;

  // define tiles
  tileMap.grass_top = newTile((c, ox, oy) => { noiseFill(c, ox, oy, '#5fae46', 0.08, 3); blobs(c, ox, oy, shade('#4f9e38', 0.05), 18, 5); });
  tileMap.grass_side = newTile((c, ox, oy) => {
    noiseFill(c, ox, oy, '#866043', 0.08, 7);
    for (let y = 0; y < 4; y++) for (let x = 0; x < TILE; x++) px(c, ox + x, oy + y, shade('#5fae46', (Math.random() - 0.5) * 0.1));
  });
  tileMap.dirt = newTile((c, ox, oy) => { noiseFill(c, ox, oy, '#866043', 0.1, 11); blobs(c, ox, oy, '#6f4e34', 12, 2); });
  tileMap.stone = newTile((c, ox, oy) => { noiseFill(c, ox, oy, '#888888', 0.06, 13); blobs(c, ox, oy, '#7a7a7a', 10, 4); });
  tileMap.cobble = newTile((c, ox, oy) => {
    noiseFill(c, ox, oy, '#8a8a8a', 0.08, 17);
    for (const [bx, by] of [[1,1],[8,2],[3,8],[10,9],[6,5]]) { for (let yy=0;yy<4;yy++) for(let xx=0;xx<4;xx++) px(c, ox+bx+xx, oy+by+yy, shade('#6f6f6f', (Math.random()-0.5)*0.2)); }
  });
  tileMap.sand = newTile((c, ox, oy) => { noiseFill(c, ox, oy, '#e0d6a0', 0.06, 19); });
  tileMap.log_side = newTile((c, ox, oy) => {
    noiseFill(c, ox, oy, '#6b4f2a', 0.05, 23);
    for (let x = 0; x < TILE; x += 3) for (let y = 0; y < TILE; y++) px(c, ox + x, oy + y, shade('#5a4122', 0.05));
  });
  tileMap.log_top = newTile((c, ox, oy) => {
    noiseFill(c, ox, oy, '#a07c47', 0.05, 29);
    for (let r = 1; r < 8; r += 2) { for (let a = 0; a < 64; a++) { const x = 8 + Math.cos(a/10)*r, y = 8 + Math.sin(a/10)*r; px(c, ox + (x|0), oy + (y|0), '#7a5a30'); } }
  });
  tileMap.leaves = newTile((c, ox, oy) => { noiseFill(c, ox, oy, '#3f8a2e', 0.12, 31); blobs(c, ox, oy, shade('#2f6a20', 0.1), 24, 6); });
  tileMap.planks = newTile((c, ox, oy) => {
    noiseFill(c, ox, oy, '#b08b50', 0.05, 37);
    for (let y = 0; y < TILE; y += 4) for (let x = 0; x < TILE; x++) px(c, ox + x, oy + y, shade('#8a6a3a', 0.08));
  });
  tileMap.water = newTile((c, ox, oy) => { noiseFill(c, ox, oy, '#3a6fcf', 0.05, 41); });
  tileMap.bedrock = newTile((c, ox, oy) => { noiseFill(c, ox, oy, '#444444', 0.12, 43); blobs(c, ox, oy, '#222', 14, 8); });
  tileMap.coal = newTile((c, ox, oy) => { noiseFill(c, ox, oy, '#888888', 0.06, 13); blobs(c, ox, oy, '#1a1a1a', 16, 9); });
  tileMap.iron = newTile((c, ox, oy) => { noiseFill(c, ox, oy, '#888888', 0.06, 13); blobs(c, ox, oy, '#d8a878', 14, 10); });
  tileMap.gold = newTile((c, ox, oy) => { noiseFill(c, ox, oy, '#888888', 0.06, 13); blobs(c, ox, oy, '#f0d040', 14, 11); });
  tileMap.diamond = newTile((c, ox, oy) => { noiseFill(c, ox, oy, '#888888', 0.06, 13); blobs(c, ox, oy, '#5fe0d8', 14, 12); });
  tileMap.glass = newTile((c, ox, oy) => {
    const ctx = c; ctx.clearRect(ox, oy, TILE, TILE);
    ctx.fillStyle = 'rgba(180,220,235,0.25)'; ctx.fillRect(ox, oy, TILE, TILE);
    ctx.strokeStyle = 'rgba(220,240,250,0.8)'; ctx.strokeRect(ox + 0.5, oy + 0.5, TILE - 1, TILE - 1);
  });
  tileMap.craft_top = newTile((c, ox, oy) => { noiseFill(c, ox, oy, '#9a7440', 0.05, 51); for (let i=2;i<TILE;i+=4){for(let j=2;j<TILE;j+=4)px(c,ox+i,oy+j,'#5a4122');} });
  tileMap.craft_side = newTile((c, ox, oy) => { noiseFill(c, ox, oy, '#8a6438', 0.05, 53); for(let x=2;x<TILE;x++)px(c,ox+x,oy+2,'#5a4122'); });
  tileMap.snow = newTile((c, ox, oy) => { noiseFill(c, ox, oy, '#f4f8ff', 0.04, 57); });
  tileMap.gravel = newTile((c, ox, oy) => { noiseFill(c, ox, oy, '#8a8278', 0.12, 59); blobs(c, ox, oy, '#6a6258', 16, 13); });
  tileMap.brick = newTile((c, ox, oy) => {
    noiseFill(c, ox, oy, '#a04030', 0.05, 61);
    c.fillStyle = '#cccccc';
    for (let y = 0; y < TILE; y += 4) c.fillRect(ox, oy + y, TILE, 1);
    for (let y = 0; y < TILE; y += 8) for (let x = 0; x < TILE; x += 8) c.fillRect(ox + x, oy + y, 1, 4);
    for (let y = 4; y < TILE; y += 8) for (let x = 4; x < TILE; x += 8) c.fillRect(ox + x, oy + y, 1, 4);
  });
  tileMap.torch = newTile((c, ox, oy) => {
    c.clearRect(ox, oy, TILE, TILE);
    c.fillStyle = '#7a5a30'; c.fillRect(ox + 7, oy + 6, 2, 9);
    c.fillStyle = '#ffcc33'; c.fillRect(ox + 6, oy + 2, 4, 5);
    c.fillStyle = '#ffffaa'; c.fillRect(ox + 7, oy + 3, 2, 2);
  });
  tileMap.cactus_side = newTile((c, ox, oy) => {
    noiseFill(c, ox, oy, '#2d6e1a', 0.06, 71);
    for (let x = 0; x < TILE; x += 4) for (let y = 0; y < TILE; y++) px(c, ox + x, oy + y, shade('#3a8a2a', 0.05));
    blobs(c, ox, oy, '#8ab040', 6, 73);
  });
  tileMap.cactus_top = newTile((c, ox, oy) => {
    noiseFill(c, ox, oy, '#3a8a2a', 0.06, 75);
    for (let i = 5; i < 11; i++) { px(c, ox + 8, oy + i, '#4a9a3a'); px(c, ox + i, oy + 8, '#4a9a3a'); }
  });
  tileMap.ice = newTile((c, ox, oy) => {
    c.clearRect(ox, oy, TILE, TILE);
    c.fillStyle = 'rgba(160,216,239,0.6)'; c.fillRect(ox, oy, TILE, TILE);
    c.strokeStyle = 'rgba(220,240,255,0.5)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(ox + 2, oy + 4); c.lineTo(ox + 10, oy + 8); c.lineTo(ox + 14, oy + 5); c.stroke();
    c.beginPath(); c.moveTo(ox + 5, oy + 12); c.lineTo(ox + 12, oy + 14); c.stroke();
    c.strokeStyle = 'rgba(200,230,245,0.4)'; c.strokeRect(ox + 0.5, oy + 0.5, TILE - 1, TILE - 1);
  });

  // crack stages (row 4, columns 0..3 — stage 0..3 to keep within 4 tiles;
  // stage 4 reuses stage 3 with the per-face UV animation done in main.js
  // by adding a faint extra-dark tint when progress >= 1)
  const crackTiles = [];
  for (let s = 1; s < CRACK_STAGES; s++) {
    crackTiles.push(newTile((c, ox, oy) => {
      c.clearRect(ox, oy, TILE, TILE);
      drawCrackStage(c, ox, oy, s);
    }));
  }

  const texture = new THREE.CanvasTexture(atlasCanvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;

  const uv = (idx) => {
    const ox = (idx % ATLAS_COLS) * TILE;
    const oy = Math.floor(idx / ATLAS_COLS) * TILE;
    const pad = 0.1;
    return {
      u0: (ox + pad) / atlasCanvas.width,
      v0: 1 - (oy + TILE - pad) / atlasCanvas.height,
      u1: (ox + TILE - pad) / atlasCanvas.width,
      v1: 1 - (oy + pad) / atlasCanvas.height,
    };
  };

  // map block id -> { top, side, bottom } tile indices
  const faces = {
    [BLOCK.GRASS]:       { top: tileMap.grass_top, side: tileMap.grass_side, bottom: tileMap.dirt },
    [BLOCK.DIRT]:        { all: tileMap.dirt },
    [BLOCK.STONE]:       { all: tileMap.stone },
    [BLOCK.COBBLESTONE]: { all: tileMap.cobble },
    [BLOCK.SAND]:        { all: tileMap.sand },
    [BLOCK.WOOD]:        { top: tileMap.log_top, side: tileMap.log_side, bottom: tileMap.log_top },
    [BLOCK.LEAVES]:      { all: tileMap.leaves },
    [BLOCK.PLANKS]:      { all: tileMap.planks },
    [BLOCK.WATER]:       { all: tileMap.water },
    [BLOCK.BEDROCK]:     { all: tileMap.bedrock },
    [BLOCK.COAL_ORE]:    { all: tileMap.coal },
    [BLOCK.IRON_ORE]:    { all: tileMap.iron },
    [BLOCK.GOLD_ORE]:    { all: tileMap.gold },
    [BLOCK.DIAMOND_ORE]: { all: tileMap.diamond },
    [BLOCK.GLASS]:       { all: tileMap.glass },
    [BLOCK.CRAFTING_TABLE]:{ top: tileMap.craft_top, side: tileMap.craft_side, bottom: tileMap.planks },
    [BLOCK.SNOW]:        { all: tileMap.snow },
    [BLOCK.GRAVEL]:      { all: tileMap.gravel },
    [BLOCK.BRICK]:       { all: tileMap.brick },
    [BLOCK.TORCH]:       { all: tileMap.torch },
    [BLOCK.CACTUS]:      { top: tileMap.cactus_top, side: tileMap.cactus_side, bottom: tileMap.cactus_top },
    [BLOCK.ICE]:         { all: tileMap.ice },
  };

  // pre-computed UVs for the 4 crack stages (for the per-face overlay mesh)
  const crackUVs = crackTiles.map(idx => uv(idx));

  return { texture, uv, faces, tileMap, canvas: atlasCanvas, ATLAS_COLS, TILE, crackUVs, crackTiles };
}

// Tile index lookup for inventory icons
export function faceTile(faces, blockId) {
  const f = faces[blockId];
  if (!f) return 0;
  return f.top ?? f.all ?? 0;
}
