// Dropped items: world entities you can walk over to pick up, or you can throw
// one out of your hotbar with Q. Each drop spins and bobs in place, falls with
// gravity, and despawns after DESPAWN seconds. Picking up uses an AABB
// distance check; if the inventory has no room the drop stays put.

import { BLOCK, blockDefs } from './blocks.js';
import { ITEMS } from './items.js';

const PICKUP_RADIUS = 1.6;          // generous — items on the ground are within reach
const PICKUP_RADIUS_SQ = PICKUP_RADIUS * PICKUP_RADIUS;
const DESPAWN = 300;            // 5 minutes
const MAGNET_DIST = 2.0;        // start homing in once this close (was 1.2 — too short)
const MAGNET_SPEED = 6.0;       // faster pull (was 4.0)

let _nextId = 1;

export class Drop {
  /**
   * @param {THREE} THREE
   * @param {THREE.Scene} scene
   * @param {{iconCanvas: HTMLCanvasElement, isBlock: boolean, itemId: string, atlas: any}} visual
   * @param {number} x  world x (centre of the drop)
   * @param {number} y  world y (foot of the drop)
   * @param {number} z  world z
   * @param {number} count  stack size (visual only; pickup always takes the whole drop)
   */
  constructor(THREE, scene, itemId, iconCanvas, isBlock, x, y, z, count = 1) {
    this.id = 'd' + (_nextId++);
    this.THREE = THREE;
    this.itemId = itemId;
    this.count = count;
    this.isBlock = isBlock;
    this.spawnT = performance.now() / 1000;
    this.dead = false;

    this.pos = new THREE.Vector3(x, y, z);
    this.vel = new THREE.Vector3((Math.random() - 0.5) * 1.5, 2.5, (Math.random() - 0.5) * 1.5);
    this.onGround = false;
    this.spin = (Math.random() * 4 + 2) * (Math.random() < 0.5 ? -1 : 1);
    this.bobPhase = Math.random() * Math.PI * 2;
    // cached ground-collision state (re-scanned only when x/z column changes)
    this._lastGX = -9999; this._lastGZ = -9999; this._groundY = 0; this._groundDirty = true;
    this.world = null; // set by DropManager.update before our update runs

    // ---- mesh: a 0.35-unit textured plane facing up-ish, billboarded
    const tex = new THREE.CanvasTexture(iconCanvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide, depthWrite: true });
    // 0.5 x 0.5 unit billboard quad
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), mat);
    this.mesh.position.copy(this.pos);
    this.mesh.userData.drop = this; // for raycasts / hits
    scene.add(this.mesh);

    // small shadow blob underneath
    const shMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false });
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), shMat);
    this.shadow.rotation.x = -Math.PI / 2;
    scene.add(this.shadow);

    // count label as a small canvas sprite (only if > 1)
    if (count > 1) {
      this.label = makeCountLabel(THREE, count);
      this.mesh.add(this.label);
    }
  }

  update(dt, scene, player, onPickup) {
    if (this.dead) return;
    const THREE = this.THREE;
    const age = performance.now() / 1000 - this.spawnT;
    if (age > DESPAWN) { this.remove(scene); return; }

    // physics (tiny: gravity + ground)
    this.vel.y -= 22 * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;
    // ground collision: rescan when the column changes OR when falling
    const gx = Math.floor(this.pos.x), gz = Math.floor(this.pos.z);
    const columnChanged = gx !== this._lastGX || gz !== this._lastGZ;
    if (columnChanged) { this._lastGX = gx; this._lastGZ = gz; this._groundDirty = true; }
    // rescan ground when column changed or when we're falling and haven't scanned yet
    if (this._groundDirty || (this.vel.y < 0 && !this.onGround)) {
      const w = this.world;
      if (w) {
        // scan downward from just above the drop's current y
        let y = Math.min(127, Math.max(0, Math.floor(this.pos.y)));
        while (y > 0 && !w.isSolid(gx, y, gz) && w.getBlock(gx, y, gz) !== BLOCK.WATER) y--;
        if (w.isSolid(gx, y, gz) || w.getBlock(gx, y, gz) === BLOCK.WATER) {
          this._groundY = y + 1;
          this._groundDirty = false;
        } else {
          // chunk not loaded — keep scanning next frame, suspend at current pos
          this._groundY = Math.max(1, Math.floor(this.pos.y));
          this._groundDirty = true;
        }
      } else { this._groundY = Math.max(1, Math.floor(this.pos.y)); }
    }
    if (this.pos.y < this._groundY + 0.05) {
      this.pos.y = this._groundY + 0.05;
      this.vel.y = 0;
      this.vel.x *= 0.6; this.vel.z *= 0.6;
      this.onGround = true;
    }

    // mild magnetic pull once the player gets close. Doesn't require
    // onGround anymore — if a drop pops into the air near the player we
    // still want it to home in (otherwise it can land 2+ blocks away
    // and be just outside the pickup circle).
    const dx = player.pos.x - this.pos.x;
    const dy = (player.pos.y + 0.9) - this.pos.y;
    const dz = player.pos.z - this.pos.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq < MAGNET_DIST * MAGNET_DIST) {
      const dist = Math.sqrt(distSq) || 1;
      // Stronger pull as the drop gets closer (1/r falloff clamped) so
      // distant items accelerate but very-close ones snap in fast.
      const pull = MAGNET_SPEED * (1 + (1 - dist / MAGNET_DIST));
      this.vel.x += (dx / dist) * pull * dt;
      this.vel.y += (dy / dist) * pull * dt;
      this.vel.z += (dz / dist) * pull * dt;
    }

    // billboard: face the player horizontally, with a tilt
    this.mesh.position.copy(this.pos);
    if (this.onGround) {
      this.mesh.rotation.y += this.spin * dt;
      // gentle bob
      this.mesh.position.y += Math.sin(performance.now() * 0.004 + this.bobPhase) * 0.04;
    } else {
      // while airborne face the camera
      this.mesh.lookAt(player.pos.x, this.pos.y, player.pos.z);
    }
    this.shadow.position.set(this.pos.x, this._groundY + 0.01, this.pos.z);
    // fade in the last 5s of life
    if (age > DESPAWN - 5) {
      const k = (DESPAWN - age) / 5;
      this.mesh.material.opacity = Math.max(0, k);
      this.shadow.material.opacity = 0.25 * k;
    }

    // pickup test
    if (distSq < PICKUP_RADIUS_SQ) {
      const left = onPickup(this.itemId, this.count);
      if (left <= 0) { this.remove(scene); return; }
      // if there's still leftover (inventory full), reduce the count and stay
      this.count = left;
      if (this.label) {
        this.mesh.remove(this.label);
        this.label = makeCountLabel(THREE, this.count);
        this.mesh.add(this.label);
      }
    }
  }

  remove(scene) {
    this.dead = true;
    scene.remove(this.mesh);
    scene.remove(this.shadow);
    if (this.mesh.material.map) this.mesh.material.map.dispose();
    this.mesh.material.dispose();
    this.mesh.geometry.dispose();
    this.shadow.material.dispose();
    this.shadow.geometry.dispose();
  }
}

