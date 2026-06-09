import Peer, { DataConnection } from "peerjs";

const PREFIX = "nomaecraft-";

const SIGNAL_SERVERS = [
  { host: "nomaecraft-signal.onrender.com", port: 443, secure: true, path: "/" },
  { host: "0.peerjs.com", port: 443, secure: true, path: "/peerjs" },
];

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
  {
    urls: "turn:openrelay.metered.ca:80",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:443",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:443?transport=tcp",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

export interface NetHandlers {
  getSeed(): number;
  getEdits(): any[];
  onInit(seed: number, edits: any[]): void;
  onPlayer(id: string, state: any): void;
  onRemovePlayer(id: string): void;
  onBlock(x: number, y: number, z: number, b: number, from: string): void;
  onChat(name: string, text: string): void;
  onHit(dmg: number, from: string): void;
}

export class Net {
  h: NetHandlers;
  isHost = false;
  peer: Peer | null = null;
  conns = new Map<string, DataConnection>();
  room: string | null = null;
  myId: string;
  connected = false;
  hostId = "";
  private host_conn: DataConnection | null = null;
  private _serverIdx = 0;
  private _shared = false;
  private _migrating = false;

  constructor(handlers: NetHandlers) {
    this.h = handlers;
    this.myId = "p" + Math.random().toString(36).slice(2, 8);
  }

  private _newPeer(id?: string): Peer {
    const srv = SIGNAL_SERVERS[this._serverIdx] || SIGNAL_SERVERS[0];
    const opts: any = {
      host: srv.host,
      port: srv.port,
      secure: srv.secure,
      path: srv.path,
      debug: 1,
      config: { iceServers: ICE_SERVERS },
    };
    return id ? new Peer(id, opts) : new Peer(opts);
  }

  async connectShared(room = "MAIN"): Promise<string> {
    this.room = room;
    this._shared = true;
    return this._tryConnect(room);
  }

  private async _tryConnect(room: string): Promise<string> {
    for (let si = 0; si < SIGNAL_SERVERS.length; si++) {
      this._serverIdx = si;
      const srvName = SIGNAL_SERVERS[si].host;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await this.join(room);
          this._log("Joined via " + srvName);
          return "joined";
        } catch (e: any) {
          this.close();
          if (e.signalDown) {
            this._log("Signal down on " + srvName + " — rotating");
            break;
          }
          let raceLost = false;
          for (let ha = 0; ha < 2; ha++) {
            try {
              await this.host(room);
              this._log("Hosting via " + srvName);
              return "hosting";
            } catch (e2: any) {
              this.close();
              if (e2.idTaken) {
                this._log("Host already taken — retrying join");
                raceLost = true;
                break;
              }
              if (e2.signalDown) {
                await new Promise((r) =>
                  setTimeout(r, 800 + Math.random() * 1200)
                );
                continue;
              }
              throw e2;
            }
          }
          if (raceLost) {
            await new Promise((r) =>
              setTimeout(r, 400 + Math.random() * 600)
            );
            continue;
          }
          this._log("Could not host on " + srvName + " — rotating");
          break;
        }
      }
    }
    throw new Error("Could not connect to any signal server. Try refreshing.");
  }

  private _log(msg: string) {
    console.log("[Net]", msg);
  }

  private _migrate() {
    if (this._migrating || !this._shared) return;
    this._migrating = true;
    this.h.onChat("system", "Host left — reconnecting...");
    this.close();
    setTimeout(async () => {
      this._migrating = false;
      try {
        const r = await this._tryConnect(this.room!);
        this.h.onChat(
          "system",
          r === "hosting"
            ? "You are now hosting the shared world."
            : "Reconnected to the shared world."
        );
      } catch {
        this.h.onChat("system", "Lost connection. Refresh to rejoin.");
      }
    }, 300 + Math.random() * 1400);
  }

  host(roomCode: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.isHost = true;
      this.room = roomCode;
      const id = PREFIX + roomCode;
      this.peer = this._newPeer(id);
      this.myId = id;
      let done = false;
      const fail = (
        msg: string,
        opts: { signalDown?: boolean; idTaken?: boolean } = {}
      ) => {
        if (done) return;
        done = true;
        const e: any = new Error(msg);
        e.signalDown = !!opts.signalDown;
        e.idTaken = !!opts.idTaken;
        reject(e);
      };
      this.peer.on("open", () => {
        this.connected = true;
        if (!done) {
          done = true;
          resolve(roomCode);
        }
      });
      this.peer.on("error", (e: any) => {
        if (e.type === "unavailable-id")
          fail("Someone is already hosting.", { idTaken: true });
        else
          fail("Signal error: " + (e.type || e.message), {
            signalDown: true,
          });
      });
      this.peer.on("connection", (conn: DataConnection) =>
        this._onHostConn(conn)
      );
      setTimeout(
        () => fail("Signal server unreachable.", { signalDown: true }),
        15000
      );
    });
  }

  private _onHostConn(conn: DataConnection) {
    conn.on("open", () => {
      this.conns.set(conn.peer, conn);
      conn.send({
        t: "init",
        seed: this.h.getSeed(),
        edits: this.h.getEdits(),
        hostId: this.myId,
      });
    });
    conn.on("data", (msg: any) => this._hostHandle(conn.peer, msg));
    conn.on("close", () => {
      this.conns.delete(conn.peer);
      this.h.onRemovePlayer(conn.peer);
      this._broadcast({ t: "leave", from: conn.peer }, conn.peer);
    });
    conn.on("error", () => {});
  }

  private _hostHandle(from: string, msg: any) {
    msg.from = from;
    if (msg.t === "hit") {
      if (msg.target === this.myId) this.h.onHit(msg.dmg, from);
      else {
        const c = this.conns.get(msg.target);
        if (c && c.open) {
          try {
            c.send(msg);
          } catch {}
        }
      }
      return;
    }
    if (msg.t === "state") this.h.onPlayer(from, msg.s);
    else if (msg.t === "block")
      this.h.onBlock(msg.x, msg.y, msg.z, msg.b, from);
    else if (msg.t === "chat") this.h.onChat(msg.name, msg.text);
    this._broadcast(msg, from);
  }

  private _broadcast(msg: any, exceptId: string) {
    for (const [pid, c] of this.conns)
      if (pid !== exceptId && c.open) {
        try {
          c.send(msg);
        } catch {}
      }
  }

  join(roomCode: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.isHost = false;
      this.room = roomCode;
      let done = false;
      let peerOpened = false;
      const fail = (msg: string, signalDown?: boolean) => {
        if (done) return;
        done = true;
        const e: any = new Error(msg);
        e.signalDown = !!signalDown || !peerOpened;
        reject(e);
      };
      this.peer = this._newPeer();
      this.peer.on("open", (myid: string) => {
        peerOpened = true;
        this.myId = myid;
        const conn = this.peer!.connect(PREFIX + roomCode, {
          reliable: true,
        });
        this.host_conn = conn;
        conn.on("open", () => {
          this.connected = true;
        });
        conn.on("data", (msg: any) => {
          if (msg.t === "init") {
            this.h.onInit(msg.seed, msg.edits);
            this.hostId = msg.hostId;
            if (!done) {
              done = true;
              resolve(roomCode);
            }
          } else this._clientHandle(msg);
        });
        conn.on("error", () => fail("Could not reach host."));
        conn.on("close", () => {
          this.connected = false;
          if (this._shared) this._migrate();
          else this.h.onChat("system", "Disconnected from host.");
        });
        setTimeout(() => fail("Connection timed out."), 8000);
      });
      this.peer.on("error", (e: any) => {
        if (e.type === "peer-unavailable") fail("No host found.");
        else fail("Signal error: " + (e.type || e.message), true);
      });
      setTimeout(() => fail("Signal server unreachable.", true), 15000);
    });
  }

  private _clientHandle(msg: any) {
    const from = msg.from || this.hostId;
    if (msg.t === "hit") {
      if (!msg.target || msg.target === this.myId)
        this.h.onHit(msg.dmg, from);
      return;
    }
    if (msg.t === "state") this.h.onPlayer(from, msg.s);
    else if (msg.t === "block")
      this.h.onBlock(msg.x, msg.y, msg.z, msg.b, from);
    else if (msg.t === "chat") this.h.onChat(msg.name, msg.text);
    else if (msg.t === "leave") this.h.onRemovePlayer(msg.from);
  }

  sendState(s: any) {
    const msg = { t: "state", s, from: this.myId };
    if (this.isHost) this._broadcast(msg, "");
    else if (this.host_conn?.open) this.host_conn.send({ t: "state", s });
  }

  sendBlock(x: number, y: number, z: number, b: number) {
    const msg = { t: "block", x, y, z, b, from: this.myId };
    if (this.isHost) this._broadcast(msg, "");
    else if (this.host_conn?.open)
      this.host_conn.send({ t: "block", x, y, z, b });
  }

  sendChat(name: string, text: string) {
    const msg = { t: "chat", name, text, from: this.myId };
    if (this.isHost) this._broadcast(msg, "");
    else if (this.host_conn?.open) this.host_conn.send(msg);
  }

  sendHit(target: string, dmg: number) {
    if (!target) return;
    const msg = { t: "hit", target, dmg, from: this.myId };
    if (this.isHost) {
      if (target === this.myId) {
        this.h.onHit(dmg, this.myId);
        return;
      }
      const c = this.conns.get(target);
      if (c?.open) {
        try {
          c.send(msg);
        } catch {}
      }
    } else if (this.host_conn?.open) {
      this.host_conn.send(msg);
    }
  }

  close() {
    try {
      this.peer?.destroy();
    } catch {}
    this.conns.clear();
    this.connected = false;
  }
}

export function randomRoom(): string {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 5; i++) s += a[(Math.random() * a.length) | 0];
  return s;
}
