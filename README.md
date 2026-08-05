# Sistema de Control Robótico vía HTTP + WebSocket

Proyecto de Compiladores: sistema de comunicación segura y procesamiento de lenguajes para controlar un vehículo robótico basado en ESP32.

Este documento es el **manual completo** del proyecto: describe la arquitectura, cada componente, su función, el protocolo de comunicación y cómo usarlo (1 PC o 2 PCs).

---

## 1. Arquitectura

```
┌─────────────────────────┐   HTTP (REST + SSE)   ┌──────────────────────┐   WebSocket   ┌────────────┐
│        FRONTEND         │◄────────────────────►│       BACKEND        │◄─────────────►│   CARRO    │
│  (SPA - Transmisor y    │  números encriptados │     (Node.js)        │   byte crudo  │   (ESP32)  │
│   Receptor en pestañas) │  Puerto 3000         │  /api/* - 0.0.0.0    │   ws://ip:80  │  (robot)   │
└─────────────────────────┘                      └──────────────────────┘               └────────────┘
```

### Principio de comunicación

- **El Transmisor encripta el programa.** Convierte cada comando del lenguaje (`A`, `R:2`, `D`, …) en un **número encriptado de 4 dígitos** tomado de la tabla de números autorizados. Ese número es el único mensaje que viaja por HTTP hacia el Receptor.
- **El Receptor (Backend) es "ciego".** No recibe el texto del programa: solo recibe números, los valida con los autómatas de residuos (dictamen `VALIDO`/`FALSO`/`CORRUPTO`), descompone el número en su comando real y lo ejecuta en el carro.
- **Transmisor ↔ Backend: SOLO HTTP.** El Transmisor envía los números con `POST` (`fetch`) y recibe confirmaciones `OK_*` en tiempo real por **Server-Sent Events (SSE)**, que también es HTTP.
- **Backend ↔ Carro: SOLO WebSocket.** El backend abre una conexión WebSocket con el carro y le envía **un byte crudo por comando** (el primer byte del mensaje es el comando, igual que el firmware real del ESP32).
- **El frontend NO usa WebSocket en ningún momento.** Toda su comunicación es HTTP.
- **Confirmación por paso (ACK):** el carro confirma cada comando con `ACK:<char>` por el WebSocket; el backend no avanza al siguiente paso hasta recibirla (reintenta hasta 3 veces con timeout de 5 s — ver `transmisorService`). Esto implementa la regla de espera/confirmación del protocolo.
- **Video:** con el simulador el Transmisor muestra un stream **MJPEG** (`http://<ip_carro>:8081/mjpeg`); con el carro real la cámara se documenta como **RTSP** (`rtsp://<ip_carro>:8554/stream`), que el navegador no reproduce de forma nativa.

### ¿Por qué esta arquitectura?

- **Encriptación verificable:** cada número de la tabla es divisible por exactamente un primo de la lista `[41, 43, 47, 53, 59, 61]`. El Receptor lo comprueba sin conocer la tabla (solo con el autómata de residuos), de modo que el Transmisor "encrypta" y el Receptor "descifra y valida".
- **Compatibilidad multi-PC:** el backend escucha en `0.0.0.0` y habilita **CORS**, por lo que dos computadoras pueden conectarse sin configuración adicional.
- **El carro es el único consumidor de WebSocket**, replicando el protocolo exacto del firmware real.

---

## 2. Componentes del proyecto

```
Proyecto_Compiladores/
├── package.json                 # Script maestro (inicia backend + frontend juntos)
├── start.bat                    # Inicio rápido en Windows
├── README.md                    # Este manual (documentación única del proyecto)
├── Backend/
│   ├── package.json
│   ├── server.js                # Servidor HTTP API + SSE (router principal)
│   ├── src/
│   │   ├── core/
│   │   │   ├── parser.js        # Lexer/Sintáctico + semántica de programas
│   │   │   ├── automatas.js     # AFD de residuos (divisibilidad por 6 primos)
│   │   │   └── encriptador.js   # Tabla de 54 números autorizados + clasificación
│   │   ├── services/
│   │   │   ├── carService.js    # Cliente WebSocket hacia el carro (ESP32)
│   │   │   ├── auditService.js  # Log de auditoría + hub de eventos SSE
│   │   │   └── transmisorService.js # Ejecución de programas, envío al carro y clasificación
│   │   └── utils/
│   │       └── logger.js        # Logger con colores por consola
│   └── test/
│       ├── parser.test.js
│       ├── automatas.test.js
│       ├── encriptador.test.js
│       ├── api-flujo-integral.test.js
│       └── flujo-numeros.test.js
├── Frontend/
│   ├── package.json
│   ├── server.js                # Servidor de archivos estáticos (SPA)
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── app.js               # Orquestador de vistas + configuración del backend
│       └── views/
│           ├── transmitterView.js   # Panel del operador (Transmisor - encripta)
│           └── receiverView.js      # Panel de auditoría (Receptor)
└── simulador/
    ├── package.json
    └── esp32-simulator.js       # Simulador del carro (WS byte crudo + MJPEG)
```

