/**
 * Simulator Pengiriman Data ESP32
 * Mensimulasikan mikrokontroler ESP32 yang mengirim payload sensor tiap 10 detik.
 *
 * Jalankan:
 *   npm run simulate
 * atau:
 *   node scripts/simulate-esp32.js [TARGET_URL]
 */

const TARGET_URL = process.argv[2] || process.env.API_URL || 'http://localhost:5000/api/telemetry';
const INTERVAL_MS = 10000; // 10 Detik

console.log(`=========================================`);
console.log(`🤖 Simulator ESP32 Dimulai`);
console.log(`🎯 Target Endpoint : ${TARGET_URL}`);
console.log(`⏱️  Interval        : ${INTERVAL_MS / 1000} detik`);
console.log(`=========================================\n`);

// Kondisi awal sensor
let temperature = 28.5;
let humidity = 65.0;
let soilMoisture = 60; // Persen
let waterLevel = 85;   // Persen
let pumpActive = false;

async function sendTelemetry() {
  // Simulasi dinamika lingkungan:
  // Suhu fluktuasi kecil (-0.2 s/d +0.2)
  temperature = +(temperature + (Math.random() * 0.4 - 0.2)).toFixed(1);
  if (temperature < 24) temperature = 25.0;
  if (temperature > 36) temperature = 35.0;

  // Kelembapan udara fluktuasi
  humidity = +(humidity + (Math.random() * 0.6 - 0.3)).toFixed(1);
  if (humidity < 40) humidity = 45.0;
  if (humidity > 90) humidity = 85.0;

  // Jika pompa menyala, kelembapan tanah bertambah, air tandon berkurang
  if (pumpActive) {
    soilMoisture += 5;
    waterLevel = Math.max(0, waterLevel - 2);
    if (soilMoisture >= 70) {
      pumpActive = false; // Pompa mati otomatis jika tanah sudah cukup lembap
    }
  } else {
    // Jika pompa mati, tanah perlahan mengering (-1 setiap siklus)
    soilMoisture = Math.max(20, soilMoisture - 1);
    // Jika tanah terlalu kering (< 35%) dan air tersedia (> 10%), aktifkan pompa
    if (soilMoisture < 35 && waterLevel > 10) {
      pumpActive = true;
    }
  }

  // Raw analog value (0 - 4095 pada ADC ESP32, berbanding terbalik dengan kelembapan)
  const rawSoil = Math.round(4095 - (soilMoisture / 100) * 2800);
  const waterOk = waterLevel >= 15;

  const payload = {
    temperature,
    humidity,
    soil_moisture: soilMoisture,
    raw_soil: rawSoil,
    water_level: waterLevel,
    water_ok: waterOk,
    pump_active: pumpActive
  };

  const timestamp = new Date().toLocaleTimeString();

  try {
    const response = await fetch(TARGET_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      const result = await response.json();
      console.log(`[${timestamp}] ✅ Paket terkirim berhasil! ID #${result.data?.id}`);
      console.log(`   Suhu: ${temperature}°C | Hum: ${humidity}% | Tanah: ${soilMoisture}% (raw: ${rawSoil}) | Pompa: ${pumpActive ? 'ON' : 'OFF'} | Air: ${waterLevel}% (${waterOk ? 'OK' : 'LOW'})`);
    } else {
      console.error(`[${timestamp}] ⚠️ Server merespon dengan status ${response.status}: ${response.statusText}`);
    }
  } catch (error) {
    console.error(`[${timestamp}] ❌ Gagal menghubungi server: ${error.message}`);
  }
}

// Kirim data pertama langsung
sendTelemetry();

// Lanjutkan pengiriman tiap interval
setInterval(sendTelemetry, INTERVAL_MS);
