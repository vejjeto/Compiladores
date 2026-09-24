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
      audit: { path: '/api/audit', method: 'GET' },
      'connect-peer': { path: '/api/connect-peer', method: 'POST' },
      'disconnect-peer': { path: '/api/disconnect-peer', method: 'POST' },
      'peer-status': { path: '/api/peer-status', method: 'GET' },
      'connect-car-peer': { path: '/api/connect-car-peer', method: 'POST' },
      'scan-and-connect': { path: '/api/scan-and-connect', method: 'POST' },
      'scan-network': { path: '/api/scan-network', method: 'POST' },
      'mis-direcciones': { path: '/api/estado', method: 'GET' }
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

  async request(action, data = {}, timeout = 10000) {
    if (this.mode === 'http') {
      return this._httpRequest(action, data, timeout);
    }
    if (this.transport === 'ws') {
      return this._wsRequest(action, data, timeout);
    }
    if (this.transport === 'http') {
      return this._httpRequest(action, data, timeout);
    }
    if (this.ws === null && this.es === null) {
      await this.connect();
    }
    if (this.transport === 'ws') {
      return this._wsRequest(action, data, timeout);
    }
    if (this.transport === 'http') {
      return this._httpRequest(action, data, timeout);
    }
    return Promise.reject(new Error('WS no disponible'));
  }

  _wsRequest(action, data, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const requestId = 'r' + (this.requestSeq++);
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('Timeout'));
      }, timeout);
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

  async _httpRequest(action, data, timeout = 10000) {
    const route = this.ACTION_ROUTES[action];
    const url = this.baseUrl + route.path;
    let options;
    if (route.method === 'POST') {
      options = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      return { ok: res.ok, status: res.status, data: await res.json(), error: null };
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('Timeout');
      throw e;
    } finally {
      clearTimeout(timeoutId);
    }
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

  /**
   * Escanea la red y se conecta a un receptor disponible
   * @param {object} opts - Opciones de escaneo
   * @param {number} opts.port - Puerto a escanear (default: 80)
   * @param {string} opts.baseIP - Subnet base (ej: "192.168.0", default: "192.168.0")
   * @param {number} opts.startOctet - Octeto inicial (default: 1)
   * @param {number} opts.endOctet - Octeto final (default: 254)
   * @returns {Promise<object>} Resultado del escaneo y conexión
   */
  async scanAndConnect({ port = 80, baseIP = '192.168.0', startOctet, endOctet } = {}) {
    // 30s timeout para scan + connect
    return this.request('scan-and-connect', { port, baseIP, startOctet, endOctet }, 30000);
  }

  /**
   * Escanea la red buscando receptores
   * @param {object} opts - Opciones de escaneo
   * @param {number} opts.port - Puerto a escanear (default: 80)
   * @param {string} opts.baseIP - Subnet base (ej: "192.168.0"). Si no se proporciona, el backend auto-detecta la subred local.
   * @param {number} opts.startOctet - Octeto inicial (default: 100)
   * @param {number} opts.endOctet - Octeto final (default: 200)
   * @returns {Promise<object>} Resultado del escaneo
   */
  async scanNetwork({ port = 80, baseIP, startOctet = 100, endOctet = 200 } = {}) {
    // 30s timeout para scan completo (101 IPs × 3s con 20 paralelo = ~16s + margen)
    return this.request('scan-network', { port, baseIP, startOctet, endOctet }, 30000);
  }

  /**
   * Obtiene las direcciones WebSocket locales de este equipo
   * @returns {Promise<Array>} Array de objetos { ip, interface, wsTransmisor, wsPeer, wsApi }
   */
  async getMisDirecciones() {
    const result = await this.request('mis-direcciones', {});
    return result.ok && result.data?.misDirecciones ? result.data.misDirecciones : [];
  }
}