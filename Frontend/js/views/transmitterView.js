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
    this.pcIpDisplay = document.getElementById('tx-pc-ip');

    this.cameraOnBtn = document.getElementById('tx-camera-on-btn');
    this.cameraOffBtn = document.getElementById('tx-camera-off-btn');
    this.cameraStatus = document.getElementById('tx-camera-status');

    this.peerUrlInput = document.getElementById('tx-peer-url');
    this.peerConnectBtn = document.getElementById('tx-peer-connect-btn');
    this.peerDisconnectBtn = document.getElementById('tx-peer-disconnect-btn');
    this.peerStatus = document.getElementById('tx-peer-status');

    this.videoActive = false;
    this.cameraActive = false;

    this.bindEvents();
    this.connectBackend();
  }

  bindEvents() {
    this.executeBtn.addEventListener('click', () => this.executeProgram());
    this.clearBtn.addEventListener('click', () => this.clearInput());
    this.clearLogsBtn.addEventListener('click', () => this.clearLogs());

    this.cameraOnBtn.addEventListener('click', () => this.cameraOn());
    this.cameraOffBtn.addEventListener('click', () => this.cameraOff());

    this.peerConnectBtn.addEventListener('click', () => this.connectPeer());
    this.peerDisconnectBtn.addEventListener('click', () => this.disconnectPeer());

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
    } else if (type === 'CAR_MESSAGE') {
      // Manejar mensajes del carro (PC_IP, CAMERA_IP, etc.)
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
      this.addLog(`IP del PC detectada: ${pcIP}`, 'info');
    }
    // Manejar IP de cámara
    else if (message.startsWith('CAMERA_IP:')) {
      const camIP = message.substring(10);
      this.addLog(`IP de cámara: ${camIP}`, 'info');
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

    // If program starts with N, connect car first
    if (program.trim().toUpperCase().startsWith('N')) {
      let peerConnected = false;
      try {
        const peerRes = await this.client.request('peer-status');
        peerConnected = peerRes.ok && peerRes.data?.connected;
      } catch { /* no peer */ }

      if (peerConnected) {
        this.addLog('Programa inicia con N — pidiendo conexión de carro al receptor...', 'info');
        try {
          await this.client.request('connect-car-peer', { ip: NetworkConfig.CAR_IP, port: NetworkConfig.CAR_PORT });
          await new Promise(r => setTimeout(r, 1500));
        } catch { /* ignore */ }
      }
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
    } catch (err) {
      this.addLog(`No se pudo contactar al backend (${this.client.baseUrl}): ${err.message}`, 'invalid');
    }
  }

  async cameraOn() {
    if (this.cameraActive) return;

    if (!this.client.transport) {
      this.addLog('No hay conexión con el backend', 'invalid');
      return;
    }

    // Check if peer is connected
    let peerConnected = false;
    try {
      const peerRes = await this.client.request('peer-status');
      peerConnected = peerRes.ok && peerRes.data?.connected;
    } catch { /* no peer */ }

    if (peerConnected) {
      // Peer mode: tell receiver to connect to car first
      this.addLog('Pidiendo al receptor que conecte el carro...', 'info');
      try {
        const connectRes = await this.client.request('connect-car-peer', { ip: NetworkConfig.CAR_IP, port: NetworkConfig.CAR_PORT });
        if (!connectRes.ok) {
          this.addLog(`Error: ${connectRes.data?.error || connectRes.error}`, 'invalid');
          return;
        }
        this.addLog(`Receptor conectando al carro (${NetworkConfig.CAR_IP})...`, 'info');
        await new Promise(r => setTimeout(r, 1500));
      } catch (err) {
        this.addLog(`Error: ${err.message}`, 'invalid');
        return;
      }
    } else {
      // Direct mode: check if car is connected
      try {
        const healthRes = await this.client.request('health');
        if (!healthRes.ok || !healthRes.data?.carConnected) {
          this.addLog('No hay conexión con el carro ni con el peer. Conectá el carro primero.', 'invalid');
          return;
        }
      } catch {
        this.addLog('No se pudo verificar el estado del carro', 'invalid');
        return;
      }
    }

    // Send camera ON command
    try {
      const res = await this.client.request('command', { command: 'N' });
      if (res.ok) {
        this.cameraActive = true;
        this.cameraStatus.textContent = 'Encendida';
        this.cameraStatus.className = 'camera-status camera-on';
        this.cameraOnBtn.disabled = true;
        this.cameraOffBtn.disabled = false;
        this.addLog('Cámara encendida', 'valid');
        this.startVideo();
      } else {
        const errorMsg = res.data?.error || res.error || 'desconocido';
        this.addLog(`Error encendiendo cámara: ${errorMsg}`, 'invalid');
      }
    } catch (err) {
      this.addLog(`Error de conexión: ${err.message}`, 'invalid');
    }
  }

  async cameraOff() {
    if (!this.cameraActive) return;

    try {
      const res = await this.client.request('command', { command: 'P' });
      if (res.ok) {
        this.cameraActive = false;
        this.cameraStatus.textContent = 'Apagada';
        this.cameraStatus.className = 'camera-status';
        this.cameraOnBtn.disabled = false;
        this.cameraOffBtn.disabled = true;
        this.stopVideo();
        this.addLog(`Cámara apagada (P) — secuencia ${res.data.sequenceId}`, 'warn');
      } else {
        const errorMsg = res.data?.error || res.error || 'desconocido';
        this.addLog(`Error apagando cámara: ${errorMsg}`, 'invalid');
      }
    } catch (err) {
      this.addLog(`Error de conexión: ${err.message}`, 'invalid');
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

      if (health.cameraStream && this.videoPlayer) {
        this.videoPlayer.src = health.cameraStream;
        this.videoPlayer.style.display = 'block';
        this.addLog(`Stream MJPEG: ${health.cameraStream}`, 'info');
      } else if (health.carAddress && this.videoPlayer) {
        const streamUrl = `http://${health.carAddress}`;
        this.videoPlayer.src = streamUrl;
        this.videoPlayer.style.display = 'block';
        this.addLog(`Stream MJPEG: ${streamUrl}`, 'info');
      } else {
        if (this.videoPlayer) this.videoPlayer.removeAttribute('src');
        this.addLog('No se pudo obtener la URL del stream', 'warn');
      }
    } catch {
      if (this.videoPlayer) this.videoPlayer.removeAttribute('src');
      this.addLog('Error obteniendo URL del stream', 'warn');
    }
  }

  stopVideo() {
    if (this.videoPlaceholder) this.videoPlaceholder.classList.remove('hidden');
    if (this.videoOverlay) this.videoOverlay.classList.add('hidden');
    this.videoActive = false;
    if (this.videoPlayer) {
      this.videoPlayer.removeAttribute('src');
      this.videoPlayer.style.display = 'none';
    }
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

  async connectPeer() {
    const url = this.peerUrlInput.value.trim();
    if (!url) {
      this.addLog('Ingresá la URL del peer (ej: ws://192.168.0.XX:3000/ws/peer)', 'invalid');
      return;
    }

    // Validate URL format
    if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
      this.addLog('URL inválida. Debe empezar con ws:// o wss://', 'invalid');
      return;
    }
    if (!url.includes('/ws/peer')) {
      this.addLog('URL inválida. Debe terminar en /ws/peer (ej: ws://IP:3000/ws/peer)', 'invalid');
      return;
    }

    this.addLog(`Conectando al peer: ${url}`, 'info');
    this.peerConnectBtn.disabled = true;
    this.peerStatus.textContent = 'Conectando...';

    try {
      const res = await this.client.request('connect-peer', { url });
      if (res.ok) {
        this.peerStatus.textContent = `Conectado a ${res.data.address}`;
        this.peerStatus.className = 'peer-status peer-connected';
        this.peerConnectBtn.disabled = true;
        this.peerDisconnectBtn.disabled = false;
        this.addLog(`Peer conectado: ${res.data.address}`, 'valid');
      } else {
        const errorMsg = res.data?.error || res.error || 'Error desconocido';
        this.peerStatus.textContent = 'Error de conexión';
        this.peerStatus.className = 'peer-status peer-error';
        this.peerConnectBtn.disabled = false;
        this.addLog(`Error conectando peer: ${errorMsg}`, 'invalid');
      }
    } catch (err) {
      this.peerStatus.textContent = 'Error de conexión';
      this.peerStatus.className = 'peer-status peer-error';
      this.peerConnectBtn.disabled = false;
      if (err.message === 'Timeout') {
        this.addLog('Timeout: tu backend no respondió. Verificá que esté corriendo en localhost:3000', 'invalid');
      } else if (err.message === 'WS no disponible') {
        this.addLog('Tu backend no está conectado. Recargá la página (F5) y verificá que el backend esté corriendo', 'invalid');
      } else {
        this.addLog(`Error de conexión: ${err.message}`, 'invalid');
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
      this.addLog('Peer desconectado', 'warn');
    } catch (err) {
      this.addLog(`Error desconectando peer: ${err.message}`, 'invalid');
    }
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