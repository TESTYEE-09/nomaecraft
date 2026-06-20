# ⛏️ Nomaecraft

A tiny but genuine **Minecraft-style voxel sandbox** that runs entirely in the browser — built with **Three.js**, **TypeScript** and **Vite**. Zero binary assets: every texture is procedurally generated on a canvas at runtime.

> Live demo: **https://testyee-09.github.io/nomaecraft/**

![Nomaecraft](https://img.shields.io/badge/Three.js-r169-black) ![Vite](https://img.shields.io/badge/Vite-5-purple) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)

## ✨ Features

- **Infinite-ish procedural terrain** — fractal value-noise heightmaps with plains, desert and snowy biomes, plus lakes/oceans at sea level.
- **Trees, caves & ores** — generated deterministically from the world seed.
- **Greedy-ish culled chunk meshing** — only visible faces are emitted, with per-vertex **ambient occlusion** and directional face shading baked into a single interleaved buffer.
- **First-person controls** — pointer-lock mouse look, AABB-vs-voxel collision, walking, sprinting, jumping and a creative **fly** mode.
- **Build & dig** — DDA voxel raycasting for block breaking/placement, with a 9-slot hotbar.
- **Procedural texture atlas** — 16×16 tiles drawn in code (grass, dirt, stone, sand, logs, leaves, water, planks, brick, glass, ice, glowstone…), mipmapped and pixel-perfect.
- **Distance fog** matching the sky for a clean horizon.
- **Zero runtime asset downloads** — everything ships in the JS bundle.

## 🎮 Controls

| Action | Key |
| --- | --- |
| Move | `W` `A` `S` `D` |
| Jump | `Space` |
| Sprint | `Ctrl` |
| Look | Mouse |
| Break block | Left click |
| Place block | Right click |
| Select block | `1`–`9` / scroll wheel |
| Toggle fly | `F` |
| Debug overlay | `F3` |
| Pause / release mouse | `Esc` |

## 🚀 Run locally

```bash
npm install
npm run dev      # start the dev server
npm run build    # type-check + production build to dist/
npm run preview  # preview the production build
```

## 🏗️ Architecture

```
src/
  main.ts          # entry: renderer, scene, sky, input, game loop
  world.ts         # chunk storage + deterministic terrain generation
  mesher.ts        # voxel -> interleaved vertex buffer (cull + AO + shade)
  chunkmanager.ts  # stream/dispose chunk meshes around the player
  player.ts        # first-person controller, AABB voxel collision, physics
  raycast.ts       # Amanatides & Woo DDA voxel raycast for build/dig
  material.ts      # custom GLSL chunk shader (atlas + AO + fog)
  textures.ts      # procedural canvas atlas (no image assets)
  noise.ts         # seedable value-noise fBm
  blocks.ts        # block registry + properties
  constants.ts     # tunable world/physics constants
  ui.ts            # crosshair, hotbar, debug overlay (plain DOM)
```

## 📦 Deploy

Pushing to `main` triggers the GitHub Actions workflow in
`.github/workflows/deploy.yml`, which builds the site and publishes `dist/` to
GitHub Pages. Make sure the repo's **Settings → Pages → Source** is set to
**GitHub Actions**.

---

Made with 🧱 and a lot of cubes. Not affiliated with Mojang or Microsoft.
