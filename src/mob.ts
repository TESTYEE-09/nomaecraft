// Simple wandering mobs: passive cows by day, hostile-looking zombies that
// drift toward the player by night. No combat/damage system — they're decor
// and ambience, not a threat (yet).

import * as THREE from 'three';
import { CHUNK_SIZE, RENDER_DISTANCE, WORLD_HEIGHT } from './constants';
import type { Player } from './player';
import type { World } from './world';

export const enum MobKind {
  Cow,
  Zombie,
}

const cowBodyGeo = new THREE.BoxGeometry(0.9, 0.6, 0.5);
const cowHeadGeo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
const cowBodyMat = new THREE.MeshLambertMaterial({ color: 0xe8e2d6 });
const cowHeadMat = new THREE.MeshLambertMaterial({ color: 0x6b4a32 });

const zombieBodyGeo = new THREE.BoxGeometry(0.5, 1.1, 0.3);
const zombieHeadGeo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
const zombieBodyMat = new THREE.MeshLambertMaterial({ color: 0x3f6b3f });
const zombieHeadMat = new THREE.MeshLambertMaterial({ color: 0x4d7a4d });

function buildMesh(kind: MobKind): THREE.Group {
  const group = new THREE.Group();
  if (kind === MobKind.Cow) {
    const body = new THREE.Mesh(cowBodyGeo, cowBodyMat);
    body.position.y = 0.5;
    const head = new THREE.Mesh(cowHeadGeo, cowHeadMat);
    head.position.set(0, 0.55, 0.4);
    group.add(body, head);
  } else {
    const body = new THREE.Mesh(zombieBodyGeo, zombieBodyMat);
    body.position.y = 0.75;
    const head = new THREE.Mesh(zombieHeadGeo, zombieHeadMat);
    head.position.set(0, 1.5, 0);
    group.add(body, head);
  }
  return group;
}

const WANDER_INTERVAL = 3;

export class Mob {
  readonly kind: MobKind;
  readonly mesh: THREE.Group;
  position = new THREE.Vector3();
  private heading = Math.random() * Math.PI * 2;
  private wanderTimer = Math.random() * WANDER_INTERVAL;
  age = 0;

  constructor(kind: MobKind, x: number, y: number, z: number) {
    this.kind = kind;
    this.position.set(x, y, z);
    this.mesh = buildMesh(kind);
    this.mesh.position.copy(this.position);
  }

  update(dt: number, world: World, player: Player, isNight: boolean): void {
    this.age += dt;
    const speed = this.kind === MobKind.Zombie ? 1.6 : 1.1;

    if (this.kind === MobKind.Zombie && isNight) {
      const dx = player.position.x - this.position.x;
      const dz = player.position.z - this.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 12 && dist > 0.01) {
        this.heading = Math.atan2(dx, dz);
      }
    } else {
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) {
        this.wanderTimer = WANDER_INTERVAL * (0.6 + Math.random() * 0.8);
        this.heading += (Math.random() - 0.5) * Math.PI;
      }
    }

    const dirX = Math.sin(this.heading);
    const dirZ = Math.cos(this.heading);
    const nx = this.position.x + dirX * speed * dt;
    const nz = this.position.z + dirZ * speed * dt;

    // Avoid walking off ledges or into walls: only move if the destination
    // column's surface is within one block of the current one.
    const curY = world.surfaceY(Math.floor(this.position.x), Math.floor(this.position.z));
    const nextY = world.surfaceY(Math.floor(nx), Math.floor(nz));
    if (Math.abs(nextY - curY) <= 1) {
      this.position.x = nx;
      this.position.z = nz;
      this.position.y = nextY + 1;
    } else {
      this.wanderTimer = 0; // pick a new direction immediately next tick
    }

    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.heading;
  }
}

const MAX_MOBS = 12;
const SPAWN_INTERVAL = 4;
const SPAWN_RADIUS = RENDER_DISTANCE * CHUNK_SIZE * 0.7;
const DESPAWN_RADIUS = RENDER_DISTANCE * CHUNK_SIZE * 1.4;

export class MobManager {
  readonly group = new THREE.Group();
  private mobs: Mob[] = [];
  private spawnTimer = SPAWN_INTERVAL;

  update(dt: number, world: World, player: Player, isNight: boolean): void {
    for (const mob of this.mobs) mob.update(dt, world, player, isNight);

    // Despawn mobs that wandered too far away.
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const m = this.mobs[i];
      const dist = Math.hypot(m.position.x - player.position.x, m.position.z - player.position.z);
      if (dist > DESPAWN_RADIUS) {
        this.group.remove(m.mesh);
        this.mobs.splice(i, 1);
      }
    }

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = SPAWN_INTERVAL;
      if (this.mobs.length < MAX_MOBS) this.trySpawn(world, player, isNight);
    }
  }

  private trySpawn(world: World, player: Player, isNight: boolean): void {
    const angle = Math.random() * Math.PI * 2;
    const dist = SPAWN_RADIUS * (0.4 + Math.random() * 0.6);
    const x = Math.floor(player.position.x + Math.sin(angle) * dist);
    const z = Math.floor(player.position.z + Math.cos(angle) * dist);
    const y = world.surfaceY(x, z);
    if (y <= 0 || y >= WORLD_HEIGHT - 2) return;
    const kind = isNight ? MobKind.Zombie : MobKind.Cow;
    const mob = new Mob(kind, x + 0.5, y + 1, z + 0.5);
    this.mobs.push(mob);
    this.group.add(mob.mesh);
  }
}
