import { BLOCK, blockDefs } from './blocks.js';

// Simple box-built mobs with gravity, wander, and (for zombies) player-chasing AI.
const MOB_TYPES = {
  pig:   { hostile: false, hp: 10, color: 0xe89aa0, headColor: 0xe79aa0, legColor: 0xc97f86, snout: 0xd0697a, height: 0.9, width: 0.9, speed: 1.6, drop: 'raw_meat', dropN: [1, 3] },
  cow:   { hostile: false, hp: 10, color: 0x59453a, headColor: 0x4a3525, legColor: 0x3a2a1d, snout: 0xd9a6ac, horns: true, height: 1.4, width: 0.9, speed: 1.4, drop: 'raw_meat', dropN: [1, 3] },
  zombie:{ hostile: true,  hp: 20, color: 0x4a7a3a, headColor: 0x6c9a4c, legColor: 0x33485f, arms: true, height: 1.8, width: 0.6, speed: 2.6, drop: 'raw_meat', dropN: [0, 1], attack: 3, range: 1.5 },
};

let nextId = 1;

// Ray vs axis-aligned box (slab method). Returns the entry distance t along
// `dir` (assumed normalized) or null if the ray misses the box.
function rayAABB(o, d, minX, minY, minZ, maxX, maxY, maxZ) {
  let tmin = -Infinity, tmax = Infinity;
  for (const [oc, dc, lo, hi] of [[o.x, d.x, minX, maxX], [o.y, d.y, minY, maxY], [o.z, d.z, minZ, maxZ]]) {
    if (Math.abs(dc) < 1e-8) { if (oc < lo || oc > hi) return null; continue; }
    let t1 = (lo - oc) / dc, t2 = (hi - oc) / dc;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return tmin >= 0 ? tmin : (tmax >= 0 ? 0 : null);
}

export class Mob {
  constructor(THREE, world, type, x, y, z, id = null) {
    this.THREE = THREE;
    this.world = world;
    this.type = type;
    this.def = MOB_TYPES[type];
    this.id = id ?? ('m' + (nextId++));
    this.pos = new THREE.Vector3(x, y, z);
    this.vel = new THREE.Vector3();
    this.yaw = Math.random() * Math.PI * 2;
    this.hp = this.def.hp;
    this.onGround = false;
    this.wanderT = 0;
    this.attackCD = 0;
    this.dead = false;
    this.hurtT = 0;
    this.buildMesh();
  }

  buildMesh() {
    const THREE = this.THREE;
    const d = this.def;
    this.group = new THREE.Group();
    const w = d.width, h = d.height;

    const bodyMat = new THREE.MeshLambertMaterial({ color: d.color });
    const headMat = new THREE.MeshLambertMaterial({ color: d.headColor });
    const limbMat = new THREE.MeshLambertMaterial({ color: d.legColor ?? d.color });
    this.bodyMat = bodyMat; this.headMat = headMat;
    // every coloured material we want to flash red when the mob is hurt
    this.flashMats = [bodyMat, headMat, limbMat];

    // body
    const bodyH = h * 0.5, bodyY = h * 0.44;
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, bodyH, w * 0.82), bodyMat);
    body.position.y = bodyY; this.group.add(body);

    // head on its own pivot so it can bob; front of the mob is +z
    this.head = new THREE.Group();
    this.head.position.set(0, h * 0.78, w * 0.3);
    this.headBaseY = this.head.position.y;
    const hs = w * 0.62;
    const headMesh = new THREE.Mesh(new THREE.BoxGeometry(hs, hs, hs), headMat);
    headMesh.position.z = w * 0.05; this.head.add(headMesh);
    this.group.add(this.head);
    const faceZ = w * 0.05 + hs * 0.5;

    // eyes
    const eyeMat = new THREE.MeshBasicMaterial({ color: d.hostile ? 0xff2a2a : 0x141414 });
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(hs * 0.2, hs * 0.2, 0.04), eyeMat);
      eye.position.set(sx * hs * 0.24, hs * 0.12, faceZ + 0.01); this.head.add(eye);
    }
    // snout / muzzle
    if (d.snout) {
      const snoutMat = new THREE.MeshLambertMaterial({ color: d.snout });
      this.flashMats.push(snoutMat);
      const snout = new THREE.Mesh(new THREE.BoxGeometry(hs * 0.5, hs * 0.34, hs * 0.22), snoutMat);
      snout.position.set(0, -hs * 0.18, faceZ + hs * 0.08); this.head.add(snout);
      const nostrilMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
      for (const sx of [-1, 1]) { const nz = new THREE.Mesh(new THREE.BoxGeometry(hs * 0.08, hs * 0.08, 0.04), nostrilMat); nz.position.set(sx * hs * 0.12, -hs * 0.18, faceZ + hs * 0.19); this.head.add(nz); }
    }
    // horns
    if (d.horns) {
      const hornMat = new THREE.MeshLambertMaterial({ color: 0xe8e0cf });
      this.flashMats.push(hornMat);
      for (const sx of [-1, 1]) { const horn = new THREE.Mesh(new THREE.BoxGeometry(hs * 0.16, hs * 0.16, hs * 0.16), hornMat); horn.position.set(sx * hs * 0.42, hs * 0.5, w * 0.05); this.head.add(horn); }
    }

    // legs — each on a hip pivot so it swings from the top, not the middle
    this.legs = [];
    const legW = w * 0.24, legH = h * 0.42, hipY = h * 0.42;
    // order: back-left, back-right, front-left, front-right
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const pivot = new THREE.Group();
      pivot.position.set(lx * w * 0.3, hipY, lz * w * 0.3);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(legW, legH, legW), limbMat);
      leg.position.y = -legH / 2; pivot.add(leg);
      this.group.add(pivot); this.legs.push(pivot);
    }

    // arms (zombie) — reach forward, swing slightly while walking
    this.arms = [];
    if (d.arms) {
      const armW = w * 0.28, armH = h * 0.42;
      for (const sx of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(sx * (w * 0.5 + armW * 0.45), bodyY + bodyH * 0.42, w * 0.08);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(armW, armH, armW), limbMat);
        arm.position.y = -armH / 2; pivot.add(arm);
        pivot.rotation.x = -Math.PI / 2; // classic outstretched reach
        this.group.add(pivot); this.arms.push(pivot);
      }
    }

    this.animPhase = 0;
    this.baseColors = this.flashMats.map(m => m.color.getHex());
  }

  isSolid(x, y, z) { const b = this.world.getBlock(x, y, z); const def = blockDefs[b]; return def && def.solid; }

  update(dt, player, isNight) {
    if (this.dead) return;
    dt = Math.min(dt, 0.05);
    const d = this.def;
    this.attackCD = Math.max(0, this.attackCD - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);

    const toPlayer = player.pos.clone().sub(this.pos);
    const dist = toPlayer.length();

    let moveX = 0, moveZ = 0;
    if (d.hostile && (isNight || dist < 6) && dist < 22 && !player.dead) {
      // chase
      this.yaw = Math.atan2(toPlayer.x, toPlayer.z);
      moveX = Math.sin(this.yaw); moveZ = Math.cos(this.yaw);
      if (dist < d.range && this.attackCD <= 0 && Math.abs(toPlayer.y) < 2) {
        player.damage(d.attack); this.attackCD = 1.0;
      }
    } else {
      // wander
      this.wanderT -= dt;
      if (this.wanderT <= 0) { this.wanderT = 2 + Math.random() * 3; this.yaw = Math.random() * Math.PI * 2; this.moving = Math.random() > 0.35; }
      if (this.moving) { moveX = Math.sin(this.yaw); moveZ = Math.cos(this.yaw); }
    }

    const sp = d.speed;
    this.vel.x = moveX * sp;
    this.vel.z = moveZ * sp;
    this.vel.y -= 28 * dt;

    // step-up / jump if blocked horizontally and grounded
    const ahead = this.pos.clone(); ahead.x += this.vel.x * dt * 3; ahead.z += this.vel.z * dt * 3;
    if (this.onGround && (moveX || moveZ) && this.isSolid(Math.floor(ahead.x), Math.floor(this.pos.y), Math.floor(ahead.z))
        && !this.isSolid(Math.floor(ahead.x), Math.floor(this.pos.y + 1), Math.floor(ahead.z))) {
      this.vel.y = 8; this.onGround = false;
    }

    this.moveAxis('x', this.vel.x * dt);
    this.moveAxis('y', this.vel.y * dt);
    this.moveAxis('z', this.vel.z * dt);

    // anim — swing the legs from the hips in a quadruped diagonal gait
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const moving = speed > 0.2;
    this.animPhase += dt * (moving ? 7 + speed : 0);
    const swing = moving ? Math.sin(this.animPhase) * 0.7 : this.legs[0].rotation.x * 0.85;
    // diagonal pairs: (back-left, front-right) vs (back-right, front-left)
    this.legs[0].rotation.x = swing; this.legs[3].rotation.x = swing;
    this.legs[1].rotation.x = -swing; this.legs[2].rotation.x = -swing;
    for (const arm of this.arms) { arm.rotation.x = -Math.PI / 2 + Math.sin(this.animPhase) * 0.12; arm.rotation.z = Math.cos(this.animPhase) * 0.06; }
    this.head.position.y = this.headBaseY + (moving ? Math.abs(Math.sin(this.animPhase)) * 0.03 : 0);

    // despawn zombies in daylight
    if (d.hostile && !isNight && dist > 30) this.dead = true;

    this.group.position.copy(this.pos);
    // face the way we move/look — front of the model is +z, which maps to the
    // movement direction (sin yaw, cos yaw) when rotation.y === yaw.
    this.group.rotation.y = this.yaw;
    // hurt flash: tint every coloured material red, then restore
    const flash = this.hurtT > 0;
    this.flashMats.forEach((m, i) => m.color.setHex(flash ? 0xff6060 : this.baseColors[i]));
  }

  moveAxis(axis, amt) {
    if (amt === 0) return;
    const next = this.pos.clone(); next[axis] += amt;
    const w = this.def.width / 2, h = this.def.height;
    const minX = Math.floor(next.x - w), maxX = Math.floor(next.x + w);
    const minY = Math.floor(next.y), maxY = Math.floor(next.y + h - 0.05);
    const minZ = Math.floor(next.z - w), maxZ = Math.floor(next.z + w);
    let hit = false;
    for (let x = minX; x <= maxX && !hit; x++) for (let y = minY; y <= maxY && !hit; y++) for (let z = minZ; z <= maxZ; z++) if (this.isSolid(x, y, z)) { hit = true; break; }
    if (!hit) { this.pos[axis] = next[axis]; if (axis === 'y') this.onGround = false; }
    else if (axis === 'y') { if (amt < 0) this.onGround = true; this.vel.y = 0; }
  }

  hit(dmg) {
    this.hp -= dmg; this.hurtT = 0.2;
    // knockback handled by caller
    if (this.hp <= 0) this.dead = true;
    return this.hp <= 0;
  }
}

