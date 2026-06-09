import TWEEN from "@tweenjs/tween.js";
import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

import audioManager from "./audio/AudioManager";
import { BlockID } from "./Block";
import { BlockFactory } from "./Block/BlockFactory";
import { World } from "./World";
import { Inventory, Slot } from "./Inventory";
import { ITEMS, TOOL_TYPE } from "./Items";

function cuboid(width: number, height: number, depth: number) {
  const hw = width * 0.5;
  const hh = height * 0.5;
  const hd = depth * 0.5;
  return [
    [-hw, -hh, -hd], [-hw, hh, -hd], [hw, hh, -hd], [hw, -hh, -hd],
    [-hw, -hh, -hd], [-hw, -hh, hd], [-hw, hh, hd], [-hw, hh, -hd],
    [-hw, hh, hd], [hw, hh, hd], [hw, hh, -hd], [hw, hh, hd],
    [hw, -hh, hd], [hw, -hh, -hd], [hw, -hh, hd], [-hw, -hh, hd],
  ].flat();
}

const selectionMaterial = new LineMaterial({
  color: 0x000000,
  opacity: 0.9,
  linewidth: 1,
  resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
});
const selectionLineGeometry = new LineGeometry();
selectionLineGeometry.setPositions(cuboid(1.001, 1.001, 1.001));
const CENTER_SCREEN = new THREE.Vector2(0, 0);

const WIDTH = 0.6;
const HEIGHT = 1.8;
const EYE = 1.62;
const GRAVITY = 28;
const JUMP = 9.2;
const SPEED = 4.7;
const SPRINT = 6.9;
const FLY_SPEED = 12;

export class Player {
  height = HEIGHT;
  radius = WIDTH / 2;

  camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.1,
    5000
  );
  cameraHelper = new THREE.CameraHelper(this.camera);
  boundsHelper = new THREE.Mesh(
    new THREE.CylinderGeometry(this.radius, this.radius, this.height, 16),
    new THREE.MeshBasicMaterial({ wireframe: true })
  );
  selectionHelper = new Line2(selectionLineGeometry, selectionMaterial);
  controls = new PointerLockControls(this.camera, document.body);
  raycaster = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(), 0, 5);

  selectedCoords: THREE.Vector3 | null = null;
  selectedBlockSize: THREE.Vector3 | null = null;
  blockPlacementCoords: THREE.Vector3 | null = null;

  // minicraft toolbar (block IDs for placing) — survival starts empty
  toolbar: (BlockID | null)[] = [null, null, null, null, null, null, null, null, null];
  activeToolbarIndex = 0;

  // Nomaecraft survival stats — start near the sky so chunk-load + grass-scan
  // has time to run before we hit the ground. The real spawn y is set in
  // World.update() once the first grass column is found.
  pos = new THREE.Vector3(32, 80, 32);
  vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  onGround = false;
  flying = false;
  sprinting = false;

  health = 20;
  maxHealth = 20;
  hunger = 20;
  maxHunger = 20;
  saturation = 5;
  air = 10;
  dead = false;
  fallStart: number | null = null;
  spawn = new THREE.Vector3(32, 80, 32);
  spawned = false;

  inventory = new Inventory(36);

  // input state
  private input = {
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,
    sprint: false,
    sneak: false,
  };
  private lastWPressed = 0;
  private wKeyPressed = false;
  private lastStepSoundPlayed = 0;
  private _regenT = 0;
  private _starveT = 0;
  private _hungerT = 0;

  // fly toggle
  private _lastSpaceTime = 0;
  private _spaceCount = 0;

  onHurt?: (n: number) => void;
  onDeath?: () => void;

  constructor(private scene: THREE.Scene) {
    this.camera.position.copy(this.pos);
    this.camera.position.y += EYE;
    this.boundsHelper.visible = false;
    this.cameraHelper.visible = false;
    this.selectionHelper.visible = false;
    scene.add(this.camera);
    scene.add(this.cameraHelper);
    scene.add(this.boundsHelper);
    scene.add(this.selectionHelper);

    document.addEventListener("keydown", this._onKeyDown.bind(this));
    document.addEventListener("keyup", this._onKeyUp.bind(this));

  }

  get position() {
    return this.camera.position;
  }

  get activeBlockId() {
    return this.toolbar[this.activeToolbarIndex];
  }

  get worldVelocity() {
    const wv = this.vel.clone();
    wv.applyEuler(new THREE.Euler(0, this.camera.rotation.y, 0));
    return wv;
  }

  applyWorldDeltaVelocity(dv: THREE.Vector3) {
    dv.applyEuler(new THREE.Euler(0, -this.camera.rotation.y, 0));
    this.vel.add(dv);
  }

  update(dt: number, world: World) {
    if (this.dead) return;
    dt = Math.min(dt, 0.05);

    this.sprinting = this.input.sprint && this.input.forward && this.hunger > 0;
    const baseSpeed = this.flying ? FLY_SPEED : this.sprinting ? SPRINT : SPEED;

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let wx = 0, wz = 0;
    if (this.input.forward) { wx -= sin; wz -= cos; }
    if (this.input.back) { wx += sin; wz += cos; }
    if (this.input.left) { wx -= cos; wz += sin; }
    if (this.input.right) { wx += cos; wz -= sin; }
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }

    if (this.flying) {
      this.vel.x = wx * baseSpeed;
      this.vel.z = wz * baseSpeed;
      this.vel.y =
        (this.input.jump ? 1 : 0) * baseSpeed -
        (this.input.sneak ? 1 : 0) * baseSpeed;
    } else {
      const accel = this.onGround ? 14 : 4;
      this.vel.x += (wx * baseSpeed - this.vel.x) * Math.min(1, accel * dt);
      this.vel.z += (wz * baseSpeed - this.vel.z) * Math.min(1, accel * dt);
      this.vel.y -= GRAVITY * dt;
      if (this.input.jump && this.onGround) {
        this.vel.y = JUMP;
        this.onGround = false;
      }
    }

    // move with collision via Physics system (handled externally)
    // The physics system sets pos/vel/onGround
    // We just apply velocity to controls for the camera
    this.controls.moveRight(this.vel.x * dt);
    this.controls.moveForward(-this.vel.z * dt);
    this.position.y += this.vel.y * dt;

    // sync pos from camera
    this.pos.set(
      this.position.x,
      this.position.y - EYE,
      this.position.z
    );

    // fall damage (skip until player has touched ground once after spawn)
    if (!this.flying) {
      if (this.onGround) {
        if (!this.spawned) {
          this.spawned = true;
          this.fallStart = null;
        } else if (this.fallStart !== null) {
          const fell = this.fallStart - this.pos.y;
          if (fell > 3.5) this.damage(Math.floor(fell - 3.0));
          this.fallStart = null;
        }
      } else {
        if (this.vel.y < 0 && this.spawned) {
          if (this.fallStart === null || this.pos.y > this.fallStart)
            this.fallStart = this.pos.y;
        }
      }
    } else {
      this.fallStart = null;
    }

    this._updateStats(dt, wl > 0);
    this._updateBoundsHelper();
    this.updateRaycaster(world);
    this._updateToolbar();
    this._updateCameraFOV();

    // step sounds
    if (this.onGround && wl > 0) {
      const minTimeout = this.sprinting ? 300 : 400;
      if (performance.now() - this.lastStepSoundPlayed > minTimeout) {
        audioManager.play("step.grass");
        this.lastStepSoundPlayed = performance.now();
      }
    }

    // prevent falling through the world
    if (this.position.y < -10) {
      this.position.set(this.spawn.x, this.spawn.y + EYE, this.spawn.z);
      this.vel.set(0, 0, 0);
    }
  }

  private _updateStats(dt: number, moving: boolean) {
    this._hungerT += dt * (moving ? (this.sprinting ? 1.8 : 0.7) : 0.18);
    if (this._hungerT > 8) {
      this._hungerT = 0;
      if (this.saturation > 0)
        this.saturation = Math.max(0, this.saturation - 1);
      else this.hunger = Math.max(0, this.hunger - 1);
    }

    if (this.hunger >= 18 && this.health < this.maxHealth) {
      this._regenT += dt;
      if (this._regenT > 3.5) {
        this.health = Math.min(this.maxHealth, this.health + 1);
        this._regenT = 0;
      }
    } else {
      this._regenT = 0;
    }

    if (this.hunger <= 0) {
      this._starveT += dt;
      if (this._starveT > 4) {
        this.damage(1);
        this._starveT = 0;
      }
    }
  }

  eat(food: { hunger: number; sat: number }) {
    this.hunger = Math.min(this.maxHunger, this.hunger + food.hunger);
    this.saturation = Math.min(this.hunger, this.saturation + food.sat);
  }

  damage(n: number) {
    if (this.dead) return;
    this.health -= n;
    this.onHurt?.(n);
    if (this.health <= 0) {
      this.health = 0;
      this.die();
    }
  }

  die() {
    this.dead = true;
    this.onDeath?.();
  }

  respawn() {
    this.dead = false;
    this.health = this.maxHealth;
    this.hunger = this.maxHunger;
    this.saturation = 5;
    this.air = 10;
    this.vel.set(0, 0, 0);
    this.pos.copy(this.spawn);
    this.position.set(this.spawn.x, this.spawn.y + EYE, this.spawn.z);
    this.fallStart = null;
  }

  private _updateBoundsHelper() {
    this.boundsHelper.position.copy(this.camera.position);
    this.boundsHelper.position.y -= this.height / 2;
  }

  updateRaycaster(world: World) {
    this.raycaster.setFromCamera(CENTER_SCREEN, this.camera);
    const intersections = this.raycaster.intersectObjects(world.children, true);

    if (intersections.length > 0) {
      const intersection = intersections[0];
      const chunk = intersection.object.parent;

      if (intersection.instanceId == null || !chunk) {
        this.selectionHelper.visible = false;
        return;
      }

      const blockMatrix = new THREE.Matrix4();
      (intersection.object as THREE.InstancedMesh).getMatrixAt(
        intersection.instanceId,
        blockMatrix
      );

      const rotationMatrix = new THREE.Matrix4().extractRotation(blockMatrix);
      const inverseRotationMatrix = rotationMatrix.invert();
      blockMatrix.multiply(inverseRotationMatrix);

      this.selectedCoords = chunk.position.clone();
      this.selectedCoords.applyMatrix4(blockMatrix);

      const boundingBox = new THREE.Box3().setFromObject(intersection.object);
      this.selectedBlockSize = boundingBox.getSize(new THREE.Vector3());

      if (this.activeBlockId !== BlockID.Air && intersection.normal) {
        this.blockPlacementCoords = this.selectedCoords
          .clone()
          .add(intersection.normal);
      }

      this.selectionHelper.position.copy(this.selectedCoords);
      this.selectionHelper.visible = true;
    } else {
      this.selectedCoords = null;
      this.selectionHelper.visible = false;
    }
  }

  private _updateToolbar() {
    for (let i = 1; i <= 9; i++) {
      const slot = document.getElementById(`toolbar-slot-${i}`);
      if (slot) {
        const blockId = this.toolbar[i - 1];
        if (blockId != null && blockId !== BlockID.Air) {
          slot.style.backgroundImage = `url('${BlockFactory.getBlock(blockId).uiTexture}')`;
        }
      }
    }
  }

  private _updateCameraFOV() {
    const currentFov = { fov: this.camera.fov };
    const targetFov = this.sprinting ? 80 : 70;
    new TWEEN.Tween(currentFov)
      .to({ fov: targetFov }, 30)
      .easing(TWEEN.Easing.Quadratic.Out)
      .onUpdate(() => {
        this.camera.fov = currentFov.fov;
        this.camera.updateProjectionMatrix();
      })
      .start();
  }

  private _onKeyDown(event: KeyboardEvent) {
    // Don't handle keys if chat is focused or inventory is open
    const chatInput = document.getElementById("chat-input");
    if (chatInput && chatInput === document.activeElement) return;
    const invPanel = document.getElementById("inventory-panel");
    if (invPanel && invPanel.style.display !== "none") {
      if (event.code === "KeyE" || event.code === "Escape") {
        invPanel.style.display = "none";
        this.controls.lock();
      }
      return;
    }

    const validKeys = ["KeyW", "KeyA", "KeyS", "KeyD", "KeyR"];
    if (validKeys.includes(event.code) && !this.controls.isLocked) {
      this.controls.lock();
    }

    switch (event.code) {
      case "Digit1": case "Digit2": case "Digit3": case "Digit4":
      case "Digit5": case "Digit6": case "Digit7": case "Digit8":
      case "Digit9":
        this.activeToolbarIndex = Number(event.key) - 1;
        this.inventory.selected = this.activeToolbarIndex;
        document
          ?.getElementById("hotbar-active")
          ?.setAttribute(
            "style",
            `left: ${this.activeToolbarIndex * 46 + this.activeToolbarIndex * 2}px`
          );
        break;
      case "KeyW":
        this.input.forward = true;
        if (!this.wKeyPressed && performance.now() - this.lastWPressed < 200) {
          this.input.sprint = true;
        }
        this.wKeyPressed = true;
        this.lastWPressed = performance.now();
        break;
      case "KeyA":
        this.input.left = true;
        break;
      case "KeyS":
        this.input.back = true;
        break;
      case "KeyD":
        this.input.right = true;
        break;
      case "Space":
        this.input.jump = true;
        // survival mode: flying disabled
        break;
      case "ShiftLeft":
        this.input.sneak = true;
        break;
      case "KeyE":
        // toggle inventory
        if (this.controls.isLocked) {
          this.controls.unlock();
          if (invPanel) invPanel.style.display = "flex";
        }
        break;
      case "KeyR":
        this.position.set(this.spawn.x, this.spawn.y + EYE, this.spawn.z);
        this.vel.set(0, 0, 0);
        break;
      case "F3":
        event.preventDefault();
        const dbg = document.getElementById("debug");
        if (dbg) dbg.style.display = dbg.style.display === "none" ? "flex" : "none";
        break;
    }
  }

  private _onKeyUp(event: KeyboardEvent) {
    switch (event.code) {
      case "KeyW":
        this.input.forward = false;
        this.wKeyPressed = false;
        this.input.sprint = false;
        break;
      case "KeyA":
        this.input.left = false;
        break;
      case "KeyS":
        this.input.back = false;
        break;
      case "KeyD":
        this.input.right = false;
        break;
      case "Space":
        this.input.jump = false;
        break;
      case "ShiftLeft":
        this.input.sneak = false;
        break;
    }
  }
}
