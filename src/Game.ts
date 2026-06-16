import TWEEN from "@tweenjs/tween.js";
import { Howl } from "howler";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import Stats from "three/examples/jsm/libs/stats.module";

import audioManager from "./audio/AudioManager";
import { Physics } from "./Physics";
import { Player, selectionMaterial } from "./Player";
import { numberWithCommas } from "./util";
import { World } from "./World";
import { BlockID } from "./Block";
import { getBlockDrop, ITEMS } from "./Items";
import { InventoryUI } from "./InventoryUI";
import { Net, NetHandlers } from "./multiplayer/Net";
import { RemotePlayer } from "./multiplayer/RemotePlayer";
import {
  WorldSaveData,
  listWorlds,
  getWorld,
  createWorld,
  saveWorld,
  deleteWorld,
  seedFromString,
} from "./WorldSave";

const vertexShader = `
  varying vec3 worldPosition;
  void main() {
    vec4 mPosition = modelMatrix * vec4(position, 1.0);
    worldPosition = mPosition.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  uniform vec3 topColor;
  uniform vec3 bottomColor;
  uniform float offset;
  uniform float exponent;
  varying vec3 worldPosition;
  void main() {
    float h = normalize(worldPosition + offset).y;
    gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(h, exponent), 0.0)), 1.0);
  }
`;

const SHARED_SEED = 20260607;

export default class Game {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private orbitCamera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private stats!: any;
  private clock!: THREE.Clock;

  private sunSettings = { distance: 400, cycleLength: 600 };
  private sky!: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private sun!: THREE.DirectionalLight;
  private sunHelper!: THREE.DirectionalLightHelper;
  private shadowHelper!: THREE.CameraHelper;

  world!: World;
  player!: Player;
  private physics!: Physics;
  private inventoryUI!: InventoryUI;

  private previousTime = 0;
  private lastShadowUpdate = 0;

  private dayColor = new THREE.Color(0xc0d8ff);
  private nightColor = new THREE.Color(0x10121e);
  private sunsetColor = new THREE.Color(0xcc7a00);

  net: Net | null = null;
  private remotePlayers = new Map<string, RemotePlayer>();
  private multiplayer = false;
  private myName = "Steve";
  private stateTimer = 0;
  private running = false;
  private paused = false;
  private currentSave: WorldSaveData | null = null;
  private autoSaveTimer = 0;

  constructor() {
    this.previousTime = performance.now();
    this.clock = new THREE.Clock();
    this.initMenus();
  }

  // ---- Menu System ----

  private showScreen(id: string) {
    for (const s of [
      "main-menu", "world-select", "create-world", "multi-menu",
      "loading", "hud", "pause-menu",
    ]) {
      const el = document.getElementById(s);
      if (el) el.style.display = s === id ? (s === "hud" ? "block" : "flex") : "none";
    }
  }

