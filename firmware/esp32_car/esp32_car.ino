/*
 * ESP32_CAR - Firmware refactorizado
 * -----------------------------------
 * Cambios respecto a la versión original:
 *  1. setup() ya NO bloquea: todo el flujo de credenciales/WiFi es una
 *     máquina de estados en loop() (evita el panic del task watchdog).
 *  2. leerLineaBLE(): lector BLE no bloqueante con timeout (antes se colgaba).
 *  3. WiFi con timeout: si las credenciales fallan, vuelve a pedirlas por BLE.
 *  4. Control por client->id() (antes remoteIP() podía quedar en 0.0.0.0
 *     en el evento de disconnect y el control quedaba ocupado para siempre).
 *  5. Guard de len==0 en WS_EVT_DATA.
 *  6. Confirmaciones en formato ACK:<comando> (alineado con Backend y
 *     simulador; antes enviaba "C.E <comando>" y el backend nunca lo veía).
 *  7. Limpieza: sin malloc, defines muertos eliminados, setVelocidad solo
 *     en comandos de movimiento, sin callback RX en la característica TX.
 *
 * PROTOCOLO WS (byte crudo):
 *  -> F/B/L/R: mover 15cm / girar 90° (ACK cuando TERMINA de moverse)
 *  -> O/C: abrir/cerrar pinza (ACK cuando TERMINA el servo)
 *  -> N/P: encender/apagar cámara, M: liberar control (ACK inmediato)
 *  <- ACK:F, ACK:B, ... (formato que espera Backend/src/services/carService.js)
 */

#include <Arduino.h>
#include <WiFi.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <ESP32Servo.h>
#include <NimBLEDevice.h>

#define BT_DEVICE_NAME "ESP32_CAR"

static BLEUUID serviceUUID("6E400001-B5A3-F393-E0A9-E50E24DCCA9E");
static BLEUUID charRxUUID ("6E400002-B5A3-F393-E0A9-E50E24DCCA9E");
static BLEUUID charTxUUID ("6E400003-B5A3-F393-E0A9-E50E24DCCA9E");

NimBLECharacteristic* pTxChar = nullptr;
String ipWiFi   = "";
bool   ipEnviada = false;

// Buffer circular para datos BLE entrantes
#define BLE_BUF_SIZE 128
volatile char bleBuf[BLE_BUF_SIZE];
volatile int  bleHead = 0;
volatile int  bleTail = 0;

inline void blePush(char c) {
  int next = (bleHead + 1) % BLE_BUF_SIZE;
  if (next != bleTail) { bleBuf[bleHead] = c; bleHead = next; }
}
inline int blePop() {
  if (bleTail == bleHead) return -1;
  char c = bleBuf[bleTail];
  bleTail = (bleTail + 1) % BLE_BUF_SIZE;
  return (unsigned char)c;
}
inline bool bleAvailable() { return bleTail != bleHead; }

void blePrint(const char* msg) {
  if (pTxChar) { pTxChar->setValue((uint8_t*)msg, strlen(msg)); pTxChar->notify(); }
}
void blePrintln(const char* msg) {
  blePrint(msg);
  if (pTxChar) { pTxChar->setValue((uint8_t*)"\r\n", 2); pTxChar->notify(); }
}
// Envía prefijo + valor + salto de línea en un único notify
void blePrintPair(const char* label, const char* value) {
  char buf[128];
  snprintf(buf, sizeof(buf), "%s%s\r\n", label, value);
  if (pTxChar) { pTxChar->setValue((uint8_t*)buf, strlen(buf)); pTxChar->notify(); }
}

