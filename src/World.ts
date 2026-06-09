import * as THREE from "three";

import { BlockID } from "./Block";
import { BlockFactory } from "./Block/BlockFactory";
import { LightSourceBlock } from "./Block/LightSourceBlock";
import { DataStore } from "./DataStore";
import { Player } from "./Player";
import { WorldChunk, WorldParams, WorldSize } from "./WorldChunk";

export class World extends THREE.Group {
  scene: THREE.Scene;
  seed: number;
  renderDistance = 8;
  asyncLoading = true;
  chunkSize: WorldSize = { width: 16, height: 32 };
  chunkQueue: { x: number; z: number }[] = [];
  initialLoadComplete = false;
  onReady: ((player: Player) => void) | null = null;

  params: WorldParams = {
    seed: 0,
    terrain: { scale: 50, magnitude: 0.1, offset: 0.5 },
    surface: { offset: 4, magnitude: 4 },
    bedrock: { offset: 1, magnitude: 1 },
    trees: {
      frequency: 0.04,
      trunkHeight: { min: 5, max: 7 },
      canopy: { size: { min: 1, max: 3 } },
    },
    grass: { frequency: 0.02, patchSize: 5 },
    flowers: { frequency: 0.0075 },
  };

  dataStore = new DataStore();
  pointLights = new Map<string, THREE.PointLight>();
  wireframeMode = false;

  // Multiplayer edit tracking
  edits: { x: number; y: number; z: number; b: number }[] = [];

  constructor(seed = 0, scene: THREE.Scene) {
    super();
    this.seed = seed;
    this.params.seed = seed;
    this.scene = scene;
  }

  regenerate(player: Player) {
    this.children.forEach((chunk) => {
      if (chunk instanceof WorldChunk) chunk.disposeChildren();
    });
    this.clear();
    this.update(player);
  }

  getBlockKey(x: number, y: number, z: number) {
    return `${x},${y},${z}`;
  }

  getChunkKey(x: number, z: number) {
    return `${x},${z}`;
  }

  update(player: Player) {
    const visibleChunks = this.getVisibleChunks(player);
    const chunksToAdd = this.getChunksToAdd(visibleChunks);
    this.removeUnusedChunks(visibleChunks);

    if (chunksToAdd.length > 0) {
      this.chunkQueue = [...chunksToAdd, ...this.chunkQueue];
      const chunkQueueSet = new Set<string>();
      this.chunkQueue = this.chunkQueue.filter((chunk) => {
        const key = this.getChunkKey(chunk.x, chunk.z);
        if (chunkQueueSet.has(key)) return false;
        chunkQueueSet.add(key);
        return true;
      });
    }

    if (this.chunkQueue.length) {
      const chunk = this.chunkQueue.shift();
      if (chunk) this.generateChunk(chunk.x, chunk.z);
    } else {
      if (!this.initialLoadComplete) {
        this.initialLoadComplete = true;
        const menuScreen = document.getElementById("loading");
        const debugMenu = document.getElementById("debug");
        const hud = document.getElementById("hud");
        if (menuScreen) menuScreen.style.display = "none";
        if (hud) hud.style.display = "block";
        if (debugMenu) debugMenu.style.display = "none";

        const startPos = new THREE.Vector3(
          player.position.x,
          player.position.y,
          player.position.z
        );
        for (let y = this.chunkSize.height; y > 0; y--) {
          const block = this.getBlock(startPos.x, y, startPos.z);
          if (block?.block === BlockID.Grass) {
            startPos.y = y;
            break;
          }
        }

        player.position.set(startPos.x, startPos.y + 1.8, startPos.z);
        player.spawn.set(startPos.x, startPos.y + 1.8, startPos.z);
        player.vel.set(0, 0, 0);
        player.fallStart = null;
        if (this.onReady) this.onReady(player);
        player.controls.lock();
      }
    }

    if (!this.initialLoadComplete) {
      const totalChunks = (this.renderDistance * 2 + 1) ** 2;
      const loadedChunks = this.children.length;
      const percentLoaded = Math.round((loadedChunks / totalChunks) * 100);
      const progressBar = document.getElementById("loading-progress-bar");
      if (progressBar) progressBar.style.width = `${percentLoaded}%`;
    }
  }

  getBlockUnderneath(position: THREE.Vector3, playerHeight: number) {
    return this.getBlock(
      Math.floor(position.x),
      Math.floor(position.y - playerHeight / 2 - 1),
      Math.floor(position.z)
    );
  }

  getVisibleChunks(player: Player): { x: number; z: number }[] {
    const coords = this.worldToChunkCoords(
      player.position.x,
      player.position.y,
      player.position.z
    );
    const visibleChunks: { x: number; z: number }[] = [];
    const range = Array.from(
      { length: this.renderDistance * 2 + 1 },
      (_, i) => i - this.renderDistance
    );
    range.sort((a, b) => Math.abs(a) - Math.abs(b));
    for (const dx of range) {
      for (const dz of range) {
        visibleChunks.push({ x: coords.chunk.x + dx, z: coords.chunk.z + dz });
      }
    }
    visibleChunks.sort((a, b) => {
      const distA = Math.sqrt((a.x - coords.chunk.x) ** 2 + (a.z - coords.chunk.z) ** 2);
      const distB = Math.sqrt((b.x - coords.chunk.x) ** 2 + (b.z - coords.chunk.z) ** 2);
      return distA - distB;
    });
    return visibleChunks;
  }

  getChunksToAdd(visibleChunks: { x: number; z: number }[]): { x: number; z: number }[] {
    return visibleChunks.filter((chunk) => {
      return !this.children
        .map((obj) => obj.userData)
        .find(({ x, z }) => chunk.x === x && chunk.z === z);
    });
  }