  initMenus() {
    // Main menu
    document.getElementById("btn-singleplayer")?.addEventListener("click", () => {
      audioManager.play("gui.button.press");
      this.showWorldSelect();
    });
    document.getElementById("btn-multiplayer")?.addEventListener("click", () => {
      audioManager.play("gui.button.press");
      this.showScreen("multi-menu");
    });
    document.getElementById("github")?.addEventListener("click", () => {
      audioManager.play("gui.button.press");
      window.open("https://github.com/TESTYEE-09/nomaecraft");
    });

    // World select
    document.getElementById("btn-create-world")?.addEventListener("click", () => {
      audioManager.play("gui.button.press");
      this.showScreen("create-world");
      (document.getElementById("cw-name") as HTMLInputElement).value = "";
      (document.getElementById("cw-seed") as HTMLInputElement).value = "";
    });
    document.getElementById("btn-ws-back")?.addEventListener("click", () => {
      audioManager.play("gui.button.press");
      this.showScreen("main-menu");
    });

    // Create world
    document.getElementById("btn-cw-create")?.addEventListener("click", () => {
      audioManager.play("gui.button.press");
      const name = (document.getElementById("cw-name") as HTMLInputElement).value.trim() || "My World";
      const seedStr = (document.getElementById("cw-seed") as HTMLInputElement).value.trim();
      const playerName = (document.getElementById("cw-player-name") as HTMLInputElement).value.trim() || "Steve";
      const seed = seedFromString(seedStr);
      const save = createWorld(name, seed, playerName);
      this.startSingleplayer(save);
    });
    document.getElementById("btn-cw-back")?.addEventListener("click", () => {
      audioManager.play("gui.button.press");
      this.showWorldSelect();
    });

    // Multiplayer
    document.getElementById("btn-mm-join")?.addEventListener("click", () => {
      audioManager.play("gui.button.press");
      this.myName = (document.getElementById("mm-name") as HTMLInputElement).value.trim() || "Steve";
      this.startMultiplayer();
    });
    document.getElementById("btn-mm-back")?.addEventListener("click", () => {
      audioManager.play("gui.button.press");
      this.showScreen("main-menu");
    });

    // Pause menu
    document.getElementById("btn-resume")?.addEventListener("click", () => {
      audioManager.play("gui.button.press");
      this.unpause();
    });
    document.getElementById("btn-save-quit")?.addEventListener("click", () => {
      audioManager.play("gui.button.press");
      this.saveAndQuit();
    });
    // Escape-key pause handling is now in initListeners (as _escapeKeyBound)
    // so it can be removed cleanly on saveAndQuit.
  }

  private showWorldSelect() {
    this.showScreen("world-select");
    this.renderWorldList();
  }

  private renderWorldList() {
    const container = document.getElementById("world-list")!;
    const worlds = listWorlds();

    if (worlds.length === 0) {
      container.innerHTML = '<div class="world-list-empty">No worlds yet. Create one!</div>';
      return;
    }

    container.innerHTML = "";
    for (const w of worlds) {
      const entry = document.createElement("div");
      entry.className = "world-entry";

      const ago = this.timeAgo(w.lastPlayed);
      const seedStr = String(w.seed).slice(0, 10);

      entry.innerHTML = `
        <div class="world-info">
          <div class="world-name">${this.escapeHtml(w.name)}</div>
          <div class="world-meta">Seed: ${seedStr} &middot; ${ago}</div>
        </div>
        <div class="world-actions">
          <button class="play-btn">Play</button>
          <button class="del-btn">Delete</button>
        </div>
      `;

      entry.querySelector(".play-btn")!.addEventListener("click", (e) => {
        e.stopPropagation();
        audioManager.play("gui.button.press");
        this.startSingleplayer(w);
      });
      entry.querySelector(".del-btn")!.addEventListener("click", (e) => {
        e.stopPropagation();
        audioManager.play("gui.button.press");
        deleteWorld(w.id);
        this.renderWorldList();
      });

      entry.addEventListener("click", () => {
        audioManager.play("gui.button.press");
        this.startSingleplayer(w);
      });

      container.appendChild(entry);
    }
  }

