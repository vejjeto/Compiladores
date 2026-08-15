class TransmitterView {
  constructor(client) {
    this.client = client;
    this.listenersRegistered = false;
    this.activeSequenceId = null;
    this.pendingSteps = [];
    this.pendingTotal = 0;
    this.lastUpdateState = null;

    this.commandInput = document.getElementById('tx-command-input');
    this.executeBtn = document.getElementById('tx-execute-btn');
    this.clearBtn = document.getElementById('tx-clear-btn');
    this.clearLogsBtn = document.getElementById('tx-clear-logs-btn');
    this.logConsole = document.getElementById('tx-log-console');
    this.statusEl = document.getElementById('tx-status');
    this.videoPlaceholder = document.getElementById('tx-video-placeholder');
    this.videoOverlay = document.getElementById('tx-video-overlay');
    this.videoPlayer = document.getElementById('tx-video-player');

    this.videoActive = false;

    this.bindEvents();
    this.connectBackend();
  }

  bindEvents() {
    this.executeBtn.addEventListener('click', () => this.executeProgram());
    this.clearBtn.addEventListener('click', () => this.clearInput());
    this.clearLogsBtn.addEventListener('click', () => this.clearLogs());

    this.commandInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.executeProgram();
      }
    });
  }

  connectBackend() {
    if (!this.listenersRegistered) {
      this.listenersRegistered = true;
      this.client.onStatus((state) => this.updateStatus(state === 'connected' ? 'connected' : (state === 'connecting' ? 'connecting' : 'disconnected')));
      this.client.onEvent(({type, data}) => this._handleServerEvent(type, data));
    }
    this.client.connect();
  }

  _handleServerEvent(type, data) {
    if (type === 'SEQUENCE_STARTED') {
      this.activeSequenceId = data.sequenceId;
      this.pendingSteps = [];
      this.pendingTotal = data.totalSteps;
      this.addLog(`Secuencia iniciada (${data.totalSteps} pasos)`, 'command');
    } else if (type === 'STEP_SENT') {
      if (data.sequenceId !== this.activeSequenceId) return;
      if (Array.isArray(this.pendingSteps)) this.pendingSteps.push(data);
    } else if (type === 'SEQUENCE_COMPLETED') {
      if (data.sequenceId !== this.activeSequenceId) return;
      const steps = this.pendingSteps || [];

      if (steps.length > 0) {
        this.addLog(`Secuencia ejecutada (${steps.length} pasos):`, 'valid');
        for (const s of steps) {
          this.addLog(
            `  ${s.step}/${s.total}) N°${s.encryptedNumber} → ${s.message} (${s.classification})`,
            'valid'
          );
        }
      }

      this.addLog(`Programa completado (${data.duration}ms)`, 'valid');
      this.pendingSteps = [];
    } else if (type === 'SEQUENCE_ERROR') {
      if (data.sequenceId !== this.activeSequenceId) return;
      this.addLog(`Error de secuencia en paso ${data.step}: ${data.message}`, 'invalid');
      this.pendingSteps = [];
    }
  }

  updateStatus(state) {
    if (state === this.lastUpdateState) return;
    this.lastUpdateState = state;
    const dot = this.statusEl.querySelector('.status-dot');
    const label = this.statusEl.querySelector('span:last-child');

    dot.className = 'status-dot';
    switch (state) {
      case 'connected':
        dot.classList.add('status-connected');
        label.textContent = `Backend conectado (${this.client.transport === 'ws' ? 'WS' : 'HTTP'})`;
        break;
      case 'disconnected':
        dot.classList.add('status-disconnected');
        label.textContent = 'Desconectado';
        break;
      case 'connecting':
        dot.classList.add('status-connecting');
        label.textContent = 'Conectando...';
        break;
    }
  }

  async executeProgram() {
    const program = this.commandInput.value;

    if (!program.trim()) {
      this.addLog('El programa está vacío', 'invalid');
      return;
    }

    let numeroUnico;

    try {
      const codRes = await this.client.request('codificar', { program });

      if (!codRes.ok) {
        (codRes.data.errors || []).forEach(err => this.addLog(err, 'invalid'));
        return;
      }

      numeroUnico = codRes.data.numeroUnico;

      for (const block of codRes.data.bloques) {
        if (Array.isArray(block.intentos) && block.intentos.length > 0) {
          const fallidos = block.intentos.map(n => `${n} ✗`).join(', ');
          this.addLog(`Buscando para ${block.command}: ${fallidos}, ${block.numero} ✓`, 'info');
        }
        this.addLog(`N°${block.numero} → ${block.name} (${block.command})`, 'command');
      }
      this.addLog(`Programa encriptado: ${numeroUnico}`, 'command');
    } catch (err) {
      this.addLog(`No se pudo contactar al backend (${this.client.baseUrl}): ${err.message}`, 'invalid');
      return;
    }

    try {
      const res = await this.client.request('programa-numeros', { programa: numeroUnico });

      if (res.status === 400) {
        (res.data.errors || []).forEach(err => this.addLog(err, 'invalid'));
        return;
      }

      if (res.status === 409) {
        this.addLog(res.data.error, 'invalid');
        return;
      }

      if (!res.ok) {
        this.addLog(res.data.error || 'Error del servidor', 'invalid');
        return;
      }

      this.activeSequenceId = res.data.sequenceId;
      this.addLog(`Enviado al Receptor: ${res.data.decoded.length} comandos encriptados, ${res.data.totalSteps} pasos`, 'info');
      this.addLog(`Secuencia ESP32: [${res.data.esp32Sequence.map(s => s.char).join(', ')}]`, 'command');
      this.addLog(`Línea de comandos (dígitos): ${res.data.decoded.map(d => d.numero).join(', ')}`, 'command');
      this.addLog('Esperando confirmaciones OK_*...', 'info');

      if (res.data.decoded.some(c => c.command === 'N') && !this.videoActive) {
        this.startVideo();
      }
      if (res.data.decoded.some(c => c.command === 'P') && this.videoActive) {
        this.stopVideo();
      }
    } catch (err) {
      this.addLog(`No se pudo contactar al backend (${this.client.baseUrl}): ${err.message}`, 'invalid');
    }
  }

  async startVideo() {
    if (this.videoPlaceholder) this.videoPlaceholder.classList.add('hidden');
    if (this.videoOverlay) this.videoOverlay.classList.remove('hidden');
    this.videoActive = true;
    this.addLog('Cámara encendida (N)', 'valid');

    try {
      const res = await this.client.request('health');
      const health = res.data;

      if (health.carAddress && this.videoPlayer) {
        this.videoPlayer.src = `http://${health.carAddress}/mjpeg`;
        this.addLog(`Stream MJPEG: http://${health.carAddress}/mjpeg`, 'info');
      } else {
        if (this.videoPlayer) this.videoPlayer.removeAttribute('src');
        this.addLog('Carro no conectado. Hardware real usa RTSP: rtsp://<ip_carro>:8554/stream', 'warn');
      }
    } catch {
      if (this.videoPlayer) this.videoPlayer.removeAttribute('src');
    }
  }

  stopVideo() {
    this.videoPlaceholder.classList.remove('hidden');
    this.videoOverlay.classList.add('hidden');
    this.videoActive = false;
    if (this.videoPlayer) this.videoPlayer.removeAttribute('src');
    this.addLog('Cámara apagada (P)', 'warn');
  }

  addLog(message, type = 'info') {
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

  clearInput() {
    this.commandInput.value = '';
  }

  clearLogs() {
    this.logConsole.innerHTML = '';
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  destroy() {}
}