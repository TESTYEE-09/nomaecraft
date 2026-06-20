// Player controller: first-person camera with pointer lock, AABB-vs-voxel
// collision, walking/sprinting/jumping, and a creative fly toggle.

import * as THREE from 'three';
import { isSolid } from './blocks';
import {
  FLY_SPEED,
  GRAVITY,
  JUMP_SPEED,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  SPRINT_SPEED,
  TERMINAL_VELOCITY,
  WALK_SPEED,
  WORLD_HEIGHT,
} from './constants';
import type { World } from './world';

export class Player {
  readonly camera: THREE.PerspectiveCamera;
  // Position is the player's feet centre; eye is feet + eyeHeight.
  position = new THREE.Vector3();
  velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  onGround = false;
  flying = false;

  private readonly eyeHeight = PLAYER_HEIGHT - 0.2;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
  }

  setSpawn(x: number, y: number, z: number): void {
    this.position.set(x + 0.5, y, z + 0.5);
    this.velocity.set(0, 0, 0);
  }

  /** Apply mouse look from pointer-lock movement deltas. */
  look(dx: number, dz: number): void {
    const sens = 0.0022;
    this.yaw -= dx * sens;
    this.pitch -= dz * sens;
    const limit = Math.PI / 2 - 0.001;
    this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
  }

  getForward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
  }
  getRight(out: THREE.Vector3): THREE.Vector3 {
    return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();
  }

  /**
   * Advance physics by dt seconds. `input` is the set of movement keys held.
   * Collision is resolved per-axis against the voxel grid.
   */
  update(dt: number, input: InputState, world: World): void {
    // Cap dt so a stutter doesn't tunnel the player through terrain.
    dt = Math.min(dt, 0.05);

    const forward = this.getForward(new THREE.Vector3());
    const right = this.getRight(new THREE.Vector3());
    const wish = new THREE.Vector3();
    if (input.forward) wish.add(forward);
    if (input.back) wish.sub(forward);
    if (input.right) wish.add(right);
    if (input.left) wish.sub(right);
    if (wish.lengthSq() > 0) wish.normalize();

    if (this.flying) {
      const speed = input.sprint ? FLY_SPEED * 2.0 : FLY_SPEED;
      this.velocity.x = wish.x * speed;
      this.velocity.z = wish.z * speed;
      this.velocity.y = 0;
      if (input.jump) this.velocity.y = speed;
      if (input.crouch) this.velocity.y = -speed;
    } else {
      const speed = input.sprint ? SPRINT_SPEED : WALK_SPEED;
      this.velocity.x = wish.x * speed;
      this.velocity.z = wish.z * speed;
      this.velocity.y -= GRAVITY * dt;
      if (this.velocity.y < -TERMINAL_VELOCITY) this.velocity.y = -TERMINAL_VELOCITY;
      if (input.jump && this.onGround) {
        this.velocity.y = JUMP_SPEED;
        this.onGround = false;
      }
    }

    // Move + collide axis by axis.
    const dx = this.velocity.x * dt;
    const dy = this.velocity.y * dt;
    const dz = this.velocity.z * dt;
    this.moveAxis(world, dx, 0, 0);
    const groundedBefore = this.onGround;
    this.onGround = false;
    this.moveAxis(world, 0, dy, 0);
    if (this.velocity.y === 0 && dy < 0 && !this.flying) this.onGround = true;
    if (this.flying) this.onGround = false;
    void groundedBefore;
    this.moveAxis(world, 0, 0, dz);

    // Void protection: respawn if you fall out of the world.
    if (this.position.y < -10) {
      this.velocity.set(0, 0, 0);
      const sy = world.surfaceY(Math.floor(this.position.x), Math.floor(this.position.z));
      this.position.y = sy + 2;
    }

    // Update camera transform from yaw/pitch/position.
    this.camera.position.set(this.position.x, this.position.y + this.eyeHeight, this.position.z);
    const e = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(e);
  }

  /**
   * Move along a single axis by `amt`, resolving collisions against voxels.
   * On collision, snaps to the block boundary and zeroes velocity on that axis.
   */
  private moveAxis(world: World, ax: number, ay: number, az: number): void {
    this.position.x += ax;
    this.position.y += ay;
    this.position.z += az;

    // Player AABB.
    const minX = this.position.x - PLAYER_RADIUS;
    const maxX = this.position.x + PLAYER_RADIUS;
    const minY = this.position.y;
    const maxY = this.position.y + PLAYER_HEIGHT;
    const minZ = this.position.z - PLAYER_RADIUS;
    const maxZ = this.position.z + PLAYER_RADIUS;

    const x0 = Math.floor(minX), x1 = Math.floor(maxX);
    const y0 = Math.floor(minY), y1 = Math.floor(maxY);
    const z0 = Math.floor(minZ), z1 = Math.floor(maxZ);

    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          if (y < 0 || y >= WORLD_HEIGHT) continue;
          if (!isSolid(world.getBlock(x, y, z))) continue;
          // Resolve along the axis we moved.
          if (ax > 0) this.position.x = x - PLAYER_RADIUS - 1e-4;
          else if (ax < 0) this.position.x = x + 1 + PLAYER_RADIUS + 1e-4;
          else if (ay > 0) {
            this.position.y = y - PLAYER_HEIGHT - 1e-4;
            this.velocity.y = 0;
          } else if (ay < 0) {
            this.position.y = y + 1 + 1e-4;
            this.velocity.y = 0;
          } else if (az > 0) this.position.z = z - PLAYER_RADIUS - 1e-4;
          else if (az < 0) this.position.z = z + 1 + PLAYER_RADIUS + 1e-4;
        }
      }
    }
  }
}

export interface InputState {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  crouch: boolean;
  sprint: boolean;
}
