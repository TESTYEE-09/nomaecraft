import { BlockID } from "./Block";

export const TOOL_TYPE = {
  NONE: 0,
  PICKAXE: 1,
  AXE: 2,
  SHOVEL: 3,
  SWORD: 4,
} as const;

export interface FoodDef {
  hunger: number;
  sat: number;
}

export interface ToolDef {
  type: number;
  mult: number;
  level: number;
  dura: number;
  attack: number;
}

export interface GunDef {
  damage: number;
  mag: number;
  reload: number;
  fireCD: number;
  range: number;
  spread: number;
  kb: number;
}

export interface ItemDef {
  id: string;
  name: string;
  max: number;
  block?: BlockID;
  food?: FoodDef;
  tool?: ToolDef;
  gun?: GunDef;
  draw?: (ctx: CanvasRenderingContext2D) => void;
}

export const ITEMS: Record<string, ItemDef> = {};

function reg(id: string, def: Partial<ItemDef>) {
  ITEMS[id] = { id, name: id, max: 64, ...def } as ItemDef;
}

function prettify(s: string): string {
  return s
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

// Block items — map item ids to minicraft's BlockID enum
const blockItems: [string, BlockID][] = [
  ["grass", BlockID.Grass],
  ["dirt", BlockID.Dirt],
  ["stone", BlockID.Stone],
  ["cobblestone", BlockID.StoneBrick],
  ["oak_log", BlockID.OakLog],
  ["leaves", BlockID.Leaves],
  ["coal_ore", BlockID.CoalOre],
  ["iron_ore", BlockID.IronOre],
  ["redstone_lamp", BlockID.RedstoneLamp],
];
for (const [id, b] of blockItems) reg(id, { name: prettify(id), block: b });

// Material items
function matIcon(
  color: string,
  shape: "lump" | "stick" | "ingot" | "gem" = "lump"
) {
  return (ctx: CanvasRenderingContext2D) => {
    ctx.clearRect(0, 0, 32, 32);
    if (shape === "lump") {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(16, 18, 9, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.beginPath();
      ctx.ellipse(13, 15, 3, 2, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (shape === "stick") {
      ctx.fillStyle = color;
      ctx.save();
      ctx.translate(16, 16);
      ctx.rotate(-Math.PI / 4);
      ctx.fillRect(-2, -10, 4, 20);
      ctx.restore();
    } else if (shape === "ingot") {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(8, 22);
      ctx.lineTo(24, 22);
      ctx.lineTo(22, 12);
      ctx.lineTo(10, 12);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillRect(11, 13, 10, 2);
    } else if (shape === "gem") {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(16, 6);
      ctx.lineTo(26, 16);
      ctx.lineTo(16, 26);
      ctx.lineTo(6, 16);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.beginPath();
      ctx.moveTo(16, 8);
      ctx.lineTo(12, 16);
      ctx.lineTo(16, 14);
      ctx.closePath();
      ctx.fill();
    }
  };
}

reg("coal", { name: "Coal", draw: matIcon("#1c1c1c", "lump") });
reg("iron", { name: "Iron Ingot", draw: matIcon("#d9c4b0", "ingot") });
reg("gold", { name: "Gold Ingot", draw: matIcon("#f3d23a", "ingot") });
reg("diamond", { name: "Diamond", draw: matIcon("#4fe6dd", "gem") });
reg("stick", { name: "Stick", draw: matIcon("#7a5a30", "stick") });
reg("string", {
  name: "String",
  max: 64,
  draw: (ctx) => {
    ctx.clearRect(0, 0, 32, 32);
    ctx.strokeStyle = "#f0f0f0";
    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.ellipse(16, 16, 9, 6, 0, 0, Math.PI * 2);
    ctx.ellipse(16, 16, 7, 9, Math.PI / 4, 0, Math.PI * 2);
    ctx.stroke();
  },
});

// Food
reg("apple", {
  name: "Apple",
  max: 64,
  food: { hunger: 4, sat: 2.4 },
  draw: (ctx) => {
    ctx.clearRect(0, 0, 32, 32);
    ctx.fillStyle = "#d33";
    ctx.beginPath();
    ctx.ellipse(16, 18, 8, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#6a3";
    ctx.fillRect(15, 7, 2, 5);
  },
});
reg("raw_meat", {
  name: "Raw Meat",
  max: 64,
  food: { hunger: 2, sat: 0.6 },
  draw: (ctx) => {
    ctx.clearRect(0, 0, 32, 32);
    ctx.fillStyle = "#c46";
    ctx.beginPath();
    ctx.ellipse(16, 17, 9, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#eee";
    ctx.fillRect(13, 22, 6, 4);
  },
});
reg("cooked_meat", {
  name: "Cooked Meat",
  max: 64,
  food: { hunger: 8, sat: 6 },
  draw: (ctx) => {
    ctx.clearRect(0, 0, 32, 32);
    ctx.fillStyle = "#8a5a30";
    ctx.beginPath();
    ctx.ellipse(16, 17, 9, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#eee";
    ctx.fillRect(13, 22, 6, 4);
  },
});

// Tools
const TIER: Record<
  string,
  { mult: number; level: number; dura: number; color: string }
> = {
  wood: { mult: 2, level: 1, dura: 59, color: "#9a7440" },
  stone: { mult: 4, level: 2, dura: 131, color: "#888" },
  iron: { mult: 6, level: 3, dura: 250, color: "#d9c4b0" },
  gold: { mult: 12, level: 1, dura: 32, color: "#f3d23a" },
  diamond: { mult: 8, level: 4, dura: 1561, color: "#4fe6dd" },
};

function toolIcon(kind: string, color: string) {
  return (ctx: CanvasRenderingContext2D) => {
    ctx.clearRect(0, 0, 32, 32);
    ctx.strokeStyle = "#6a4a25";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(10, 24);
    ctx.lineTo(20, 10);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    if (kind === "pickaxe") {
      ctx.beginPath();
      ctx.moveTo(13, 7);
      ctx.quadraticCurveTo(20, 5, 27, 9);
      ctx.stroke();
    } else if (kind === "axe") {
      ctx.beginPath();
      ctx.moveTo(19, 6);
      ctx.lineTo(27, 9);
      ctx.lineTo(24, 15);
      ctx.lineTo(18, 11);
      ctx.closePath();
      ctx.fill();
    } else if (kind === "shovel") {
      ctx.beginPath();
      ctx.ellipse(22, 8, 5, 6, 0.6, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === "sword") {
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(11, 25);
      ctx.lineTo(25, 7);
      ctx.stroke();
      ctx.strokeStyle = "#6a4a25";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(9, 22);
      ctx.lineTo(15, 27);
      ctx.stroke();
    }
  };
}

for (const tname of ["wood", "stone", "iron", "gold", "diamond"]) {
  const tier = TIER[tname];
  for (const kind of ["pickaxe", "axe", "shovel", "sword"]) {
    const toolType =
      kind === "sword"
        ? TOOL_TYPE.SWORD
        : kind === "pickaxe"
          ? TOOL_TYPE.PICKAXE
          : kind === "axe"
            ? TOOL_TYPE.AXE
            : TOOL_TYPE.SHOVEL;
    const attack =
      kind === "sword"
        ? tier.level + 3
        : kind === "axe"
          ? tier.level + 2
          : 1;
    reg(`${tname}_${kind}`, {
      name: `${prettify(tname)} ${prettify(kind)}`,
      max: 1,
      draw: toolIcon(kind, tier.color),
      tool: {
        type: toolType,
        mult: tier.mult,
        level: tier.level,
        dura: tier.dura,
        attack,
      },
    });
  }
}

// Gun
reg("pistol", {
  name: "Pistol",
  max: 1,
  gun: {
    damage: 6,
    mag: 12,
    reload: 1.2,
    fireCD: 0.14,
    range: 70,
    spread: 0.012,
    kb: 4,
  },
  draw: (ctx) => {
    ctx.clearRect(0, 0, 32, 32);
    ctx.fillStyle = "#3a3a40";
    ctx.fillRect(5, 13, 20, 6);
    ctx.fillStyle = "#55555c";
    ctx.fillRect(22, 14, 7, 3);
    ctx.fillStyle = "#2a2a2e";
    ctx.save();
    ctx.translate(9, 18);
    ctx.rotate(0.35);
    ctx.fillRect(0, 0, 6, 11);
    ctx.restore();
    ctx.fillStyle = "#1f1f22";
    ctx.fillRect(8, 11, 3, 2);
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(6, 13, 18, 1);
  },
});

// Crafting recipes
export interface Recipe {
  type: "shaped" | "shapeless";
  out: string;
  count: number;
  pattern?: string[];
  keymap?: Record<string, string>;
  ingredients?: string[];
}

export const RECIPES: Recipe[] = [];

function shaped(
  out: string,
  count: number,
  pattern: string[],
  keymap: Record<string, string>
) {
  RECIPES.push({ type: "shaped", out, count, pattern, keymap });
}
function shapeless(out: string, count: number, ingredients: string[]) {
  RECIPES.push({ type: "shapeless", out, count, ingredients });
}

shapeless("oak_log", 4, ["oak_log"]); // planks placeholder — we map planks = oak_log for now
shapeless("stick", 4, ["oak_log", "oak_log"]);
shaped("redstone_lamp", 1, ["PP ", "PP ", "   "], { P: "oak_log" });
shapeless("cooked_meat", 1, ["raw_meat", "coal"]);

for (const tname of ["wood", "stone", "iron", "gold", "diamond"]) {
  const M =
    tname === "wood"
      ? "oak_log"
      : tname === "stone"
        ? "cobblestone"
        : tname;
  shaped(`${tname}_pickaxe`, 1, ["MMM", " S ", " S "], {
    M,
    S: "stick",
  });
  shaped(`${tname}_axe`, 1, ["MM ", "MS ", " S "], { M, S: "stick" });
  shaped(`${tname}_shovel`, 1, ["M  ", "S  ", "S  "], {
    M,
    S: "stick",
  });
  shaped(`${tname}_sword`, 1, ["M  ", "M  ", "S  "], {
    M,
    S: "stick",
  });
}
