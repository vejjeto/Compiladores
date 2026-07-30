import { readFileSync } from 'fs';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 8081;
const WSS_PORT = 8082;

const COMMAND_ACTIONS = {
  W: 'Avanzar 15cm',
  B: 'Retroceder 15cm',
  R: 'Girar Derecha 45°',
  L: 'Girar Izquierda 45°',
  O: 'Abrir Pinza',
  C: 'Cerrar Pinza',
  P: 'Cámara Encendida',
  F: 'Cámara Apagada'
};

function handleConnection(ws, req) {
  const clientIp = req.socket.remoteAddress;
  const protocol = req.socket.encrypted ? 'wss' : 'ws';
  console.log(`[+] Nueva conexión ${protocol} desde ${clientIp}`);

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === 'COMMAND') {
        const action = COMMAND_ACTIONS[message.command] || 'Acción desconocida';
        console.log(`[CMD] Recibido: '${message.command}' → ${action}`);

        const response = {
          type: 'RESPONSE',
          data: `${action} ejecutado`,
          command: message.command,
          timestamp: new Date().toISOString()
        };

        ws.send(JSON.stringify(response));
        console.log(`[RSP] Enviado: ${response.data}`);
      }
    } catch (err) {
      console.error(`[ERR] Error procesando mensaje: ${err.message}`);
    }
  });

  ws.on('close', () => {
    console.log(`[-] Conexión cerrada con ${clientIp}`);
  });

  ws.on('error', (err) => {
    console.error(`[ERR] Error en conexión: ${err.message}`);
  });

  ws.send(JSON.stringify({
    type: 'RESPONSE',
    data: 'ESP32 Simulador conectado y listo',
    timestamp: new Date().toISOString()
  }));
}

console.log('╔══════════════════════════════════════════╗');
console.log('║   SIMULADOR DE ESP32 - Compiladores      ║');
console.log('╚══════════════════════════════════════════╝');

// WS server
const httpServer = createServer();
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
wss.on('connection', handleConnection);
httpServer.listen(PORT, () => {
  console.log(`  WS  → ws://localhost:${PORT}/ws`);
});

// WSS server (solo si hay certificados)
const certPath = join(__dirname, '..', 'certs', 'cert.pem');
const keyPath = join(__dirname, '..', 'certs', 'key.pem');

let certFound = false;
try {
  if (readFileSync(certPath) && readFileSync(keyPath)) certFound = true;
} catch { /* sin certificados */ }

if (certFound) {
  const httpsServer = createHttpsServer({
    key: readFileSync(keyPath),
    cert: readFileSync(certPath)
  });
  const wsss = new WebSocketServer({ server: httpsServer, path: '/ws' });
  wsss.on('connection', handleConnection);
  httpsServer.listen(WSS_PORT, () => {
    console.log(`  WSS → wss://localhost:${WSS_PORT}/ws`);
  });
}

console.log(`\nEsperando conexiones...\n`);

process.on('SIGINT', () => {
  console.log('\n[!] Cerrando simulador...');
  wss.close(() => {
    process.exit(0);
  });
});
