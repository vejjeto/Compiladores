class TransmitterView {
  constructor(backendUrl) {
    this.backendUrl = backendUrl;
    this.eventSource = null;
    this.activeSequenceId = null;
    this.pendingSteps = [];
    this.pendingTotal = 0;

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

  updateBackendUrl(url) {
    this.backendUrl = url;
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
    if (this.eventSource) {
      this.eventSource.close();
    }

    this.updateStatus('connecting');

    this.eventSource = new EventSource(`${this.backendUrl}/api/events`);

    this.eventSource.onopen = () => this.updateStatus('connected');
    this.eventSource.onerror = () => this.updateStatus('connecting');

    this.eventSource.addEventListener('SEQUENCE_STARTED', (e) => {
      const data = JSON.parse(e.data);
      this.activeSequenceId = data.sequenceId;
      this.pendingSteps = [];
      this.pendingTotal = data.totalSteps;
      this.addLog(`Secuencia iniciada (${data.totalSteps} pasos)`, 'command');
    });

    this.eventSource.addEventListener('STEP_SENT', (e) => {
      const data = JSON.parse(e.data);
      if (data.sequenceId !== this.activeSequenceId) return;
      if (Array.isArray(this.pendingSteps)) this.pendingSteps.push(data);
    });

    this.eventSource.addEventListener('SEQUENCE_COMPLETED', (e) => {
      const data = JSON.parse(e.data);
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
    });

    this.eventSource.addEventListener('SEQUENCE_ERROR', (e) => {
      const data = JSON.parse(e.data);
      if (data.sequenceId !== this.activeSequenceId) return;
      this.addLog(`Error de secuencia en paso ${data.step}: ${data.message}`, 'invalid');
      this.pendingSteps = [];
    });
  }

  updateStatus(state) {
    const dot = this.statusEl.querySelector('.status-dot');
    const label = this.statusEl.querySelector('span:last-child');

    dot.className = 'status-dot';
    switch (state) {
      case 'connected':
        dot.classList.add('status-connected');
        label.textContent = 'Backend conectado';
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
      const codRes = await fetch(`${this.backendUrl}/api/codificar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ program })
      });

      const codData = await codRes.json();

      if (!codRes.ok) {
        (codData.errors || []).forEach(err => this.addLog(err, 'invalid'));
        return;
      }

      numeroUnico = codData.numeroUnico;

      for (const block of codData.bloques) {
        if (Array.isArray(block.intentos) && block.intentos.length > 0) {
          const fallidos = block.intentos.map(n => `${n} ✗`).join(', ');
          this.addLog(`Buscando para ${block.command}: ${fallidos}, ${block.numero} ✓`, 'info');
        }
        this.addLog(`N°${block.numero} → ${block.name} (${block.command})`, 'command');
      }
      this.addLog(`Programa encriptado: ${numeroUnico}`, 'command');
    } catch (err) {
      this.addLog(`No se pudo contactar al backend (${this.backendUrl}): ${err.message}`, 'invalid');
      return;
    }

    try {
      const res = await fetch(`${this.backendUrl}/api/programa-numeros`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ programa: numeroUnico })
      });

      const data = await res.json();

      if (res.status === 400) {
        (data.errors || []).forEach(err => this.addLog(err, 'invalid'));
        return;
      }

      if (res.status === 409) {
        this.addLog(data.error, 'invalid');
        return;
      }

      if (!res.ok) {
        this.addLog(data.error || 'Error del servidor', 'invalid');
        return;
      }

      this.activeSequenceId = data.sequenceId;
      this.addLog(`Enviado al Receptor: ${data.decoded.length} comandos encriptados, ${data.totalSteps} pasos`, 'info');
      this.addLog(`Secuencia ESP32: [${data.esp32Sequence.map(s => s.char).join(', ')}]`, 'command');
      this.addLog(`Línea de comandos (dígitos): ${data.decoded.map(d => d.numero).join(', ')}`, 'command');
      this.addLog('Esperando confirmaciones OK_*...', 'info');

      if (data.decoded.some(c => c.command === 'N') && !this.videoActive) {
        this.startVideo();
      }
      if (data.decoded.some(c => c.command === 'P') && this.videoActive) {
        this.stopVideo();
      }
    } catch (err) {
      this.addLog(`No se pudo contactar al backend (${this.backendUrl}): ${err.message}`, 'invalid');
    }
  }

  async startVideo() {
    if (this.videoPlaceholder) this.videoPlaceholder.classList.add('hidden');
    if (this.videoOverlay) this.videoOverlay.classList.remove('hidden');
    this.videoActive = true;
    this.addLog('Cámara encendida (N)', 'valid');

    try {
      const res = await fetch(`${this.backendUrl}/api/health`);
      const health = await res.json();

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

  destroy() {
    if (this.eventSource) {
      this.eventSource.close();
    }
  }
}
