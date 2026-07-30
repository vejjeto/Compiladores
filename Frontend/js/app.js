class App {
  constructor() {
    this.currentRole = 'transmitter';
    this.transmitterView = new TransmitterView();
    this.receiverView = new ReceiverView();

    this.roleButtons = document.querySelectorAll('.role-btn');
    this.views = {
      transmitter: document.getElementById('view-transmitter'),
      receiver: document.getElementById('view-receiver')
    };

    this.init();
  }

  init() {
    this.roleButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.switchRole(btn.dataset.role);
      });
    });

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const backendPort = window.location.protocol === 'https:' ? '3443' : '3000';
    const backendUrl = `${wsProtocol}//${window.location.hostname}:${backendPort}/ws/transmitter`;
    this.transmitterView.initWebSocket(backendUrl);

    this.transmitterView.addLog('Sistema inicializado', 'info');
    this.transmitterView.addLog('Conectando al backend...', 'info');
    this.transmitterView.addLog('Seleccione un programa de comandos y presione "Ejecutar"', 'info');
    this.receiverView.addAuditLog('Sistema de auditoría inicializado', 'info');
    this.receiverView.addAuditLog('Conecte la ESP32 para recibir datos', 'info');
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

  destroy() {
    this.transmitterView.destroy();
    this.receiverView.destroy();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
