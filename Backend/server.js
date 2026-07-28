import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { info, warn, error, success, event } from './src/utils/logger.js';
import { TransmisorService } from './src/services/transmisorService.js';
import { ReceptorService } from './src/services/receptorService.js';

const PORT = process.env.PORT || 3000;
const COMPONENT = 'SERVER';

const httpServer = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Backend WebSocket Server - Compiladores');
});

const wss = new WebSocketServer({ server: httpServer });

const transmisorService = new TransmisorService();
const receptorService = new ReceptorService();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  event(COMPONENT, `Nueva conexión: ${path} desde ${req.socket.remoteAddress}`);

  switch (path) {
    case '/ws/transmitter':
      transmisorService.handleConnection(ws, req);
      break;

    case '/ws/receiver':
      receptorService.handleReceiverConnection(ws, req);
      break;

    case '/ws/esp32':
      receptorService.handleESP32Connection(ws, req);
      break;

    default:
      warn(COMPONENT, `Ruta desconocida: ${path}`);
      ws.close(1008, 'Ruta no válida');
      break;
  }
});

wss.on('error', (err) => {
  error(COMPONENT, 'Error en WebSocket Server', { error: err.message });
});

httpServer.listen(PORT, () => {
  success(COMPONENT, `Servidor backend escuchando en ws://localhost:${PORT}`);
  info(COMPONENT, 'Rutas disponibles:');
  info(COMPONENT, '  /ws/transmitter  - Canal del Transmisor (Frontend)');
  info(COMPONENT, '  /ws/receiver     - Canal del Receptor (Frontend)');
  info(COMPONENT, '  /ws/esp32        - Relay hacia ESP32');
});

process.on('SIGINT', () => {
  warn(COMPONENT, 'Cerrando servidor...');
  wss.close(() => {
    httpServer.close(() => {
      success(COMPONENT, 'Servidor cerrado correctamente');
      process.exit(0);
    });
  });
});
