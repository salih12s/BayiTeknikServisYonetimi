import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

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
};

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
  const token = localStorage.getItem('token');
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Hata yönetimi
api.interceptors.response.use(
  (response) => response,
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
