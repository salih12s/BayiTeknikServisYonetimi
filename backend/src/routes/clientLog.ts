import express, { ErrorRequestHandler, Request, Response } from 'express';
import logger from '../utils/logger';
import {
  CLIENT_LOG_BODY_LIMIT,
  createRateLimiter,
  formatClientEventLog,
  RateLimiter,
  sanitizeClientEvents,
} from '../utils/diagnostics';

/**
 * `POST /api/client-log`: tarayıcıda olup sunucuya hiç ulaşmayan sorunlar (bağlantı
 * kopması, fotoğrafın telefonda açılamaması, depoya yüklenememesi, ekran çökmesi,
 * kullanıcıya gösterilen hata mesajı) buraya bildirilir ve log dosyasına tek satır yazılır.
 * Veritabanına hiçbir şey yazılmaz.
 *
 * Giriş istemez: oturumu düşmüş kullanıcının hatası da gelmelidir. Tarayıcı `sendBeacon`
 * ile `text/plain` gönderir (başlık eklenemez, CORS ön isteği olmaz); gövde JSON'dur.
 * Kötüye kullanıma karşı: gövde 8 kB, adres başına dakikada 30 olay, toplam 600 olay.
 */
export function createClientLogRouter(limiter?: RateLimiter): express.Router {
  const router = express.Router();
  const rateLimiter =
    limiter ?? createRateLimiter({ limit: 30, globalLimit: 600, windowMs: 60_000 });

  router.post(
    '/',
    express.text({ type: () => true, limit: CLIENT_LOG_BODY_LIMIT }),
    (req: Request, res: Response): void => {
      let body: unknown;
      try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      } catch {
        res.status(400).json({ message: 'Geçersiz JSON' });
        return;
      }
      const events = sanitizeClientEvents(body);
      if (!events.ok) {
        res.status(400).json({ message: events.message });
        return;
      }
      const ip = clientIp(req);
      if (!rateLimiter.take(ip ?? 'bilinmiyor', events.value.length)) {
        res.status(429).json({ message: 'Çok fazla olay' });
        return;
      }
      for (const event of events.value) logger.warn(formatClientEventLog(event, ip));
      res.status(204).end();
    },
  );

  // Gövde sınırı aşımı (413) gibi ayrıştırma hataları sessizce cevaplanır: log ucunun
  // kendi hatası logu doldurmasın.
  const parseErrors: ErrorRequestHandler = (err, _req, res, _next) => {
    const status = typeof err?.status === 'number' ? err.status : 400;
    res.status(status).json({ message: status === 413 ? 'Gövde çok büyük' : 'Geçersiz istek' });
  };
  router.use(parseErrors);
  return router;
}

/** Barındırmanın vekil sunucusu gerçek adresi X-Forwarded-For'un başına yazar. */
function clientIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || null;
}

export default createClientLogRouter();