class RxCallbacks : public NimBLECharacteristicCallbacks {
#if defined(NIMBLE_CPP_VERSION) && NIMBLE_CPP_VERSION >= 2
  void onWrite(NimBLECharacteristic* pChar, NimBLEConnInfo& connInfo) override {
#else
  void onWrite(NimBLECharacteristic* pChar) override {
#endif
    std::string val = pChar->getValue();
    for (char c : val) blePush(c);
  }
};

void iniciarBLE() {
  NimBLEDevice::init(BT_DEVICE_NAME);
  NimBLEDevice::setPower(ESP_PWR_LVL_P9);

  NimBLEServer* pServer = NimBLEDevice::createServer();

  NimBLEService* pService = pServer->createService(serviceUUID);

  // TX: ESP32 -> celular (notify)  — sin callbacks: nunca recibe writes
  pTxChar = pService->createCharacteristic(charTxUUID, NIMBLE_PROPERTY::NOTIFY);

  // RX: celular -> ESP32 (write)
  NimBLECharacteristic* pRxChar = pService->createCharacteristic(
    charRxUUID, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  pRxChar->setCallbacks(new RxCallbacks());

  pService->start();

  // Advertising: UUID NUS en paquete principal, nombre en scan response
  NimBLEAdvertisementData advData;
  advData.setCompleteServices(serviceUUID);

  NimBLEAdvertisementData scanData;
  scanData.setName(BT_DEVICE_NAME);

  NimBLEAdvertising* pAdv = NimBLEDevice::getAdvertising();
  pAdv->setAdvertisementData(advData);
  pAdv->setScanResponseData(scanData);
  pAdv->setMinInterval(0x20);   // ~20 ms
  pAdv->setMaxInterval(0x40);   // ~40 ms
  pAdv->start();
}

// ============================================================================
// Servidor WebSocket + prototipos (declarados antes de manejarSetup)
// ============================================================================
AsyncWebServer server(80);
AsyncWebSocket ws("/ws");

void beep(int frecuencia, int duracionMs);
void detenerMotores();
void avanzar();
void retroceder();
void girarIzquierda();
void girarDerecha();
void setVelocidad(int v);
void Comando(char comando);
void onWsEvent(AsyncWebSocket*, AsyncWebSocketClient*, AwsEventType, void*, uint8_t*, size_t);

// ============================================================================
// Máquina de estados del arranque (antes todo esto bloqueaba en setup())
// ============================================================================
enum EstadoSetup {
  ESPERANDO_BLE,
  PIDIENDO_SSID,
  PIDIENDO_PASSWORD,
  CONECTANDO_WIFI,
  LISTO
};
EstadoSetup estado = ESPERANDO_BLE;

#define TIEMPO_LINEA_BLE_MS 30000   // timeout por prompt BLE
#define WIFI_TIMEOUT_MS      20000  // timeout de conexión WiFi

char ssid[64]     = { 0 };
char password[64] = { 0 };
char buffer[64];

// Resultado del lector de línea BLE: distingue "sigo esperando" de "timeout".
enum ResultadoLineaBLE { LINEA_WAITING, LINEA_COMPLETA, LINEA_TIMEOUT };

// Lector de línea BLE no bloqueante (máquina interna con timeout).
ResultadoLineaBLE leerLineaBLE(char* out, int maxLen, unsigned long timeoutMs) {
  static char buf[64];
  static int  idx = 0;
  static unsigned long inicio = 0;
  static bool activo = false;

  if (!activo) {
    idx = 0;
    inicio = millis();
    activo = true;
  }

  while (bleAvailable()) {
    char c = (char)blePop();
    if (c == '\n' || c == '\r') {
      if (idx == 0) continue;   // línea vacía: seguí esperando
      buf[idx] = '\0';
      activo = false;
      int n = idx;
      if (n >= maxLen) n = maxLen - 1;
      memcpy(out, buf, n);
      out[n] = '\0';
      return LINEA_COMPLETA;
    }
    if (idx < (int)sizeof(buf) - 1) buf[idx++] = c;
  }

  if (millis() - inicio >= timeoutMs) {
    activo = false;
    return LINEA_TIMEOUT;
  }
  return LINEA_WAITING;
}

void manejarSetup() {
  switch (estado) {
    case ESPERANDO_BLE:
      if (NimBLEDevice::getServer()->getConnectedCount() > 0) {
        delay(500);
        blePrintln("=== Ingresa SSID y PASSWORD por BLE ===");
        estado = PIDIENDO_SSID;
        Serial.println("[setup] BLE conectado -> pidiendo SSID");
      }
      break;

    case PIDIENDO_SSID: {
      ResultadoLineaBLE r = leerLineaBLE(buffer, sizeof(buffer), TIEMPO_LINEA_BLE_MS);
      if (r == LINEA_COMPLETA) {
        strncpy(ssid, buffer, sizeof(ssid) - 1);
        ssid[sizeof(ssid) - 1] = '\0';
        blePrint("SSID: "); blePrintln(ssid);
        estado = PIDIENDO_PASSWORD;
        Serial.println("[setup] SSID recibido");
      } else if (r == LINEA_TIMEOUT) {
        blePrintln("Timeout. Reintenta SSID:");
        Serial.println("[setup] timeout SSID");
      }
      break;
    }

    case PIDIENDO_PASSWORD: {
      ResultadoLineaBLE r = leerLineaBLE(buffer, sizeof(buffer), TIEMPO_LINEA_BLE_MS);
      if (r == LINEA_COMPLETA) {
        strncpy(password, buffer, sizeof(password) - 1);
        password[sizeof(password) - 1] = '\0';
        blePrint("Password: "); blePrintln(password);
        estado = CONECTANDO_WIFI;
        Serial.println("[setup] Password recibido");
      } else if (r == LINEA_TIMEOUT) {
        blePrintln("Timeout. Reintenta Password:");
        Serial.println("[setup] timeout password");
      }
      break;
    }

    case CONECTANDO_WIFI: {
      static unsigned long wifiInicio = 0;
      static bool wifiActivo = false;
      if (!wifiActivo) {
        WiFi.mode(WIFI_STA);
        WiFi.begin(ssid, password);
        wifiInicio = millis();
        wifiActivo = true;
        Serial.println("[setup] Conectando WiFi...");
      }
      if (WiFi.status() == WL_CONNECTED) {
        wifiActivo = false;
        ipWiFi = WiFi.localIP().toString();
        blePrintPair("IP: ", ipWiFi.c_str());
        ws.onEvent(onWsEvent);
        server.addHandler(&ws);
        server.begin();
        estado = LISTO;
        for (int i = 0; i < 3; i++) { beep(1000 + (i * 200), 100); delay(50); }
        Serial.print("[setup] LISTO, IP: "); Serial.println(ipWiFi);
      } else if (millis() - wifiInicio >= WIFI_TIMEOUT_MS) {
        wifiActivo = false;
        ssid[0] = '\0';
        password[0] = '\0';
        blePrintln("Credenciales incorrectas. Reintenta:");
        estado = PIDIENDO_SSID;
        Serial.println("[setup] timeout WiFi -> reintentar credenciales");
      }
      break;
    }

    case LISTO:
      break;
  }
}

bool controlAsignado = false;
uint32_t controlClientId = 0;

#define ENA 13
#define IN1 12
#define IN2 14
#define IN3 27
#define IN4 16
#define ENB 17

#define BUZZER_PIN      5
#define SERVO_PINZA_PIN 26

Servo servoPinza;

#define PINZA_ABIERTA_POS  90
#define PINZA_CERRADA_POS  120

int  pinzaPos    = PINZA_ABIERTA_POS;
int  pinzaTarget = PINZA_ABIERTA_POS;

#define NUM_PASOS_SERVO  6

const unsigned long tablaDelayServo[NUM_PASOS_SERVO] = { 40, 25, 12, 12, 25, 40 };

unsigned long lastServoUpdate = 0;
int           pinzaStart      = PINZA_ABIERTA_POS;

enum Movimiento { QUIETO, AVANZANDO_15, RETROCEDIENDO_15, GIRANDO_IZQ, GIRANDO_DER };
Movimiento movimientoActual = QUIETO;
unsigned long movimientoInicio = 0;

const unsigned long TIEMPO_15CM     = 300;
const unsigned long TIEMPO_90GRADOS = 300;

// Comando de movimiento (F/B/L/R) cuyo ACK aún no se ha enviado:
// se reporta hasta que el carro realmente termine de moverse.
char comandoPendiente = 0;

// Indica que la pinza está en camino y falta emitir su sonido de "terminado"
bool pinzaSonidoPendiente = false;

// Comando de pinza (O/C) cuyo ACK aún no se ha enviado: se reporta
// hasta que el servo realmente termine de moverse (pinzaPos == pinzaTarget).
char comandoPinzaPendiente = 0;

void beep(int frecuencia, int duracionMs) {
  tone(BUZZER_PIN, frecuencia, duracionMs);
}

// Sonido característico al terminar de abrir/cerrar la pinza (distinto al de cámara)
void beepPinzaLista() {
  beep(1200, 80); delay(90);
  beep(2400, 80);
}

void setup() {
  Serial.begin(115200);
  delay(100);

  pinMode(19, OUTPUT);
  pinMode(IN1, OUTPUT); pinMode(IN2, OUTPUT);
  pinMode(IN3, OUTPUT); pinMode(IN4, OUTPUT);
  pinMode(ENA, OUTPUT); pinMode(ENB, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);

  detenerMotores();

  ESP32PWM::allocateTimer(3);
  servoPinza.setPeriodHertz(50);
  servoPinza.attach(SERVO_PINZA_PIN, 500, 2400);
  pinzaPos = pinzaTarget = PINZA_ABIERTA_POS;
  servoPinza.write(pinzaPos);

  iniciarBLE();

  Serial.println("[setup] ESP32_CAR listo. Esperando conexión BLE...");
  // OJO: setup() termina acá. El flujo de credenciales/WiFi lo maneja
  // la máquina de estados en loop() -> manejarSetup(). Nada bloquea.
}

void loop() {
  ws.cleanupClients();

  manejarSetup();

  // Enviar IP cada vez que el celular se conecta por BLE
  if (ipWiFi.length() > 0) {
    bool hayCliente = NimBLEDevice::getServer()->getConnectedCount() > 0;
    if (hayCliente && !ipEnviada) {
      delay(500);
      blePrintPair("IP: ", ipWiFi.c_str());
      ipEnviada = true;
    }
    if (!hayCliente) ipEnviada = false;  // resetear al desconectar
  }

  if (pinzaPos != pinzaTarget) {
    int totalGrados   = abs(pinzaTarget - pinzaStart);
    int gradosMovidos = abs(pinzaPos    - pinzaStart);
    int tramo = (totalGrados > 0)
                ? constrain((gradosMovidos * NUM_PASOS_SERVO) / totalGrados, 0, NUM_PASOS_SERVO - 1)
                : 0;
    if (millis() - lastServoUpdate >= tablaDelayServo[tramo]) {
      lastServoUpdate = millis();
      if (pinzaPos < pinzaTarget) servoPinza.write(++pinzaPos);
      else                        servoPinza.write(--pinzaPos);
    }
    if (pinzaPos == pinzaTarget && pinzaSonidoPendiente) {
      beepPinzaLista();
      pinzaSonidoPendiente = false;
    }
    if (pinzaPos == pinzaTarget && comandoPinzaPendiente != 0) {
      // La pinza ya terminó de abrir/cerrar: ahora sí se reporta la ejecución
      ws.textAll("ACK:" + String(comandoPinzaPendiente));
      comandoPinzaPendiente = 0;
    }
  }

  if (movimientoActual != QUIETO) {
    unsigned long ahora = millis();
    bool tiempoMov = (movimientoActual == AVANZANDO_15 || movimientoActual == RETROCEDIENDO_15)
                     && ahora - movimientoInicio >= TIEMPO_15CM;
    bool tiempoGir = (movimientoActual == GIRANDO_IZQ || movimientoActual == GIRANDO_DER)
                     && ahora - movimientoInicio >= TIEMPO_90GRADOS;
    if (tiempoMov || tiempoGir) {
      detenerMotores();
      movimientoActual = QUIETO;
      // El movimiento ya terminó: ahora sí se reporta la ejecución al receptor
      if (comandoPendiente != 0) {
        ws.textAll("ACK:" + String(comandoPendiente));
        comandoPendiente = 0;
      }
    }
  }
}

void onWsEvent(AsyncWebSocket* server, AsyncWebSocketClient* client,
               AwsEventType type, void* arg, uint8_t* data, size_t len) {
  if (type == WS_EVT_CONNECT) {
    if (!controlAsignado) {
      controlClientId = client->id();
      controlAsignado = true;
      beep(1000, 200);
      client->text("Control asignado a tu IP");
    } else if (client->id() != controlClientId) {
      client->text("ERROR: Control ocupado");
    }
  } else if (type == WS_EVT_DISCONNECT) {
    // El cliente de control se desconectó: detener el carro por seguridad
    if (client->id() == controlClientId) {
      detenerMotores();
      movimientoActual = QUIETO;
      controlAsignado  = false;
      controlClientId  = 0;
      comandoPendiente = 0;      // ya no hay a quién reportarle
      comandoPinzaPendiente = 0;
    }
  } else if (type == WS_EVT_DATA) {
    if (len == 0) return;        // frame vacío: nada que procesar
    if (client->id() == controlClientId) {
      char AA = (char)data[0];
      Comando(AA);
      if (AA == 'F' || AA == 'B' || AA == 'L' || AA == 'R') {
        // El ACK se envía más adelante, desde loop(), cuando el carro
        // realmente termine de moverse (no hay feedback del L298N/motores).
        comandoPendiente = AA;
      } else if (AA == 'O' || AA == 'C') {
        if (pinzaPos == pinzaTarget) {
          // La pinza ya estaba en esa posición: no hay movimiento que esperar
          client->text("ACK:" + String(AA));
        } else {
          // El ACK se envía más adelante, desde loop(), cuando la pinza
          // realmente termine de abrir/cerrar (el SG90 no reporta posición).
          comandoPinzaPendiente = AA;
        }
      } else {
        // Acciones instantáneas (cámara, liberar control): responde ya
        client->text("ACK:" + String(AA));
      }
    }
  }
}

void Comando(char comando) {
  switch (comando) {
    case 'F': setVelocidad(210); avanzar();        movimientoActual = AVANZANDO_15;     movimientoInicio = millis(); break;
    case 'B': setVelocidad(210); retroceder();     movimientoActual = RETROCEDIENDO_15; movimientoInicio = millis(); break;
    case 'L': setVelocidad(210); girarIzquierda(); movimientoActual = GIRANDO_IZQ;      movimientoInicio = millis(); break;
    case 'R': setVelocidad(210); girarDerecha();   movimientoActual = GIRANDO_DER;      movimientoInicio = millis(); break;
    case 'N': digitalWrite(19, HIGH); break;   // ENCENDER CAMARA
    case 'P': digitalWrite(19, LOW);  break;   // APAGAR CAMARA
    case 'O':
      if (pinzaPos != PINZA_ABIERTA_POS) { pinzaStart = pinzaPos; pinzaTarget = PINZA_ABIERTA_POS; pinzaSonidoPendiente = true; }
      break;
    case 'C':
      if (pinzaPos != PINZA_CERRADA_POS) { pinzaStart = pinzaPos; pinzaTarget = PINZA_CERRADA_POS; pinzaSonidoPendiente = true; }
      break;
    case 'M':
      controlAsignado = false;
      controlClientId = 0;
      beep(500, 500);
      break;
  }
  if (comando == 'N' || comando == 'P') {
    for (int i = 0; i < 3; i++) { beep(3000 + (i * 500), 100); delay(50); }
  } else {
    beep(1800, 50);
  }
}

void setVelocidad(int v) {
  analogWrite(ENA, v);
  analogWrite(ENB, v);
}
void avanzar()        { digitalWrite(IN1,HIGH); digitalWrite(IN2,LOW);  digitalWrite(IN3,LOW);  digitalWrite(IN4,HIGH); }
void retroceder()     { digitalWrite(IN1,LOW);  digitalWrite(IN2,HIGH); digitalWrite(IN3,HIGH); digitalWrite(IN4,LOW);  }
void girarIzquierda() { digitalWrite(IN1,HIGH); digitalWrite(IN2,LOW);  digitalWrite(IN3,HIGH); digitalWrite(IN4,LOW);  }
void girarDerecha()   { digitalWrite(IN1,LOW);  digitalWrite(IN2,HIGH); digitalWrite(IN3,LOW);  digitalWrite(IN4,HIGH); }
void detenerMotores() {
  digitalWrite(IN1,LOW); digitalWrite(IN2,LOW);
  digitalWrite(IN3,LOW); digitalWrite(IN4,LOW);
  analogWrite(ENA, 0);
  analogWrite(ENB, 0);
}