  private escapeHtml(s: string): string {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  private timeAgo(ts: number): string {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  // ---- Game Start ----

  private startSingleplayer(save: WorldSaveData) {
    this.multiplayer = false;
    this.myName = save.playerName || "Steve";
    this.currentSave = save;
    this.showScreen("loading");
    this.initScene(save.seed);
    this.initStats();
    this.initListeners();
    this.initAudio();

    if (save.edits?.length) this.world.applyEdits(save.edits);

    this.world.onReady = (player) => {
      if (save.inventory) player.inventory.load(save.inventory);
      if (save.health != null) player.health = save.health;
      if (save.hunger != null) player.hunger = save.hunger;
      if (save.playerPos) {
        player.position.set(save.playerPos.x, save.playerPos.y, save.playerPos.z);
        player.spawn.set(save.playerPos.x, save.playerPos.y, save.playerPos.z);
        player.vel.set(0, 0, 0);
        player.fallStart = null;
      }
      this.inventoryUI.render();
    };
  }

  private startMultiplayer() {
    this.multiplayer = true;
    this.currentSave = null;
    this.showScreen("loading");
    this.initScene(SHARED_SEED);
    this.initStats();
    this.initListeners();
    this.initAudio();
    this.initMultiplayer();
  }

  private pause() {
    if (!this.running || this.paused) return;
    this.paused = true;
    this.player.controls.unlock();
    const pm = document.getElementById("pause-menu");
    if (pm) pm.style.display = "flex";
  }

  private unpause() {
    this.paused = false;
    const pm = document.getElementById("pause-menu");
    if (pm) pm.style.display = "none";
    this.player.controls.lock();
  }

  private saveCurrentWorld() {
    if (!this.currentSave || this.multiplayer) return;
    this.currentSave.inventory = this.player.inventory.serialize();
    this.currentSave.playerPos = {
      x: this.player.pos.x,
      y: this.player.pos.y,
      z: this.player.pos.z,
    };
    this.currentSave.health = this.player.health;
    this.currentSave.hunger = this.player.hunger;
    this.currentSave.edits = this.world.edits;
    saveWorld(this.currentSave);
  }

  private saveAndQuit() {
    this.saveCurrentWorld();
    this.running = false;
    this.paused = false;

    // Clean up network
    if (this.net) { this.net.close(); this.net = null; }
    for (const [, rp] of this.remotePlayers) rp.remove();
    this.remotePlayers.clear();

    // Remove global listeners that would otherwise stack across sessions.
    document.removeEventListener("mousedown", this._onMouseDownBound);
    document.removeEventListener("keydown", this._escapeKeyBound);
    document.removeEventListener("keydown", this._chatKeyDownBound!);
    const chatInput = document.getElementById("chat-input") as HTMLInputElement | null;
    if (chatInput && this._chatInputKeyBound)
      chatInput.removeEventListener("keydown", this._chatInputKeyBound);
    window.removeEventListener("resize", this._onWindowResizeBound);
    if (this.player) this.player.dispose();

    // Remove the renderer from the DOM and free its WebGL context so a
    // fresh start doesn't bleed GPU resources.
    if (this.renderer) {
      if (this.renderer.domElement?.parentNode) {
        this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
      }
      this.renderer.dispose();
      this.renderer.forceContextLoss();
    }
    if (this.stats) {
      if (this.stats.dom?.parentNode) {
        this.stats.dom.parentNode.removeChild(this.stats.dom);
      }
      this.stats = null;
    }

    // Hide game UI
    const hud = document.getElementById("hud");
    const pause = document.getElementById("pause-menu");
    const death = document.getElementById("death-screen");
    const chat = document.getElementById("chat-box");
    if (hud) hud.style.display = "none";
    if (pause) pause.style.display = "none";
    if (death) death.style.display = "none";
    if (chat) chat.style.display = "none";

    this.showScreen("main-menu");
  }

  // ---- Multiplayer ----

  initMultiplayer() {
    const handlers: NetHandlers = {
      getSeed: () => this.world.seed,
      getEdits: () => this.world.edits,
      onInit: (seed: number, edits: any[]) => {
        this.world.seed = seed;
        this.world.params.seed = seed;
        if (edits?.length) this.world.applyEdits(edits);
      },
      onPlayer: (id: string, state: any) => {
        let rp = this.remotePlayers.get(id);
        if (!rp) {
          rp = new RemotePlayer(this.scene, state.name || "Player");
          this.remotePlayers.set(id, rp);
        }
        rp.setState(state);
        this.updatePlayerCount();
      },
      onRemovePlayer: (id: string) => {
        const rp = this.remotePlayers.get(id);
        if (rp) { rp.remove(); this.remotePlayers.delete(id); }
        this.updatePlayerCount();
      },
      onBlock: (x: number, y: number, z: number, b: number) => {
        if (b === 0) this.world.removeBlock(x, y, z);
        else this.world.addBlock(x, y, z, b);
      },
      onChat: (name: string, text: string) => this.addChatMessage(name, text),
      onHit: (dmg: number) => this.player.damage(dmg),
    };

    this.net = new Net(handlers);
    this.net.connectShared("MAIN").then((result) => {
      this.addChatMessage("system", result === "hosting" ? "Hosting the shared world." : "Joined the shared world.");
      this.updatePlayerCount();
    }).catch((e) => {
      this.addChatMessage("system", "Connection failed: " + e.message);
    });
  }

  private updatePlayerCount() {
    const count = 1 + this.remotePlayers.size;
    const el = document.getElementById("player-count");
    const text = document.getElementById("player-count-text");
    if (el) el.style.display = this.multiplayer ? "block" : "none";
    if (text) text.textContent = `${count} player${count > 1 ? "s" : ""}`;
  }

  addChatMessage(name: string, text: string) {
    const log = document.getElementById("chat-log");
    const box = document.getElementById("chat-box");
    if (!log || !box) return;
    box.style.display = "block";
    const div = document.createElement("div");
    div.className = name === "system" ? "chat-msg chat-system" : "chat-msg";
    // textContent (not innerHTML) so player-supplied names can't inject markup.
    div.textContent = name === "system" ? text : `<${name}> ${text}`;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    setTimeout(() => div.classList.add("fade"), 100);

    // Cap the chat log so it doesn't grow unbounded across long sessions.
    const MAX_CHAT = 50;
    while (log.childElementCount > MAX_CHAT) {
      log.removeChild(log.firstElementChild!);
    }
  }

  // ---- Scene Init ----

  initStats() {
    this.stats = new (Stats as any)();
    document.body.appendChild(this.stats.dom);
  }

  initScene(seed: number) {
    this.scene = new THREE.Scene();

    this.orbitCamera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight);
    this.orbitCamera.position.set(-32, 64, -32);

    this.renderer = new THREE.WebGLRenderer();
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x80abfe);
    document.body.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.orbitCamera, this.renderer.domElement);
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    // Skybox
    const uniforms = {
      topColor: { type: "c", value: new THREE.Color(0xa0c0ff) },
      bottomColor: { type: "c", value: new THREE.Color(0xffffff) },
      offset: { type: "f", value: 99 },
      exponent: { type: "f", value: 0.3 },
    };
    const skyGeo = new THREE.SphereGeometry(4000, 32, 15);
    const skyMat = new THREE.ShaderMaterial({
      vertexShader, fragmentShader, uniforms, side: THREE.BackSide,
    });
    this.sky = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(this.sky);

