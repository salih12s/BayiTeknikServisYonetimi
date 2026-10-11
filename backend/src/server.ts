import express from 'express';
import cors from 'cors';
import compression from 'compression';
import http from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

import authRoutes from './routes/auth';
import islemlerRoutes from './routes/islemler';
import teknisyenlerRoutes from './routes/teknisyenler';
import markalarRoutes from './routes/markalar';
import bayilerRoutes from './routes/bayiler';
import atolyeRoutes from './routes/atolye';
import adminRoutes from './routes/admin';
import montajlarRoutes from './routes/montajlar';
import aksesuarlarRoutes from './routes/aksesuarlar';
import urunlerRoutes from './routes/urunler';
import locationsRoutes from './routes/locations';
import printerSettingsRoutes from './routes/printerSettings';
import sahaRoutes from './routes/saha';
import karalisteRoutes from './routes/karaliste';
import bayiKayitRoutes from './routes/bayiKayit';
import { errorHandler } from './middleware/errorHandler';
import { sweepPhotoStorageInBackground } from './services/sahaPhoto.service';

dotenv.config();

// Oturum anahtarı olmadan yayına çıkılmaz: anahtar yoksa token'lar herkesin bildiği bir
// değerle imzalanır ve isteyen herkes kendine yönetici token'ı üretebilir.
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.error('❌ JWT_SECRET tanımlı değil; sunucu başlatılmıyor.');
  process.exit(1);
}

const app = express();
const server = http.createServer(app);

// CORS origin - development ve production
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
  'https://crm-mefateknik.com',
  'https://www.crm-mefateknik.com',
  'https://crm-msssoft.com',
  'https://www.crm-msssoft.com',
  'https://projecrm-production.up.railway.app',
  process.env.FRONTEND_URL || '',
].filter(Boolean);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    credentials: true
  }
});

// Middleware
// ⚡ COMPRESSION: Tüm API response'ları gzip ile sıkıştır (%60-80 daha az veri transferi)
app.use(compression({
  threshold: 1024, // 1KB'dan büyük response'ları sıkıştır
  level: 6, // Sıkıştırma seviyesi (1-9, 6 optimal hız/boyut dengesi)
}));

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'production') {
      callback(null, true);
    } else {
      callback(new Error('CORS policy violation'));
    }
  },
  credentials: true
}));

// JSON body limit - fotoğraf yüklemeleri için 50MB
// Bayi kayıt formu herkese açıktır; gövdesi küçük tutulur ki giriş yapmamış biri sunucuya
// büyük istekler yığamasın. Genel (50 MB) ayrıştırıcıdan ÖNCE gelmelidir.
app.use('/api/bayi-kayit/form', express.json({ limit: '20kb' }));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Socket.IO bağlantısı
io.on('connection', (socket) => {
  console.log('Yeni kullanıcı bağlandı:', socket.id);

  socket.on('disconnect', () => {
    console.log('Kullanıcı ayrıldı:', socket.id);
  });
});

// Socket.IO'yu app'e ekle
app.set('io', io);

