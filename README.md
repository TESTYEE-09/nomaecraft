# 🟩 Nomaecraft

A browser-based **multiplayer voxel sandbox** — a Minecraft clone you can play instantly in any modern browser, no install required.

### ▶️ Play now: **https://testyee-09.github.io/nomaecraft/**

Share that link with friends. To play together, one person clicks **Host a World**, gets a 5-letter room code (and a shareable link), and everyone else types the code (or opens the link) and clicks **Join**.

---

## Features

- **Infinite procedural world** — hills, mountains, beaches, oceans, caves of ore, and trees, all generated from a seed with value-noise terrain.
- **Mining & building** — break and place 20+ block types. Block-perfect voxel raycasting.
- **Tools & tiers** — wood → stone → iron → gold → diamond pickaxes, axes, shovels and swords, each with mining speed, harvest level, and **durability**.
- **Crafting** — a real 2×2 inventory grid plus a 3×3 grid when standing near a **Crafting Table**. Shaped & shapeless recipes: planks, sticks, tools, torches, bricks, glass, and more.
- **Survival** — **health** ❤ and **hunger** 🍗 systems, food (apples, meat, bread), natural regeneration, fall damage, and drowning (watch your air 🫧).
- **Day/night cycle** — a moving sun & moon, dynamic sky colors, sunsets, and fog.
- **Mobs** — passive pigs & cows (drop meat) and **zombies** that spawn in the dark and hunt you. Fight back with swords; mobs have knockback and drops.
- **Torches** that cast real light in caves and at night.
- **Multiplayer** — peer-to-peer over WebRTC. Player avatars with name tags, synced block edits, and live chat. No game server needed.
- **Auto-save** — singleplayer worlds persist in your browser.

## Controls

| Action | Key |
| --- | --- |
| Move | **WASD** |
| Jump / swim up | **Space** |
| Sneak / descend (fly) | **Shift** |
| Sprint | **Ctrl** or double-tap **W** |
| Look | **Mouse** |
| Mine / attack | **Left-click** (hold to mine) |
| Place block / eat | **Right-click** |
| Select hotbar | **1–9** or **scroll** |
| Inventory & crafting | **E** |
| Toggle fly | **F** |
| Chat | **T** |
| Release mouse | **Esc** |

## Tech

Pure client-side: [Three.js](https://threejs.org) for rendering, [PeerJS](https://peerjs.com) (WebRTC) for multiplayer, procedurally-generated textures (zero image assets). Served as static files from GitHub Pages.

### Developer console
Open DevTools and use `nomae.give('diamond_pickaxe')`, `nomae.give('torch', 64)`, `nomae.time(0.5)`, `nomae.tp(x,y,z)`, `nomae.heal()`. Run `nomae.items()` to list every item id.

## Run locally

```bash
git clone https://github.com/TESTYEE-09/nomaecraft.git
cd nomaecraft
python3 -m http.server 8123
# open http://localhost:8123
```

---

Built as a single static site — just HTML, CSS, and ES modules. No build step.