    this.scene.fog = new THREE.Fog(0x80a0e0, 50, 100);
    this.scene.fog.color.copy(uniforms.bottomColor.value);

    this.sun = new THREE.DirectionalLight();
    this.sun.intensity = 1.5;
    this.sun.castShadow = true;
    this.sun.shadow.camera.left = -80;
    this.sun.shadow.camera.right = 80;
    this.sun.shadow.camera.top = 80;
    this.sun.shadow.camera.bottom = -80;
    this.sun.shadow.camera.near = 0.1;
    this.sun.shadow.camera.far = 600;
    this.sun.shadow.bias = -0.005;
    this.sun.shadow.mapSize = new THREE.Vector2(512, 512);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.sunHelper = new THREE.DirectionalLightHelper(this.sun);
    this.sunHelper.visible = false;
    this.scene.add(this.sunHelper);

    this.shadowHelper = new THREE.CameraHelper(this.sun.shadow.camera);
    this.shadowHelper.visible = false;
    this.scene.add(this.shadowHelper);

    const ambient = new THREE.AmbientLight();
    ambient.intensity = 0.2;
    this.scene.add(ambient);

    this.world = new World(seed, this.scene);
    this.scene.add(this.world);

    this.player = new Player(this.scene);
    this.physics = new Physics(this.scene);
    this.inventoryUI = new InventoryUI(this.player, () => {
      this.updateHUD();
    });

