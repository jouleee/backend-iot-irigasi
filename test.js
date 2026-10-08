/**
 * Automated Test Suite untuk IoT Backend
 * - Uji Coba Database SQLite (Insert, Latest, History, Stats)
 * - Uji Coba HTTP REST API Endpoint
 */

const assert = require('assert');
const {
  db,
  insertTelemetry,
  getLatestTelemetry,
  getTelemetryHistory,
  getTelemetryStats
} = require('./db');

async function runTestSuite() {
  console.log('🧪 ==========================================');
  console.log('🧪 MEMULAI PENGUJIAN BACKEND IOT');
  console.log('🧪 ==========================================\n');

  // --- TAHAP 1: UNIT TEST DATABASE ---
  console.log('--- [1/2] Pengujian Fungsi Database SQLite ---');
  
  const testPayload = {
    temperature: 29.5,
    humidity: 62.4,
    soil_moisture: 45,
    raw_soil: 2200,
    water_level: 80,
    water_ok: true,
    pump_active: false
  };

  const inserted = insertTelemetry(testPayload);
  assert.ok(inserted.id, 'Record harus memiliki ID');
  assert.strictEqual(inserted.temperature, 29.5);
  assert.strictEqual(inserted.humidity, 62.4);
  assert.strictEqual(inserted.water_ok, true);
  assert.strictEqual(inserted.pump_active, false);
  console.log(`  ✅ insertTelemetry sukses (ID #${inserted.id})`);

  const latest = getLatestTelemetry();
  assert.ok(latest, 'Latest record tidak boleh null');
  assert.strictEqual(typeof latest.water_ok, 'boolean');
  assert.strictEqual(typeof latest.pump_active, 'boolean');
  console.log('  ✅ getLatestTelemetry sukses');

  const history1h = getTelemetryHistory('1h');
  const history7d = getTelemetryHistory('7d');
  assert.ok(Array.isArray(history1h) && history1h.length >= 1);
  assert.ok(Array.isArray(history7d) && history7d.length >= 1);
  console.log(`  ✅ getTelemetryHistory sukses (1h: ${history1h.length} row, 7d agregat: ${history7d.length} row)`);

  const stats = getTelemetryStats();
  assert.ok(stats.total_records >= 1);
  console.log(`  ✅ getTelemetryStats sukses (Total ${stats.total_records} data tercatat)`);

  // --- TAHAP 2: INTEGRATION TEST HTTP SERVER ---
  console.log('\n--- [2/2] Pengujian Endpoint REST API HTTP ---');
  process.env.PORT = '5056';
  const server = require('./server.js');
  await new Promise((resolve) => setTimeout(resolve, 600));

  const BASE_URL = 'http://localhost:5056';

  // 1. POST /api/telemetry
  const postRes = await fetch(`${BASE_URL}/api/telemetry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      temperature: 31.0,
      humidity: 55.0,
      soil_moisture: 30,
      raw_soil: 2900,
      water_level: 60,
      water_ok: true,
      pump_active: true
    })
  });
  assert.strictEqual(postRes.status, 200);
  const postJson = await postRes.json();
  assert.strictEqual(postJson.status, 'success');
  console.log('  ✅ POST /api/telemetry sukses');

  // 2. GET /api/telemetry/latest
  const latestRes = await fetch(`${BASE_URL}/api/telemetry/latest`);
  assert.strictEqual(latestRes.status, 200);
  const latestData = await latestRes.json();
  assert.strictEqual(latestData.temperature, 31.0);
  console.log('  ✅ GET /api/telemetry/latest sukses');

  // 3. GET /api/telemetry/history
  const historyRes = await fetch(`${BASE_URL}/api/telemetry/history?range=24h`);
  assert.strictEqual(historyRes.status, 200);
  const historyData = await historyRes.json();
  assert.ok(Array.isArray(historyData) && historyData.length >= 2);
  console.log(`  ✅ GET /api/telemetry/history?range=24h sukses (${historyData.length} records)`);

  // 4. GET /api/telemetry/stats
  const statsRes = await fetch(`${BASE_URL}/api/telemetry/stats`);
  assert.strictEqual(statsRes.status, 200);
  const statsData = await statsRes.json();
  assert.ok(statsData.total_records >= 2);
  console.log('  ✅ GET /api/telemetry/stats sukses');

  console.log('\n==========================================');
  console.log('🎉 SEMUA PENGUJIAN OTOMATIS SUKSES (100% PASS)');
  console.log('==========================================\n');

  process.exit(0);
}

runTestSuite().catch((err) => {
  console.error('\n❌ Pengujian gagal:', err);
  process.exit(1);
});
