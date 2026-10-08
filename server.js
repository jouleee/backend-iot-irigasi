const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const {
  insertTelemetry,
  getLatestTelemetry,
  getTelemetryHistory,
  getTelemetryStats
} = require('./db');

const app = express();
const server = http.createServer(app);

// Inisialisasi Socket.io dengan CORS terbuka untuk client dashboard
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Logging setiap request HTTP yang masuk
app.use((req, res, next) => {
  process.stdout.write(`>>> [${req.method}] ${req.url} dari IP: ${req.ip}\n`);
  next();
});

// ==========================================
// SOCKET.IO REALTIME EVENTS
// ==========================================
io.on('connection', (socket) => {
  console.log(`🔌 [WebSocket] Client terhubung: ${socket.id} | Total koneksi: ${io.engine.clientsCount}`);

  // Kirim data mutakhir langsung ke client yang baru terhubung
  const latest = getLatestTelemetry();
  if (latest) {
    socket.emit('telemetry:init', latest);
  }

  socket.on('disconnect', (reason) => {
    console.log(`🔌 [WebSocket] Client terputus: ${socket.id} (${reason}) | Sisa: ${io.engine.clientsCount}`);
  });
});

// ==========================================
// REST API ENDPOINTS
// ==========================================

/**
 * 1. POST /api/telemetry
 * Dipanggil oleh ESP32 tiap 10 detik.
 * Menerima payload, menyimpan ke SQLite, lalu menyiarkan realtime ke WebSocket client.
 */
app.post('/api/telemetry', (req, res) => {
  try {
    const {
      temperature,
      humidity,
      soil_moisture,
      raw_soil,
      water_level,
      water_ok,
      pump_active
    } = req.body;

    // Validasi data minimum
    if (temperature === undefined || humidity === undefined || soil_moisture === undefined) {
      return res.status(400).json({
        status: 'error',
        message: 'Field temperature, humidity, dan soil_moisture wajib disertakan.'
      });
    }

    // Simpan ke SQLite
    const savedData = insertTelemetry({
      temperature,
      humidity,
      soil_moisture,
      raw_soil,
      water_level: water_level !== undefined ? water_level : 0,
      water_ok: water_ok !== undefined ? water_ok : true,
      pump_active: pump_active !== undefined ? pump_active : false
    });

    // Broadcast ke seluruh client React Dashboard via Socket.io
    io.emit('telemetry:update', savedData);

    // Logging informasi telemetri ke konsol
    console.log(
      `[DATA TELEMETRI #${savedData.id} - ${savedData.created_at}]\n` +
      `  Suhu       : ${savedData.temperature} °C\n` +
      `  Kelembapan : ${savedData.humidity} %\n` +
      `  Tanah      : ${savedData.soil_moisture} % (raw: ${savedData.raw_soil})\n` +
      `  Air        : ${savedData.water_level} (Status: ${savedData.water_ok ? 'OK' : 'LOW'})\n` +
      `  Pompa      : ${savedData.pump_active ? 'ON' : 'OFF'}\n` +
      `-----------------------------------------`
    );

    // Kirim response status 200 OK (kompatibel penuh dengan pustaka HTTPClient ESP32)
    res.status(200).json({
      status: 'success',
      message: 'Data telemetry berhasil disimpan dan disiarkan',
      data: savedData
    });
  } catch (error) {
    console.error('❌ Gagal memproses telemetri:', error);
    res.status(500).json({
      status: 'error',
      message: 'Gagal memproses data telemetri',
      error: error.message
    });
  }
});

/**
 * 2. GET /api/telemetry/latest
 * Dipanggil Frontend saat pertama buka untuk inisialisasi kartu KPI/metrik.
 */
app.get('/api/telemetry/latest', (req, res) => {
  try {
    const latest = getLatestTelemetry();
    if (!latest) {
      return res.status(200).json(null);
    }
    res.status(200).json(latest);
  } catch (error) {
    console.error('❌ Gagal mengambil telemetri terbaru:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

/**
 * 3. GET /api/telemetry/history
 * Query data historis berdasarkan rentang waktu: ?range=1h | 24h | 7d | all
 * Rentang 7d otomatis diagregasi rata-rata per jam di SQLite.
 */
app.get('/api/telemetry/history', (req, res) => {
  try {
    const range = req.query.range || '24h';
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 1000;
    const history = getTelemetryHistory(range, limit);
    res.status(200).json(history);
  } catch (error) {
    console.error('❌ Gagal mengambil riwayat telemetri:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

/**
 * 4. GET /api/telemetry/stats
 * Mengembalikan ringkasan statistik (24 jam terakhir):
 * Suhu rata-rata, min/max, frekuensi & estimasi durasi pompa menyala, dan durasi tandon kosong.
 */
app.get('/api/telemetry/stats', (req, res) => {
  try {
    const stats = getTelemetryStats();
    res.status(200).json(stats);
  } catch (error) {
    console.error('❌ Gagal mengambil statistik telemetri:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// Health check root endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'IoT Telemetry Backend (Express + Socket.io + SQLite)',
    timestamp: new Date().toISOString()
  });
});

// Menjalankan HTTP & WebSocket server pada interface 0.0.0.0
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n==================================================`);
  console.log(`🚀 IoT Backend AKTIF di http://0.0.0.0:${PORT}`);
  console.log(`📡 WebSocket Server (Socket.io) siap menerima koneksi`);
  console.log(`💾 Database: SQLite (WAL Mode)`);
  console.log(`==================================================\n`);
});