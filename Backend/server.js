import { readFileSync } from 'fs';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { info, warn, error, success, event } from './src/utils/logger.js';
import { TransmisorService } from './src/services/transmisorService.js';
import { ReceptorService } from './src/services/receptorService.js';

const PORT = process.env.PORT || 3000;
const WSS_PORT = process.env.WSS_PORT || 3443;
const COMPONENT = 'SERVER';

const CERT_DIR = new URL('../certs/', import.meta.url);
let httpsOptions = null;
try {
  httpsOptions = {
    key: readFileSync(new URL('key.pem', CERT_DIR)),
    cert: readFileSync(new URL('cert.pem', CERT_DIR))
  };
} catch {
  info(COMPONENT, 'Certificados SSL no encontrados, solo se iniciará HTTP/WS');
}

function handleRequest(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Backend WebSocket Server - Compiladores');
}

function handleWebSocket(ws, req) {
  const protocol = req.socket.encrypted ? 'wss' : 'ws';
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url, `${protocol}://${host}`);
  const path = url.pathname;

  event(COMPONENT, `Nueva conexión: ${path} desde ${req.socket.remoteAddress} vía ${protocol}`);

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
}

const transmisorService = new TransmisorService();
const receptorService = new ReceptorService();

// HTTP + WS
const httpServer = createServer(handleRequest);
const wss = new WebSocketServer({ server: httpServer });
wss.on('connection', handleWebSocket);

httpServer.listen(PORT, () => {
  success(COMPONENT, `WS    → ws://localhost:${PORT}`);
  info(COMPONENT, 'Rutas disponibles:');
  info(COMPONENT, '  /ws/transmitter  - Canal del Transmisor (Frontend)');
  info(COMPONENT, '  /ws/receiver     - Canal del Receptor (Frontend)');
  info(COMPONENT, '  /ws/esp32        - Relay hacia ESP32');
});

// HTTPS + WSS (solo si hay certificados)
if (httpsOptions) {
  const httpsServer = createHttpsServer(httpsOptions, handleRequest);
  const wsss = new WebSocketServer({ server: httpsServer });
  wsss.on('connection', handleWebSocket);

  httpsServer.listen(WSS_PORT, () => {
    success(COMPONENT, `WSS   → wss://localhost:${WSS_PORT}`);
  });
}

function closeAll() {
  warn(COMPONENT, 'Cerrando servidores...');
  wss.close(() => {
    httpServer.close(() => {
      success(COMPONENT, 'Servidores cerrados correctamente');
      process.exit(0);
    });
  });
}

process.on('SIGINT', closeAll);
process.on('SIGTERM', closeAll);
