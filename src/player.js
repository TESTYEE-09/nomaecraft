import { BLOCK, blockDefs } from './blocks.js';

const WIDTH = 0.6, HEIGHT = 1.8, EYE = 1.62;
const GRAVITY = 28, JUMP = 9.2, SPEED = 4.7, SPRINT = 6.9, FLY_SPEED = 12;

export class Player {
  constructor(THREE, camera, world) {
    this.THREE = THREE;
    this.camera = camera;
    this.world = world;
    this.pos = new THREE.Vector3(8, 50, 8);
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.onGround = false;
    this.flying = false;
    this.sprinting = false;
    // stats
    this.health = 20; this.maxHealth = 20;
    this.hunger = 20; this.maxHunger = 20;
    this.saturation = 5;
    this.air = 10;            // breath when underwater
    this.dead = false;
    this.fallStart = null;
    this._regenT = 0; this._starveT = 0; this._hungerT = 0;
    this.spawn = new THREE.Vector3(8, 50, 8);
  }

  setSpawnToSurface() {
    const w = this.world;
    let y = 60;
    while (y > 1 && w.getBlock(8, y, 8) === BLOCK.AIR) y--;
    this.pos.set(8.5, y + 2, 8.5);
    this.spawn.copy(this.pos);
  }

  aabbCollide(pos) {
    const w = this.world;
    const minX = Math.floor(pos.x - WIDTH / 2), maxX = Math.floor(pos.x + WIDTH / 2);
    const minY = Math.floor(pos.y), maxY = Math.floor(pos.y + HEIGHT);
    const minZ = Math.floor(pos.z - WIDTH / 2), maxZ = Math.floor(pos.z + WIDTH / 2);
    for (let x = minX; x <= maxX; x++)
      for (let y = minY; y <= maxY; y++)
        for (let z = minZ; z <= maxZ; z++)
          if (w.isSolid(x, y, z)) return true;
    return false;
  }

  headInWater() {
    return this.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + EYE), Math.floor(this.pos.z)) === BLOCK.WATER;
  }
  feetInWater() {
    return this.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y), Math.floor(this.pos.z)) === BLOCK.WATER;
  }

  update(dt, input) {
    if (this.dead) return;
    const THREE = this.THREE;
    dt = Math.min(dt, 0.05);

    // look
    this.yaw -= input.mouseDX * 0.0022;
    this.pitch -= input.mouseDY * 0.0022;
    this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));
    input.mouseDX = 0; input.mouseDY = 0;

    const inWater = this.feetInWater();
    this.sprinting = input.sprint && (input.forward) && this.hunger > 0;
    const baseSpeed = this.flying ? FLY_SPEED : (this.sprinting ? SPRINT : SPEED);

    // wish direction
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let wx = 0, wz = 0;
    if (input.forward) { wx -= sin; wz -= cos; }
    if (input.back) { wx += sin; wz += cos; }
    if (input.left) { wx -= cos; wz += sin; }
    if (input.right) { wx += cos; wz -= sin; }
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }

    if (this.flying) {
      this.vel.x = wx * baseSpeed;
      this.vel.z = wz * baseSpeed;
      this.vel.y = (input.jump ? 1 : 0) * baseSpeed - (input.sneak ? 1 : 0) * baseSpeed;
    } else {
      const accel = this.onGround ? 14 : 4;
      this.vel.x += (wx * baseSpeed - this.vel.x) * Math.min(1, accel * dt);
      this.vel.z += (wz * baseSpeed - this.vel.z) * Math.min(1, accel * dt);
      const g = inWater ? GRAVITY * 0.32 : GRAVITY;
      this.vel.y -= g * dt;
      if (inWater) { this.vel.y *= 0.86; if (input.jump) this.vel.y = 4.0; this.vel.y = Math.max(this.vel.y, -4); }
      else if (input.jump && this.onGround) { this.vel.y = JUMP; this.onGround = false; }
    }

    this.moveAxis('x', this.vel.x * dt);
    const groundedBefore = this.onGround;
    this.moveAxis('y', this.vel.y * dt);
    this.moveAxis('z', this.vel.z * dt);

    // fall damage tracking
    if (!this.flying && !inWater) {
      if (this.onGround) {
        if (this.fallStart !== null) {
          const fell = this.fallStart - this.pos.y;
          if (fell > 3.5) this.damage(Math.floor(fell - 3.0));
          this.fallStart = null;
        }
      } else {
        if (this.vel.y < 0) {
          if (this.fallStart === null || this.pos.y > this.fallStart) this.fallStart = this.pos.y;
        }
      }
    } else this.fallStart = null;

    this.updateStats(dt, wl > 0);

    // camera
    this.camera.position.set(this.pos.x, this.pos.y + EYE - (this.sprinting ? 0 : 0), this.pos.z);
    const q = new THREE.Quaternion();
    q.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    this.camera.quaternion.copy(q);
    this.camera.fov = this.sprinting ? 78 : 72;
    this.camera.updateProjectionMatrix();
  }

  moveAxis(axis, amount) {
    if (amount === 0) return;
    const next = this.pos.clone();
    next[axis] += amount;
    if (!this.aabbCollide(next)) { this.pos[axis] = next[axis]; if (axis === 'y') this.onGround = false; return; }
    // blocked
    if (axis === 'y') { if (amount < 0) this.onGround = true; this.vel.y = 0; }
    else this.vel[axis] = 0;
  }

  updateStats(dt, moving) {
    // breath
    if (this.headInWater()) {
      this.air -= dt;
      if (this.air <= 0) { this.air = 0; this._starveT += dt; if (this._starveT > 1) { this.damage(2); this._starveT = 0; } }
    } else { this.air = Math.min(10, this.air + dt * 4); }

    // hunger drain from activity
    this._hungerT += dt * (moving ? (this.sprinting ? 1.8 : 0.7) : 0.18);
    if (this._hungerT > 8) {
      this._hungerT = 0;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else this.hunger = Math.max(0, this.hunger - 1);
    }

    // regen / starve
    if (this.hunger >= 18 && this.health < this.maxHealth) {
      this._regenT += dt;
      if (this._regenT > 3.5) { this.health = Math.min(this.maxHealth, this.health + 1); this._regenT = 0; }
    } else this._regenT = 0;

    if (this.hunger <= 0) {
      this._starveT += dt;
      if (this._starveT > 4) { this.damage(1); this._starveT = 0; }
    }
  }

  eat(food) {
    this.hunger = Math.min(this.maxHunger, this.hunger + food.hunger);
    this.saturation = Math.min(this.hunger, this.saturation + food.sat);
  }

  damage(n) {
    if (this.dead) return;
    this.health -= n;
    this.onHurt && this.onHurt(n);
    if (this.health <= 0) { this.health = 0; this.die(); }
  }

  heal(n) { this.health = Math.min(this.maxHealth, this.health + n); }

  die() {
    this.dead = true;
    this.onDeath && this.onDeath();
  }

  respawn() {
    this.dead = false;
    this.health = this.maxHealth;
    this.hunger = this.maxHunger;
    this.saturation = 5;
    this.air = 10;
    this.vel.set(0, 0, 0);
    this.pos.copy(this.spawn);
    this.fallStart = null;
  }
}
