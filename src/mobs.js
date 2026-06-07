import { BLOCK, blockDefs } from './blocks.js';

// Simple box-built mobs with gravity, wander, and (for zombies) player-chasing AI.
const MOB_TYPES = {
  pig:   { hostile: false, hp: 10, color: 0xe89aa0, headColor: 0xe07a82, height: 0.9, width: 0.9, speed: 1.6, drop: 'raw_meat', dropN: [1, 3] },
  cow:   { hostile: false, hp: 10, color: 0x6b4f3a, headColor: 0x4a3525, height: 1.4, width: 0.9, speed: 1.4, drop: 'raw_meat', dropN: [1, 3] },
  zombie:{ hostile: true,  hp: 20, color: 0x3a7a4a, headColor: 0x4a8a3a, height: 1.8, width: 0.6, speed: 2.6, drop: 'raw_meat', dropN: [0, 1], attack: 3, range: 1.5 },
};

let nextId = 1;

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
    const bodyMat = new THREE.MeshLambertMaterial({ color: d.color });
    const headMat = new THREE.MeshLambertMaterial({ color: d.headColor });
    this.bodyMat = bodyMat; this.headMat = headMat;
    const w = d.width, h = d.height;
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.55, w * 0.7), bodyMat);
    body.position.y = h * 0.45; this.group.add(body);
    const head = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, h * 0.35, w * 0.7), headMat);
    head.position.set(0, h * 0.85, w * 0.35); this.group.add(head);
    // eyes
    const eyeMat = new THREE.MeshBasicMaterial({ color: d.hostile ? 0xff3030 : 0x111111 });
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.05), eyeMat);
      eye.position.set(sx * w * 0.18, h * 0.9, w * 0.7); this.group.add(eye);
    }
    // legs
    this.legs = [];
    const legGeo = new THREE.BoxGeometry(w * 0.22, h * 0.4, w * 0.22);
    for (const [lx, lz] of [[-1,-1],[1,-1],[-1,1],[1,1]]) {
      const leg = new THREE.Mesh(legGeo, bodyMat);
      leg.position.set(lx * w * 0.28, h * 0.2, lz * w * 0.22);
      this.group.add(leg); this.legs.push(leg);
    }
    this.legBase = h * 0.2;
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

    // anim
    const moving = Math.abs(this.vel.x) + Math.abs(this.vel.z) > 0.2;
    const t = performance.now() * 0.01;
    this.legs.forEach((leg, i) => { leg.position.y = this.legBase + (moving ? Math.sin(t + i * Math.PI) * 0.06 : 0); leg.rotation.x = moving ? Math.sin(t + i * Math.PI) * 0.5 : 0; });

    // despawn zombies in daylight
    if (d.hostile && !isNight && dist > 30) this.dead = true;

    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw + Math.PI;
    // hurt flash
    const flash = this.hurtT > 0;
    this.bodyMat.color.setHex(flash ? 0xff6060 : d.color);
    this.headMat.color.setHex(flash ? 0xff6060 : d.headColor);
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
          if (n > 0) onDrop(m.def.drop, n);
        }
        this.scene.remove(m.group);
      }
    }
    this.mobs = this.mobs.filter(m => !m.dead);
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