export class MobManager {
  constructor(THREE, world, scene) {
    this.THREE = THREE; this.world = world; this.scene = scene;
    this.mobs = [];
    this.spawnT = 0;
    this.maxMobs = 14;
  }

  spawnNear(player, isNight) {
    const THREE = this.THREE;
    const angle = Math.random() * Math.PI * 2;
    const r = 16 + Math.random() * 12;
    const x = player.pos.x + Math.cos(angle) * r;
    const z = player.pos.z + Math.sin(angle) * r;
    // find ground
    let y = 60; while (y > 1 && this.world.getBlock(Math.floor(x), y, Math.floor(z)) === BLOCK.AIR) y--;
    if (y <= 1 || this.world.getBlock(Math.floor(x), y, Math.floor(z)) === BLOCK.WATER) return;
    const type = isNight ? (Math.random() < 0.7 ? 'zombie' : (Math.random() < 0.5 ? 'pig' : 'cow'))
                         : (Math.random() < 0.5 ? 'pig' : 'cow');
    const mob = new Mob(THREE, this.world, type, x + 0.5, y + 1, z + 0.5);
    this.mobs.push(mob); this.scene.add(mob.group);
  }

  update(dt, player, isNight, onDrop) {
    this.spawnT -= dt;
    if (this.spawnT <= 0 && this.mobs.length < this.maxMobs) {
      this.spawnT = isNight ? 3 : 6;
      this.spawnNear(player, isNight);
    }
    for (const m of this.mobs) {
      m.update(dt, player, isNight);
      if (m.dead) {
        // drops if killed (hp<=0); natural despawn gives nothing
        if (m.hp <= 0 && m.def.drop) {
          const [lo, hi] = m.def.dropN; const n = lo + Math.floor(Math.random() * (hi - lo + 1));
          if (n > 0) onDrop(m.def.drop, n, m.pos);
        }
        this.scene.remove(m.group);
      }
    }
    this.mobs = this.mobs.filter(m => !m.dead);
  }

