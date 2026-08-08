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

- **El Transmisor encripta el programa.** Convierte cada comando del lenguaje (`F`, `R:2`, `L`, …) en un **número encriptado de 4 dígitos** dentro del rango autorizado de su comando. El programa completo viaja como **un único string** que concatena un número de 4 dígitos por cada repetición, en el orden escrito.
- **El Receptor (Backend) es "ciego".** No recibe el texto del programa: solo recibe el string de números, lo corta en bloques de 4 dígitos, valida cada uno con los autómatas de residuos (dictamen `VALIDO`/`FALSO`/`CORRUPTO`), lo descompone a su comando real y lo ejecuta en el carro.
- **Transmisor ↔ Backend: SOLO HTTP.** El Transmisor envía los números con `POST` (`fetch`) y recibe confirmaciones `OK_*` en tiempo real por **Server-Sent Events (SSE)**, que también es HTTP.
- **Backend ↔ Carro: SOLO WebSocket.** El backend abre una conexión WebSocket con el carro y le envía **un byte crudo por comando** (el primer byte del mensaje es el comando, igual que el firmware real del ESP32).
- **El frontend NO usa WebSocket en ningún momento.** Toda su comunicación es HTTP.
- **Confirmación por paso (ACK):** el carro confirma cada comando con `ACK:<char>` por el WebSocket; el backend no avanza al siguiente paso hasta recibirla (reintenta hasta 3 veces con timeout de 5 s — ver `transmisorService`). Esto implementa la regla de espera/confirmación del protocolo.
- **Video:** con el simulador el Transmisor muestra un stream **MJPEG** (`http://<ip_carro>:8081/mjpeg`); con el carro real la cámara se documenta como **RTSP** (`rtsp://<ip_carro>:8554/stream`), que el navegador no reproduce de forma nativa.

### ¿Por qué esta arquitectura?

- **Encriptación verificable:** cada comando tiene un **rango** de números propio (F = 1000–1999, B = 2000–2999, …, M = 9000–9999) y cada número autorizado es divisible por exactamente un primo de la lista `[41, 43, 47, 53, 59, 61]`. El Receptor identifica el comando por el rango y lo valida con el autómata de residuos sin conocer lista alguna, de modo que el Transmisor "encripta" y el Receptor "descifra y valida".
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
│   │   │   └── encriptador.js   # Rangos por comando + generación/decodificación del número único
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
│       ├── flujo-numeros.test.js
│       └── ack-reintento.test.js
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
- Reglas sintácticas: cada comando es una letra mayúscula con repetición opcional `F:3`.
- Reglas semánticas (`validateCommands`): `N` (encender cámara) debe ser el primer comando; `P` (apagar cámara) debe ser el último; los comandos de acción (`O, C, N, P, M`) no aceptan repetición.
- `buildESP32Sequence`: expande los comandos en la secuencia ESP32, un elemento por repetición, conservando el número encriptado si el comando lo trae.
- `parseCommands` reutiliza `validateCommands`, por lo que la semántica es la misma para el flujo por texto y el flujo por números encriptados.
- **Mapeo de comandos (esquema directo del carro):**

| Lenguaje | Comando | Char carro | Tipo |
|----------|---------|------------|------|
| `F:x`    | Avanzar | `F`        | movimiento |
| `B:x`    | Retroceder | `B`     | movimiento |
| `R:x`    | Girar Derecha | `R`   | movimiento |
| `L:x`    | Girar Izquierda | `L`  | movimiento |
| `O`      | Abrir Pinza | `O`      | acción |
| `C`      | Cerrar Pinza | `C`     | acción |
| `N`      | Encender Cámara | `N`   | cámara |
| `P`      | Apagar Cámara | `P`     | cámara |
| `M`      | Liberar Control | `M`   | acción |

> El lenguaje del proyecto usa el mismo esquema que el firmware real del carro: `F B R L O C N P M`. Ya no existe un mapeo intermedio.