---

## 3. Componente por componente: qué hace y cómo funciona

### 3.1 Backend (`Backend/`)

#### `server.js` — Servidor HTTP API
- Crea los servicios (`CarService`, `AuditService`, `TransmisorService`).
- Expone las rutas HTTP (ver sección 4).
- Escucha en `0.0.0.0:3000` para permitir conexiones desde otras PCs de la red.
- Habilita **CORS** en todas las respuestas (`Access-Control-Allow-Origin: *`) y responde `OPTIONS` (preflight) para peticiones cross-origin.
- Expone `/api/events` como **SSE** para notificaciones en tiempo real.

#### `src/core/parser.js` — Parser de programas
- Convierte el **lenguaje del proyecto** en **comandos del carro**.
- Reglas sintácticas: cada comando es una letra mayúscula con repetición opcional `A:3`.
- Reglas semánticas (`validateCommands`): `P` (encender cámara) debe ser el primer comando; `F` (apagar cámara) debe ser el último; los comandos de acción (`P, F, O, C, M`) no aceptan repetición.
- `buildESP32Sequence`: expande los comandos en la secuencia ESP32, un elemento por repetición, conservando el número encriptado si el comando lo trae.
- `parseCommands` reutiliza `validateCommands`, por lo que la semántica es la misma para el flujo por texto y el flujo por números encriptados.
- **Mapeo de comandos (protocolo real del carro):**

| Lenguaje | Comando | Char carro | Tipo |
|----------|---------|------------|------|
| `A:x`    | Avanzar | `F`        | movimiento |
| `R:x`    | Retroceder | `B`     | movimiento |
| `D:x`    | Girar Derecha | `R`   | movimiento |
| `I:x`    | Girar Izquierda | `L`  | movimiento |
| `O`      | Abrir Pinza | `O`      | acción |
| `C`      | Cerrar Pinza | `C`     | acción |
| `P`      | Encender Cámara | `N`   | cámara |
| `F`      | Apagar Cámara | `P`     | cámara |
| `M`      | Liberar Control | `M`   | acción |

> Nota: en el firmware real del carro la cámara se enciende con `N` y se apaga con `P`. El lenguaje del proyecto (P/F) se mantiene, solo cambia el char enviado.

#### `src/core/automatas.js` — Autómata de residuos
- Implementa un **AFD de residuos** que verifica si un número es divisible por cada uno de los 6 primos autorizados, procesando el número dígito a dígito (estado = resto parcial).
- Primos: `41, 43, 47, 53, 59, 61`.
- Funciones: `divisibilityAutomaton(number, prime)`, `getClassificationResults(number)`, `countDivisibilities(results)`, `getDivisiblePrimes(results)`.

#### `src/core/encriptador.js` — Tabla de números autorizados
- **54 números** (6 por cada uno de los 9 comandos). Cada número es divisible por exactamente 1 primo, lo que lo hace único y verificable.
- `selectRandomNumber(command)`: elige un número aleatorio de la tabla para el comando.
- `getCommandByNumber(number)`: busca a qué comando pertenece un número.
- `classifyNumber(number)`: clasifica un número y devuelve `VALIDO`, `FALSO` o `CORRUPTO`.
- **`NUMBER_TABLE`** es la fuente de verdad que el Transmisor descarga vía `GET /api/tabla` para encriptar.

##### Clasificación de números
| Dictamen | Regla |
|----------|-------|
| **VÁLIDO** | Está en la tabla y es divisible por exactamente 1 primo |
| **FALSO** | No está en la tabla, o está en la tabla pero no es divisible por ningún primo |
| **CORRUPTO** | Es divisible por 2 o más primos (independientemente de la tabla) |

##### Esquema de encriptación
- Un comando con repetición `A:3` se transmite como `{ numero: <4 dígitos del comando A>, repeticiones: 3 }`.
- Un programa completo se transmite como un array de estos bloques: `{ pasos: [ { numero, repeticiones }, ... ] }`.
- El Receptor valida cada `numero` (debe ser entero de 4 dígitos y clasificar `VALIDO`), lo descompone a su comando y expande `repeticiones` en pasos individuales para el carro.

#### `src/services/carService.js` — Cliente WebSocket del carro
- Conecta el backend al carro: `ws://<ip>:<puerto>/ws`.
- `connect(ip, port)`: abre la conexión, con timeout de 5s y eventos de estado (`connected`, `disconnected`, `error`).
- `sendCommand(char)`: envía **el char crudo** (texto) por el WebSocket; el carro lee el primer byte.
- `waitForAck(char, timeout)`: envía el char y resuelve `true` cuando el carro responde `ACK:<char>` (o `false` al vencer el timeout). Si un ACK tardío llegara sin espera registrada se descarta.
- Emite eventos `status` y `message` (mensajes de texto del carro, ej. "Control asignado a tu IP").

