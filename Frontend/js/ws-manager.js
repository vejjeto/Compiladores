class WSManager {
  constructor(url, options = {}) {
    this.url = url;
    this.ws = null;
    this.callbacks = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = options.maxReconnect || 5;
    this.reconnectDelay = options.reconnectDelay || 2000;
    this.ackTimeout = options.ackTimeout || 5000;
    this.pendingAcks = new Map();

    this.onConnect = options.onConnect || (() => {});
    this.onDisconnect = options.onDisconnect || (() => {});
    this.onMessage = options.onMessage || (() => {});
    this.onReconnecting = options.onReconnecting || (() => {});
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.onConnect();
    };

    this.ws.onclose = () => {
      this.onDisconnect();
      this.attemptReconnect();
    };

    this.ws.onerror = () => {
      this.onDisconnect();
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.ackId && this.pendingAcks.has(data.ackId)) {
          const pending = this.pendingAcks.get(data.ackId);
          clearTimeout(pending.timeout);
          this.pendingAcks.delete(data.ackId);
          pending.resolve(data);
          return;
        }

        this.onMessage(data);
      } catch (e) {
        this.onMessage({ raw: event.data });
      }
    };
  }

  disconnect() {
    this.maxReconnectAttempts = 0;
    if (this.ws) {
      this.ws.close();
    }
  }

  send(data, waitForAck = false) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('WebSocket no conectado'));
    }

    const message = typeof data === 'string' ? data : JSON.stringify(data);

    if (!waitForAck) {
      this.ws.send(message);
      return Promise.resolve({ sent: true });
    }

    return new Promise((resolve, reject) => {
      const ackId = this.generateUUID();
      const payload = JSON.parse(message);
      payload.ackId = ackId;
      this.ws.send(JSON.stringify(payload));

      const timeout = setTimeout(() => {
        this.pendingAcks.delete(ackId);
        reject(new Error('Timeout esperando confirmación del servidor'));
      }, this.ackTimeout);

      this.pendingAcks.set(ackId, { resolve, reject, timeout, retries: 0 });
    });
  }

  async sendWithRetry(data, maxRetries = 3) {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.send(data, true);
        return { ...result, attempt };
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries) {
          await this.sleep(1000 * attempt);
        }
      }
    }

    throw new Error(`Fallo después de ${maxRetries} intentos: ${lastError.message}`);
  }

  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1);

    this.onReconnecting(this.reconnectAttempts);

    setTimeout(() => {
      this.maxReconnectAttempts = 5;
      this.connect();
    }, delay);
  }

  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  get isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}
