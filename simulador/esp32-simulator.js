import { WebSocketServer } from 'ws';
import { createServer } from 'http';

const PORT = 8081;
const MJPEG_BOUNDARY = 'frame';
const MJPEG_FRAME = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCABaAKADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDh6KKKoQUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFSR280qs0UUjqv3iqkgfWo6v2gWa3EVx5QgUswfzQHQ8Z+XPPTpiqirik7FX7NP5PneRJ5XXfsO386T7PPuK+TJkEAjaeM9Pzq0E/4lON8WfN37fMXOMY6ZzV1b+M3kodkVUcEuDnfiRcY+gq1BN2ZDk+hjrFI4BVGbJwMDvSIjSOEjUsx6BRkmtO2227QRPLFuMrtlZAQBtwMnOBUFqiWrSvPKqsEwpiZZDk8dj6Z796lQ/r5D5itHbTyqzRwyOF+8VUnFIsEzxNKsTtGvVgpIH41pyCOTLQTxqDOJcs4UqCATxnsewpWmjkuYrmOVEgjL7kLAHlifu9TkEdKrkQudmW1vMkQleGRY26OVIB/GmKpZgqglicAAcmtOWWFrJ0jcCUwxg5YEMB1A9COPXvVKyYLewMxAUSKSSeBzUuK5khqTs2I1rcJIsbQSq7fdUoQT9BQLO5aRoxbzF15KhDkfhVsl47zMcVou5WBAmBVgeuTu4/MU5vskCXC5LKyodiyjIOeQGwc4pqK6hzMorbTuHKwSME4YhCdv19KaIZTEZRE5jHBfacD8av2s/m3z3cohVS2Sxkwye6jPJ/A02BSlk8qzIzOrIqGVRtXuSCc5PYUuVWuHMzPoooqCwooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/Z', 'base64');

const COMMAND_ACTIONS = {
  F: 'Avanzar 15cm',
  B: 'Retroceder 15cm',
  R: 'Girar Derecha 45°',
  L: 'Girar Izquierda 45°',
  N: 'Cámara Encendida',
  P: 'Cámara Apagada',
  O: 'Abrir Pinza',
  C: 'Cerrar Pinza',
  M: 'Liberar Control'
};

let controlClient = null;

function procesarComando(client, char) {
  if (char === 'M') {
    controlClient = null;
    client.send('Control liberado');
    console.log(`[CMD] 'M' → Control liberado`);
    setTimeout(() => {
      const response = `ACK:${char}`;
      console.log(`[RSP] ${response}`);
      client.send(response);
    }, 150);
    return;
  }

  if (controlClient !== null && controlClient !== client) {
    client.send('ERROR: Control ocupado');
    console.log(`[CMD] Intento de control desde IP distinta → rechazado`);
    return;
  }

  if (controlClient === null) {
    controlClient = client;
  }

  const action = COMMAND_ACTIONS[char] || 'Acción desconocida';
  console.log(`[CMD] Recibido: '${char}' → ${action}`);

  setTimeout(() => {
    const response = `ACK:${char}`;
    console.log(`[RSP] ${response}`);
    if (controlClient === client) client.send(response);
  }, 150);
}

function handleConnection(ws) {
  const clientIp = ws._socket?.remoteAddress || 'desconocida';
  console.log(`[+] Nueva conexión desde ${clientIp}`);

  if (controlClient === null) {
    controlClient = ws;
    ws.send('Control asignado a tu IP');
  } else if (controlClient !== ws) {
    ws.send('ERROR: Control ocupado');
  }

  ws.on('message', (data) => {
    const msg = data.toString();
    for (const char of msg) {
      procesarComando(ws, char);
    }
  });

  ws.on('close', () => {
    if (controlClient === ws) controlClient = null;
    console.log(`[-] Conexión cerrada con ${clientIp}`);
  });

  ws.on('error', () => {});
}

function handleMjpeg(req, res) {
  res.writeHead(200, {
    'Content-Type': `multipart/x-mixed-replace; boundary=${MJPEG_BOUNDARY}`,
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  const interval = setInterval(() => {
    if (res.destroyed) {
      clearInterval(interval);
      return;
    }
    res.write(`--${MJPEG_BOUNDARY}\r\n`);
    res.write('Content-Type: image/jpeg\r\n');
    res.write(`Content-Length: ${MJPEG_FRAME.length}\r\n\r\n`);
    res.write(MJPEG_FRAME);
    res.write('\r\n');
  }, 200);

  req.on('close', () => clearInterval(interval));
  res.on('close', () => clearInterval(interval));
}

console.log('╔══════════════════════════════════════════╗');
console.log('║   SIMULADOR DE ESP32 - Compiladores      ║');
console.log('║   Protocolo: byte crudo por WebSocket    ║');
console.log('╚══════════════════════════════════════════╝');

const httpServer = createServer((req, res) => {
  if (req.url === '/mjpeg') {
    handleMjpeg(req, res);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
wss.on('connection', handleConnection);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`  WS  → ws://0.0.0.0:${PORT}/ws`);
  console.log(`  MJPEG → http://0.0.0.0:${PORT}/mjpeg`);
});

console.log('\nEsperando conexiones...\n');

process.on('SIGINT', () => {
  console.log('\n[!] Cerrando simulador...');
  wss.close(() => {
    process.exit(0);
  });
});