#### `src/services/auditService.js` — Auditoría y eventos
- Guarda un **log acumulado** de auditoría (máximo 500 entradas, FIFO).
- `addLog(entry)`: agrega entrada y emite evento `AUDIT_LOG`.
- `broadcast(type, data)`: emite cualquier evento a todos los suscriptores (SSE).
- `subscribe(fn)`: permite al endpoint SSE recibir todos los eventos.

#### `src/services/transmisorService.js` — Ejecución de programas
- `executeProgram(program)`: valida con el parser un programa por texto (compatibilidad); inicia la secuencia y responde `202`.
- `executeEncodedProgram(steps)`: flujo principal del Receptor. Por cada `{ numero, repeticiones }`:
  1. Valida que `numero` sea entero de 4 dígitos.
  2. Lo clasifica con `classifyNumber`; si no es `VALIDO`, rechaza con `400`, indica el dictamen (`FALSO`/`CORRUPTO`) y lo registra en auditoría (el Receptor "ciego" audita el rechazo).
  3. Si es `VALIDO`, descompone el número a su comando y expande las repeticiones en pasos.
  4. Valida la semántica con `validateCommands` (repetición en acción, `P`/`F` mal ubicados).
  5. Sin carro conectado responde `409`; si hay conexión, ejecuta la secuencia por WebSocket.
- `executeCommand(command, repetitions)`: comando individual (compatibilidad).
- `sendRawChar(char)`: envía un char crudo directo al carro (compatibilidad/manual).
- `classifyNumber(number)`: clasifica y agrega al log de auditoría (manual).
- `runSequence(...)`: por cada paso:
  1. Envía el char al carro por WebSocket y **espera su confirmación** `ACK:<char>` (regla de espera del protocolo).
  2. Si no llega ACK en **5 segundos**, **reintenta hasta 3 veces** (emite `STEP_RETRY` por intento).
  3. Si se agotan los intentos, emite `SEQUENCE_ERROR` y detiene la secuencia.
  4. Usa el número encriptado recibido (`cmd.numero`) o, si no existe (flujo por texto), elige uno aleatorio de la tabla.
  5. Lo clasifica (debe ser `VALIDO`).
  6. Agrega la entrada de auditoría y emite `STEP_SENT` con el mensaje `OK_<NOMBRE>:<paso>` (confirmación para el Transmisor).
  7. Espera `stepDelay` (350 ms por defecto) entre pasos.

#### `src/utils/logger.js` — Logger
- Imprime con colores y niveles (`INFO`, `WARN`, `ERROR`, `SUCCESS`, `EVENT`) y timestamp.

### 3.2 Frontend (`Frontend/`)

#### `server.js` — Servidor estático
- Sirve la SPA (HTML/CSS/JS) en `0.0.0.0:8080`.
- Protección contra path traversal y fallback a `index.html`.

#### `js/app.js` — Orquestador
- Crea ambas vistas y gestiona el cambio de rol (Transmisor/Receptor).
- **Configuración del backend:** permite cambiar la URL del backend (campo en la barra superior), persistida en `localStorage`. Por defecto `http://<host>:3000`.

#### `js/views/transmitterView.js` — Panel del Transmisor (operador que encripta)
- **Función:** encriptar programas y enviar los números al Receptor.
- Al iniciar descarga la tabla autorizada con `GET /api/tabla` (la tabla vive solo en el backend).
- Al presionar "Ejecutar Programa": tokeniza el texto (`P, A:3, R:2, D, O, C, F`), por cada token elige un número aleatorio de la tabla (la **encriptación**) y arma `{ numero, repeticiones }` (las acciones fuerzan repetición 1). Envía `POST /api/programa-numeros`.
- Muestra en el log el número encriptado y su comando (`N°1025 ×3 → Avanzar (A)`), la secuencia ESP32 decodificada y las confirmaciones `OK_*` por SSE (`SEQUENCE_STARTED`, `STEP_SENT`, `SEQUENCE_COMPLETED`, `SEQUENCE_ERROR`).
- **Cámara:** si el programa contiene `P` muestra el stream; con carro/simulador conectado apunta a `http://<ip>:8081/mjpeg` (tomada de `/api/health`); con `F` lo oculta. Con hardware real se documenta la URL RTSP (no reproducible en navegador).

#### `js/views/receiverView.js` — Panel del Receptor (auditoría ciega)
- **Función:** conectar el backend al carro y auditar los mensajes.
- Conectar Carro: `POST /api/connect` con IP/puerto del carro.
- Recibe por SSE:
  - `AUDIT_LOG`: renderiza el desglose del autómata (marcas ✓/✗ por primo), el dictamen (`VALIDO`/`FALSO`/`CORRUPTO`) y el mensaje en la consola.
  - `CAR_STATUS`: actualiza el indicador de conexión del carro.
  - `CAR_MESSAGE`: muestra mensajes de texto del carro.
- Al iniciar, carga el historial con `GET /api/audit`.
- **Verificar Número:** campo para clasificar manualmente un número (`POST /api/classify`).

