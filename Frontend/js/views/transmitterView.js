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

    this.videoContainer = document.getElementById('tx-video-container');
    this.cameraUrlInput = document.getElementById('tx-camera-url-input');
    this.camRefreshBtn = document.getElementById('tx-cam-refresh-btn');
    this.camFullscreenBtn = document.getElementById('tx-cam-fullscreen-btn');
    this.camPopoutBtn = document.getElementById('tx-cam-popout-btn');

    this.peerUrlInput = document.getElementById('tx-peer-url');
    this.peerConnectBtn = document.getElementById('tx-peer-connect-btn');
    this.peerDisconnectBtn = document.getElementById('tx-peer-disconnect-btn');
    this.peerStatus = document.getElementById('tx-peer-status');

    this.carUrlInput = document.getElementById('tx-esp-url');
    this.carConnectBtn = document.getElementById('tx-connect-car-btn');
    this.carDisconnectBtn = document.getElementById('tx-disconnect-car-btn');

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

    if (this.camRefreshBtn) this.camRefreshBtn.addEventListener('click', () => this.refreshVideo());
    if (this.camFullscreenBtn) this.camFullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
    if (this.camPopoutBtn) this.camPopoutBtn.addEventListener('click', () => this.openPopoutVideo());

    this.peerConnectBtn.addEventListener('click', () => this.connectPeer());
    this.peerDisconnectBtn.addEventListener('click', () => this.disconnectPeer());

    if (this.carConnectBtn) this.carConnectBtn.addEventListener('click', () => this.connectCar());
    if (this.carDisconnectBtn) this.carDisconnectBtn.addEventListener('click', () => this.disconnectCar());

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
    } else if (type === 'PEER_PROGRESS') {
      if (data.fase === 'confirmado') {
        this.addLog(`Receptor: robot confirmó '${data.comando}'`, 'valid');
      } else if (data.fase === 'descifrado') {
        this.addLog(`Receptor descifró bloque: ${data.detalle?.numero} → ${data.detalle?.nombre || data.comando}`, 'info');
      } else if (data.fase === 'robot') {
        this.addLog(`Receptor enviando orden al robot: '${data.comando}'`, 'command');
      } else if (data.fase === 'descartado') {
        this.addLog(`Receptor descartó: ${data.detalle?.motivo || 'inválido'}`, 'invalid');
      }
    } else if (type === 'PEER_PROGRAM_RESULT') {
      if (data.estado === 'OK') {
        this.addLog(`Programa completado exitosamente en el receptor remoto (${data.comando || ''})`, 'valid');
      } else {
        this.addLog(`Receptor reportó error: ${data.motivo || data.estado}`, 'invalid');
      }
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
          const rawUrl = this.carUrlInput ? this.carUrlInput.value.trim() : NetworkConfig.CAR_IP;
          const match = rawUrl.match(/^(?:ws:\/\/)?([^:/]+)(?::(\d+))?(?:\/.*)?$/i);
          const ip = match ? match[1] : rawUrl;
          const port = match && match[2] ? parseInt(match[2], 10) : 80;
          await this.client.request('connect-car-peer', { ip, port });
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

      if (res.status === 202) {
        this.addLog(res.data.message || 'Enviado al receptor (Peer)', 'info');
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

    // Check if car is already connected (direct mode)
    let carConnected = false;
    try {
      const healthRes = await this.client.request('health');
      carConnected = healthRes.ok && healthRes.data?.carConnected;
    } catch { }

    if (!carConnected) {
      // Car not connected yet — connect first via POST /robot (same as connectCar)
      await this.connectCar();
      if (!this.cameraActive) return;
      return; // connectCar already calls cameraOn recursively
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
        this.addLog('Cámara apagada (P) — Sesión finalizada, carro desconectado', 'warn');
        await this.disconnectCar();
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

    try {
      let streamUrl = this.cameraUrlInput ? this.cameraUrlInput.value.trim() : 'http://192.168.0.51';
      if (!streamUrl) streamUrl = 'http://192.168.0.51';

      const res = await this.client.request('health');
      const health = res.data || {};
      if (health.carAddress && health.carAddress.includes('8081')) {
        const host = health.carAddress.split(':')[0] || '127.0.0.1';
        streamUrl = `http://${host}:8081/mjpeg`;
        if (this.cameraUrlInput) this.cameraUrlInput.value = streamUrl;
      } else if (health.carAddress && health.carAddress.includes('192.168.0.50')) {
        streamUrl = 'http://192.168.0.51';
        if (this.cameraUrlInput) this.cameraUrlInput.value = streamUrl;
      }

      if (this.videoPlayer) {
        this.videoPlayer.src = streamUrl;
        this.videoPlayer.style.display = 'block';
        this.videoPlayer.onerror = () => {
          if (streamUrl === 'http://192.168.0.51') {
            const fallback = 'http://192.168.0.51:81/stream';
            this.videoPlayer.src = fallback;
            if (this.cameraUrlInput) this.cameraUrlInput.value = fallback;
          } else {
            this.addLog(`⚠️ Cámara no accesible en ${streamUrl}. Verifica que el ESP32 esté encendido y en la red.`, 'warn');
            if (this.videoPlaceholder) {
              this.videoPlaceholder.classList.remove('hidden');
              const textSpan = this.videoPlaceholder.querySelector('span:last-child');
              if (textSpan) textSpan.textContent = '⚠️ Cámara fuera de línea (Verificar Wi-Fi / IP)';
            }
            if (this.videoOverlay) this.videoOverlay.classList.add('hidden');
          }
        };
        this.addLog(`Intentando conectar stream de video: ${streamUrl}`, 'info');
      }
    } catch {
      this.addLog('No se pudo iniciar el stream de video', 'warn');
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
  }

  refreshVideo() {
    if (!this.videoPlayer || !this.videoActive) return;
    const currentUrl = this.cameraUrlInput ? this.cameraUrlInput.value.trim() : this.videoPlayer.src;
    const separator = currentUrl.includes('?') ? '&' : '?';
    this.videoPlayer.src = `${currentUrl}${separator}_t=${Date.now()}`;
    this.addLog('Stream de video recargado', 'info');
  }

  toggleFullscreen() {
    const container = this.videoContainer || document.getElementById('tx-video-container');
    if (!container) return;
    if (!document.fullscreenElement) {
      container.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  openPopoutVideo() {
    const url = this.cameraUrlInput ? this.cameraUrlInput.value.trim() : (this.videoPlayer?.src || 'http://192.168.0.51:81/stream');
    const popout = window.open('', 'ESP32_Camera_Live', 'width=800,height=600,menubar=no,toolbar=no,location=no,status=no');
    if (popout) {
      popout.document.open();
      popout.document.write(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
          <meta charset="UTF-8">
          <title>ESP32 Cámara — Stream en Vivo</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { background: #0a0e14; display: flex; align-items: center; justify-content: center; width: 100vw; height: 100vh; overflow: hidden; font-family: monospace; }
            img { width: 100%; height: 100%; object-fit: contain; }
            .live-badge { position: fixed; top: 12px; right: 12px; background: rgba(255, 0, 0, 0.85); color: #fff; padding: 4px 10px; border-radius: 4px; font-weight: bold; font-size: 12px; z-index: 10; box-shadow: 0 0 10px rgba(255,0,0,0.5); }
          </style>
        </head>
        <body>
          <div class="live-badge">LIVE 🔴</div>
          <img src="${url}" alt="ESP32 Live Stream" onerror="this.onerror=null; if(this.src.includes(':81/stream')) this.src='http://192.168.0.51/';">
        </body>
        </html>
      `);
      popout.document.close();
      this.addLog('Cámara abierta en ventana independiente', 'info');
    }
  }

  addLog(message, type = 'info') {
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    entry.innerHTML = `
      <span class="log-timestamp">${new Date().toLocaleTimeString()}</span>
      <span class="log-message">${message}</span>
    `;

    this.logConsole.appendChild(entry);
    while (this.logConsole.children.length > 800) {
      this.logConsole.removeChild(this.logConsole.firstChild);
    }
    this.logConsole.scrollTop = this.logConsole.scrollHeight;
  }

  async connectCar() {
    const rawUrl = this.carUrlInput ? this.carUrlInput.value.trim() : NetworkConfig.CAR_IP;
    if (!rawUrl) {
      this.addLog('IP o URL del carro vacía', 'invalid');
      return;
    }

    let ip = rawUrl;
    let port = 80;
    
    // Parse if it's a URL
    const match = rawUrl.match(/^(?:ws:\/\/)?([^:/]+)(?::(\d+))?(?:\/.*)?$/i);
    if (match) {
      ip = match[1];
      if (match[2]) port = parseInt(match[2], 10);
    }

    this.carConnectBtn.disabled = true;
    this.addLog(`Solicitando conexión al carro (${ip}:${port})...`, 'info');

    const robotUrl = `ws://${ip}:${port}/ws`;

    try {
      // Check if there's an external peer (receptor) connected
      let peerConnected = false;
      let peerAddress = null;
      try {
        const peerRes = await this.client.request('peer-status');
        peerConnected = peerRes.ok && peerRes.data?.connected;
        if (peerConnected) peerAddress = peerRes.data?.address;
      } catch { }

      if (peerConnected && peerAddress) {
        // External receptor mode: POST /robot directly to the external receptor
        // (like Andrés Cuello's emisor does with receptor IP)
        const [receptorIp, receptorPort] = peerAddress.split(':');
        const postUrl = `http://${receptorIp}:${receptorPort || 80}/robot`;
        this.addLog(`POST /robot → ${postUrl} (robotUrl: ${robotUrl})`, 'info');

        try {
          const resp = await fetch(postUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: robotUrl })
          });
          const data = await resp.json();
          if (!resp.ok) {
            this.addLog(`Error POST /robot: ${data.error || resp.statusText}`, 'invalid');
            return;
          }
          this.addLog(`Receptor conectado al carro (${data.robotUrl || robotUrl})`, 'valid');
        } catch (fetchErr) {
          this.addLog(`Error POST /robot al receptor: ${fetchErr.message}`, 'invalid');
          return;
        }
      } else {
        // Local mode: POST /robot to our own backend (we ARE the receptor)
        const postUrl = `${window.location.protocol}//${window.location.host}/robot`;
        this.addLog(`POST /robot → ${postUrl} (robotUrl: ${robotUrl})`, 'info');

        try {
          const resp = await fetch(postUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: robotUrl })
          });
          const data = await resp.json();
          if (!resp.ok) {
            this.addLog(`Error POST /robot: ${data.error || resp.statusText}`, 'invalid');
            return;
          }
          this.addLog(`Carro conectado (${data.robotUrl || robotUrl})`, 'valid');
        } catch (fetchErr) {
          this.addLog(`Error POST /robot: ${fetchErr.message}`, 'invalid');
          return;
        }
      }

      this.carDisconnectBtn.disabled = false;

      // Auto-encender la cámara de inmediato al conectar
      this.addLog('Encendiendo cámara del carro automáticamente...', 'info');
      await new Promise(r => setTimeout(r, 600));
      await this.cameraOn();
    } catch (err) {
      this.addLog(`No se pudo contactar al backend: ${err.message}`, 'invalid');
    } finally {
      this.carConnectBtn.disabled = false;
    }
  }

  async disconnectCar() {
    try {
      let peerConnected = false;
      try {
        const peerRes = await this.client.request('peer-status');
        peerConnected = peerRes.ok && peerRes.data?.connected;
      } catch { }

      if (!peerConnected) {
        await this.client.request('disconnect', {});
        this.addLog('Carro desconectado (Local)', 'info');
      } else {
        // Para desconectar el carro remotamente, enviamos el comando M (Liberar Control)
        this.addLog('Enviando orden remota (M) para liberar el control del carro...', 'info');
        await this.client.request('command', { command: 'M' });
        this.addLog('Control remoto liberado', 'valid');
      }
      if (this.carDisconnectBtn) this.carDisconnectBtn.disabled = true;
    } catch (err) {
      this.addLog(`Error: ${err.message}`, 'invalid');
    }
  }

  async connectPeer() {
    const url = this.peerUrlInput.value.trim();
    if (!url) {
      this.addLog('Ingresá la URL del receptor (ej: ws://192.168.0.XX/ws)', 'invalid');
      return;
    }

    // Validate URL format
    if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
      this.addLog('URL inválida. Debe empezar con ws:// o wss://', 'invalid');
      return;
    }

    this.addLog(`Conectando al receptor remoto: ${url}`, 'info');
    this.peerConnectBtn.disabled = true;
    this.peerStatus.textContent = 'Conectando...';

    try {
      const res = await this.client.request('connect-peer', { url });
      if (res.ok) {
        this.peerStatus.textContent = `Conectado a ${res.data.address}`;
        this.peerStatus.className = 'peer-status peer-connected';
        this.peerConnectBtn.disabled = true;
        this.peerDisconnectBtn.disabled = false;
        this.addLog(`Conectado con el dispositivo: ${res.data.address}`, 'valid');
      } else {
        const errorMsg = res.data?.error || res.error || 'Error desconocido';
        this.peerStatus.textContent = 'Error de conexión';
        this.peerStatus.className = 'peer-status peer-error';
        this.peerConnectBtn.disabled = false;
        this.addLog(errorMsg.startsWith('Error') ? errorMsg : `Error conectando al receptor: ${errorMsg}`, 'invalid');
      }
    } catch (err) {
      this.peerStatus.textContent = 'Error de conexión';
      this.peerStatus.className = 'peer-status peer-error';
      this.peerConnectBtn.disabled = false;
      if (err.message === 'Timeout') {
        this.addLog('Timeout: tu backend no respondió. Verificá que esté corriendo en localhost', 'invalid');
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
      this.peerStatus.textContent = 'Sin conexión remota (Modo Local)';
      this.peerStatus.className = 'peer-status';
      this.peerConnectBtn.disabled = false;
      this.peerDisconnectBtn.disabled = true;
      this.addLog('Desconectado del receptor remoto', 'warn');
    } catch (err) {
      this.addLog(`Error desconectando receptor: ${err.message}`, 'invalid');
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