#### `src/core/automatas.js` — Autómata de residuos
- Implementa un **AFD de residuos** que verifica si un número es divisible por cada uno de los 6 primos autorizados, procesando el número dígito a dígito (estado = resto parcial).
- Primos: `41, 43, 47, 53, 59, 61`.
- Funciones: `divisibilityAutomaton(number, prime)`, `getClassificationResults(number)`, `countDivisibilities(results)`, `getDivisiblePrimes(results)`.

#### `src/core/encriptador.js` — Rangos por comando y número único
- Cada comando tiene un **rango** de 1000 números propios:
  - `F` (1000–1999), `B` (2000–2999), `R` (3000–3999), `L` (4000–4999), `O` (5000–5999), `C` (6000–6999), `N` (7000–7999), `P` (8000–8999), `M` (9000–9999).
- `COMMAND_RANGE`: mapa comando → `{ min, max, name }`. Se expone vía `GET /api/rangos`.
- `generarNumero(command)`: elige al azar un número **dentro del rango** del comando divisible por exactamente 1 primo (~117 por rango), garantizando un número `VALIDO`.
- `clasificarNumero(number)`: identifica el comando por **rango** y valida con los autómatas; devuelve `VALIDO`, `FALSO` o `CORRUPTO`.
- `codificarPrograma(comandos)`: genera un número por cada repetición y los **concatena** en el string único (`numeroUnico`).
- `decodificarPrograma(numeroStr)`: corta el string en bloques de 4 dígitos y clasifica cada bloque.

##### Clasificación de números
| Dictamen | Regla |
|----------|-------|
| **VÁLIDO** | Está en un rango conocido y es divisible por exactamente 1 primo |
| **FALSO** | No está en ningún rango, o está en un rango pero no es divisible por ningún primo |
| **CORRUPTO** | Es divisible por 2 o más primos (independientemente del rango) |

##### Esquema de encriptación (número único)
- El programa completo viaja como **un solo string** que concatena un número de 4 dígitos por cada repetición: `F:3, R` → por ejemplo `"1640168115933445"` (3 bloques de F + 1 de R).
- `POST /api/codificar` convierte el texto del programa (`F:3, R`) en el `numeroUnico` y sus `bloques`.
- `POST /api/programa-numeros` recibe ese string, lo corta en bloques de 4 dígitos, valida cada bloque (debe clasificar `VALIDO`) y ejecuta la secuencia en el carro.
- El `numeroUnico` puede superar `Number.MAX_SAFE_INTEGER`: **siempre se trata como string** (nunca como Number) y se corta con `string.slice`.

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
- `executeEncodedProgram(programa)`: flujo principal del Receptor. Recibe el **string único** (`programa`) y:
  1. Lo decodifica con `decodificarPrograma` (bloques de 4 dígitos).
  2. Si algún bloque no clasifica `VALIDO`, rechaza con `400`, indica el dictamen (`FALSO`/`CORRUPTO`) y lo registra en auditoría (el Receptor "ciego" audita el rechazo).
  3. Valida la semántica con `validateCommands` (`N`/`P` mal ubicados).
  4. Construye la secuencia ESP32 (un paso por bloque, cada uno con su `numero`) y ejecuta por WebSocket.