### 3.3 Simulador (`simulador/esp32-simulator.js`)
- **Función:** imitar el comportamiento del carro real para poder probar el sistema sin hardware.
- Escucha en `0.0.0.0:8081` con dos endpoints:
  - **WebSocket** `ws://0.0.0.0:8081/ws`: mismo protocolo que el firmware real (recibe **1 byte crudo** por mensaje; comandos `F B R L N P O C M`; control único).
  - **HTTP MJPEG** `http://0.0.0.0:8081/mjpeg`: stream multipart `multipart/x-mixed-replace` con un frame JPEG embebido (cámara simulada, ~5 fps).
- Comandos: `F` Avanzar, `B` Retroceder, `R` Girar Derecha, `L` Girar Izquierda, `N` Cámara Encendida, `P` Cámara Apagada, `O` Abrir Pinza, `C` Cerrar Pinza, `M` Liberar Control.
- **Confirmación:** tras ejecutar cada comando de acción responde `ACK:<char>`, que el backend usa para avanzar al siguiente paso.
- Control único: la primera conexión recibe "Control asignado a tu IP"; las demás "ERROR: Control ocupado".

---

### 3.4 Recorrido paso a paso de todo el sistema

Esta sección explica **el viaje completo de un programa**, desde que lo escribís en el Transmisor hasta que el carro lo ejecuta y la confirmación vuelve a tu pantalla. Se usa como ejemplo el programa `P, A:3, R:2, D, O, C, F` (encender cámara, avanzar 3, retroceder 2, girar derecha, abrir pinza, cerrar pinza, apagar cámara).

### Fase A — Puesta en marcha (qué arranca con `npm start`)

1. El script maestro `package.json` usa `concurrently` para lanzar **Backend** y **Frontend** juntos.
2. **Backend** (`0.0.0.0:3000`) crea e instancia en orden:
   - `CarService` → el cliente que hablará con el carro por WebSocket.
   - `AuditService` → el log central + el hub de eventos SSE (`broadcast` / `subscribe`).
   - `TransmisorService` (`{ carService, auditService, stepDelay: 350, ackTimeout: 5000, maxRetries: 3 }`).
3. **Frontend** (`0.0.0.0:8080`) sirve la SPA (HTML/CSS/JS) y al abrirla crea dos vistas: `TransmisorView` y `ReceiverView`.

### Fase B — El Transmisor (PC1) se prepara y encripta

1. Al abrir el rol **Transmisor**, la vista hace `GET /api/tabla` y guarda los **54 números autorizados** en memoria. Recordá: la tabla vive solo en el backend; el Transmisor la descarga para encriptar, nunca la genera.
2. `GET /api/events` (SSE) queda abierto como stream para recibir las confirmaciones en vivo.
3. **Escribís el programa** en el textarea: `P, A:3, R:2, D, O, C, F`.
4. Al presionar **Ejecutar Programa**, la vista **tokeniza** el texto (separa por comas y recorta espacios) y por cada comando:
   - Elige un número **al azar** de la tabla para ese comando (eso es "encriptar": nada viaja como texto, solo números de 4 dígitos).
   - Las acciones (`P, F, O, C, M`) fuerzan repetición `1`; los movimientos (`A, R, D, I`) usan la repetición que escribiste (entre 1 y 9).
5. Arma el cuerpo JSON y lo envía por `fetch` (`POST`) al backend.

### Fase C — El backend recibe y valida los números (Receptor "ciego")

1. `server.js` recibe el `POST`, lee el cuerpo y llama `executeEncodedProgram(pasos)`. Acepta dos formatos: `{ pasos: [...] }` o el formato de la consigna `{ numero, repeticiones, timestamp }`.
2. Por cada paso valida en orden:
   1. **Integridad:** `numero` debe ser un entero de 4 dígitos (1000–9999). Si no, error `400`.
   2. **Clasificación con el autómata** (`classifyNumber`): calcula la divisibilidad del número por cada uno de los 6 primos `[41, 43, 47, 53, 59, 61]` y emite el dictamen:
      - `VALIDO` → divisible por exactamente 1 primo y está en la tabla.
      - `FALSO` → está en la tabla o no coincide con ningún primo.
      - `CORRUPTO` → divisible por 2 o más primos (posible ataque).
   3. Si es inválido, rechaza con `400`, **audita** el rechazo y corta la secuencia; si es `VALIDO`, descompone el número → comando real (p. ej. `1025` → `A` = Avanzar).
3. `validateCommands` aplica las reglas semánticas como en el flujo de texto: `P` primero, `F` último, acciones sin repetición.
4. Si **no hay carro conectado** responde `409`. Si todo está bien, responde `202` (ejecución asíncrona) y arranca la secuencia.

### Fase D — Ejecución paso a paso con confirmación (ACK)