    this.player.onDeath = () => {
      const ds = document.getElementById("death-screen");
      if (ds) ds.style.display = "flex";
    };

    document.getElementById("respawn-btn")?.addEventListener("click", () => {
      this.player.respawn();
      const ds = document.getElementById("death-screen");
      if (ds) ds.style.display = "none";
      this.player.controls.lock();
    });

    this.initChat();
    this.updateSunPosition(0);
    this.initHotbar();
    this.running = true;
    this.draw();
  }

  private initHotbar() {
    const slotsContainer = document.getElementById("hotbar-slots");
    if (!slotsContainer) return;
    slotsContainer.innerHTML = "";
    for (let i = 0; i < 9; i++) {
      const slot = document.createElement("div");
      slot.className = "hotbar-slot";
      slot.id = `toolbar-slot-${i + 1}`;
      const icon = document.createElement("div");
      icon.className = "slot-icon";
      slot.appendChild(icon);
      slotsContainer.appendChild(slot);
    }
  }

  private initChat() {
    const chatInput = document.getElementById("chat-input") as HTMLInputElement;
    if (!chatInput) return;

    // Bound so we can remove on teardown.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "KeyT" && this.player?.controls.isLocked && this.multiplayer) {
        e.preventDefault();
        this.player.controls.unlock();
        chatInput.style.display = "block";
        chatInput.focus();
      }
      if (e.code === "Escape" && chatInput.style.display === "block") {
        chatInput.style.display = "none";
        chatInput.value = "";
        this.player.controls.lock();
      }
    };
    const onInputKey = (e: KeyboardEvent) => {
      if (e.code === "Enter") {
        const text = chatInput.value.trim();
        if (text && this.net) {
          this.net.sendChat(this.myName, text);
          this.addChatMessage(this.myName, text);
        }
        chatInput.value = "";
        chatInput.style.display = "none";
        this.player.controls.lock();
      }
      e.stopPropagation();
    };
    this._chatKeyDownBound = onKeyDown;
    this._chatInputKeyBound = onInputKey;

    document.addEventListener("keydown", onKeyDown);
    chatInput.addEventListener("keydown", onInputKey);
  }

  private _chatKeyDownBound?: (e: KeyboardEvent) => void;
  private _chatInputKeyBound?: (e: KeyboardEvent) => void;

  initAudio() {
    const sound = new Howl({ src: ["audio/ambient.mp3"], loop: true });
    sound.play();
  }

  onMouseDown(event: MouseEvent) {
    if (this.paused) return;
    if (this.player.controls.isLocked) {
      if (event.button === 0 && this.player.selectedCoords) {
        const x = Math.ceil(this.player.selectedCoords.x - 0.5);
        const y = Math.ceil(this.player.selectedCoords.y - 0.5);
        const z = Math.ceil(this.player.selectedCoords.z - 0.5);
        
        const block = this.world.getBlock(x, y, z);
        if (block && block.block !== BlockID.Bedrock) {
          const drop = getBlockDrop(block.block);
          if (drop) {
            this.player.inventory.add(drop.id, drop.count);
            this.updateHUD();
          }

          if (this.multiplayer && this.net) {
            this.world.removeBlockNetworked(x, y, z);
            this.net.sendBlock(x, y, z, BlockID.Air);
          } else {
            this.world.removeBlock(x, y, z);
            this.world.edits.push({ x, y, z, b: BlockID.Air });
          }
        }
      } else if (event.button === 2) {
        // Handle food eating first
        const activeSlot = this.player.inventory.slots[this.player.activeToolbarIndex];
        if (activeSlot) {
          const itemDef = ITEMS[activeSlot.id];
          if (itemDef && itemDef.food) {
            this.player.eat(itemDef.food);
            activeSlot.count -= 1;
            if (activeSlot.count <= 0) {
              this.player.inventory.slots[this.player.activeToolbarIndex] = null;
            }
            audioManager.play("step.grass");
            this.updateHUD();
            return;
          }
        }

        // Handle block placement
        if (this.player.blockPlacementCoords && this.player.activeBlockId != null) {
          const playerPos = new THREE.Vector3(
            Math.floor(this.player.position.x),
            Math.floor(this.player.position.y) - 1,
            Math.floor(this.player.position.z)
          );
          const blockPos = new THREE.Vector3(
            Math.floor(this.player.blockPlacementCoords.x - 0.5),
            Math.floor(this.player.blockPlacementCoords.y - 0.5),
            Math.floor(this.player.blockPlacementCoords.z - 0.5)
          );
          if (playerPos.distanceTo(blockPos) <= this.player.radius * 2) return;

          const bid = this.player.activeBlockId;

          // Deduct 1 from hotbar slot
          if (activeSlot) {
            activeSlot.count -= 1;
            if (activeSlot.count <= 0) {
              this.player.inventory.slots[this.player.activeToolbarIndex] = null;
            }
          }

          if (this.multiplayer && this.net) {
            this.world.addBlockNetworked(blockPos.x, blockPos.y, blockPos.z, bid);
            this.net.sendBlock(blockPos.x, blockPos.y, blockPos.z, bid);
          } else {
            this.world.addBlock(blockPos.x, blockPos.y, blockPos.z, bid);
            this.world.edits.push({ x: blockPos.x, y: blockPos.y, z: blockPos.z, b: bid });
          }

          this.updateHUD();
        }
      }
    }
  }

  // Bound so saveAndQuit can remove them.
  private _onMouseDownBound = (e: MouseEvent) => this.onMouseDown(e);
  private _onWindowResizeBound = () => this.onWindowResize();
  private _escapeKeyBound = (e: KeyboardEvent) => {
    if (e.code === "Escape" && this.running && !this.player?.dead) {
      const inv = document.getElementById("inventory-panel");
      const chat = document.getElementById("chat-input");
      if (inv && inv.style.display !== "none") return;
      if (chat && chat === document.activeElement) return;

      if (this.paused) this.unpause();
      else this.pause();
    }
  };

  initListeners() {
    window.addEventListener("resize", this._onWindowResizeBound, false);
    document.addEventListener("mousedown", this._onMouseDownBound, false);
    document.addEventListener("keydown", this._escapeKeyBound);
  }

  onWindowResize() {
    this.orbitCamera.aspect = window.innerWidth / window.innerHeight;
    this.orbitCamera.updateProjectionMatrix();
    this.player.camera.aspect = window.innerWidth / window.innerHeight;
    this.player.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // The block selection outline uses a screen-space line material whose
    // thickness depends on the renderer's pixel resolution. If we don't
    // update it on resize, the outline goes paper-thin or pixel-thick.
    selectionMaterial.resolution.set(window.innerWidth, window.innerHeight);
  }

  updateSkyColor() {
    const elapsedTime = this.clock.getElapsedTime();
    const cycleDuration = this.sunSettings.cycleLength;
    const cycleTime = elapsedTime % cycleDuration;

    let topColor: THREE.Color;
    let bottomColor: THREE.Color;

    if (cycleTime < cycleDuration / 2) {
      topColor = this.dayColor.clone().lerp(this.nightColor, cycleTime / (cycleDuration / 2));
      this.sun.intensity = 1 - cycleTime / (cycleDuration / 2);
    } else {
      topColor = this.nightColor.clone().lerp(this.dayColor, (cycleTime - cycleDuration / 2) / (cycleDuration / 2));
      this.sun.intensity = (cycleTime - cycleDuration / 2) / (cycleDuration / 2);
    }

    const sunsetStart = cycleDuration * 0.4;
    const nightStart = cycleDuration * 0.5;
    const sunriseStart = cycleDuration * 0.9;

    if (cycleTime < sunsetStart) {
      bottomColor = this.dayColor.clone().lerp(this.sunsetColor, cycleTime / sunsetStart);
    } else if (cycleTime < nightStart) {
      bottomColor = this.sunsetColor.clone().lerp(this.nightColor, (cycleTime - sunsetStart) / (nightStart - sunsetStart));
    } else if (cycleTime < sunriseStart) {
      bottomColor = this.nightColor.clone().lerp(this.sunsetColor, (cycleTime - nightStart) / (sunriseStart - nightStart));
    } else {
      bottomColor = this.sunsetColor.clone().lerp(this.dayColor, (cycleTime - sunriseStart) / (cycleDuration - sunriseStart));
    }

    this.sky.material.uniforms.topColor.value = topColor;
    this.sky.material.uniforms.bottomColor.value = bottomColor;
    this.scene.fog?.color.copy(topColor).multiplyScalar(0.2);

    if (performance.now() - this.lastShadowUpdate < this.sunSettings.cycleLength) return;
    const sunAngle = ((2 * Math.PI) / cycleDuration) * (cycleTime + cycleDuration / 6);
    this.updateSunPosition(sunAngle);
    this.lastShadowUpdate = performance.now();
  }

  updateSunPosition(angle: number) {
    const sunX = this.sunSettings.distance * Math.cos(angle);
    const sunY = this.sunSettings.distance * Math.sin(angle);
    this.sun.position.set(sunX, sunY, this.player.camera.position.z);
    this.sun.position.add(this.player.camera.position);
    this.sun.target.position.copy(this.player.camera.position);
    this.sun.target.updateMatrixWorld();
    this.sunHelper.update();
    this.shadowHelper.update();
  }

  updateHUD() {
    const p = this.player;
    const healthVal = document.getElementById("health-val");
    const hungerVal = document.getElementById("hunger-val");
    if (healthVal) healthVal.style.width = `${(p.health / p.maxHealth) * 100}%`;
    if (hungerVal) hungerVal.style.width = `${(p.hunger / p.maxHunger) * 100}%`;

    const posX = document.getElementById("player-pos-x");
    const posY = document.getElementById("player-pos-y");
    const posZ = document.getElementById("player-pos-z");
    if (posX) posX.textContent = `x: ${p.position.x.toFixed(1)}`;
    if (posY) posY.textContent = `y: ${p.position.y.toFixed(1)}`;
    if (posZ) posZ.textContent = `z: ${p.position.z.toFixed(1)}`;

    const triangleCount = document.getElementById("triangle-count");
    if (triangleCount)
      triangleCount.textContent = `tris: ${numberWithCommas(this.renderer.info.render.triangles)}`;
    const renderCalls = document.getElementById("render-calls");
    if (renderCalls)
      renderCalls.textContent = `calls: ${numberWithCommas(this.renderer.info.render.calls)}`;
  }

  draw() {
    if (!this.running) return;

    const currentTime = performance.now();
    const deltaTime = (currentTime - this.previousTime) / 1000;

    requestAnimationFrame(() => this.draw());

    this.updateSkyColor();

    if (!this.paused) {
      this.player.update(deltaTime, this.world, this.physics);
      this.physics.update(deltaTime, this.player, this.world);
      this.world.update(this.player);

      for (const [, rp] of this.remotePlayers) rp.update(deltaTime);

      if (this.net?.connected) {
        this.stateTimer += deltaTime;
        if (this.stateTimer > 0.05) {
          this.stateTimer = 0;
          this.net.sendState({
            x: this.player.pos.x, y: this.player.pos.y, z: this.player.pos.z,
            yaw: this.player.yaw, name: this.myName, health: this.player.health,
          });
        }
      }

      // Auto-save every 30s
      if (this.currentSave) {
        this.autoSaveTimer += deltaTime;
        if (this.autoSaveTimer > 30) {
          this.autoSaveTimer = 0;
          this.saveCurrentWorld();
        }
      }
    }

    this.updateHUD();
    if (this.stats) this.stats.update();
    if (this.controls) this.controls.update();
    TWEEN.update();

    this.renderer.render(
      this.scene,
      this.player.controls.isLocked ? this.player.camera : this.orbitCamera
    );

    this.previousTime = currentTime;
  }
}