  removeUnusedChunks(visibleChunks: { x: number; z: number }[]) {
    const chunksToRemove = this.children.filter((obj) => {
      const { x, z } = obj.userData;
      return !visibleChunks.find((vc) => vc.x === x && vc.z === z);
    });
    chunksToRemove.forEach((chunk) => {
      if (chunk instanceof WorldChunk) chunk.disposeChildren();
      this.remove(chunk);
    });
  }

  async generateChunk(x: number, z: number) {
    const chunk = new WorldChunk(
      this.chunkSize,
      this.params,
      this.dataStore,
      this.wireframeMode
    );
    chunk.position.set(x * this.chunkSize.width, 0, z * this.chunkSize.width);
    chunk.userData = { x, z };
    chunk.generate();
    this.add(chunk);
  }

  addBlock(x: number, y: number, z: number, block: BlockID) {
    const coords = this.worldToChunkCoords(x, y, z);
    const chunk = this.getChunk(coords.chunk.x, coords.chunk.z);

    if (chunk && chunk.loaded) {
      chunk.addBlock(coords.block.x, coords.block.y, coords.block.z, block);

      if (block === BlockID.RedstoneLamp) {
        const blockClass = BlockFactory.getBlock(block) as LightSourceBlock;
        const light = new THREE.PointLight(
          blockClass.color,
          blockClass.intensity,
          blockClass.distance,
          blockClass.decay
        );
        light.position.set(x + 0.5, y + 0.5, z + 0.5);
        light.castShadow = true;
        this.pointLights.set(this.getBlockKey(x, y, z), light);
        this.scene.add(light);
      }

      this.hideBlockIfNeeded(x - 1, y, z);
      this.hideBlockIfNeeded(x + 1, y, z);
      this.hideBlockIfNeeded(x, y - 1, z);
      this.hideBlockIfNeeded(x, y + 1, z);
      this.hideBlockIfNeeded(x, y, z - 1);
      this.hideBlockIfNeeded(x, y, z + 1);
    }
  }

  removeBlock(x: number, y: number, z: number) {
    const coords = this.worldToChunkCoords(x, y, z);
    const chunk = this.getChunk(coords.chunk.x, coords.chunk.z);
    const blockToRemove = this.getBlock(x, y, z);

    if (blockToRemove?.block === BlockID.Bedrock) return;

    if (chunk && chunk.loaded) {
      chunk.removeBlock(coords.block.x, coords.block.y, coords.block.z);
      if (this.pointLights.has(this.getBlockKey(x, y, z))) {
        const light = this.pointLights.get(this.getBlockKey(x, y, z));
        if (light) {
          this.scene.remove(light);
          this.pointLights.delete(this.getBlockKey(x, y, z));
        }
      }

      this.revealBlock(x - 1, y, z);
      this.revealBlock(x + 1, y, z);
      this.revealBlock(x, y - 1, z);
      this.revealBlock(x, y + 1, z);
      this.revealBlock(x, y, z - 1);
      this.revealBlock(x, y, z + 1);

      const aboveBlock = this.getBlock(x, y + 1, z);
      if (
        aboveBlock &&
        BlockFactory.getBlock(aboveBlock.block).canPassThrough &&
        aboveBlock.block !== BlockID.Air
      ) {
        this.removeBlock(x, y + 1, z);
      }
    }
  }

  // Multiplayer-aware block operations
  addBlockNetworked(x: number, y: number, z: number, block: BlockID) {
    this.addBlock(x, y, z, block);
    this.edits.push({ x, y, z, b: block });
  }

  removeBlockNetworked(x: number, y: number, z: number) {
    this.removeBlock(x, y, z);
    this.edits.push({ x, y, z, b: BlockID.Air });
  }

  applyEdits(edits: { x: number; y: number; z: number; b: number }[]) {
    for (const e of edits) {
      if (e.b === BlockID.Air) this.removeBlock(e.x, e.y, e.z);
      else this.addBlock(e.x, e.y, e.z, e.b);
    }
    this.edits = edits;
  }

  getBlock(x: number, y: number, z: number) {
    const coords = this.worldToChunkCoords(x, y, z);
    const chunk = this.getChunk(coords.chunk.x, coords.chunk.z);
    if (chunk && chunk.loaded) {
      return chunk.getBlock(coords.block.x, y, coords.block.z);
    }
  }

  worldToChunkCoords(x: number, y: number, z: number) {
    const chunkX = Math.floor(x / this.chunkSize.width);
    const chunkZ = Math.floor(z / this.chunkSize.width);
    const blockX = x - chunkX * this.chunkSize.width;
    const blockZ = z - chunkZ * this.chunkSize.width;
    return {
      chunk: { x: chunkX, z: chunkZ },
      block: { x: blockX, y, z: blockZ },
    };
  }

  getChunk(x: number, z: number): WorldChunk | undefined {
    return this.children.find(
      (obj) => obj.userData.x === x && obj.userData.z === z
    ) as WorldChunk | undefined;
  }

  revealBlock(x: number, y: number, z: number) {
    const coords = this.worldToChunkCoords(x, y, z);
    const chunk = this.getChunk(coords.chunk.x, coords.chunk.z);
    if (chunk && chunk.loaded) {
      chunk.addBlockInstance(coords.block.x, coords.block.y, coords.block.z);
    }
  }

  hideBlockIfNeeded(x: number, y: number, z: number) {
    const coords = this.worldToChunkCoords(x, y, z);
    const chunk = this.getChunk(coords.chunk.x, coords.chunk.z);
    if (
      chunk &&
      chunk.loaded &&
      chunk.isBlockObscured(coords.block.x, coords.block.y, coords.block.z)
    ) {
      chunk.deleteBlockInstance(coords.block.x, coords.block.y, coords.block.z);
    }
  }
}
