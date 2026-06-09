import * as THREE from "three";

export class RemotePlayer {
  name: string;
  target = new THREE.Vector3();
  targetYaw = 0;
  group = new THREE.Group();
  head: THREE.Group;
  tag: THREE.Sprite;
  health = 20;
  private _seen = 0;

  constructor(private scene: THREE.Scene, name: string) {
    this.name = name || "Player";

    const skin = new THREE.MeshLambertMaterial({ color: 0x6aa9ff });
    const headMat = new THREE.MeshLambertMaterial({ color: 0xf0c090 });
    const legs = new THREE.MeshLambertMaterial({ color: 0x355aa0 });

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.7, 0.28),
      skin
    );
    body.position.y = 1.05;
    this.group.add(body);

    const h = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.45, 0.45),
      headMat
    );
    h.position.y = 1.62;
    this.group.add(h);
    this.head = new THREE.Group();
    this.head.add(h);

    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    for (const sx of [-1, 1]) {
      const e = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.06, 0.04),
        eyeMat
      );
      e.position.set(sx * 0.1, 1.66, -0.23);
      this.group.add(e);
    }
    for (const sx of [-1, 1]) {
      const arm = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.7, 0.2),
        skin
      );
      arm.position.set(sx * 0.33, 1.05, 0);
      this.group.add(arm);
    }
    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.7, 0.2),
        legs
      );
      leg.position.set(sx * 0.12, 0.35, 0);
      this.group.add(leg);
    }

    this.tag = this._makeTag(this.name);
    this.tag.position.y = 2.2;
    this.group.add(this.tag);

    scene.add(this.group);
  }

  private _makeTag(text: string): THREE.Sprite {
    const cv = document.createElement("canvas");
    cv.width = 256;
    cv.height = 64;
    const ctx = cv.getContext("2d")!;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 12, 256, 40);
    ctx.font = "bold 28px sans-serif";
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text.slice(0, 16), 128, 32);
    const tex = new THREE.CanvasTexture(cv);
    const spr = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        depthTest: false,
        transparent: true,
      })
    );
    spr.scale.set(1.6, 0.4, 1);
    return spr;
  }

  setState(s: any) {
    this.target.set(s.x, s.y, s.z);
    this.targetYaw = s.yaw;
    if (s.name && s.name !== this.name) {
      this.name = s.name;
      this.group.remove(this.tag);
      this.tag = this._makeTag(this.name);
      this.tag.position.y = 2.2;
      this.group.add(this.tag);
    }
    this.health = s.health;
    this._seen = performance.now();
  }

  update(dt: number) {
    this.group.position.lerp(this.target, Math.min(1, dt * 12));
    let dy = this.targetYaw - this.group.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.group.rotation.y += dy * Math.min(1, dt * 12);
  }

  remove() {
    this.scene.remove(this.group);
  }
}