- `executeCommand(command, repetitions)`: comando individual (compatibilidad).
- `sendRawChar(char)`: envía un char crudo directo al carro (compatibilidad/manual).
- `classifyNumber(number)`: clasifica y agrega al log de auditoría (manual).
- `runSequence(...)`: por cada paso:
  1. Envía el char al carro por WebSocket y **espera su confirmación** `ACK:<char>` (regla de espera del protocolo).
  2. Si no llega ACK en **5 segundos**, **reintenta hasta 3 veces** (emite `STEP_RETRY` por intento).
  3. Si se agotan los intentos, emite `SEQUENCE_ERROR` y detiene la secuencia.
  4. Usa el número encriptado del bloque (`cmd.numero`) o, si no existe (flujo por texto), genera uno con `generarNumero`.
  5. Lo clasifica (debe ser `VALIDO`).
  6. Agrega la entrada de auditoría (con el número encriptado) y emite `STEP_SENT` con el mensaje `OK_<NOMBRE>:<paso>` (confirmación para el Transmisor).
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
- **Función:** encriptar programas y enviar el número único al Receptor.
- Al presionar "Ejecutar Programa": envía el texto (`N, F:3, B:2, R, O, C, P`) a `POST /api/codificar`, que devuelve el `numeroUnico` y sus bloques. Luego envía ese string a `POST /api/programa-numeros`.
- El log muestra el comando **ya encriptado**: por cada bloque aparece su número (`N°1272 → Avanzar (F)`) y el programa completo (`Programa encriptado: 127213783572...`), además de la secuencia ESP32 decodificada y las confirmaciones `OK_*` por SSE (`SEQUENCE_STARTED`, `STEP_SENT`, `SEQUENCE_COMPLETED`, `SEQUENCE_ERROR`).
- **Cámara:** si el programa contiene `N` muestra el stream; con carro/simulador conectado apunta a `http://<ip>:8081/mjpeg` (tomada de `/api/health`); con `P` lo oculta. Con hardware real se documenta la URL RTSP (no reproducible en navegador).

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

Esta sección explica **el viaje completo de un programa**, desde que lo escribís en el Transmisor hasta que el carro lo ejecuta y la confirmación vuelve a tu pantalla. Se usa como ejemplo el programa `N, F:3, B:2, R, O, C, P` (encender cámara, avanzar 3, retroceder 2, girar derecha, abrir pinza, cerrar pinza, apagar cámara).

### Fase A — Puesta en marcha (qué arranca con `npm start`)

1. El script maestro `package.json` usa `concurrently` para lanzar **Backend** y **Frontend** juntos.
2. **Backend** (`0.0.0.0:3000`) crea e instancia en orden:
   - `CarService` → el cliente que hablará con el carro por WebSocket.
   - `AuditService` → el log central + el hub de eventos SSE (`broadcast` / `subscribe`).
   - `TransmisorService` (`{ carService, auditService, stepDelay: 350, ackTimeout: 5000, maxRetries: 3 }`).
3. **Frontend** (`0.0.0.0:8080`) sirve la SPA (HTML/CSS/JS) y al abrirla crea dos vistas: `TransmisorView` y `ReceiverView`.

### Fase B — El Transmisor (PC1) se prepara y encripta

1. `GET /api/events` (SSE) queda abierto como stream para recibir las confirmaciones en vivo.
2. **Escribís el programa** en el textarea: `N, F:3, B:2, R, O, C, P`.
3. Al presionar **Ejecutar Programa**, la vista envía el texto a `POST /api/codificar`:
   - El backend tokeniza, valida la semántica y genera un número **al azar dentro del rango** de cada comando, uno por cada repetición (eso es "encriptar": nada viaja como texto, solo números de 4 dígitos).
   - Devuelve `numeroUnico` (el string que concatena los bloques) y los `bloques` con su comando y número.
4. La vista muestra cada bloque ya encriptado (`N°1272 → Avanzar (F)`) y el `Programa encriptado: <numeroUnico>`.
5. Envía el `numeroUnico` por `fetch` (`POST`) a `/api/programa-numeros`.

### Fase C — El backend recibe y valida los números (Receptor "ciego")

1. `server.js` recibe el `POST` con `{ programa: "<numeroUnico>" }` y llama `executeEncodedProgram(programa)`.
2. `decodificarPrograma` corta el string en bloques de 4 dígitos (la longitud debe ser múltiplo de 4). Por cada bloque valida en orden:
   1. **Integridad:** debe ser un número entre 1000 y 9999. Si no, error `400`.
   2. **Clasificación con el autómata** (`clasificarNumero`): identifica el comando por **rango** y calcula la divisibilidad por cada uno de los 6 primos `[41, 43, 47, 53, 59, 61]`:
      - `VALIDO` → está en un rango conocido y es divisible por exactamente 1 primo.
      - `FALSO` → no está en ningún rango, o está pero no coincide con ningún primo.
      - `CORRUPTO` → divisible por 2 o más primos (posible ataque).
   3. Si es inválido, rechaza con `400`, **audita** el rechazo y corta la secuencia; si es `VALIDO`, el comando real es el de su rango (p. ej. `1272` → rango 1000–1999 → `F` = Avanzar).
