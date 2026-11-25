/*
  ScholarDesk Pro — ESP32 + GSM SMS gateway (SIM800L / SIM800C / SIM7600 in SMS text mode)

  The desktop app calls:   http://<ESP32-IP>/send?to=01XXXXXXXXX&msg=<text>&key=<GATEWAY_KEY>
  and expects a reply containing "OK".

  Wiring (SIM800L):  SIM800 TX -> ESP32 GPIO16 (RX2),  SIM800 RX -> ESP32 GPIO17 (TX2),  GND <-> GND.
  Power the SIM800L from a 3.7–4.2 V source that can give 2 A peaks (a Li-ion cell or a buck module) — NOT the ESP32 3.3 V pin.

  Arduino IDE: Board "ESP32 Dev Module". No extra libraries needed.
  Give the ESP32 a fixed IP in your router (DHCP reservation) and put that address in ScholarDesk → Settings → SMS.
*/
#include <WiFi.h>
#include <WebServer.h>

const char* WIFI_SSID    = "YOUR_WIFI";
const char* WIFI_PASS    = "YOUR_PASSWORD";
const char* GATEWAY_KEY  = "change-this-key";   // same value as "Gateway key" in ScholarDesk
const bool  UNICODE_SMS  = false;               // true = send Bangla text (UCS2, 70 chars per part)

HardwareSerial gsm(2);
WebServer server(80);

String at(const String& cmd, uint32_t waitMs = 1500) {
  gsm.println(cmd);
  String r; uint32_t t = millis();
  while (millis() - t < waitMs) { while (gsm.available()) r += (char)gsm.read(); }
  return r;
}

String toUcs2Hex(const String& s) {           // UTF-8 -> UCS2 hex for Bangla SMS
  String out; char buf[5];
  for (size_t i = 0; i < s.length();) {
    uint32_t c = (uint8_t)s[i];
    int n = c < 0x80 ? 1 : c < 0xE0 ? 2 : c < 0xF0 ? 3 : 4;
    if (n == 2) c = ((c & 0x1F) << 6) | (s[i + 1] & 0x3F);
    if (n == 3) c = ((c & 0x0F) << 12) | ((s[i + 1] & 0x3F) << 6) | (s[i + 2] & 0x3F);
    if (n == 4) c = 0x3F;                     // emoji not supported -> '?'
    sprintf(buf, "%04X", (unsigned)c); out += buf; i += n;
  }
  return out;
}

bool sendSms(const String& to, const String& msg) {
  at(UNICODE_SMS ? "AT+CSCS=\"UCS2\"" : "AT+CSCS=\"GSM\"");
  at(UNICODE_SMS ? "AT+CSMP=17,167,0,8" : "AT+CSMP=17,167,0,0");
  String number = to.startsWith("01") ? "+88" + to : to;
  gsm.print("AT+CMGS=\""); gsm.print(UNICODE_SMS ? toUcs2Hex(number) : number); gsm.println("\"");
  delay(500);
  gsm.print(UNICODE_SMS ? toUcs2Hex(msg) : msg);
  gsm.write(26);                              // Ctrl+Z sends
  String r = at("", 12000);
  return r.indexOf("+CMGS") >= 0 && r.indexOf("ERROR") < 0;
}

void handleSend() {
  if (server.arg("key") != GATEWAY_KEY) { server.send(403, "text/plain", "DENIED"); return; }
  String to = server.arg("to"), msg = server.arg("msg");
  if (to.length() < 11 || msg.length() == 0) { server.send(400, "text/plain", "BAD REQUEST"); return; }
  bool ok = sendSms(to, msg);
  server.send(ok ? 200 : 500, "text/plain", ok ? "OK" : "FAILED");
}

void setup() {
  Serial.begin(115200);
  gsm.begin(9600, SERIAL_8N1, 16, 17);
  delay(3000);
  at("AT"); at("ATE0"); at("AT+CMGF=1");      // text mode
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print('.'); }
  Serial.printf("\nScholarDesk SMS gateway ready at http://%s\n", WiFi.localIP().toString().c_str());
  server.on("/send", handleSend);
  server.on("/", []() { server.send(200, "text/plain", "ScholarDesk SMS gateway OK"); });
  server.begin();
}

void loop() { server.handleClient(); }
