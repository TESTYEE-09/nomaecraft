// Peer-to-peer multiplayer over WebRTC using a self-hosted PeerJS server
// with fallback to the free public broker. Topology: a star. One player
// hosts (peer id = room code). Clients connect to the host; the host relays
// every message to all other clients, tagging the sender.

const PREFIX = 'nomaecraft-';

// Signal servers — tried in order. First is our own Render deploy.
const SIGNAL_SERVERS = [
  { host: 'nomaecraft-signal.onrender.com', port: 443, secure: true, path: '/' },
  { host: '0.peerjs.com', port: 443, secure: true, path: '/' },
];

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

export class Net {
  constructor(handlers) {
    this.h = handlers;
    this.isHost = false;
    this.peer = null;
    this.conns = new Map();
    this.room = null;
    this.myId = 'p' + Math.random().toString(36).slice(2, 8);
    this.connected = false;
    this._serverIdx = 0;
  }

  _newPeer(id) {
    const srv = SIGNAL_SERVERS[this._serverIdx] || SIGNAL_SERVERS[0];
    const opts = {
      host: srv.host, port: srv.port, secure: srv.secure, path: srv.path,
      debug: 1,
      config: { iceServers: ICE_SERVERS },
    };
    return id ? new Peer(id, opts) : new Peer(undefined, opts);
  }

  // Connect to the single global world. Tries to join the existing host; if there
  // is none, becomes the host. Survives host changes via _migrate().
  async connectShared(room = 'MAIN') {
    this.room = room;
    this._shared = true;
    return this._tryConnect(room);
  }

  async _tryConnect(room) {
    for (let si = 0; si < SIGNAL_SERVERS.length; si++) {
      this._serverIdx = si;
      const srvName = SIGNAL_SERVERS[si].host;
      this._log('Trying server: ' + srvName);
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await this.join(room);
          this._log('Joined via ' + srvName);
          return 'joined';
        } catch (e) {
          this.close();
          try {
            await this.host(room);
            this._log('Hosting via ' + srvName);
            return 'hosting';
          } catch (e2) {
            this.close();
            await new Promise(r => setTimeout(r, 500 + Math.random() * 800));
          }
        }
      }
    }
    throw new Error('Could not connect to any signal server. Try refreshing.');
  }

  _log(msg) { console.log('[Net]', msg); }

  _migrate() {
    if (this._migrating || !this._shared) return;
    this._migrating = true;
    this.h.onChat('system', 'Host left — reconnecting to the shared world…');
    this.close();
    setTimeout(async () => {
      this._migrating = false;
      try {
        const r = await this._tryConnect(this.room);
        this.h.onChat('system', r === 'hosting' ? 'You are now hosting the shared world.' : 'Reconnected to the shared world.');
      } catch (e) {
        this.h.onChat('system', 'Lost connection. Refresh to rejoin.');
      }
    }, 300 + Math.random() * 1400);
  }

  host(roomCode) {
    return new Promise((resolve, reject) => {
      this.isHost = true;
      this.room = roomCode;
      const id = PREFIX + roomCode;
      this.peer = this._newPeer(id);
      this.myId = id;
      this.peer.on('open', () => { this.connected = true; resolve(roomCode); });
      this.peer.on('error', (e) => {
        if (e.type === 'unavailable-id') reject(new Error('Room code taken — pick another.'));
        else reject(e);
      });
      this.peer.on('connection', (conn) => this._onHostConn(conn));
    });
  }

  _onHostConn(conn) {
    conn.on('open', () => {
      this.conns.set(conn.peer, conn);
      // send world init to the new client
      conn.send({ t: 'init', seed: this.h.getSeed(), edits: this.h.getEdits(), hostId: this.myId });
    });
    conn.on('data', (msg) => this._hostHandle(conn.peer, msg));
    conn.on('close', () => { this.conns.delete(conn.peer); this.h.onRemovePlayer(conn.peer); this._broadcast({ t: 'leave', from: conn.peer }, conn.peer); });
    conn.on('error', () => {});
  }

  _hostHandle(from, msg) {
    msg.from = from;
    // apply locally
    if (msg.t === 'state') this.h.onPlayer(from, msg.s);
    else if (msg.t === 'block') this.h.onBlock(msg.x, msg.y, msg.z, msg.b, from);
    else if (msg.t === 'chat') this.h.onChat(msg.name, msg.text);
    // relay to every other client
    this._broadcast(msg, from);
  }

  _broadcast(msg, exceptId) {
    for (const [pid, c] of this.conns) if (pid !== exceptId && c.open) { try { c.send(msg); } catch {} }
  }

  join(roomCode) {
    return new Promise((resolve, reject) => {
      this.isHost = false;
      this.room = roomCode;
      let done = false;
      const fail = (msg) => { if (!done) { done = true; reject(new Error(msg)); } };
      this.peer = this._newPeer(null);
      this.peer.on('open', (myid) => {
        this.myId = myid;
        const conn = this.peer.connect(PREFIX + roomCode, { reliable: true });
        this.host_conn = conn;
        conn.on('open', () => { this.connected = true; });
        conn.on('data', (msg) => {
          if (msg.t === 'init') { this.h.onInit(msg.seed, msg.edits); this.hostId = msg.hostId; if (!done) { done = true; resolve(roomCode); } }
          else this._clientHandle(msg);
        });
        conn.on('error', () => fail('Could not reach host.'));
        conn.on('close', () => { this.connected = false; if (this._shared) this._migrate(); else this.h.onChat('system', 'Disconnected from host.'); });
        setTimeout(() => fail('Connection timed out.'), 8000);
      });
      this.peer.on('error', (e) => fail(e.type === 'peer-unavailable' ? 'No host found.' : 'Signal error: ' + (e.type || e.message)));
      // if the peer itself can't connect to the signal server, fail fast
      setTimeout(() => fail('Signal server unreachable.'), 6000);
    });
  }

  _clientHandle(msg) {
    const from = msg.from || this.hostId;
    if (msg.t === 'state') this.h.onPlayer(from, msg.s);
    else if (msg.t === 'block') this.h.onBlock(msg.x, msg.y, msg.z, msg.b, from);
    else if (msg.t === 'chat') this.h.onChat(msg.name, msg.text);
    else if (msg.t === 'leave') this.h.onRemovePlayer(msg.from);
  }

  // ---- outgoing ----
  sendState(s) {
    const msg = { t: 'state', s, from: this.myId };
    if (this.isHost) this._broadcast(msg, null);
    else if (this.host_conn && this.host_conn.open) this.host_conn.send({ t: 'state', s });
  }

  sendBlock(x, y, z, b) {
    const msg = { t: 'block', x, y, z, b, from: this.myId };
    if (this.isHost) this._broadcast(msg, null);
    else if (this.host_conn && this.host_conn.open) this.host_conn.send({ t: 'block', x, y, z, b });
  }

  sendChat(name, text) {
    const msg = { t: 'chat', name, text, from: this.myId };
    if (this.isHost) { this._broadcast(msg, null); }
    else if (this.host_conn && this.host_conn.open) this.host_conn.send(msg);
  }

  close() {
    try { this.peer && this.peer.destroy(); } catch {}
    this.conns.clear();
    this.connected = false;
  }
}

export function randomRoom() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += a[(Math.random() * a.length) | 0];
  return s;
}