// API yanıtları kişiye özeldir ve her an değişir: tarayıcı da aradaki katmanlar da
// (barındırmanın CDN'i, LiteSpeed önbelleği) bunları saklamamalıdır.
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/islemler', islemlerRoutes);
app.use('/api/teknisyenler', teknisyenlerRoutes);
app.use('/api/markalar', markalarRoutes);
app.use('/api/bayiler', bayilerRoutes);
app.use('/api/atolye', atolyeRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/montajlar', montajlarRoutes);
app.use('/api/aksesuarlar', aksesuarlarRoutes);
app.use('/api/urunler', urunlerRoutes);
app.use('/api/ilceler', locationsRoutes);
app.use('/api/locations/ilceler', locationsRoutes);
app.use('/api/printer-settings', printerSettingsRoutes);
app.use('/api/saha', sahaRoutes);
app.use('/api/karaliste', karalisteRoutes);
app.use('/api/bayi-kayit', bayiKayitRoutes);

// Global error handler — asyncHandler ile sarılmış route'lardan gelen
// yakalanmamış promise rejection'larını yakalar. Tüm route mount'larından
// SONRA, fakat statik dosya servisi/SPA fallback'inden ÖNCE eklenmelidir
// ki API yanıtlarına müdahale edebilsin. (Part 2 / P2.D4)
app.use('/api', errorHandler);

// Serve static files from frontend build (production only)
if (process.env.NODE_ENV === 'production') {
  // Hostinger paketinde arayüz sunucunun yanındaki "public" klasöründedir
  // (scripts/package-hostinger.cjs); depodan çalışırken frontend/dist kullanılır.
  const packagedPath = path.join(__dirname, 'public');
  const frontendPath = fs.existsSync(path.join(packagedPath, 'index.html'))
    ? packagedPath
    : path.join(__dirname, '../../frontend/dist');
  // /assets altındaki dosyaların adında içerik özeti vardır (index-DXbu_UDa.js): içerik
  // değişince ad da değişir. Bu yüzden "kalıcı" işaretlenirler ve tarayıcı bir kez
  // indirdiği dosyayı bir daha sormaz. Eskiden her sayfa açılışında yeniden soruluyordu;
  // barındırmanın CDN'i kısa arayla aynı dosyaya gelen ikinci isteği ara sıra yanıtsız
  // bırakıyor ve sayfa boş kalıyordu (2026-10-12, crm-mefateknik.com).
  app.use(
    '/assets',
    express.static(path.join(frontendPath, 'assets'), { immutable: true, maxAge: '1y', index: false }),
  );
  // Olmayan bir /assets dosyası için index.html DÖNMEZ: tarayıcı HTML'i betik sanıp
  // (kalıcı olarak) saklarsa sayfa beyaz kalır. Yeni sürüm yayınlandığında eski sayfası
  // açık kalan kullanıcıda olur; sayfayı yenileyince düzelir.
  app.use('/assets', (_req, res) => {
    res.status(404).type('text/plain').send('Bulunamadı');
  });
  // Diğer sabit dosyalar (yazı tipleri, şablonlar) kısa süre saklanır; index.html her
  // seferinde yeniden sorulur ki yeni sürüm hemen görülsün.
  const noCache = (res: express.Response): void => {
    res.setHeader('Cache-Control', 'no-cache');
  };
  app.use(
    express.static(frontendPath, {
      maxAge: '1h',
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) noCache(res);
      },
    }),
  );

  // Serve index.html for all non-API routes
  app.get('*', (_req, res) => {
    noCache(res);
    res.sendFile(path.join(frontendPath, 'index.html'));
  });
} else {
  // Ana route (development)
  app.get('/', (_req, res) => {
    res.json({ message: 'CRM API çalışıyor' });
  });
}

const PORT = process.env.PORT || 5000;

// Global hata yakalayıcılar - process'in çökmesini engelle
process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  console.error('⚠️ Yakalanmamış promise reddi:', message);
});

process.on('uncaughtException', (err) => {
  console.error('⚠️ Yakalanmamış istisna:', err.message);
});

// Açılışta şema değişikliği YAPILMAZ: tablolar migrations/mysql altındaki SQL ile
// bir kez kurulur. Hosting süreci sık sık yeniden başlatır; her açılışta DDL
// çalıştırmak hem gereksiz hem risklidir. Bağlantı testi db.ts içinde yapılır.
server.listen(PORT, () => {
  console.log(`✅ Server ${PORT} portunda çalışıyor`);
});

// R2 temizliği: yarım kalmış fotoğraf yüklemeleri ve silinmeyi bekleyen dosyalar.
// Silme işlemleri kendi temizliğini hemen tetikler; bu zamanlayıcı yarıda kalanları
// (ör. R2'ye o an ulaşılamadıysa) ve süresi dolan yüklemeleri toplar.
setTimeout(sweepPhotoStorageInBackground, 60 * 1000).unref();
setInterval(sweepPhotoStorageInBackground, 60 * 60 * 1000).unref();

export { app, io };
