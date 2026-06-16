import * as THREE from "three";

import { BlockID } from "./Block";
import { BlockFactory } from "./Block/BlockFactory";
import { Player } from "./Player";
import { World } from "./World";

type Candidate = {
  block: BlockID;
  x: number;
  y: number;
  z: number;
};

type Collision = {
  candidate: Candidate;
  contactPoint: THREE.Vector3;
  normal: THREE.Vector3;
  overlap: number;
};

const collisionMaterial = new THREE.MeshBasicMaterial({
  color: 0xff0000,
  transparent: true,
  opacity: 0.2,
});
const collisionGeometry = new THREE.BoxGeometry(1.001, 1.001, 1.001);

const contactMaterial = new THREE.MeshBasicMaterial({
  wireframe: true,
  color: 0x00ff00,
});
const contactGeometry = new THREE.SphereGeometry(0.05, 6, 6);

export class Physics {
  helpers: THREE.Group;

  constructor(scene: THREE.Scene) {
    this.helpers = new THREE.Group();
    this.helpers.visible = false;
    scene.add(this.helpers);
  }

  update(dt: number, player: Player, world: World) {
    // Stub for compatibility, real logic is in move() called by player
  }

  isSolid(x: number, y: number, z: number, world: World): boolean {
    if (y < 0 || y >= world.chunkSize.height) return false;
    const block = world.getBlock(x, y, z);
    if (!block) return false;
    const blockClass = BlockFactory.getBlock(block.block);
    return !blockClass.canPassThrough;
  }

  move(player: Player, displacement: THREE.Vector3, world: World) {
    player.onGround = false;

    // 1. Move X
    player.pos.x += displacement.x;
    this.resolveX(player, world, displacement.x);

    // 2. Move Z
    player.pos.z += displacement.z;
    this.resolveZ(player, world, displacement.z);

    // 3. Move Y
    player.pos.y += displacement.y;
    this.resolveY(player, world, displacement.y);

    // Sync camera position back from player.pos
    player.camera.position.set(
      player.pos.x,
      player.pos.y + 1.62, // 1.62 is EYE height
      player.pos.z
    );
  }

  resolveX(player: Player, world: World, dx: number) {
    const minX = Math.floor(player.pos.x - player.radius);
    const maxX = Math.floor(player.pos.x + player.radius);
    const minY = Math.floor(player.pos.y);
    const maxY = Math.floor(player.pos.y + player.height);
    const minZ = Math.floor(player.pos.z - player.radius);
    const maxZ = Math.floor(player.pos.z + player.radius);

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          if (this.isSolid(x, y, z, world)) {
            const bMinX = x;
            const bMaxX = x + 1;
            const pMinX = player.pos.x - player.radius;
            const pMaxX = player.pos.x + player.radius;

            if (pMinX < bMaxX && pMaxX > bMinX) {
              if (dx > 0) {
                player.pos.x = bMinX - player.radius - 0.001;
                player.vel.x = 0;
              } else if (dx < 0) {
                player.pos.x = bMaxX + player.radius + 0.001;
                player.vel.x = 0;
              }
            }
          }
        }
      }
    }
  }

  resolveZ(player: Player, world: World, dz: number) {
    const minX = Math.floor(player.pos.x - player.radius);
    const maxX = Math.floor(player.pos.x + player.radius);
    const minY = Math.floor(player.pos.y);
    const maxY = Math.floor(player.pos.y + player.height);
    const minZ = Math.floor(player.pos.z - player.radius);
    const maxZ = Math.floor(player.pos.z + player.radius);

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          if (this.isSolid(x, y, z, world)) {
            const bMinZ = z;
            const bMaxZ = z + 1;
            const pMinZ = player.pos.z - player.radius;
            const pMaxZ = player.pos.z + player.radius;

            if (pMinZ < bMaxZ && pMaxZ > bMinZ) {
              if (dz > 0) {
                player.pos.z = bMinZ - player.radius - 0.001;
                player.vel.z = 0;
              } else if (dz < 0) {
                player.pos.z = bMaxZ + player.radius + 0.001;
                player.vel.z = 0;
              }
            }
          }
        }
      }
    }
  }

  resolveY(player: Player, world: World, dy: number) {
    const minX = Math.floor(player.pos.x - player.radius);
    const maxX = Math.floor(player.pos.x + player.radius);
    const minY = Math.floor(player.pos.y);
    const maxY = Math.floor(player.pos.y + player.height);
    const minZ = Math.floor(player.pos.z - player.radius);
    const maxZ = Math.floor(player.pos.z + player.radius);

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          if (this.isSolid(x, y, z, world)) {
            const bMinY = y;
            const bMaxY = y + 1;
            const pMinY = player.pos.y;
            const pMaxY = player.pos.y + player.height;

            if (pMinY < bMaxY && pMaxY > bMinY) {
              if (dy > 0) {
                player.pos.y = bMinY - player.height - 0.001;
                player.vel.y = 0;
              } else if (dy < 0) {
                player.pos.y = bMaxY;
                player.vel.y = 0;
                player.onGround = true;
              }
            }
          }
        }
      }
    }
  }
}
