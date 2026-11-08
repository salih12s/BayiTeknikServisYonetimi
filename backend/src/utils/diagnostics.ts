/**
 * Gizli hataları yakalamak için yazılan teşhis loglarının kuralları. Saf fonksiyonlardır
 * (girdi -> çıktı): ne yazılacağına ve kişisel bilginin loga sızmamasına burada karar verilir.
 *
 * Kural: yalnızca SORUN olduğunda yazılır; normal istek ve sorgular loglanmaz.
 */

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

// ---------------------------------------------------------------------------
// Sunucu: reddedilen ve yavaş istekler
// ---------------------------------------------------------------------------

/** Bu süreyi aşan istek, cevabı başarılı olsa da yazılır. */
export const SLOW_REQUEST_MS = 3000;
/** Bu süreyi aşan veritabanı sorgusu yazılır. */
export const SLOW_QUERY_MS = 2000;

/** İstek loga yazılmalı mı? Reddedilen/başarısız (400+) ya da yavaş olanlar. */
export function shouldLogRequest(status: number, durationMs: number): boolean {
  return status >= 400 || durationMs >= SLOW_REQUEST_MS;
}

/** Adresin `?` sonrası (arama kutusuna yazılan isim, telefon vb.) atılır. */
export function stripQuery(url: string): string {
  const index = url.search(/[?#]/);
  return index === -1 ? url : url.slice(0, index);
}

export interface RequestLogInput {
  method: string;
  url: string;
  status: number;
  durationMs: number;
  role?: string;
  userId?: number;
}

/** İstek log satırı: `[istek] {"yontem":"PUT","uc":"/api/islemler/5","durum":409,...}` */
export function formatRequestLog(input: RequestLogInput): string {
  const line: Record<string, unknown> = {
    yontem: input.method,
    uc: stripQuery(input.url),
    durum: input.status,
    ms: Math.round(input.durationMs),
  };
  if (input.role) line.rol = input.role;
  if (typeof input.userId === 'number') line.kullaniciId = input.userId;
  return `[istek] ${JSON.stringify(line)}`;
}

/**
 * Yavaş sorgu satırı. DİKKAT: `text` yer tutuculu (`$1`) ham sorgu olmalıdır; değerleri
 * yerleştirilmiş sorgu müşteri bilgisi içerir ve loga yazılmaz.
 */
export function formatSlowQueryLog(text: string, durationMs: number): string {
  const sql = text.replace(/\s+/g, ' ').trim().slice(0, 120);
  return `[yavaş sorgu] ${JSON.stringify({ ms: Math.round(durationMs), sorgu: sql })}`;
}

// ---------------------------------------------------------------------------
// Tarayıcıdan gelen olaylar (POST /api/client-log)
// ---------------------------------------------------------------------------

/** Kabul edilen olay türleri. */
export const CLIENT_EVENT_TYPES = [
  'api-ag', // istek sunucuya hiç ulaşamadı / cevap gelmedi (bağlantı, zaman aşımı)
  'api-yavas', // istek cevaplandı ama çok uzun sürdü
  'foto', // fotoğraf telefonda okunamadı / açılamadı / çok büyük
  'r2', // fotoğraf depoya yüklenemedi
  'cokme', // ekran çöktü (ErrorBoundary)
  'parca', // sayfa parçası (JS dosyası) yüklenemedi
  'js', // yakalanmamış tarayıcı hatası
  'mesaj', // kullanıcıya kırmızı hata mesajı gösterildi
  'yavas-yukleme', // "Yükleniyor..." ekranı uzun sürdü
] as const;
export type ClientEventType = (typeof CLIENT_EVENT_TYPES)[number];

export const MAX_CLIENT_EVENTS = 20;
export const MAX_CLIENT_TEXT = 300;
export const CLIENT_LOG_BODY_LIMIT = '8kb';

/** İzin verilen alanlar ve tipleri; listede olmayan her alan atılır. */
const STRING_FIELDS = [
  'sayfa', 'uc', 'yontem', 'kod', 'mesaj', 'ayrinti', 'protokol', 'sayfaProtokol', 'baglanti', 'rol', 'dosyaTipi',
] as const;
const NUMBER_FIELDS = ['ms', 'durum', 'deneme', 'boyut', 'kullaniciId', 'zaman'] as const;
const BOOLEAN_FIELDS = ['cevrimici'] as const;
/** Adres içeren alanlar: `?` sonrası atılır. */
const URL_FIELDS = new Set(['sayfa', 'uc']);

export type ClientEvent = { tur: ClientEventType } & Record<string, string | number | boolean>;

function cleanText(value: string, isUrl: boolean): string {
  // Kontrol karakterleri (satır sonu dahil) log satırını bölmesin.
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, ' ');
  return (isUrl ? stripQuery(text) : text).slice(0, MAX_CLIENT_TEXT);
}

/** `POST /api/client-log` gövdesini doğrular ve temizler. */
export function sanitizeClientEvents(body: unknown): Parsed<ClientEvent[]> {
  const list = (body as { events?: unknown } | null)?.events;
  if (!Array.isArray(list) || list.length === 0) return { ok: false, message: 'Olay listesi gerekli' };
  if (list.length > MAX_CLIENT_EVENTS) return { ok: false, message: `En fazla ${MAX_CLIENT_EVENTS} olay` };

  const events: ClientEvent[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') return { ok: false, message: 'Geçersiz olay' };
    const raw = item as Record<string, unknown>;
    if (typeof raw.tur !== 'string' || !(CLIENT_EVENT_TYPES as readonly string[]).includes(raw.tur)) {
      return { ok: false, message: 'Geçersiz olay türü' };
    }
    const event: ClientEvent = { tur: raw.tur as ClientEventType };
    for (const field of STRING_FIELDS) {
      if (typeof raw[field] === 'string') event[field] = cleanText(raw[field] as string, URL_FIELDS.has(field));
    }
    for (const field of NUMBER_FIELDS) {
      const value = raw[field];
      if (typeof value === 'number' && Number.isFinite(value)) event[field] = Math.round(value);
    }
    for (const field of BOOLEAN_FIELDS) {
      if (typeof raw[field] === 'boolean') event[field] = raw[field] as boolean;
    }
    events.push(event);
  }
  return { ok: true, value: events };
}

/** Tarayıcı olayının log satırı: `[istemci] {"tur":"api-ag",...}` */
export function formatClientEventLog(event: ClientEvent, ip: string | null): string {
  return `[istemci] ${JSON.stringify(ip ? { ...event, ip } : event)}`;
}

// ---------------------------------------------------------------------------
// Hız sınırı (log ucunu kötüye kullanıp log dosyasını doldurmayı engeller)
// ---------------------------------------------------------------------------

export interface RateLimiter {
  /** `key` için `count` kadar olaya yer var mı? Varsa ayırır ve true döner. */
  take(key: string, count: number): boolean;
}

/**
 * Sabit pencereli sınır: her anahtar `windowMs` içinde en çok `limit` olay; bütün
 * anahtarlar toplamda en çok `globalLimit`. `now` dışarıdan verilir (testte saat sabitlenir).
 */
export function createRateLimiter(options: {
  limit: number;
  globalLimit: number;
  windowMs: number;
  now?: () => number;
}): RateLimiter {
  const now = options.now ?? Date.now;
  const windows = new Map<string, { start: number; used: number }>();
  let global = { start: now(), used: 0 };

  return {
    take(key, count) {
      const time = now();
      if (time - global.start >= options.windowMs) global = { start: time, used: 0 };
      if (windows.size > 5000) {
        for (const [k, w] of windows) if (time - w.start >= options.windowMs) windows.delete(k);
      }
      let window = windows.get(key);
      if (!window || time - window.start >= options.windowMs) {
        window = { start: time, used: 0 };
        windows.set(key, window);
      }
      if (window.used + count > options.limit || global.used + count > options.globalLimit) return false;
      window.used += count;
      global.used += count;
      return true;
    },
  };
}
