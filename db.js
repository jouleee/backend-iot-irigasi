const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Pastikan folder data tersedia
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'telemetry.db');
const db = new Database(dbPath);

// Aktifkan Write-Ahead Logging untuk konkurensi write-read yang optimal
db.pragma('journal_mode = WAL');

// Inisialisasi skema tabel telemetries
db.exec(`
  CREATE TABLE IF NOT EXISTS telemetries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    temperature REAL NOT NULL,
    humidity REAL NOT NULL,
    soil_moisture INTEGER NOT NULL,
    raw_soil INTEGER,
    water_level INTEGER NOT NULL,
    water_ok INTEGER NOT NULL,
    pump_active INTEGER NOT NULL,
    created_at DATETIME DEFAULT (datetime('now', 'localtime'))
  );

  CREATE INDEX IF NOT EXISTS idx_telemetries_created_at ON telemetries(created_at);
`);

// Migrasi data lama (jika ada data awal yang masih berformat UTC sebelum id 164)
try {
  const oldUtcCheck = db.prepare(`
    SELECT COUNT(*) AS count FROM telemetries 
    WHERE created_at < datetime('now', 'localtime', '-4 hours') AND id < 164
  `).get();
  if (oldUtcCheck && oldUtcCheck.count > 0) {
    db.prepare(`UPDATE telemetries SET created_at = datetime(created_at, '+7 hours') WHERE id < 164`).run();
  }
} catch (e) {
  // Abaikan jika migrasi tidak diperlukan
}

/**
 * Format baris SQLite ke objek JSON standar dengan boolean murni
 */
function formatTelemetryRow(row) {
  if (!row) return null;
  return {
    ...row,
    water_ok: Boolean(row.water_ok),
    pump_active: Boolean(row.pump_active)
  };
}

/**
 * Simpan data telemetri baru dari ESP32
 */
function insertTelemetry(data) {
  const stmt = db.prepare(`
    INSERT INTO telemetries (
      temperature,
      humidity,
      soil_moisture,
      raw_soil,
      water_level,
      water_ok,
      pump_active,
      created_at
    ) VALUES (
      @temperature,
      @humidity,
      @soil_moisture,
      @raw_soil,
      @water_level,
      @water_ok,
      @pump_active,
      datetime('now', 'localtime')
    )
  `);

  const info = stmt.run({
    temperature: Number(data.temperature) || 0,
    humidity: Number(data.humidity) || 0,
    soil_moisture: Number(data.soil_moisture) || 0,
    raw_soil: data.raw_soil !== undefined && data.raw_soil !== null ? Number(data.raw_soil) : null,
    water_level: Number(data.water_level) || 0,
    water_ok: data.water_ok ? 1 : 0,
    pump_active: data.pump_active ? 1 : 0
  });

  const getStmt = db.prepare('SELECT * FROM telemetries WHERE id = ?');
  const inserted = getStmt.get(info.lastInsertRowid);
  return formatTelemetryRow(inserted);
}

/**
 * Ambil data telemetri terbaru (untuk initial load frontend)
 */
function getLatestTelemetry() {
  const row = db.prepare('SELECT * FROM telemetries ORDER BY id DESC LIMIT 1').get();
  return formatTelemetryRow(row);
}

/**
 * Ambil riwayat telemetri berdasarkan rentang waktu ('1h', '24h', '7d', 'all')
 */
function getTelemetryHistory(range = '24h', limit = 1000) {
  let rows = [];

  switch (range.toLowerCase()) {
    case '1h': {
      rows = db.prepare(`
        SELECT * FROM telemetries 
        WHERE created_at >= datetime('now', 'localtime', '-1 hour')
        ORDER BY created_at ASC
      `).all();
      break;
    }
    case '7d': {
      // Agregasi rata-rata per jam untuk rentang 7 hari agar query ringan
      rows = db.prepare(`
        SELECT 
          strftime('%Y-%m-%d %H:00:00', created_at) AS created_at,
          ROUND(AVG(temperature), 2) AS temperature,
          ROUND(AVG(humidity), 2) AS humidity,
          ROUND(AVG(soil_moisture), 2) AS soil_moisture,
          ROUND(AVG(raw_soil), 2) AS raw_soil,
          ROUND(AVG(water_level), 2) AS water_level,
          MAX(water_ok) AS water_ok,
          MAX(pump_active) AS pump_active,
          COUNT(*) AS sample_count
        FROM telemetries
        WHERE created_at >= datetime('now', 'localtime', '-7 days')
        GROUP BY strftime('%Y-%m-%d %H:00:00', created_at)
        ORDER BY created_at ASC
      `).all();
      break;
    }
    case 'all': {
      rows = db.prepare(`
        SELECT * FROM telemetries 
        ORDER BY created_at ASC 
        LIMIT ?
      `).all(limit);
      break;
    }
    case '24h':
    default: {
      rows = db.prepare(`
        SELECT * FROM telemetries 
        WHERE created_at >= datetime('now', 'localtime', '-24 hours')
        ORDER BY created_at ASC
      `).all();
      break;
    }
  }

  return rows.map(formatTelemetryRow);
}

/**
 * Ambil ringkasan statistik (24 jam terakhir)
 */
function getTelemetryStats() {
  const stats = db.prepare(`
    SELECT 
      COUNT(*) AS total_records,
      ROUND(AVG(temperature), 1) AS avg_temperature,
      ROUND(MIN(temperature), 1) AS min_temperature,
      ROUND(MAX(temperature), 1) AS max_temperature,
      ROUND(AVG(humidity), 1) AS avg_humidity,
      ROUND(AVG(soil_moisture), 1) AS avg_soil_moisture,
      ROUND(AVG(water_level), 1) AS avg_water_level,
      SUM(CASE WHEN pump_active = 1 THEN 1 ELSE 0 END) AS pump_active_ticks,
      SUM(CASE WHEN water_ok = 0 THEN 1 ELSE 0 END) AS water_empty_ticks
    FROM telemetries
    WHERE created_at >= datetime('now', 'localtime', '-24 hours')
  `).get();

  const pumpTicks = stats.pump_active_ticks || 0;
  const emptyTicks = stats.water_empty_ticks || 0;

  return {
    ...stats,
    pump_active_seconds_est: pumpTicks * 10,
    water_empty_seconds_est: emptyTicks * 10
  };
}

module.exports = {
  db,
  insertTelemetry,
  getLatestTelemetry,
  getTelemetryHistory,
  getTelemetryStats
};