  // ranged: nearest mob whose AABB the camera ray pierces within maxDist.
  // Returns { mob, t } or null. Used by guns (terrain is clipped by the caller).
  raycastMob(origin, dir, maxDist) {
    let best = null, bestT = maxDist;
    for (const m of this.mobs) {
      if (m.dead) continue;
      const w = m.def.width / 2;
      const t = rayAABB(origin, dir,
        m.pos.x - w, m.pos.y, m.pos.z - w,
        m.pos.x + w, m.pos.y + m.def.height, m.pos.z + w);
      if (t !== null && t >= 0 && t < bestT) { bestT = t; best = m; }
    }
    return best ? { mob: best, t: bestT } : null;
  }

  // Apply damage + knockback to a specific mob (shared by gun fire).
  hitMob(mob, damage, dir, kb = 3) {
    const killed = mob.hit(damage);
    mob.vel.x += dir.x * kb; mob.vel.z += dir.z * kb; mob.vel.y = Math.max(mob.vel.y, 4);
    return killed;
  }

  // melee: find closest mob in front of camera within range
  attack(camera, player, damage) {
    const THREE = this.THREE;
    const origin = camera.position;
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    let best = null, bestDot = 0.9, bestDist = 4;
    for (const m of this.mobs) {
      const center = m.pos.clone(); center.y += m.def.height / 2;
      const to = center.sub(origin); const dist = to.length();
      if (dist > 4) continue;
      to.normalize();
      const dot = to.dot(dir);
      if (dot > bestDot && dist < bestDist) { best = m; bestDist = dist; }
    }
    if (best) {
      const killed = best.hit(damage);
      // knockback
      const kb = best.pos.clone().sub(origin).setY(0).normalize().multiplyScalar(3);
      best.vel.x += kb.x; best.vel.z += kb.z; best.vel.y = 5;
      return best;
    }
    return null;
  }
}
