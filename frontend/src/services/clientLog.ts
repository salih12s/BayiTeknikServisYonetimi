/**
 * Tarayıcıda olup sunucuya hiç ulaşmayan sorunları sunucu loguna bildirir: bağlantı
 * kopması / zaman aşımı, fotoğrafın telefonda açılamaması, depoya yüklenememesi, ekran
 * çökmesi, kullanıcıya gösterilen hata mesajı, uzun süren "Yükleniyor..." ekranı.
 *
 * Kurallar (sistemi yormasın, kişisel bilgi gitmesin):
 *   - Yalnızca sorun olduğunda çağrılır; normal işlemler bildirilmez.
 *   - Aynı olay dakikada bir kez, bir sayfa açılışında en çok 30 olay.
 *   - Olaylar telefonda (localStorage) en çok 20 tane bekletilir; sunucu "aldım" (204)
 *     diyene kadar silinmez. İnternet yokken bekler, gelince gönderilir.
 *   - Adreslerin `?` sonrası (arama kutusuna yazılan isim/telefon) gönderilmez.
 *   - Bu modül ASLA uygulamayı bozmaz: her şey try/catch içindedir.
 */

export type ClientEventType =
  | 'api-ag'
  | 'api-yavas'
  | 'foto'
  | 'r2'
  | 'cokme'
  | 'parca'
  | 'js'
  | 'mesaj'
  | 'yavas-yukleme';

export interface ClientEventInput {
  tur: ClientEventType;
  [field: string]: string | number | boolean | undefined;
}

const API_URL = import.meta.env.VITE_API_URL || '/api';
const ENDPOINT = `${API_URL}/client-log`;
const QUEUE_KEY = 'clientLogQueue';
const MAX_QUEUE = 20;
const MAX_PER_PAGE = 30;
const DEDUPE_MS = 60_000;
const FLUSH_DELAY_MS = 2_000;
const SEND_TIMEOUT_MS = 15_000;
const MAX_TEXT = 300;
/** Sunucu sınırı 8 kB; bir gönderim bunun altında kalır. */
const MAX_BATCH_CHARS = 7_000;

type QueuedEvent = Record<string, string | number | boolean>;

let sentThisPage = 0;
const lastSeen = new Map<string, number>();
let queue: QueuedEvent[] = loadQueue();
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let sending = false;

function loadQueue(): QueuedEvent[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed.slice(-MAX_QUEUE) as QueuedEvent[]) : [];
  } catch {
    return [];
  }
}

function saveQueue(): void {
  try {
    if (queue.length === 0) localStorage.removeItem(QUEUE_KEY);
    else localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // Gizli sekme / dolu depolama: olaylar yalnızca bellekte kalır.
  }
}