3. `validateCommands` aplica las reglas semánticas como en el flujo de texto: `N` primero, `P` último.
4. Si todo está bien, responde `202` (ejecución asíncrona) y arranca la secuencia; sin carro conectado la secuencia falla con `SEQUENCE_ERROR`.

### Fase D — Ejecución paso a paso con confirmación (ACK)

1. `startSequence` emite por SSE `SEQUENCE_STARTED` y llama `runSequence`.
2. `runSequence` recorre la secuencia **de a un paso** (construida con `buildESP32Sequence`, que expande repeticiones: `F:2` → `F`, `F`).
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
2. **En pantalla:** el log del Transmisor muestra cada bloque ya encriptado (`N°1272 → Avanzar (F)`), el `Programa encriptado: <numeroUnico>`, la secuencia ESP32 decodificada y las confirmaciones `OK_*`.
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

### `GET /api/rangos`
Rangos de números autorizados por comando. Documenta el esquema de encriptación (la codificación la hace el backend, no el Transmisor).

```json
{
  "rangos": {
    "F": { "min": 1000, "max": 1999, "name": "Avanzar" },
    "B": { "min": 2000, "max": 2999, "name": "Retroceder" },
    "R": { "min": 3000, "max": 3999, "name": "Girar Derecha" },
    "L": { "min": 4000, "max": 4999, "name": "Girar Izquierda" },
    "O": { "min": 5000, "max": 5999, "name": "Abrir Pinza" },
    "C": { "min": 6000, "max": 6999, "name": "Cerrar Pinza" },
    "N": { "min": 7000, "max": 7999, "name": "Encender Cámara" },
    "P": { "min": 8000, "max": 8999, "name": "Apagar Cámara" },
    "M": { "min": 9000, "max": 9999, "name": "Liberar Control" }
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
Flujo principal del Receptor: recibe el **programa encriptado** como string único y lo ejecuta.

```json
// Request: programa "F:3, R" codificado (3 bloques F + 1 bloque R, 16 dígitos)
{ "programa": "1640168115933445" }
// Response 202 (inicia ejecución asíncrona)
{
  "ok": true, "status": 202, "sequenceId": "uuid",
  "valid": true, "programa": "1640168115933445",
  "decoded": [
    { "command": "F", "repetitions": 1, "numero": 1640, "esp32Char": "F", "name": "Avanzar" },
    { "command": "F", "repetitions": 1, "numero": 1681, "esp32Char": "F", "name": "Avanzar" },
    { "command": "F", "repetitions": 1, "numero": 1593, "esp32Char": "F", "name": "Avanzar" },
    { "command": "R", "repetitions": 1, "numero": 3445, "esp32Char": "R", "name": "Girar Derecha" }
  ],
  "esp32Sequence": [
    { "char": "F", "command": "F", "numero": 1640, "step": 1, "total": 1 },
    { "char": "F", "command": "F", "numero": 1681, "step": 1, "total": 1 },
    { "char": "F", "command": "F", "numero": 1593, "step": 1, "total": 1 },
    { "char": "R", "command": "R", "numero": 3445, "step": 1, "total": 1 }
  ],
  "totalSteps": 4
}
// Response 400 (bloque rechazado o semántica inválida)
{ "ok": false, "status": 400, "valid": false, "errors": [
  "Bloque 1: N°1000 rechazado (FALSO): Número 1000 en rango pero no divisible por ningún primo"
], "decoded": [], "bloques": [] }
```

Reglas de validación:
- `programa` debe ser un **string no vacío** de longitud múltiplo de 4 (un número de 4 dígitos por comando).
- Cada bloque debe estar entre 1000 y 9999 y clasificar `VALIDO` (en un rango conocido, divisible por exactamente 1 primo). Si clasifica `FALSO`/`CORRUPTO` se rechaza con `400` y se audita.
- Semántica idéntica al parser por texto: `N` primero, `P` último.
- El `programa` se trata siempre como **string** (puede superar `Number.MAX_SAFE_INTEGER`).

### `POST /api/program`
Valida y ejecuta un programa por texto (compatibilidad con el flujo anterior).

```json
{ "program": "N, F:3, B:2, R, O, C, P" }
// 202 / 400 (misma forma que /api/programa-numeros)
```

### `POST /api/codificar`
Convierte el texto de un programa al **número único** encriptado. Lo usa el Transmisor antes de enviar a `/api/programa-numeros`.

```json
{ "program": "F:3, R" }
// 200
{
  "ok": true, "valid": true, "program": "F:3, R",
  "numeroUnico": "1640168115933445",
  "bloques": [
    { "numero": 1640, "command": "F", "name": "Avanzar" },
    { "numero": 1681, "command": "F", "name": "Avanzar" },
    { "numero": 1593, "command": "F", "name": "Avanzar" },
    { "numero": 3445, "command": "R", "name": "Girar Derecha" }
  ],
  "totalSteps": 4
}
// 400 (programa inválido)
{ "ok": false, "valid": false, "errors": [ "..." ] }
```

### `POST /api/command`
Ejecuta un comando individual del lenguaje.

```json
{ "command": "F", "repetitions": 3 }
// 202
{ "ok": true, "sequenceId": "uuid", "command": "F", "repetitions": 3, "esp32Char": "F", "name": "Avanzar", "totalSteps": 3 }
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
  "classifiedAs": "VALIDO", "command": "F", "name": "Avanzar",
  "details": "Divisible por 41 → Avanzar",
  "divisibleCount": 1, "inRange": true }
