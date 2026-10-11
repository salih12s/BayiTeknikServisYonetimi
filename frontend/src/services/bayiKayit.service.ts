import { api } from './api';

/**
 * Bayi kayıt linki servisleri.
 *
 * Yönetici tarafı (link oluştur / yenile / iptal) oturumlu `api` ile çalışır. Herkese açık
 * form ise bilerek düz `fetch` kullanır: formu dolduran kişinin oturumu yoktur ve `api`
 * 401 gördüğünde giriş sayfasına yönlendirir.
 */

const API_URL = import.meta.env.VITE_API_URL || '/api';

export interface BayiLink {
  bayi_id: number;
  token: string;
  created_at: string;
}

export interface BayiKayitFormData {
  bayi: string;
  ilceler: Array<{ ilce_id: number; isim: string }>;
  urunler: string[];
  markalar: string[];
}

export interface BayiKayitInput {
  ad_soyad: string;
  ilce: string;
  mahalle: string;
  cadde: string;
  sokak: string;
  kapi_no: string;
  apartman_site: string;
  blok_no: string;
  daire_no: string;
  cep_tel: string;
  yedek_tel: string;
  urun: string;
  marka: string;
  sikayet: string;
}

/** Sunucunun kullanıcıya gösterilebilir hata mesajını taşıyan hata. */
export class BayiKayitError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function publicRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, init);
  } catch {
    throw new BayiKayitError(0, 'Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new BayiKayitError(response.status, body?.message || 'Bir hata oluştu, lütfen tekrar deneyin.');
  }
  return body as T;
}

export const bayiKayitService = {
  // ---- yönetici
  getLinks: async (): Promise<BayiLink[]> => (await api.get('/bayi-kayit/linkler')).data,
  /** Link oluşturur; bayinin linki varsa yeniler (eskisi çalışmaz olur). */
  createLink: async (bayiId: number): Promise<string> =>
    (await api.post(`/bayi-kayit/linkler/${bayiId}`)).data.token,
  revokeLink: async (bayiId: number): Promise<void> => {
    await api.delete(`/bayi-kayit/linkler/${bayiId}`);
  },
  /** Bayiye gönderilecek tam adres. */
  linkUrl: (token: string): string => `${window.location.origin}/bayi-kayit/${token}`,

  // ---- herkese açık form
  getForm: (token: string): Promise<BayiKayitFormData> =>
    publicRequest(`/bayi-kayit/form/${encodeURIComponent(token)}`),
  getMahalleler: async (ilceId: number): Promise<string[]> => {
    const rows = await publicRequest<Array<{ isim: string }>>(`/ilceler/${ilceId}/mahalleler`);
    return rows.map((row) => row.isim);
  },
  submit: (token: string, kayit: BayiKayitInput): Promise<{ message: string; sira_no: number }> =>
    publicRequest(`/bayi-kayit/form/${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(kayit),
    }),
};
