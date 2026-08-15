class BackendClient {
  constructor(baseUrl, mode = 'auto') {
    if (!['auto', 'ws', 'http'].includes(mode)) {
      throw new TypeError(`BackendClient: unknown mode '${mode}'`);
    }
    this.mode = mode;
    this.baseUrl = baseUrl;
    this.transport = null;
    this.ws = null;
    this.es = null;
    this.requestSeq = 1;
    this.pending = new Map();
    this.eventListeners = new Set();
    this.statusListeners = new Set();
    this.retryCount = 0;
    this.reconnectTimer = null;
    this.backendDown = false;
    this.connecting = null;
    this.ACTION_ROUTES = {
      health: { path: '/api/health', method: 'GET' },
      rangos: { path: '/api/rangos', method: 'GET' },
      connect: { path: '/api/connect', method: 'POST' },
      disconnect: { path: '/api/disconnect', method: 'POST' },
      'programa-numeros': { path: '/api/programa-numeros', method: 'POST' },
      program: { path: '/api/program', method: 'POST' },
      codificar: { path: '/api/codificar', method: 'POST' },
      command: { path: '/api/command', method: 'POST' },
      raw: { path: '/api/raw', method: 'POST' },
      classify: { path: '/api/classify', method: 'POST' },
      audit: { path: '/api/audit', method: 'GET' }
    };
    this.EVENT_NAMES = ['AUDIT_LOG', 'CAR_STATUS', 'CAR_MESSAGE', 'SEQUENCE_STARTED', 'STEP_SENT', 'SEQUENCE_COMPLETED', 'SEQUENCE_ERROR', 'STEP_RETRY'];
  }

  connect() {
    if (this.mode === 'http') {
      this._fallbackToHttp();
      return Promise.resolve();
    }
    if (this.transport === 'ws' || this.transport === 'http') {
      return Promise.resolve();
    }
    if (this.connecting) {
      return this.connecting;
    }
    this.emitStatus('connecting');
    this.connecting = new Promise((resolve) => {
      const ws = new WebSocket(this._wsUrl());
      this.ws = ws;
      const timer = setTimeout(() => {
        if (this.ws !== ws) return;
        try { ws.close(); } catch {}
        if (this.mode === 'ws') {
          this._handleWsClose();
        } else {
          this._fallbackToHttp();
        }
        resolve();
      }, 3000);
      ws.onopen = () => {
        if (this.ws !== ws) return;
        clearTimeout(timer);
        this.transport = 'ws';
        this.retryCount = 0;
        this.emitStatus('connected');
        resolve();
      };
      ws.onmessage = (e) => {
        if (this.ws !== ws) return;
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.type === 'response') {
          const pending = this.pending.get(msg.requestId);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(msg.requestId);
            pending.resolve({ ok: msg.ok, status: msg.status, data: msg.data, error: msg.error });
          }
        } else if (msg.type === 'event') {
          this.emitEvent({ type: msg.event, data: msg.data });
        }
      };
      ws.onclose = () => {
        if (this.ws !== ws) return;
        this._handleWsClose();
      };
      ws.onerror = () => {
        if (this.ws !== ws) return;
        if (this.transport !== 'ws') {
          clearTimeout(timer);
          if (this.mode === 'ws') {
            try { ws.close(); } catch {}
            this._handleWsClose();
          } else {
            this._fallbackToHttp();
          }
          resolve();
        }
      };
    });
    this.connecting.then(() => { this.connecting = null; });
    return this.connecting;
  }

  _handleWsClose() {
    if (this.mode === 'ws') {
      this.transport = null;
      this.ws = null;
      if (this.retryCount >= 10) {
        this.retryCount = 1;
      } else {
        this.retryCount += 1;
      }
      this.emitStatus('connecting');
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, Math.min(16000, 1000 * Math.pow(2, this.retryCount - 1)));
      return;
    }
    if (this.transport !== 'ws') return;
    this.transport = null;
    this.ws = null;
    if (this.retryCount < 5) {
      this.retryCount += 1;
      this.emitStatus('connecting');
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, Math.min(16000, 1000 * Math.pow(2, this.retryCount - 1)));
    } else {
      this._fallbackToHttp();
      this.emitStatus('fallback-http');
    }
  }

  _fallbackToHttp() {
    if (this.mode === 'ws') return;
    if (this.transport === 'http' && this.es) return;
    this.transport = 'http';
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    this.es = new EventSource(this.baseUrl + '/api/events');
    this.es.onopen = () => {
      this.backendDown = false;
      this.emitStatus('connected');
    };
    this.es.onerror = () => {
      if (!this.backendDown) {
        this.backendDown = true;
        this.emitStatus('disconnected');
      }
    };
    for (const name of this.EVENT_NAMES) {
      this.es.addEventListener(name, (e) => {
        let data;
        try { data = JSON.parse(e.data); } catch { return; }
        this.emitEvent({ type: name, data });
      });
    }
  }

  _wsUrl() {
    return this.baseUrl.replace(/^http/, 'ws') + '/ws/api';
  }

  setBaseUrl(url) {
    if (url === this.baseUrl) return;
    this.baseUrl = url;
    this.destroy();
    this.connect();
  }

  setMode(mode) {
    if (!['auto', 'ws', 'http'].includes(mode)) {
      throw new TypeError(`BackendClient: unknown mode '${mode}'`);
    }
    if (mode === this.mode) return;
    this.mode = mode;
    this.destroy();
    this.connect();
  }

  async request(action, data = {}) {
    if (this.mode === 'http') {
      return this._httpRequest(action, data);
    }
    if (this.transport === 'ws') {
      return this._wsRequest(action, data);
    }
    if (this.transport === 'http') {
      return this._httpRequest(action, data);
    }
    if (this.ws === null && this.es === null) {
      await this.connect();
    }
    if (this.transport === 'ws') {
      return this._wsRequest(action, data);
    }
    if (this.transport === 'http') {
      return this._httpRequest(action, data);
    }
    return Promise.reject(new Error('WS no disponible'));
  }

  _wsRequest(action, data) {
    return new Promise((resolve, reject) => {
      const requestId = 'r' + (this.requestSeq++);
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('Timeout'));
      }, 10000);
      this.pending.set(requestId, { resolve, reject, timer });
      try {
        this.ws.send(JSON.stringify({ v: 1, type: 'request', action, data, requestId }));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(err);
      }
    });
  }

  async _httpRequest(action, data) {
    const route = this.ACTION_ROUTES[action];
    const url = this.baseUrl + route.path;
    let options;
    if (route.method === 'POST') {
      options = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
    }
    const res = await fetch(url, options);
    return { ok: res.ok, status: res.status, data: await res.json(), error: null };
  }

  onEvent(cb) {
    this.eventListeners.add(cb);
    return () => this.eventListeners.delete(cb);
  }

  onStatus(cb) {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  emitStatus(state) {
    for (const cb of this.statusListeners) {
      try { cb(state); } catch {}
    }
  }

  emitEvent(event) {
    for (const cb of this.eventListeners) {
      try { cb(event); } catch {}
    }
  }

  destroy() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    if (this.es) {
      this.es.close();
      this.es = null;
    }
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('Destroyed'));
    }
    this.pending.clear();
    this.transport = null;
    this.retryCount = 0;
    this.connecting = null;
  }
}