// 400 (número inválido)
{ "ok": false, "status": 400, "error": "Número inválido" }
```

### `GET /api/audit`
Log acumulado de auditoría.

```json
{ "logs": [ { "sequenceId": null, "step": null, "command": "F", "commandName": "Avanzar",
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
3. En la pestaña **Transmisor**, escribir un programa (ej: `N, F:3, B:2, R, O, C, P`) y presionar **"Ejecutar Programa"**. El Transmisor mostrará los números encriptados enviados (p. ej. `N°1272 → Avanzar (F)` y `Programa encriptado: 127213783572...`).
4. Ver la secuencia ejecutada en el simulador, las confirmaciones `OK_*` en el Transmisor y la auditoría en el Receptor.
5. Si el programa incluye `N`, el Transmisor mostrará el stream MJPEG del simulador.

---

## 8. Uso con el carro real

1. Configurar el carro ESP32 (SSID/password por BLE) y anotar su IP.
2. Iniciar el backend + frontend (`npm start`).
3. En el **Receptor**, ingresar la IP del carro y puerto `80`, presionar **"Conectar Carro"**.
4. Ejecutar programas desde el **Transmisor** (se envían los números encriptados al Receptor).
5. La cámara del carro real expone un stream **RTSP** en `rtsp://<ip_carro>:8554/stream`. El navegador no lo reproduce de forma nativa; utilice un reproductor RTSP (VLC, ffplay) con esa URL. El panel del Transmisor documenta esta URL cuando el comando `N` se activa.

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
| `test/encriptador.test.js` | Rangos por comando, `generarNumero`, clasificación `VALIDO`/`FALSO`/`CORRUPTO` y codificar/decodificar programa |
| `test/api-flujo-integral.test.js` | Flujo E2E por texto y por número único: API HTTP + conexión WebSocket a un carro mock |
| `test/flujo-numeros.test.js` | Flujo E2E encriptado: `POST /api/programa-numeros`, `POST /api/codificar`, `GET /api/rangos`, descomposición y `OK_*` |
| `test/ack-reintento.test.js` | Confirmación ACK y regla de espera: reintento y `SEQUENCE_ERROR` cuando el carro no responde |

**Ejecutar todos los tests:**
```bash
npm test
# o bien, directamente en Backend:
cd Backend && npm test
```

**Con carro simulado (mock) incluido:** los tests de integración levantan un carro falso, conectan el backend y verifican que el carro reciba la secuencia exacta (`NFFFBBROCP` por texto; `FFFR` para un programa encriptado de `F:3, R`) y que la auditoría registre las entradas `VALIDO`.

---

## 11. Solución de problemas

| Problema | Causa probable / Solución |
|----------|---------------------------|
| "No hay conexión con el carro" (409) | El carro/simulador no está conectado. Conéctelo desde el panel Receptor. |
| El Transmisor no confirma pasos | Verifique que la URL del Backend en la barra superior sea correcta y que el backend esté corriendo. |
| El Transmisor no puede encriptar | Debe poder llamar `POST /api/codificar`; sin backend o con URL incorrecta no se genera el número único. |
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
- La lógica de encriptación/validación vive únicamente en el backend (`encriptador.js`, `automatas.js`, `parser.js`); el frontend delega la codificación a `POST /api/codificar` y no duplica reglas.

---

## 13. Cambios registrados (historial)

- **Esquema de rangos + número único (reemplaza la tabla de 54 números):** cada comando tiene un rango propio (F = 1000–1999, B = 2000–2999, …, M = 9000–9999); `generarNumero` elige un número del rango divisible por exactamente 1 primo; `codificarPrograma` concatena un número de 4 dígitos por cada repetición en un **string único** (`numeroUnico`); `decodificarPrograma` corta y clasifica cada bloque. El número único siempre se trata como string (puede superar `Number.MAX_SAFE_INTEGER`).
- **`parser.js`:** se extrajo `validateCommands` (semántica única para flujo por texto y por números) y `buildESP32Sequence` conserva el número encriptado por paso.
- **`transmisorService.js`:** nuevo `executeEncodedProgram(programa)` (decodifica el string único + dictamen `VALIDO`/`FALSO`/`CORRUPTO` + semántica) y `runSequence` usa el número del bloque cuando existe.
- **`server.js`:** `GET /api/tabla` → `GET /api/rangos`; nuevo `POST /api/codificar`; `POST /api/programa-numeros` ahora recibe `{ programa: "<numeroUnico>" }` en lugar de `{ pasos: [...] }`.
- **Frontend Transmisor:** codifica vía `POST /api/codificar`, muestra cada bloque ya encriptado (`N°1272 → Avanzar (F)`) y el `Programa encriptado: <numeroUnico>`, y lo envía a `/api/programa-numeros`.
- **Simulador:** agregado stream **MJPEG** en `http://0.0.0.0:8081/mjpeg` además del WebSocket; se documenta el RTSP real.
- **Tests:** `encriptador.test.js` reescrito para rangos/primos/concatenación; `flujo-numeros.test.js`, `api-flujo-integral.test.js` y `ack-reintento.test.js` adaptados al payload `{ programa }`.
- **Comentarios eliminados:** todo el código quedó sin comentarios; toda la documentación vive en este README.
- **Cambios anteriores (resumen):** comunicación Transmisor↔Backend por **HTTP (REST + SSE)**; carro **solo WebSocket** con byte crudo; esquema directo del carro (`F B R L O C N P M`); comando `M`; rangos de **1000 números por comando**; `CORRUPTO` = divisible por 2+ primos.
- **Confirmación ACK por paso (regla de espera):** el backend espera `ACK:<char>` del carro antes de avanzar; sin ACK en 5s reintenta hasta 3 veces (evento `STEP_RETRY`) y si se agotan emite `SEQUENCE_ERROR`. El simulador responde `ACK:<char>` por comando.
- **Formato de la consigna (reemplazado):** el payload `{ numero, repeticiones, timestamp }` quedó superado por el número único `{ programa }`. `ack-reintento.test.js` sigue cubriendo la regla de espera/ACK con el nuevo payload.

---

## 14. Autor y licencia

**Autor:** Diego Safar
**Licencia:** MIT
