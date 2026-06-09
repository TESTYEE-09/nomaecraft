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
    this.detectCollisions(player, world);
  }

  detectCollisions(player: Player, world: World) {
    player.onGround = false;
    this.helpers.clear();

    const candidates = this.broadPhase(player, world);
    const collisions = this.narrowPhase(candidates, player);

    if (collisions.length > 0) {
      this.resolveCollisions(collisions, player);
    }
  }

  broadPhase(player: Player, world: World): Candidate[] {
    const candidates: Candidate[] = [];

    const minX = Math.floor(player.position.x - player.radius);
    const maxX = Math.ceil(player.position.x + player.radius);
    const minY = Math.floor(player.position.y - player.height);
    const maxY = Math.ceil(player.position.y);
    const minZ = Math.floor(player.position.z - player.radius);
    const maxZ = Math.ceil(player.position.z + player.radius);

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          const block = world.getBlock(x, y, z);
          if (block) {
            const blockClass = BlockFactory.getBlock(block.block);
            if (!blockClass.canPassThrough) {
              candidates.push({
                block: block.block,
                x: x + 0.5,
                y: y + 0.5,
                z: z + 0.5,
              });
              this.addCollisionHelper({
                block: block.block,
                x: x + 0.5,
                y: y + 0.5,
                z: z + 0.5,
              });
            }
          }
        }
      }
    }

    return candidates;
  }

  narrowPhase(candidates: Candidate[], player: Player): Collision[] {
    const collisions: Collision[] = [];

    for (const candidate of candidates) {
      const closestPoint = new THREE.Vector3(
        Math.max(
          candidate.x - 0.5,
          Math.min(player.position.x, candidate.x + 0.5)
        ),
        Math.max(
          candidate.y - 0.5,
          Math.min(player.position.y - player.height / 2, candidate.y + 0.5)
        ),
        Math.max(
          candidate.z - 0.5,
          Math.min(player.position.z, candidate.z + 0.5)
        )
      );

      const dx = closestPoint.x - player.position.x;
      const dy = closestPoint.y - (player.position.y - player.height / 2);
      const dz = closestPoint.z - player.position.z;

      if (this.pointInPlayerBoundingCylinder(closestPoint, player)) {
        const overlapY = player.height / 2 - Math.abs(dy);
        const overlapXZ = player.radius - Math.sqrt(dx * dx + dz * dz);

        let normal: THREE.Vector3;
        let overlap: number;
        if (overlapY < overlapXZ) {
          normal = new THREE.Vector3(0, -Math.sign(dy), 0);
          overlap = overlapY;
          player.onGround = true;
        } else {
          normal = new THREE.Vector3(-dx, 0, -dz).normalize();
          overlap = overlapXZ;
        }

        collisions.push({
          candidate,
          contactPoint: closestPoint,
          normal,
          overlap,
        });

        this.addContactPointerHelper(closestPoint);
      }
    }

    return collisions;
  }

  pointInPlayerBoundingCylinder(p: THREE.Vector3, player: Player) {
    const dx = p.x - player.position.x;
    const dy = p.y - (player.position.y - player.height / 2);
    const dz = p.z - player.position.z;
    const r_sq = dx * dx + dz * dz;

    return (
      Math.abs(dy) < player.height / 2 && r_sq < player.radius * player.radius
    );
  }

  resolveCollisions(collisions: Collision[], player: Player) {
    collisions.sort((a, b) => a.overlap - b.overlap);

    for (const collision of collisions) {
      if (!this.pointInPlayerBoundingCylinder(collision.contactPoint, player)) {
        continue;
      }

      const deltaPosition = collision.normal.clone();
      deltaPosition.multiplyScalar(collision.overlap);

      if (!player.onGround && deltaPosition.y !== 0) {
        deltaPosition.y = 0;
      }
      player.position.add(deltaPosition);

      if (collision.normal.y < 0) {
        player.vel.y += 10;
      }

      const magnitude = player.worldVelocity.dot(collision.normal);
      const velocityAdj = collision.normal.clone().multiplyScalar(magnitude);
      player.applyWorldDeltaVelocity(velocityAdj.negate());
    }
  }

  addCollisionHelper(candidate: Candidate) {
    const blockMesh = new THREE.Mesh(collisionGeometry, collisionMaterial);
    blockMesh.position.copy(
      new THREE.Vector3(candidate.x, candidate.y, candidate.z)
    );
    this.helpers.add(blockMesh);
  }

  addContactPointerHelper(p: THREE.Vector3) {
    const contactMesh = new THREE.Mesh(contactGeometry, contactMaterial);
    contactMesh.position.copy(new THREE.Vector3(p.x, p.y, p.z));
    this.helpers.add(contactMesh);
  }
}