1. `startSequence` emite por SSE `SEQUENCE_STARTED` y llama `runSequence`.
2. `runSequence` recorre la secuencia **de a un paso** (construida con `buildESP32Sequence`, que expande repeticiones: `A:2` → `F`, `F`).
3. Por cada paso:
   1. Determina el char del firmware: `A→F`, `R→B`, `D→R`, `I→L`, `P→N`, `F→P`, y `O→O`, `C→C`, `M→M`.
   2. Llama `carService.waitForAck(char, 5000)`, que **envía el char por WebSocket** y espera a que el carro responda `ACK:<char>`.
   3. **Regla de espera / reintento:** si el ACK no llega en 5 segundos, reintenta hasta **3 veces** (emite `STEP_RETRY` por intento). Si al final no confirma, emite `SEQUENCE_ERROR` y **detiene** la secuencia.
   4. Cuando el ACK llega, registra la auditoría (`addLog`) y emite `STEP_SENT` con `OK_<NOMBRE>:<paso>` (la confirmación que ve el Transmisor).
4. Al terminar todos los pasos, emite `SEQUENCE_COMPLETED` con la duración.

### Fase E — El Carro (o Simulador): ejecuta y confirma

1. El carro/simulador recibe el char por el WebSocket `ws://<ip>:8081/ws`.
2. Ejecuta la acción (mover, girar, pinza, cámara) y responde:
   - Para cada comando de acción → `ACK:<char>` (ej. `ACK:F`).
   - Para `M` (Liberar Control) → `Control liberado` y luego `ACK:M`.
   - Primera conexión: `Control asignado a tu IP`; conexiones extra: `ERROR: Control ocupado`.
3. Esa confirmación vuelve por el mismo WebSocket al `CarService`, que resuelve el `waitForAck`.

### Fase F — La confirmación y todo lo que vuelve al Transmisor

1. **Por SSE** (`GET /api/events`, que es HTTP): el Transmisor recibe en vivo:
   - `SEQUENCE_STARTED`, `STEP_SENT` (`OK_<NOMBRE>:<paso>`), `SEQUENCE_COMPLETED`, y errores (`STEP_RETRY`, `SEQUENCE_ERROR`).
2. **En pantalla:** el log del Transmisor muestra el número encriptado enviado (`N°1025 ×3 → Avanzar`), la secuencia ESP32 decodificada y las confirmaciones `OK_*`.
3. **Video:** si el programa incluye `P` (encender cámara) y el carro está conectado, el Transmisor apunta su `<img>` a `http://<ip>:8081/mjpeg` (simulador) y muestra el stream. Con `F` (apagar cámara) lo oculta. Con el carro real se documenta la URL RTSP.

### 3.5 Caso PC1 – PC2 (dos computadoras)

1. **PC1** ejecuta `npm start` (Backend en `0.0.0.0:3000` + Frontend en `0.0.0.0:8080`). Abre `http://localhost:8080` y asume el rol **Transmisor**.
2. **PC2** abre `http://<IP_PC1>:8080` desde su navegador. En la barra superior configura el **Backend** como `http://<IP_PC1>:3000` (persiste en `localStorage`).
3. En **PC2** el rol **Receptor**: conecta el carro o simulador (`POST /api/connect`).
4. Ahora: PC1 encripta y ejecuta programas; el backend (que está en PC1) valida, habla con el carro por WebSocket, y ambos navegadores (PC1 y PC2) reciben los mismos eventos SSE y la misma auditoría.
5. La arquitectura mantiene que **un solo proceso (el backend) cree el WebSocket con el carro**, así el control único del firmware no se disputa.

---

## 4. API HTTP del Backend

Base URL: `http://<host>:3000` (CORS habilitado para cualquier origen).

### `GET /api/health`
Estado del servidor.

```json
{ "status": "ok", "carConnected": false, "carAddress": null }
```

### `GET /api/tabla`
Tabla de números autorizados. El Transmisor la usa para encriptar.

```json
{
  "tabla": {
    "A": { "numbers": [1025, 1032, 1034, 1060, 1062, 1037], "name": "Avanzar" },
    "R": { "numbers": [1066, 1075, 1081, 1007, 1003, 1098], "name": "Retroceder" },
    ...
  }
}
```

### `POST /api/connect`
Conecta el backend al carro por WebSocket.

```json
{ "ip": "192.168.1.15", "port": 8081 }
// 200
{ "ok": true, "status": "connected", "ip": "192.168.1.15", "port": 8081 }
// 502 (error conectando)
{ "ok": false, "error": "..." }
```

### `POST /api/disconnect`
Desconecta el carro.

```json
// 200
{ "ok": true, "status": "disconnected" }
```

### `POST /api/programa-numeros`
Flujo principal del Receptor: recibe el programa **encriptado** y lo ejecuta.

