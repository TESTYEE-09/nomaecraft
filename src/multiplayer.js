// Peer-to-peer multiplayer over WebRTC using a self-hosted PeerJS server
// with fallback to the free public broker. Topology: a star. One player
// hosts (peer id = room code). Clients connect to the host; the host relays
// every message to all other clients, tagging the sender.

const PREFIX = 'nomaecraft-';

// Signal servers — tried in order. First is our own Render deploy.
const SIGNAL_SERVERS = [
  { host: 'nomaecraft-signal.onrender.com', port: 443, secure: true, path: '/' },
  // PeerJS public broker. Path is /peerjs (not /) — that's the broker's
  // well-known endpoint. The 0.peerjs.com root returns 404 and would mask
  // a real working broker.
  { host: '0.peerjs.com', port: 443, secure: true, path: '/peerjs' },
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
    // 1) Try to join the existing host. If we succeed, done.
    // 2) If joining fails because the signal server is down / cold-starting,
    //    rotate to the next signal server (don't fall through to "host").
    // 3) If joining fails because the host simply isn't there (peer-unavailable
    //    with a working socket), become the host on this same signal server.
    // 4) Hosting can also fail with signal-down on a cold Render; retry
    //    hosting a few times on the same server before rotating.
    for (let si = 0; si < SIGNAL_SERVERS.length; si++) {
      this._serverIdx = si;
      const srvName = SIGNAL_SERVERS[si].host;
      // Up to 2 join attempts per server — Render's free tier cold-starts
      // can take ~15s on the very first hit, so one quick try isn't enough.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await this.join(room);
          this._log('Joined via ' + srvName);
          return 'joined';
        } catch (e) {
          this.close();
          if (e.signalDown) {
            this._log('Signal down on ' + srvName + ' (' + e.message + ') — rotating');
            break; // rotate to next server
          }
          // Socket was up but host wasn't there — try hosting on this same
          // server. Cold Render can also reject the host claim, so try a
          // couple times before giving up on this server.
          let hosted = false;
          for (let ha = 0; ha < 2; ha++) {
            try {
              await this.host(room);
              this._log('Hosting via ' + srvName);
              return 'hosting';
            } catch (e2) {
              this.close();
              if (e2.signalDown || /unavailable-id|Signal/i.test(e2.message)) {
                await new Promise(r => setTimeout(r, 800 + Math.random() * 1200));
                continue;
              }
              throw e2;
            }
          }
          // Hosting kept failing on this server — rotate.
          this._log('Could not host on ' + srvName + ' — rotating');
          break;
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
      let done = false;
      const fail = (msg, signalDown) => {
        if (done) return;
        done = true;
        const e = new Error(msg);
        e.signalDown = !!signalDown;
        reject(e);
      };
      this.peer.on('open', () => { this.connected = true; if (!done) { done = true; resolve(roomCode); } });
      this.peer.on('error', (e) => {
        // 'unavailable-id' = someone else already grabbed this id; not a
        // signal-server problem. 'network' / 'server-error' / 'socket-error' /
        // 'ssl-unavailable' / 'browser-incompatible' = signal server is sick.
        if (e.type === 'unavailable-id') fail('Room code taken — pick another.');
        else fail('Signal error: ' + (e.type || e.message), true);
      });
      this.peer.on('connection', (conn) => this._onHostConn(conn));
      // Same cold-start cushion as join().
      setTimeout(() => fail('Signal server unreachable.', true), 15000);
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
      // Track whether the peer socket itself ever opened. If it did NOT open
      // by the time we fail, the signal server is the problem (timeout /
      // network / server-error) and the caller should rotate to the next
      // signal server. If it DID open, then the only remaining failure is
      // "host isn't here" and the caller should host instead.
      let peerOpened = false;
      const fail = (msg, signalDown) => {
        if (done) return;
        done = true;
        // Wrap the error with a hint so the retry loop can tell them apart.
        const e = new Error(msg);
        e.signalDown = !!signalDown || !peerOpened;
        reject(e);
      };
      this.peer = this._newPeer(null);
      this.peer.on('open', (myid) => {
        peerOpened = true;
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
      this.peer.on('error', (e) => {
        // 'peer-unavailable' means the socket is up, the host just isn't
        // there — caller should host. Anything else (network, server-error,
        // socket-error, ssl-unavailable, browser-incompatible) means the
        // signal server itself is the problem — rotate.
        if (e.type === 'peer-unavailable') fail('No host found.');
        else fail('Signal error: ' + (e.type || e.message), true);
      });
      // If the peer socket never opens at all, the signal server is dead.
      // Give Render's free-tier cold start a real chance (15s).
      setTimeout(() => fail('Signal server unreachable.', true), 15000);
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
