/**
 * Herramienta de diagnóstico para el carro ESP32.
 * Uso: node Backend/src/diagnostico.js [IP] [PUERTO]
 */
import WebSocket from 'ws';

import { pathToFileURL } from 'url';

export async function runDiagnostico(ctx = {}) {
  const pasos = [];
  const carService = ctx.carService;

  pasos.push({ paso: 1, nombre: 'Verificar carService', ok: !!carService });

  if (carService) {
    try {
      if (!carService.connected) {
        await carService.connect('127.0.0.1', 80);
      }
      pasos.push({ paso: 2, nombre: 'Conexión al carro', ok: carService.connected });
    } catch (err) {
      pasos.push({ paso: 2, nombre: 'Conexión al carro', ok: false, error: err.message });
    }
  }

  return {
    ok: pasos.every(p => p.ok),
    pasos,
    timestamp: new Date().toISOString()
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const CAR_IP = process.argv[2] || '192.168.0.50';
  const CAR_PORT = process.argv[3] || 80;
  const WS_URL = `ws://${CAR_IP}:${CAR_PORT}/ws`;

  console.log('╔══════════════════════════════════════════╗');
  console.log('║   DIAGNÓSTICO DEL CARRO ESP32            ║');
  console.log('╚══════════════════════════════════════════╝\n');

  console.log(`[1] Probando conexión a ${WS_URL}...`);

  const ws = new WebSocket(WS_URL);
  let conectado = false;
  let controlAsignado = false;

  const timeout = setTimeout(() => {
    if (!conectado) {
      console.log('    ✗ TIMEOUT: No se pudo conectar en 5 segundos');
      console.log('\nPosibles causas:');
      console.log('  - El carro no está encendido');
      console.log('  - La IP ' + CAR_IP + ' es incorrecta');
      console.log('  - El firewall bloquea el puerto ' + CAR_PORT);
      console.log('  - El carro no está en la misma red');
      console.log('\nSoluciones:');
      console.log('  1. Verificar que el LED del ESP32 esté encendido');
      console.log('  2. Hacer ping: ping ' + CAR_IP);
      console.log('  3. Verificar la IP en el monitor serial del ESP32');
      ws.terminate();
      process.exit(1);
    }
  }, 5000);

  ws.on('open', () => {
    conectado = true;
    clearTimeout(timeout);
    console.log('    ✓ Conexión WebSocket establecida');
    console.log('\n[2] Esperando mensaje de control...');
  });

  ws.on('message', (data) => {
    const msg = data.toString();
    console.log(`    Mensaje recibido: "${msg}"`);

    if (msg.includes('Control asignado')) {
      controlAsignado = true;
      console.log('    ✓ Control asignado correctamente');
      console.log('\n[3] Enviando comando de prueba (P = apagar cámara)...');
      ws.send('P');
    } else if (msg.startsWith('ACK:') || msg.startsWith('C.E ')) {
      console.log('    ✓ ACK recibido - firmware funcionando correctamente');
      console.log('\n═══════════════════════════════════════════');
      console.log('  DIAGNÓSTICO COMPLETADO EXITOSAMENTE');
      console.log('  El carro está funcionando correctamente.');
      console.log('═══════════════════════════════════════════\n');
      ws.close();
      process.exit(0);
    } else if (msg.includes('ERROR')) {
      console.log('    ✗ Error del carro: ' + msg);
      console.log('\nPosible causa: Otro cliente ya tiene control.');
      ws.close();
      process.exit(1);
    }
  });

  ws.on('error', (err) => {
    console.log('    ✗ Error de conexión: ' + err.message);
    console.log('\nPosibles causas:');
    console.log('  - El carro no está en la IP ' + CAR_IP);
    console.log('  - El puerto ' + CAR_PORT + ' es incorrecto');
    console.log('  - No hay red WiFi disponible');
    ws.terminate();
    process.exit(1);
  });

  ws.on('close', () => {
    if (!controlAsignado) {
      console.log('    Conexión cerrada inesperadamente');
    }
  });
}