```json
// Request: AVANZAR:3 (número 1025) + ENCENDER CÁMARA (número 1271)
{ "pasos": [ { "numero": 1025, "repeticiones": 3 }, { "numero": 1271, "repeticiones": 1 } ] }
// Response 202 (inicia ejecución asíncrona)
{
  "ok": true, "status": 202, "sequenceId": "uuid",
  "valid": true,
  "decoded": [ { "command": "A", "repetitions": 3, "numero": 1025, "esp32Char": "F", "name": "Avanzar" } ],
  "esp32Sequence": [ { "char": "N", "command": "P", "numero": 1271, "step": 1, "total": 1 } ],
  "totalSteps": 4
}
// Response 400 (número rechazado o semántica inválida)
{ "ok": false, "status": 400, "valid": false, "errors": [
  "Paso 1: N°1000 rechazado (FALSO): Número 1000 no pertenece a la tabla autorizada",
  "Paso 2: N°1271 no acepta parámetro de repetición (encontrado 'P:2')"
], "decoded": [] }
// Response 409 (sin carro conectado)
{ "ok": false, "status": 409, "valid": true, "error": "No hay conexión con el carro. ..." }
```

Reglas de validación:
- `numero` debe ser un entero de 4 dígitos y clasificar `VALIDO` (en la tabla, divisible por exactamente 1 primo). Si clasifica `FALSO`/`CORRUPTO` se rechaza con `400` y se audita.
- `repeticiones` va de 1 a 9 (los comandos de acción fuerzan 1).
- Semántica idéntica al parser por texto: `P` primero, `F` último, acciones sin repetición.

### `POST /api/program`
Valida y ejecuta un programa por texto (compatibilidad con el flujo anterior).

```json
{ "program": "P, A:3, R:2, D, O, C, F" }
// 202 / 400 / 409 (misma forma que /api/programa-numeros)
```

### `POST /api/command`
Ejecuta un comando individual del lenguaje.

```json
{ "command": "A", "repetitions": 3 }
// 202
{ "ok": true, "sequenceId": "uuid", "command": "A", "repetitions": 3, "esp32Char": "F", "name": "Avanzar", "totalSteps": 3 }
```

### `POST /api/raw`
Envía un char crudo directo al carro (compatibilidad/manual).

```json
{ "char": "M" }
// 200
{ "ok": true, "char": "M" }
```

### `POST /api/classify`
Clasifica un número (auditoría manual).

```json
{ "number": 1025 }
// 200
{ "ok": true, "number": 1025, "results": { "41": true, "43": false, ... },
  "classifiedAs": "VALIDO", "command": "A", "details": "Divisible por 41 → Avanzar",
  "divisibleCount": 1, "inTable": true }
// 400 (número inválido)
{ "ok": false, "status": 400, "error": "Número inválido" }
```

### `GET /api/audit`
Log acumulado de auditoría.

```json
{ "logs": [ { "sequenceId": null, "step": null, "command": "A", "commandName": "Avanzar",
  "esp32Char": "F", "number": 1025, "classification": "VALIDO", "details": "...",
  "results": { "41": true, "43": false }, "timestamp": "..." } ] }
```

### `GET /api/events` — Server-Sent Events (SSE)
Stream de eventos en tiempo real. Formato de cada evento:

```
event: <TIPO>
data: <JSON>

```

| Tipo | Descripción |
|------|-------------|
| `SEQUENCE_STARTED` | Una secuencia comenzó. `{ sequenceId, totalSteps }` |
| `STEP_SENT` | Un paso fue enviado al carro (confirmación `OK_<NOMBRE>:<paso>`). Incluye `message`, `encryptedNumber`, `classification`, `ackId` |
| `STEP_RETRY` | El carro no confirmó el ACK de un paso y se reintenta. `{ sequenceId, step, attempt, total }` |
| `SEQUENCE_COMPLETED` | Secuencia terminada. `{ sequenceId, totalSteps, duration }` |
| `SEQUENCE_ERROR` | Error durante la secuencia. `{ sequenceId, step, message }` |
| `AUDIT_LOG` | Entrada de auditoría (para el Receptor). Incluye `results` y `classification` |
| `CAR_STATUS` | Estado de conexión del carro. `{ status, ip, port }` |
| `CAR_MESSAGE` | Mensaje de texto del carro. `{ message }` |

**Ejemplo de cliente SSE (frontend):**
```js
const sse = new EventSource('http://localhost:3000/api/events');
sse.addEventListener('STEP_SENT', (e) => {
  const data = JSON.parse(e.data);
  console.log(data.message, data.encryptedNumber);
});
```

---

## 5. Protocolo del carro (WebSocket)

- **URL:** `ws://<ip_del_carro>/ws` (el firmware real usa el puerto 80; el simulador usa 8081).
- **Formato:** el backend envía **un carácter por mensaje** (texto). El carro procesa `data[0]`.
- **Repertorio de comandos del carro:**

| Char | Acción |
|------|--------|
| `F` | Avanzar 15cm |
| `B` | Retroceder 15cm |
| `R` | Girar Derecha 45° |
| `L` | Girar Izquierda 45° |
| `N` | Encender Cámara |
| `P` | Apagar Cámara |
| `O` | Abrir Pinza |
| `C` | Cerrar Pinza |
| `M` | Liberar Control |

