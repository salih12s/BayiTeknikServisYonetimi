import { RequestHandler } from 'express';
import logger from '../utils/logger';
import { formatRequestLog, shouldLogRequest } from '../utils/diagnostics';

/**
 * Reddedilen (400+) ve yavaş (3 sn+) API isteklerini tek satırla yazar; normal istekler
 * yazılmaz. Cevap gönderildikten SONRA çalışır (`finish`), isteği yavaşlatmaz.
 *
 * Neden: route'lar yalnızca 500 hatalarını logluyor; 400/403/404/409 cevapları (ör.
 * "Fotoğraf yüklemesi tamamlanmamış") hiçbir yerde iz bırakmıyordu.
 */
export function requestLogger(options: { skip?: (path: string) => boolean } = {}): RequestHandler {
  return (req, res, next) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      if (!shouldLogRequest(res.statusCode, durationMs)) return;
      const url = req.originalUrl || req.url;
      if (options.skip?.(url)) return;
      // req.user, isteğin içinde auth katmanı çalıştıysa doludur (aynı nesne).
      logger.warn(
        formatRequestLog({
          method: req.method,
          url,
          status: res.statusCode,
          durationMs,
          role: req.user?.role,
          userId: typeof req.user?.id === 'number' ? req.user.id : undefined,
        }),
      );
    });
    next();
  };
}

export default requestLogger;
