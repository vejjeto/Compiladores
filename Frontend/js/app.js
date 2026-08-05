class App {
  constructor() {
    this.currentRole = 'transmitter';
    this.backendUrl = localStorage.getItem('backendUrl') || `${window.location.protocol}//${window.location.hostname}:3000`;

    this.transmitterView = new TransmitterView(this.backendUrl);
    this.receiverView = new ReceiverView(this.backendUrl);

    this.hookBeeps();

    this.roleButtons = document.querySelectorAll('.role-btn');
    this.views = {
      transmitter: document.getElementById('view-transmitter'),
      receiver: document.getElementById('view-receiver')
    };

    this.backendInput = document.getElementById('backend-url-input');
    this.backendApplyBtn = document.getElementById('backend-url-apply');

    this.init();
  }

  init() {
    this.roleButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.switchRole(btn.dataset.role);
      });
    });

    if (this.backendInput) {
      this.backendInput.value = this.backendUrl;
    }
    if (this.backendApplyBtn) {
      this.backendApplyBtn.addEventListener('click', () => this.applyBackendUrl());
    }

    this.transmitterView.addLog(`Backend configurado: ${this.backendUrl}`, 'info');
    this.transmitterView.addLog('Seleccione un programa de comandos y presione "Ejecutar Programa"', 'info');
    this.receiverView.addAuditLog(`Backend configurado: ${this.backendUrl}`, 'info');
    this.receiverView.addAuditLog('Ingrese la IP del carro y presione "Conectar Carro"', 'info');
  }

  applyBackendUrl() {
    const value = (this.backendInput.value.trim() || `${window.location.protocol}//${window.location.hostname}:3000`).replace(/\/+$/, '');
    this.backendUrl = value;
    localStorage.setItem('backendUrl', value);
    this.transmitterView.updateBackendUrl(value);
    this.receiverView.updateBackendUrl(value);
    this.transmitterView.addLog(`Backend configurado: ${value}`, 'info');
    this.receiverView.addAuditLog(`Backend configurado: ${value}`, 'info');
  }

  switchRole(role) {
    if (role === this.currentRole) return;

    this.currentRole = role;

    this.roleButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.role === role);
    });

    Object.values(this.views).forEach(view => {
      view.classList.remove('active');
    });

    this.views[role].classList.add('active');
  }

  hookBeeps() {
    const wrapLogs = (view, methodName) => {
      const original = view[methodName].bind(view);
      view[methodName] = (message, type = 'info') => {
        if (type !== 'info') {
          if (type === 'valid') Beep.success();
          else if (type === 'invalid' || type === 'corrupt') Beep.error();
          else if (type === 'warn') Beep.warn();
          else Beep.click();
        }
        original(message, type);
      };
    };

    wrapLogs(this.transmitterView, 'addLog');
    wrapLogs(this.receiverView, 'addAuditLog');

    const clickBtn = (id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', () => Beep.click());
    };

    clickBtn('tx-execute-btn');
    clickBtn('tx-clear-btn');
    clickBtn('tx-clear-logs-btn');
    clickBtn('rx-connect-btn');
    clickBtn('rx-disconnect-btn');
    clickBtn('rx-clear-logs-btn');
    clickBtn('rx-verify-btn');
    clickBtn('backend-url-apply');
  }

  destroy() {
    this.transmitterView.destroy();
    this.receiverView.destroy();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});

const Beep = (() => {
  let ctx = null;
  let gain = null;
  let filter = null;

  function ensure() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    gain = ctx.createGain();
    filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1500;
    filter.Q.value = 0.8;
    gain.connect(filter);
    filter.connect(ctx.destination);
    gain.gain.value = 0.05;
  }

  function tone(freq, dur, type = 'sine') {
    ensure();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.connect(gain);
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur / 1000);
    o.start(now);
    o.stop(now + dur / 1000);
  }

  return {
    click:   () => tone(440, 45),
    success: () => { tone(392, 60, 'triangle'); setTimeout(() => tone(523, 70, 'triangle'), 70); },
    error:   () => tone(110, 130, 'triangle'),
    warn:    () => tone(330, 80),
  };
})();