- **Control único:** el carro asigna el control a la primera conexión ("Control asignado a tu IP"); cualquier otra recibe "ERROR: Control ocupado". Por eso el backend es el único que debe conectarse.

---

## 6. Instalación

### Requisitos
- Node.js 18+
- npm

### Pasos
```bash
# 1. Clonar
git clone <url-del-repo>
cd Proyecto_Compiladores

# 2. Instalar dependencias
npm run install:all
# (equivale a: npm install --prefix Backend && npm install --prefix Frontend && npm install)

# 3. Iniciar todo (backend + frontend)
npm start
```

### Alternativa Windows
Doble clic en `start.bat` (instala dependencias e inicia todo).

Esto iniciará:
- **Backend (API HTTP + SSE):** `http://localhost:3000`
- **Frontend (SPA):** `http://localhost:8080`

---

## 7. Uso con el Simulador (sin hardware)

```bash
# Terminal 1: iniciar el simulador del carro
cd simulador
npm start
# → ws://localhost:8081/ws  y  http://localhost:8081/mjpeg

# Terminal 2: iniciar el sistema completo
npm start
```

Luego:
1. Abrir `http://localhost:8080`.
2. En la pestaña **Receptor**, ingresar IP `127.0.0.1` y puerto `8081`, presionar **"Conectar Carro"**.
3. En la pestaña **Transmisor**, escribir un programa (ej: `P, A:3, R:2, D, O, C, F`) y presionar **"Ejecutar Programa"**. El Transmisor mostrará los números encriptados enviados (p. ej. `N°1025 ×3 → Avanzar`).
4. Ver la secuencia ejecutada en el simulador, las confirmaciones `OK_*` en el Transmisor y la auditoría en el Receptor.
5. Si el programa incluye `P`, el Transmisor mostrará el stream MJPEG del simulador.

---

## 8. Uso con el carro real

1. Configurar el carro ESP32 (SSID/password por BLE) y anotar su IP.
2. Iniciar el backend + frontend (`npm start`).
3. En el **Receptor**, ingresar la IP del carro y puerto `80`, presionar **"Conectar Carro"**.
4. Ejecutar programas desde el **Transmisor** (se envían los números encriptados al Receptor).
5. La cámara del carro real expone un stream **RTSP** en `rtsp://<ip_carro>:8554/stream`. El navegador no lo reproduce de forma nativa; utilice un reproductor RTSP (VLC, ffplay) con esa URL. El panel del Transmisor documenta esta URL cuando el comando `P` se activa.

---

## 9. Dos computadoras conectadas (multi-PC)

El sistema está pensado para que dos PCs trabajen juntas sin configuración adicional:

```
PC1 (servidor)                 PC2 (receptor)
├─ Backend  → 0.0.0.0:3000
├─ Frontend → 0.0.0.0:8080     ──abre──►  http://<IP_PC1>:8080
└─ Usa el rol Transmisor                    Usa el rol Receptor
```

**Pasos:**
1. En **PC1**, iniciar el sistema (`npm start`) y abrir `http://localhost:8080`. Usar el rol **Transmisor**.
2. Desde **PC2**, abrir `http://<IP_PC1>:8080`. En la barra superior, configurar el **Backend** como `http://<IP_PC1>:3000` (se guarda en `localStorage`) y presionar **Aplicar**.
3. En PC2 (rol **Receptor**), conectar el carro (IP del carro + puerto 80, o el simulador en la IP de quien lo ejecuta).
4. PC1 encripta y ejecuta programas; PC2 recibe los números, los valida y audita en tiempo real.

> Nota: las IP deben ser alcanzables entre sí en la misma red. Verifique el firewall si no se conectan.

---

## 10. Tests

Los tests usan el runner nativo de Node (`node --test`) y cubren:

| Archivo | Qué cubre |
|---------|-----------|
| `test/parser.test.js` | Sintaxis, semántica, repeticiones y mapeo al protocolo real del carro |
| `test/automatas.test.js` | Autómata de residuos, primos, conteo y primos divisores |
| `test/encriptador.test.js` | Tabla de 54 números: unicidad, clasificación `VALIDO` y dictámenes |
| `test/api-flujo-integral.test.js` | Flujo E2E por texto: API HTTP + conexión WebSocket a un carro mock |
| `test/flujo-numeros.test.js` | Flujo E2E encriptado: `POST /api/programa-numeros`, `GET /api/tabla`, descomposición y `OK_*` |
| `test/ack-reintento.test.js` | Confirmación ACK y regla de espera: formato `{numero, timestamp}`, reintento y `SEQUENCE_ERROR` cuando el carro no responde |

**Ejecutar todos los tests:**
```bash
npm test
# o bien, directamente en Backend:
cd Backend && npm test
```

