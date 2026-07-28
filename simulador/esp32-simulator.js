import { WebSocketServer } from 'ws';

const PORT = 8081;
const wss = new WebSocketServer({ port: PORT, path: '/ws' });

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

console.log('╔══════════════════════════════════════════╗');
console.log('║   SIMULADOR DE ESP32 - Compiladores      ║');
console.log('║   WebSocket Server en puerto 8081        ║');
console.log('╚══════════════════════════════════════════╝');
console.log(`\nEsperando conexiones en ws://localhost:${PORT}/ws\n`);

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`[+] Nueva conexión desde ${clientIp}`);

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
});

wss.on('error', (err) => {
  console.error(`[ERR] Error en servidor WebSocket: ${err.message}`);
  if (err.code === 'EADDRINUSE') {
    console.error(`[!] El puerto ${PORT} ya está en uso. Cerrá el otro proceso.`);
  }
});

process.on('SIGINT', () => {
  console.log('\n[!] Cerrando simulador...');
  wss.close(() => {
    console.log('[OK] Simulador cerrado correctamente');
    process.exit(0);
  });
});
