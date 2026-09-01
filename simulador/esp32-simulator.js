import { WebSocket, WebSocketServer } from 'ws';
import { createServer } from 'http';
import os from 'os';

const PORT = Number(process.env.SIM_PORT) || 8081;

function getLocalIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

const LOCAL_IP = getLocalIp();
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
let modoSimulador = process.env.SIM_MODE || 'normal';
const MODO_LENTO_MS = 7000;

const estado = {
  movimiento: 'quieto',
  pinza: 'abierta',
  camara: 'apagada'
};

function procesarComando(client, char, ackId = null) {
  if (controlClient !== null && controlClient !== client) {
    client.send(`C.E ${char}`);
    console.log(`[CMD] Intento de control desde IP distinta → rechazado`);
    return;
  }

  if (controlClient === null) {
    controlClient = client;
  }

  // Modo error: rechazar todo
  if (modoSimulador === 'error') {
    console.log(`[CMD] '${char}' → RECHAZADO (modo error)`);
    const response = ackId
      ? JSON.stringify({ v: 1, ack: false, cmd: char, status: 'error', ackId, motivo: 'Fallo simulado' })
      : `ERROR:${char}`;
    if (client.readyState === WebSocket.OPEN) client.send(response);
    return;
  }

  if (char === 'M') {
    controlClient = null;
    client.send('Control liberado');
    console.log(`[CMD] 'M' → Control liberado`);
    setTimeout(() => {
      const response = ackId
        ? JSON.stringify({ v: 1, ack: true, cmd: char, status: 'done', ackId })
        : `ACK:${char}`;
      console.log(`[RSP] ${response}`);
      if (client.readyState === WebSocket.OPEN) client.send(response);
    }, 150);
    return;
  }

  const action = COMMAND_ACTIONS[char] || 'Acción desconocida';
  console.log(`[CMD] Recibido: '${char}' → ${action} (modo: ${modoSimulador})`);

  // Update simulator state
  switch (char) {
    case 'F': estado.movimiento = 'avanzando'; break;
    case 'B': estado.movimiento = 'retrocediendo'; break;
    case 'L': estado.movimiento = 'girando_izq'; break;
    case 'R': estado.movimiento = 'girando_der'; break;
    case 'N': estado.camara = 'encendida'; break;
    case 'P': estado.camara = 'apagada'; break;
    case 'O': estado.pinza = 'abierta'; break;
    case 'C': estado.pinza = 'cerrada'; break;
  }

  // Modo timeout: nunca responder
  if (modoSimulador === 'timeout') {
    console.log(`[CMD] '${char}' → SIN RESPUESTA (modo timeout)`);
    return;
  }

  // Modo lento: 7 segundos de delay
  const delay = modoSimulador === 'lento' ? MODO_LENTO_MS : 150;

  setTimeout(() => {
    // Reset movement after delay
    if (['F', 'B', 'L', 'R'].includes(char)) {
      estado.movimiento = 'quieto';
    }
    const response = ackId
      ? JSON.stringify({ v: 1, ack: true, cmd: char, status: 'done', ackId })
      : `ACK:${char}`;
    console.log(`[RSP] ${response}`);
    if (client.readyState === WebSocket.OPEN) client.send(response);
  }, delay);
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
    const trimmed = msg.trim();

    if (trimmed.startsWith('{')) {
      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        return;
      }
      if (parsed && parsed.v === 1 && typeof parsed.cmd === 'string' && parsed.cmd.length === 1) {
        procesarComando(ws, parsed.cmd, parsed.ackId ?? null);
      }
      return;
    }

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
  res.on('error', () => clearInterval(interval));
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
  if (req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      modo: modoSimulador,
      clientes: wss.clients.size,
      controlAsignado: controlClient !== null,
      movimiento: estado.movimiento,
      pinza: estado.pinza,
      camara: estado.camara,
      uptime: Math.round(process.uptime() * 1000)
    }));
    return;
  }
  if (req.url?.startsWith('/modo/')) {
    const nuevoModo = req.url.slice(6);
    if (['normal', 'lento', 'timeout', 'error'].includes(nuevoModo)) {
      modoSimulador = nuevoModo;
      console.log(`[CONFIG] Modo cambiado a: ${nuevoModo}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, modo: modoSimulador }));
      return;
    }
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Modos válidos: normal, lento, timeout, error' }));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
wss.on('connection', handleConnection);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`  WS  → ws://${LOCAL_IP}:${PORT}/ws (desde otra PC en la red)`);
  console.log(`  WS  → ws://127.0.0.1:${PORT}/ws (desde esta PC)`);
  console.log(`  MJPEG → http://${LOCAL_IP}:${PORT}/mjpeg`);
  console.log(`  IP del simulador → ${LOCAL_IP}`);
  console.log(`\n  Modo actual: ${modoSimulador}`);
  console.log('  Cambiar modo: curl http://127.0.0.1:' + PORT + '/modo/lento');
  console.log('  Modos: normal | lento (7s) | timeout (sin respuesta) | error (rechaza todo)\n');
});

console.log('\nEsperando conexiones...\n');

process.on('SIGINT', () => {
  console.log('\n[!] Cerrando simulador...');
  wss.close(() => {
    process.exit(0);
  });
});
