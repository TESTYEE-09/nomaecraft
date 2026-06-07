// Peer-to-peer multiplayer over WebRTC using PeerJS's free public broker.
// Topology: a star. One player hosts (peer id = room code). Clients connect to the
// host; the host relays every message to all other clients, tagging the sender.
// No backend of our own — works from static hosting like GitHub Pages.

const PREFIX = 'nomaecraft-';

export class Net {
  constructor(handlers) {
    this.h = handlers;            // { onInit, onPlayer, onRemovePlayer, onBlock, onChat, getSeed, getEdits }
    this.isHost = false;
    this.peer = null;
    this.conns = new Map();       // peerId -> DataConnection
    this.room = null;
    this.myId = 'p' + Math.random().toString(36).slice(2, 8);
    this.connected = false;
  }

  _newPeer(id) {
    // PeerJS global from CDN
    return id ? new Peer(id, { debug: 1 }) : new Peer(undefined, { debug: 1 });
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
      this.peer = this._newPeer(null);
      this.peer.on('open', (myid) => {
        this.myId = myid;
        const conn = this.peer.connect(PREFIX + roomCode, { reliable: true });
        this.host_conn = conn;
        let done = false;
        conn.on('open', () => { this.connected = true; });
        conn.on('data', (msg) => {
          if (msg.t === 'init') { this.h.onInit(msg.seed, msg.edits); this.hostId = msg.hostId; if (!done) { done = true; resolve(roomCode); } }
          else this._clientHandle(msg);
        });
        conn.on('error', (e) => { if (!done) reject(new Error('Could not reach host. Check the room code.')); });
        conn.on('close', () => { this.connected = false; this.h.onChat('system', 'Disconnected from host.'); });
        // timeout
        setTimeout(() => { if (!done) reject(new Error('Connection timed out. Is the host online?')); }, 12000);
      });
      this.peer.on('error', (e) => { if (e.type === 'peer-unavailable') reject(new Error('No host found for that room code.')); });
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
