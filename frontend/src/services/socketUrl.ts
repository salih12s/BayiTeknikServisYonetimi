/**
 * Socket.IO sunucusunun adresi.
 *
 * Öncelik:
 *   1. VITE_SOCKET_URL (açıkça verilmişse)
 *   2. VITE_API_URL tam adres ise onun sunucusu (API başka bir alan adındaysa)
 *   3. Production'da sayfanın kendi adresi (arayüz ve API aynı sunucudaysa),
 *      geliştirmede yerel backend
 */
export function getSocketUrl(): string {
  const explicit = import.meta.env.VITE_SOCKET_URL;
  if (explicit) return explicit;

  const apiUrl = import.meta.env.VITE_API_URL;
  if (apiUrl && /^https?:\/\//i.test(apiUrl)) return new URL(apiUrl).origin;

  return import.meta.env.MODE === 'production' ? window.location.origin : 'http://localhost:5000';
}

/**
 * Socket.IO bağlantısının kimlik bilgisi. Sunucu bağlanırken bilet (JWT) ister ve
 * olayları role göre gönderir (backend services/realtime.ts). Fonksiyon olarak
 * verilir: her (yeniden) bağlanmada o anki bilet okunur.
 */
export function socketAuth(cb: (data: { token: string | null }) => void): void {
  cb({ token: localStorage.getItem('token') });
}
