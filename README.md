# Nomaecraft v2

A multiplayer voxel survival sandbox built with Three.js, TypeScript, and WebRTC.

**[Play Now](https://testyee-09.github.io/nomaecraft/)**

Nomaecraft v2 is a complete rewrite combining [minicraft](https://github.com/0kzh/minicraft)'s rendering engine (instanced meshes, real PNG textures, Vite build) with Nomaecraft's peer-to-peer multiplayer system.

## Features

- **Survival mode** — health, hunger, fall damage, day/night cycle
- **World persistence** — create, save, and load worlds with custom names and seeds
- **36-slot inventory** with shaped and shapeless crafting recipes
- **5 tool tiers** — wood, stone, iron, gold, diamond
- **Multiplayer** — WebRTC peer-to-peer via PeerJS with host migration
- **Real textures** — 16x16 PNG block textures with instanced mesh rendering
- **Infinite terrain** — chunked world generation with biomes via Web Workers

## Controls

| Key | Action |
|-----|--------|
| WASD | Move |
| Space | Jump |
| Double-Space | Toggle fly |
| Left Click | Break block |
| Right Click | Place block |
| E | Inventory |
| T | Chat (multiplayer) |
| 1-9 | Hotbar slots |
| Esc | Pause menu |

## Development

```bash
npm install
npm run dev
```

## Stack

TypeScript, Three.js, Vite, PeerJS, Howler.js, TailwindCSS
