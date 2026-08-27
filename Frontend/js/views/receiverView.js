class ReceiverView {
  constructor(client) {
    this.client = client;
    this.backendDown = false;
    this.listenersRegistered = false;

    this.logConsole = document.getElementById('rx-log-console');
    this.statusEl = document.getElementById('rx-esp-status');
    this.auditBreakdown = document.getElementById('rx-audit-breakdown');
    this.dictamen = document.getElementById('rx-dictamen');
    this.clearLogsBtn = document.getElementById('rx-clear-logs-btn');
    this.verifyInput = document.getElementById('rx-verify-input');
    this.verifyBtn = document.getElementById('rx-verify-btn');
    this.pcIpDisplay = document.getElementById('rx-pc-ip');

    this.PRIMES = [41, 43, 47, 53, 59, 61];
    this.currentLine = [];
    this.lastEspState = null;

    this.bindEvents();
    this.connectBackend();
    this.loadAuditHistory();
  }

  bindEvents() {
    this.clearLogsBtn.addEventListener('click', () => this.clearLogs());

    if (this.verifyBtn) {
      this.verifyBtn.addEventListener('click', () => this.verifyNumber());
    }
  }

  connectBackend() {
    if (!this.listenersRegistered) {
      this.listenersRegistered = true;
      this.client.onEvent(({type, data}) => this._handleServerEvent(type, data));
      this.client.onStatus((state) => {
        if (state === 'disconnected' || state === 'fallback-http') {
          if (!this.backendDown) {
            this.backendDown = true;
            this.addAuditLog(`Backend sin conexión (${this.client.baseUrl})`, 'invalid');
          }
        } else {
          this.backendDown = false;
        }
      });
    }
    this.client.connect();
  }

  _handleServerEvent(type, data) {
    if (type === 'AUDIT_LOG') {
      this.renderAudit(data);
    } else if (type === 'CAR_STATUS') {
      this.handleCarStatus(data);
    } else if (type === 'CAR_MESSAGE') {
      this._handleCarMessage(data.message);
    }
  }

  _handleCarMessage(message) {
    // Manejar IP del PC
    if (message.startsWith('PC_IP:')) {
      const pcIP = message.substring(6);
      if (this.pcIpDisplay) {
        this.pcIpDisplay.textContent = 'PC: ' + pcIP;
      }
      this.addAuditLog(`IP del PC detectada: ${pcIP}`, 'info');
    }
    // Manejar IP de cámara
    else if (message.startsWith('CAMERA_IP:')) {
      const camIP = message.substring(10);
      this.addAuditLog(`IP de cámara: ${camIP}`, 'info');
    }
    // Otros mensajes
    else {
      this.addAuditLog(`Carro: ${message}`, 'info');
    }
  }

  async loadAuditHistory() {
    this.logConsole.innerHTML = '';
    this.currentLine = [];
    try {
      const res = await this.client.request('audit');
      const data = res.data;
      (data.logs || []).forEach(log => this.renderAudit(log));
    } catch {
      this.addAuditLog(`No se pudo contactar al backend (${this.client.baseUrl})`, 'invalid');
    }
  }

  renderAudit(log) {
    if (log.results) {
      this.updateAuditBreakdown(log.results);
    }
    if (log.classification) {
      this.updateDictamen(log.classification);
    }

    const parts = [];
    if (log.commandName) parts.push(`${log.commandName} (${log.command})`);
    if (log.esp32Char) parts.push(`→ '${log.esp32Char}'`);
    if (log.number != null) parts.push(`N°${log.number}`);
    if (log.classification) parts.push(log.classification);
    if (log.details) parts.push(log.details);
    if (log.step != null) parts.push(`paso ${log.step}/${log.total}`);

    if (log.step != null && log.number != null) {
      if (log.step === 1) this.currentLine = [];
      this.currentLine.push(log.number);
      if (log.step === log.total) {
        this.addAuditLog(`Línea de comandos recibida: ${this.currentLine.join(', ')}`, 'command');
        this.currentLine = [];
      }
    }

    const message = parts.join(' | ') || 'Evento de auditoría';
    this.addAuditLog(message, this.logType(log.classification));
  }

  logType(classification) {
    switch (classification) {
      case 'VALIDO': return 'valid';
      case 'FALSO': return 'invalid';
      case 'CORRUPTO': return 'corrupt';
      case 'DIRECTO': return 'command';
      default: return 'info';
    }
  }

  handleCarStatus(data) {
    this.updateESPStatus(data.status);
    if (data.status === 'connected') {
      this.addAuditLog(`Carro conectado (${data.ip}:${data.port})`, 'valid');
    } else if (data.status === 'disconnected') {
      this.addAuditLog('Carro desconectado', 'invalid');
    } else if (data.status === 'error') {
      this.addAuditLog('Error de conexión con el carro', 'invalid');
    }
  }

  async verifyNumber() {
    const value = this.verifyInput.value.trim();

    if (!value || isNaN(Number(value))) {
      this.addAuditLog('Ingrese un número válido para verificar', 'invalid');
      return;
    }

    try {
      const res = await this.client.request('classify', { number: Number(value) });

      if (!res.ok) {
        this.addAuditLog(`Error: ${res.data.error}`, 'invalid');
        return;
      }

      this.verifyInput.value = '';
    } catch (err) {
      this.addAuditLog(`No se pudo contactar al backend: ${err.message}`, 'invalid');
    }
  }

  updateAuditBreakdown(results) {
    this.auditBreakdown.classList.remove('hidden');
    const checks = this.auditBreakdown.querySelectorAll('.prime-check');

    checks.forEach(el => {
      const prime = parseInt(el.dataset.prime);
      const icon = el.querySelector('.check-icon');
      const isDivisible = results[prime];

      icon.className = 'check-icon ' + (isDivisible ? 'check-pass' : 'check-fail');
      icon.textContent = isDivisible ? '✓' : 'X';
    });
  }

  updateDictamen(classification) {
    this.dictamen.classList.remove('hidden', 'dictamen-valid', 'dictamen-invalid', 'dictamen-corrupt');
    this.dictamen.textContent = classification;

    switch (classification) {
      case 'VALIDO':
        this.dictamen.classList.add('dictamen-valid');
        break;
      case 'FALSO':
        this.dictamen.classList.add('dictamen-invalid');
        break;
      case 'CORRUPTO':
        this.dictamen.classList.add('dictamen-corrupt');
        break;
    }
  }

  updateESPStatus(state) {
    if (state === this.lastEspState) return;
    this.lastEspState = state;
    const dot = this.statusEl.querySelector('.status-dot');
    const label = this.statusEl.querySelector('span:last-child');

    dot.className = 'status-dot';
    switch (state) {
      case 'connected':
        dot.classList.add('status-connected');
        label.textContent = 'Carro Conectado';
        break;
      case 'disconnected':
        dot.classList.add('status-disconnected');
        label.textContent = 'Carro Desconectado';
        break;
      case 'error':
        dot.classList.add('status-disconnected');
        label.textContent = 'Error de conexión';
        break;
    }
  }

  addAuditLog(message, type = 'info') {
    const entry = document.createElement('div');
    entry.className = 'log-entry';

    const timestamp = new Date().toLocaleTimeString('es-MX', { hour12: false });

    entry.innerHTML = `
      <span class="log-timestamp">[${timestamp}]</span>
      <span class="log-message log-${type}">${this.escapeHtml(message)}</span>
    `;

    this.logConsole.appendChild(entry);
    while (this.logConsole.children.length > 500) {
      this.logConsole.removeChild(this.logConsole.firstChild);
    }
    this.logConsole.scrollTop = this.logConsole.scrollHeight;
  }

  async connectPeer() {
    const url = this.peerUrlInput.value.trim();
    if (!url) {
      this.addAuditLog('Ingresá la URL del peer (ej: ws://192.168.0.XX:3000/ws/peer)', 'invalid');
      return;
    }

    // Validate URL format
    if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
      this.addAuditLog('URL inválida. Debe empezar con ws:// o wss://', 'invalid');
      return;
    }
    if (!url.includes('/ws/peer')) {
      this.addAuditLog('URL inválida. Debe terminar en /ws/peer (ej: ws://IP:3000/ws/peer)', 'invalid');
      return;
    }

    this.addAuditLog(`Conectando al peer: ${url}`, 'info');
    this.peerConnectBtn.disabled = true;
    this.peerStatus.textContent = 'Conectando...';

    try {
      const res = await this.client.request('connect-peer', { url });
      if (res.ok) {
        this.peerStatus.textContent = `Conectado a ${res.data.address}`;
        this.peerStatus.className = 'peer-status peer-connected';
        this.peerConnectBtn.disabled = true;
        this.peerDisconnectBtn.disabled = false;
        this.addAuditLog(`Peer conectado: ${res.data.address}`, 'valid');
      } else {
        const errorMsg = res.data?.error || res.error || 'Error desconocido';
        this.peerStatus.textContent = 'Error de conexión';
        this.peerStatus.className = 'peer-status peer-error';
        this.peerConnectBtn.disabled = false;
        this.addAuditLog(`Error conectando peer: ${errorMsg}`, 'invalid');
      }
    } catch (err) {
      this.peerStatus.textContent = 'Error de conexión';
      this.peerStatus.className = 'peer-status peer-error';
      this.peerConnectBtn.disabled = false;
      if (err.message === 'Timeout') {
        this.addAuditLog('Timeout: tu backend no respondió. Verificá que esté corriendo en localhost:3000', 'invalid');
      } else if (err.message === 'WS no disponible') {
        this.addAuditLog('Tu backend no está conectado. Recargá la página (F5) y verificá que el backend esté corriendo', 'invalid');
      } else {
        this.addAuditLog(`Error de conexión: ${err.message}`, 'invalid');
      }
    }
  }

  async disconnectPeer() {
    try {
      await this.client.request('disconnect-peer');
      this.peerStatus.textContent = 'Sin conexión peer';
      this.peerStatus.className = 'peer-status';
      this.peerConnectBtn.disabled = false;
      this.peerDisconnectBtn.disabled = true;
      this.addAuditLog('Peer desconectado', 'warn');
    } catch (err) {
      this.addAuditLog(`Error desconectando peer: ${err.message}`, 'invalid');
    }
  }

  clearLogs() {
    this.logConsole.innerHTML = '';
    this.auditBreakdown.classList.add('hidden');
    this.dictamen.classList.add('hidden');
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  destroy() {}
}