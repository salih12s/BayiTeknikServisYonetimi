import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { lastApiProtocol, reportClientEvent } from './clientLog';

// Environment variable'dan API URL'i al
// Development: http://localhost:5000/api
// Production: /api (aynı domain)
// Local + Production API: .env.local dosyasında override edilebilir
const API_URL = import.meta.env.VITE_API_URL || '/api';

console.log('API URL:', API_URL); // Debug için

const api = axios.create({
  baseURL: API_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

declare module 'axios' {
  interface AxiosRequestConfig {
    /**
     * Yazma isteği sunucudan HİÇ cevap alamadıysa (bağlantı koptu, zaman aşımı) yeniden
     * gönderilsin. Yalnızca iki kez gönderilmesi zararsız isteklerde (aynı değeri yazan
     * PUT/PATCH) açılır; "çevir" (toggle) ya da yeni kayıt açan isteklerde AÇILMAZ.
     */
    retryOnNetworkError?: boolean;
  }
}

type RetryableAxiosConfig = InternalAxiosRequestConfig & {
  _retryCount?: number;
  /** İlk denemenin başladığı an (tekrar denemelerde değişmez: toplam süre ölçülür). */
  _startedAt?: number;
};

/** Bu süreyi aşan (ama cevaplanan) istek "yavaş" diye bildirilir. */
const SLOW_API_MS = 8000;

function describeRequest(config: RetryableAxiosConfig | undefined) {
  const started = config?._startedAt;
  return {
    uc: `${config?.baseURL ?? ''}${config?.url ?? ''}`,
    yontem: config?.method?.toUpperCase(),
    ms: typeof started === 'number' ? Math.round(performance.now() - started) : undefined,
    deneme: (config?._retryCount || 0) + 1,
    protokol: lastApiProtocol(),
  };
}

const RETRYABLE_GET_STATUS_CODES = new Set([500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function shouldRetryRequest(error: AxiosError): boolean {
  const config = error.config as RetryableAxiosConfig | undefined;
  const method = config?.method?.toLowerCase();
  const status = error.response?.status;
  const retryCount = config?._retryCount || 0;

  if (!config || retryCount >= 2) {
    return false;
  }

  // Yazma isteği: yalnızca açıkça izin verildiyse ve sunucudan hiç cevap gelmediyse.
  // (Cevap geldiyse — 4xx/5xx — sunucu isteği gördü; tekrar göndermek düzeltmez.)
  if (method !== 'get') {
    return config.retryOnNetworkError === true && !error.response;
  }

  return !status || RETRYABLE_GET_STATUS_CODES.has(status) || error.code === 'ECONNABORTED';
}

// Token'ı her istekte ekle
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const retryable = config as RetryableAxiosConfig;
  if (retryable._startedAt === undefined) retryable._startedAt = performance.now();
  const token = localStorage.getItem('token');
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Hata yönetimi
api.interceptors.response.use(
  (response) => {
    // Teşhis: yavaş cevap ya da ancak tekrar denemeyle gelen cevap (bağlantı aksadı).
    const config = response.config as RetryableAxiosConfig;
    const info = describeRequest(config);
    if ((config._retryCount || 0) > 0) {
      reportClientEvent({ tur: 'api-ag', ...info, durum: response.status, ayrinti: 'tekrar denemeyle düzeldi' });
    } else if ((info.ms ?? 0) >= SLOW_API_MS) {
      reportClientEvent({ tur: 'api-yavas', ...info, durum: response.status });
    }
    return response;
  },
  async (error: AxiosError) => {
    if (error.response?.status === 401) {
      // Token geçersiz, kullanıcıyı çıkış yap
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }

    if (shouldRetryRequest(error)) {
      const config = error.config as RetryableAxiosConfig;
      config._retryCount = (config._retryCount || 0) + 1;
      await sleep(500 * config._retryCount);
      return api(config);
    }

    // Teşhis: sunucudan HİÇ cevap gelmedi (bağlantı koptu, zaman aşımı, takılma). Bu
    // istekler sunucu logunda görünmez; tek iz burası. (Cevap gelen 4xx/5xx'i sunucu yazar.)
    if (!error.response && error.code !== 'ERR_CANCELED') {
      reportClientEvent({ tur: 'api-ag', ...describeRequest(error.config as RetryableAxiosConfig), kod: error.code });
    }

    return Promise.reject(error);
  }
);

export { api };

// Re-export shim — sadece FROZEN dosya `components/settings/PrintEditor.tsx`
// halen `from '../../services/api'` ile `printerSettingsService` import ettiği
// için tutuluyor. Diğer 14 servisin re-export'u P1.B1'de tüketicilerin
// modüllere taşınmasının ardından kaldırıldı.
// PrintEditor unfreeze edildiğinde bu satır da silinmelidir; o noktada api.ts
// salt axios konfigürasyonu olur.
export { printerSettingsService } from './printerSettings.service';