function stripQuery(url: string): string {
  const index = url.search(/[?#]/);
  return index === -1 ? url : url.slice(0, index);
}

/** Son başarılı API isteğinin bağlantı protokolü (h2 / h3): CDN takılmasının teşhisi için. */
export function lastApiProtocol(): string | undefined {
  try {
    const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      if (entries[i].name.includes('/api/') && entries[i].nextHopProtocol) return entries[i].nextHopProtocol;
    }
  } catch {
    // eski tarayıcı
  }
  return undefined;
}

function context(): QueuedEvent {
  const result: QueuedEvent = { sayfa: location.pathname, zaman: Date.now(), cevrimici: navigator.onLine };
  try {
    const connection = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
    if (connection?.effectiveType) result.baglanti = connection.effectiveType;
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (navigation?.nextHopProtocol) result.sayfaProtokol = navigation.nextHopProtocol;
    const user = JSON.parse(localStorage.getItem('user') || 'null') as { role?: string; id?: number } | null;
    if (user?.role) result.rol = user.role;
    if (typeof user?.id === 'number') result.kullaniciId = user.id;
  } catch {
    // bağlam bilgisi eksik kalabilir
  }
  return result;
}

function clean(event: ClientEventInput): QueuedEvent {
  const out: QueuedEvent = {};
  for (const [key, value] of Object.entries(event)) {
    if (value === undefined) continue;
    if (typeof value === 'string') {
      const text = key === 'uc' || key === 'sayfa' ? stripQuery(value) : value;
      out[key] = text.slice(0, MAX_TEXT);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Bir sorunu bildirir. Hemen gönderilmez: 2 sn içinde gelen olaylar birlikte gider.
 * `dedupeKey` verilmezse tür + uç + kod + mesajdan üretilir.
 */
export function reportClientEvent(event: ClientEventInput, dedupeKey?: string): void {
  try {
    if (sentThisPage >= MAX_PER_PAGE) return;
    const key = dedupeKey ?? `${event.tur}|${event.uc ?? ''}|${event.kod ?? ''}|${event.mesaj ?? ''}`;
    const now = Date.now();
    if (now - (lastSeen.get(key) ?? 0) < DEDUPE_MS) return;
    lastSeen.set(key, now);
    sentThisPage += 1;

    queue.push({ ...context(), ...clean(event) });
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
    saveQueue();
    scheduleFlush();
  } catch {
    // bildirim mekanizması uygulamayı asla bozmamalı
  }
}

function scheduleFlush(delay = FLUSH_DELAY_MS): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    void flush();
  }, delay);
}

function nextBatch(): { batch: QueuedEvent[]; body: string } {
  const batch: QueuedEvent[] = [];
  for (const event of queue) {
    if (JSON.stringify({ events: [...batch, event] }).length > MAX_BATCH_CHARS && batch.length > 0) break;
    batch.push(event);
  }
  return { batch, body: JSON.stringify({ events: batch }) };
}

function dropSent(batch: QueuedEvent[]): void {
  queue = queue.filter((event) => !batch.includes(event));
  saveQueue();
}

/** Bekleyenleri gönderir; sunucu 204 dönerse siler, olmazsa sonra yeniden dener. */
async function flush(): Promise<void> {
  if (sending || queue.length === 0 || !navigator.onLine) return;
  sending = true;
  const { batch, body } = nextBatch();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    // Bilerek axios değil: bildirim isteği kendisi bildirim üretmesin, token gitmesin.
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body,
      keepalive: true,
      signal: controller.signal,
    });
    // 400/413: bu olaylar hiçbir zaman kabul edilmez, tutmanın anlamı yok. 429: sonra.
    if (response.ok || response.status === 400 || response.status === 413) dropSent(batch);
  } catch {
    // ağ yok / takıldı: kuyrukta kalır
  } finally {
    clearTimeout(timer);
    sending = false;
  }
  if (queue.length > 0) scheduleFlush(30_000);
}

/** Sayfa kapanırken: son şans, sendBeacon (cevap beklenmez). */
function flushOnHide(): void {
  try {
    if (queue.length === 0 || !navigator.sendBeacon) return;
    const { batch, body } = nextBatch();
    if (navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'text/plain;charset=UTF-8' }))) dropSent(batch);
  } catch {
    // yok say
  }
}

const IGNORED_ERRORS = [/ResizeObserver loop/i, /^Script error\.?$/i];

/** Uygulama açılışında bir kez çağrılır: yakalanmamış hatalar + bekleyen olayların gönderimi. */
export function installClientLog(): void {
  try {
    window.addEventListener('error', (event) => {
      const message = event.message || String(event.error ?? '');
      if (!message || IGNORED_ERRORS.some((pattern) => pattern.test(message))) return;
      // Tarayıcı eklentilerinin hataları bizim değil.
      if (event.filename && !event.filename.startsWith(location.origin)) return;
      reportClientEvent({
        tur: 'js',
        mesaj: message,
        ayrinti: event.error?.stack ?? `${event.filename}:${event.lineno}:${event.colno}`,
      });
    });
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason as { name?: string; message?: string; stack?: string; isAxiosError?: boolean } | undefined;
      // API hataları zaten axios katmanında bildiriliyor.
      if (reason?.isAxiosError || reason?.name === 'CanceledError') return;
      const message = reason?.message ?? String(reason);
      if (IGNORED_ERRORS.some((pattern) => pattern.test(message))) return;
      reportClientEvent({ tur: 'js', kod: 'promise', mesaj: message, ayrinti: reason?.stack });
    });
    // Vite: sayfa parçası (JS dosyası) önceden yüklenemedi.
    window.addEventListener('vite:preloadError', (event) => {
      const payload = (event as Event & { payload?: { message?: string } }).payload;
      reportClientEvent({ tur: 'parca', mesaj: payload?.message ?? 'parça yüklenemedi' });
    });
    window.addEventListener('online', () => scheduleFlush(500));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushOnHide();
    });
    // Önceki açılışta gönderilemeyenler.
    if (queue.length > 0) scheduleFlush(5_000);
  } catch {
    // yok say
  }
}