**Con carro simulado (mock) incluido:** los tests de integración levantan un carro falso, conectan el backend y verifican que el carro reciba la secuencia exacta (`NFFFBBROCP` por texto; `FFF` para `{ numero: 1025, repeticiones: 3 }`) y que la auditoría registre las entradas `VALIDO`.

---

## 11. Solución de problemas

| Problema | Causa probable / Solución |
|----------|---------------------------|
| "No hay conexión con el carro" (409) | El carro/simulador no está conectado. Conéctelo desde el panel Receptor. |
| El Transmisor no confirma pasos | Verifique que la URL del Backend en la barra superior sea correcta y que el backend esté corriendo. |
| El Transmisor no puede encriptar | Debe poder descargar `GET /api/tabla`; sin backend o con URL incorrecta no se obtienen los números. |
| Número rechazado (400 FALSO/CORRUPTO) | El Receptor validó con los autómatas y rechazó el número. Revise la consola de auditoría para ver el dictamen y los primos divisores. |
| CORS bloqueado | El backend ya envía `Access-Control-Allow-Origin: *`. Verifique que use el puerto 3000. |
| No se conecta desde otra PC | Revise el firewall y que ambas PCs estén en la misma red; backend escucha en `0.0.0.0`. |
| El simulador rechaza comandos | Solo acepta comandos del controlador asignado (primera conexión). Reinicie el simulador. |
| El stream MJPEG no aparece | El carro/simulador debe estar conectado (`/api/health` debe reportar `carAddress`) para que el Transmisor arme la URL `http://<ip>:8081/mjpeg`. |
| El navegador no reproduce el video del carro real | Es RTSP (`rtsp://<ip_carro>:8554/stream`); úselo con VLC/ffplay. El navegador solo reproduce MJPEG. |
| Los tests tardan | Los tests de integración usan un delay reducido; los normales usan 350 ms por paso. |
| `node_modules` sigue apareciendo en git | Los directorios `node_modules` fueron trackeados en commits antiguos del repositorio. `.gitignore` evita que se vuelvan a agregar en el futuro, pero no elimina los ya trackeados. Para que las eliminaciones no ensucien un commit, se deshacen con `git reset HEAD -- <ruta>` (los archivos quedan en disco y en el índice). |

---

## 12. Documentación y estilo de código

- **No hay comentarios en el código.** Todo el proyecto se documenta exclusivamente en este `README.md`.
- La lógica de encriptación/validación vive únicamente en el backend (`encriptador.js`, `automatas.js`, `parser.js`); el frontend descarga la tabla y no duplica reglas.

---

## 13. Cambios registrados (historial)

- **Flujo encriptado nuevo (Transmisor → Receptor):** el Transmisor descarga la tabla (`GET /api/tabla`), encripta cada comando a un número de 4 dígitos y lo envía por `POST /api/programa-numeros` como `{ pasos: [{ numero, repeticiones }] }`. El Receptor (backend) valida, descompone y ejecuta en el carro; las confirmaciones `OK_*` vuelven por SSE.
- **`parser.js`:** se extrajo `validateCommands` (semántica única para flujo por texto y por números) y `buildESP32Sequence` conserva el número encriptado por paso.
- **`transmisorService.js`:** nuevo `executeEncodedProgram(steps)` (validación 4 dígitos + dictamen `VALIDO`/`FALSO`/`CORRUPTO` + semántica) y `runSequence` usa el número transmitido cuando existe.
- **`server.js`:** nuevas rutas `GET /api/tabla` y `POST /api/programa-numeros`.
- **Simulador:** agregado stream **MJPEG** en `http://0.0.0.0:8081/mjpeg` además del WebSocket; se documenta el RTSP real.
- **Frontend Transmisor:** ahora encripta (elige números de la tabla) y muestra el video MJPEG del simulador; el video es un `<img>` en lugar de `<video>`.
- **Tests:** nuevo `test/flujo-numeros.test.js` (10 casos E2E del flujo encriptado).
- **Comentarios eliminados:** todo el código quedó sin comentarios; toda la documentación vive en este README.
- **Cambios anteriores (resumen):** comunicación Transmisor↔Backend por **HTTP (REST + SSE)**; carro **solo WebSocket** con byte crudo; mapeo real del firmware (`A→F, R→B, D→R, I→L, P→N, F→P`); comando `M`; tabla de **54 números / 9 comandos**; `CORRUPTO` = divisible por 2+ primos.
- **Confirmación ACK por paso (regla de espera):** el backend espera `ACK:<char>` del carro antes de avanzar; sin ACK en 5s reintenta hasta 3 veces (evento `STEP_RETRY`) y si se agotan emite `SEQUENCE_ERROR`. El simulador responde `ACK:<char>` por comando.
- **Formato de la consigna:** `/api/programa-numeros` acepta también el cuerpo `{ numero, repeticiones, timestamp }` (además de `{ pasos: [...] }`), el `timestamp` se ignora a efectos de validación. Nuevo test `ack-reintento.test.js`.

---

## 14. Autor y licencia

**Autor:** Diego Safar
**Licencia:** MIT
