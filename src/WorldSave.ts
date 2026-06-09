const STORAGE_KEY = "nomaecraft_worlds";

export interface WorldSaveData {
  id: string;
  name: string;
  seed: number;
  createdAt: number;
  lastPlayed: number;
  playerName: string;
  inventory?: any;
  playerPos?: { x: number; y: number; z: number };
  edits?: { x: number; y: number; z: number; b: number }[];
  health?: number;
  hunger?: number;
}

function loadAll(): WorldSaveData[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveAll(worlds: WorldSaveData[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(worlds));
}

export function listWorlds(): WorldSaveData[] {
  return loadAll().sort((a, b) => b.lastPlayed - a.lastPlayed);
}

export function getWorld(id: string): WorldSaveData | undefined {
  return loadAll().find((w) => w.id === id);
}

export function createWorld(
  name: string,
  seed: number,
  playerName: string
): WorldSaveData {
  const world: WorldSaveData = {
    id: "w_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: name || "My World",
    seed,
    createdAt: Date.now(),
    lastPlayed: Date.now(),
    playerName,
  };
  const all = loadAll();
  all.push(world);
  saveAll(all);
  return world;
}

export function saveWorld(data: WorldSaveData) {
  const all = loadAll();
  const idx = all.findIndex((w) => w.id === data.id);
  data.lastPlayed = Date.now();
  if (idx >= 0) all[idx] = data;
  else all.push(data);
  saveAll(all);
}

export function deleteWorld(id: string) {
  const all = loadAll().filter((w) => w.id !== id);
  saveAll(all);
}

export function seedFromString(s: string): number {
  if (!s || s.trim() === "") return Math.floor(Math.random() * 2147483647);
  const n = parseInt(s, 10);
  if (!isNaN(n)) return n;
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}