function makeCountLabel(THREE, count) {
  const cv = document.createElement('canvas'); cv.width = 32; cv.height = 16;
  const ctx = cv.getContext('2d');
  ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'right';
  ctx.lineWidth = 3; ctx.strokeStyle = '#000';
  ctx.strokeText(String(count), 30, 13);
  ctx.fillStyle = '#fff';
  ctx.fillText(String(count), 30, 13);
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.09), mat);
  m.position.set(0.12, 0.12, 0.01);
  return m;
}

// ---- manager ----------------------------------------------------------------

export class DropManager {
  /**
   * @param {THREE} THREE
   * @param {THREE.Scene} scene
   * @param {() => HTMLCanvasElement} getIconCanvas  // itemId -> canvas
   */
  constructor(THREE, scene, getIconCanvas) {
    this.THREE = THREE;
    this.scene = scene;
    this.getIconCanvas = getIconCanvas;
    this.drops = [];
  }

  /**
   * Spawn a drop with an initial random pop velocity.
   * @param {string} itemId
   * @param {number} count
   * @param {THREE.Vector3|{x:number,y:number,z:number}} at
   * @param {THREE.Vector3|{x:number,y:number,z:number}} [eject]  initial velocity
   */
  spawn(itemId, count, at, eject) {
    if (!ITEMS[itemId]) return null;
    const iconCanvas = this.getIconCanvas(itemId);
    if (!iconCanvas) return null;
    const isBlock = ITEMS[itemId].block !== undefined;
    const d = new Drop(this.THREE, this.scene, itemId, iconCanvas, isBlock, at.x, at.y, at.z, count);
    if (eject) { d.vel.set(eject.x || 0, eject.y ?? 0, eject.z || 0); }
    this.drops.push(d);
    return d;
  }

  update(dt, player, world, inventory) {
    // expose world to drops (used for ground collision in their own update)
    for (const d of this.drops) d.world = world;
    for (const d of this.drops) d.update(dt, this.scene, player, (id, n) => inventory.add(id, n));
    this.drops = this.drops.filter(d => !d.dead);
  }

  clear() {
    for (const d of this.drops) d.remove(this.scene);
    this.drops = [];
  }
}
