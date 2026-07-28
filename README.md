# Sistema de Control Robótico vía WebSockets

Proyecto de Compiladores: Sistema de comunicación segura y procesamiento de lenguajes para controlar un vehículo robótico basado en ESP32.

## Arquitectura

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐
│   FRONTEND      │     │    BACKEND       │     │   ESP32     │
│   (SPA)         │◄───►│   (Node.js)      │◄───►│   (Robot)   │
│   Puerto 8080   │ WS  │   Puerto 3000    │ WS  │  Puerto 8081│
└─────────────────┘     └──────────────────┘     └─────────────┘
```

## Components

### Frontend (Cliente Web)
- **Transmisor**: Panel del operador con input de comandos, video player, logs
- **Receptor**: Panel de auditoría ciega con desglose del autómata por primos

### Backend (Servidor)
- **Parser**: Validación sintáctica y semántica de comandos
- **Autómata de Residuos**: AFD para verificar divisibilidad por 6 primos
- **Encriptador**: Tabla de 48 números autorizados (6 por comando)
- **Servicios WebSocket**: Gestión de conexiones Transmisor/Receptor/ESP32

### Comandos

| Comando | Acción | Carácter ESP32 |
|---------|--------|----------------|
| `A:x` | Avanzar | `W` |
| `R:x` | Retroceder | `B` |
| `D:x` | Girar Derecha | `R` |
| `I:x` | Girar Izquierda | `L` |
| `O` | Abrir Pinza | `O` |
| `C` | Cerrar Pinza | `C` |
| `P` | Encender Cámara | `P` |
| `F` | Apagar Cámara | `F` |

Donde `x` es un dígito del 1 al 9 (repetición).

### Ejemplo de programa
```
P, A:3, R:2, D, O, C, F
```

## Primos Autorizados

| Primo | Uso |
|-------|-----|
| 41 | Verificación de autenticidad |
| 43 | Verificación de autenticidad |
| 47 | Verificación de autenticidad |
| 53 | Verificación de autenticidad |
| 59 | Verificación de autenticidad |
| 61 | Verificación de autenticidad |

### Clasificación de mensajes
- **VÁLIDO**: Número en tabla y divisible por exactamente 1 primo
- **FALSO**: Número no en tabla o no divisible por ningún primo
- **CORRUPTO**: Número divisible por 2 o más primos

## Instalación

### Requisitos
- Node.js 18+ 
- npm

### Pasos

```bash
# 1. Clonar el repositorio
git clone https://gitlab.com/diego_safar_compiladores/compiladores_diego_safar.git
cd compiladores_diego_safar

# 2. Instalar dependencias
npm install

# 3. Iniciar el sistema completo
npm start
```

Esto iniciará:
- **Backend**: ws://localhost:3000
- **Frontend**: http://localhost:8080

### Alternativa Windows
Doble clic en `start.bat`

## Uso

### Modo Transmisor
1. Abrir http://localhost:8080
2. Seleccionar "Transmisor" en el navbar
3. Escribir programa de comandos (ej: `P, A:3, R:2, D, O, C, F`)
4. Presionar "Ejecutar Programa"
5. Ver logs de confirmación en la consola

### Modo Receptor
1. Abrir http://localhost:8080
2. Seleccionar "Receptor" en el navbar
3. Ingresar IP y puerto de la ESP32
4. Presionar "Conectar ESP32"
5. Ver logs de auditoría y desglose del autómata

### Con Simulador de ESP32
```bash
# Terminal 1: Iniciar simulador
cd simulador
npm start

# Terminal 2: Iniciar sistema completo
npm start
```

Luego en el Receptor, conectar a `127.0.0.1:8081`.

## Estructura del Proyecto

```
Proyecto_Compiladores/
├── package.json              # Script maestro
├── start.bat                 # Inicio rápido Windows
├── README.md                 # Esta documentación
├── Backend/
│   ├── package.json
│   ├── server.js             # Servidor WebSocket
│   └── src/
│       ├── core/
│       │   ├── parser.js     # Lexer/Sintáctico
│       │   ├── automatas.js  # AFD de residuos
│       │   └── encriptador.js# Tabla de números
│       ├── services/
│       │   ├── transmisorService.js
│       │   └── receptorService.js
│       └── utils/logger.js
├── Frontend/
│   ├── package.json
│   ├── server.js             # Servidor estáticos
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── app.js
│       ├── ws-manager.js
│       └── views/
│           ├── transmitterView.js
│           └── receiverView.js
└── simulador/
    ├── package.json
    └── esp32-simulator.js    # Simulador de ESP32
```

## WebSocket API

### Rutas del Backend
| Ruta | Descripción |
|------|-------------|
| `/ws/transmitter` | Canal del Transmisor |
| `/ws/receiver` | Canal del Receptor |
| `/ws/esp32` | Conexión de ESP32 |

### Mensajes

#### Transmisor → Backend
```json
{
  "type": "COMMAND",
  "command": "W",
  "commandName": "Avanzar",
  "step": 1,
  "total": 3,
  "ackId": "uuid"
}
```

#### Backend → Transmisor
```json
{
  "type": "CONFIRMACION_COMANDO",
  "message": "OK_AVANZAR:1",
  "encryptedNumber": 1025,
  "classification": "VALIDO",
  "ackId": "uuid"
}
```

#### Backend → ESP32
```json
{
  "type": "COMMAND",
  "command": "W"
}
```

#### ESP32 → Backend
```json
{
  "type": "RESPONSE",
  "data": "Avanzar 15cm ejecutado"
}
```

## Tecnologías

- **Backend**: Node.js, WebSocket (ws), ES Modules
- **Frontend**: HTML5, CSS3, JavaScript vanilla
- **Protocolo**: WebSocket (ws://)
- **Autenticidad**: Autómata de residuos módulo n

## Autor

Diego Safar

## Licencia

MIT
