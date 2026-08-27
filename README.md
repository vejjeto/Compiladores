# Sistema de Control Robótico vía HTTP + WebSocket

Proyecto de Compiladores: sistema de comunicación segura y procesamiento de lenguajes para controlar un vehículo robótico basado en ESP32.

Este documento es el **manual completo** del proyecto actualizado: describe la nueva arquitectura unificada, el soporte P2P compatible con repositorios pares, las tablas dinámicas y el protocolo de comunicación.

---

## 1. Arquitectura Unificada (Nueva)

```
┌─────────────────────────┐                            ┌────────────┐
│        FRONTEND         │                            │   CARRO    │
│  (SPA - Transmisor y    │   HTTP / WS (P2P)          │   (ESP32)  │
│   Receptor en pestañas) │◄───────────┬──────────────►│  (robot)   │
└─────────────────────────┘            │               └────────────┘
                              ┌────────┴─────────────┐
                              │    BACKEND UNIFICADO │
                              │      (Node.js)       │
                              │    Puerto 3000       │
                              └──────────────────────┘
```

### Principio de comunicación

- **Backend Único:** Se ha eliminado el servidor independiente del frontend. Ahora el Backend (Node.js en el puerto 3000) sirve tanto la Interfaz Web como la API Rest y los WebSockets, ahorrando un 33% de memoria y simplificando el despliegue.
- **El Transmisor toma el control:** Toda la interfaz de conexión al carro y al Peer (P2P) se ha centralizado en el Transmisor. Él es quien ordena las conexiones.
- **El Receptor es "ciego" y pasivo:** No tiene botones de control. Su única misión es escuchar la red, recibir bloques numéricos, auditarlos usando los autómatas y ejecutarlos en el carro local si aplica.
- **Tablas Dinámicas:** Los rangos, comandos y primos divisores ya no están "quemados" en el código. El sistema lee su configuración en tiempo real desde `Backend/config/tablas.json`.
- **Formato de Encriptación Estándar (5 Dígitos):** Para garantizar la compatibilidad con repositorios de la clase en GitLab, el sistema ahora utiliza bloques numéricos encriptados de 5 dígitos en formato de cadena (ej: `"14523"`).
- **Comunicación P2P (Peer-to-Peer):** El Transmisor puede conectarse directamente a un Receptor remoto (ej. la PC de un compañero) vía WebSocket (`ws://<IP>:3000/ws/peer`) usando adaptadores dinámicos que traducen la data.

---

## 2. Componentes del proyecto

```
Proyecto_Compiladores/
├── package.json                 # Script maestro (concurrencia)
├── start.bat                    # Inicio rápido en Windows
├── README.md                    # Documentación del proyecto
├── Backend/
│   ├── server.js                # Servidor unificado HTTP estático + API + WS
│   ├── config/
│   │   └── tablas.json          # Configuración dinámica de comandos, rangos y primos
│   ├── src/
│   │   ├── core/
│   │   │   ├── parser.js        
│   │   │   ├── automatas.js     # AFD de residuos para N primos dinámicos
│   │   │   └── encriptador.js   # Generación/decodificación (bloques 5 dígitos)
│   │   ├── adapters/
│   │   │   ├── peerAdapter.js   # Habilita la conexión saliente a Receptores pares
│   │   │   ├── wsCarAdapter.js  
│   │   │   └── wsServerAdapter.js # Servidor WebSocket API y P2P entrante
│   │   ├── services/
│   │   │   ├── tablaService.js  # Gestor que carga y expone las tablas dinámicas
│   │   │   └── ...
│   └── test/                    # Suite de 105 tests (0 fallos)
├── Frontend/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── views/
│       │   ├── transmitterView.js   # Panel de control maestro (encripta y conecta)
│       │   └── receiverView.js      # Panel pasivo de auditoría visual
└── simulador/
    └── esp32-simulator.js       # Simulador del carro local
```

---

## 3. ¿Cómo usar el sistema (Local y Remoto)?

### 3.1. Instalación y Arranque Rápido

1. Asegúrate de tener **Node.js** instalado.
2. Abre la consola en la carpeta raíz y ejecuta: `npm run install:all`
3. Dale doble clic al archivo **`start.bat`** (o ejecuta `npm start`).
4. Abre tu navegador y ve a: **`http://localhost:3000`**

### 3.2. Modo Local (Auto-Conexión Inteligente)

Al usar dos pestañas en la misma computadora, ambas comparten el mismo "cerebro" (el servidor Node.js).
1. Abre `http://localhost:3000` y selecciona **Receptor**.
2. Abre una segunda pestaña con la misma URL y selecciona **Transmisor**.
3. En el Transmisor, en el campo *IP del carro físico*, escribe `ws://127.0.0.1:8081/ws` (que es el Simulador corriendo) y dale a **Conectar Carro**.
4. Escribe tu programa (ej. `F:2, R:1, N, P`) y dale a **Enviar Programa**. 
5. Observa cómo el Receptor audita todo automáticamente. Si desconectas el carro (botón rojo), se cortará instantáneamente la conexión. Si vuelves a dar Enviar Programa, el sistema *auto-conectará* el carro por ti para no frenar la ejecución.

### 3.3. Modo Multi-PC P2P (Compatibilidad GitLab)

Para controlar el carro de un compañero que utiliza el repositorio de referencia de la clase:
1. Pídele a tu compañero su IP y levanta tu sistema.
2. Abre tu **Transmisor** (`http://localhost:3000`).
3. En **Conexión Peer**, escribe la ruta del websocket de su Receptor.
4. Haz clic en **Conectar Peer**. El sistema detectará automáticamente si el otro extremo usa el protocolo estándar de GitLab y adaptará la mensajería (enviando hilos numéricos limpios sin sobres JSON).
5. Usa el botón "Conectar Carro" para obligar a su Receptor a enlazar el hardware, y envía tus programas.
6. Si deseas soltarle el control, pulsa **Desconectar** en el carro, lo que enviará remótamente el comando `M` (Liberar Control) al ESP32 de tu compañero de forma limpia y segura.

---

## 4. Tests y Calidad de Código

Este proyecto incluye una suite de pruebas masiva y exhaustiva usando el framework nativo de Node.js (`node:test`).
Actualmente el proyecto cuenta con **más de 105 tests** automatizados con una tasa de éxito del 100%.

Para correr las pruebas:
```bash
npm test
```

Los tests aseguran que el motor de encriptación de 5 dígitos, los adaptadores P2P, las tablas dinámicas, y la compatibilidad con repositorios hermanos funcionen a la perfección.

