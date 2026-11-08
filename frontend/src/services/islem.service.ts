import { api } from './api';
import { Islem, IslemCreateDto, IslemUpdateDto, FilterParams } from '../types';

// İşlem servisleri
export const islemService = {
  getAll: async (filters?: FilterParams & { page?: number; limit?: number; today?: string; yazdirilmamis?: string }): Promise<Islem[] | { data: Islem[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> => {
    const response = await api.get('/islemler', { params: filters });
    return response.data;
  },

  // Filtreye uyan BÜTÜN kayıtlar (sayfalama yok). Liste büyük olabildiği için süre uzun.
  getAllMatching: async (filters?: FilterParams & { today?: string; yazdirilmamis?: string }): Promise<Islem[]> => {
    const response = await api.get('/islemler', { params: filters, timeout: 120000 });
    return Array.isArray(response.data) ? response.data : response.data.data;
  },

  getStats: async (): Promise<{ total: string; acik: string; parca_bekliyor: string; tamamlandi: string; iptal: string; bugun: string; yazdirilmamis: string }> => {
    const response = await api.get('/islemler/stats');
    return response.data;
  },

  // Telefon numarasına göre arama (duplicate kontrolü için)
  searchByPhone: async (phone: string): Promise<Islem[]> => {
    const response = await api.get('/islemler/search-by-phone', { params: { phone } });
    return response.data;
  },

  // İsme göre müşteri geçmişi arama
  searchByName: async (name: string): Promise<Islem[]> => {
    const response = await api.get('/islemler/search-by-name', { params: { name } });
    return response.data;
  },

  create: async (data: IslemCreateDto): Promise<Islem> => {
    const response = await api.post('/islemler', data);
    return response.data;
  },

  update: async (id: number, data: IslemUpdateDto): Promise<Islem> => {
    // Aynı değerleri yazar: bağlantı koparsa yeniden göndermek güvenlidir.
    const response = await api.put(`/islemler/${id}`, data, { retryOnNetworkError: true });
    return response.data;
  },

  delete: async (id: number): Promise<void> => {
    await api.delete(`/islemler/${id}`);
  },

  // ⚡ Sadece "yazdirildi" bayrağını çevirir. Tüm satırı PUT etmek yerine
  // tek kolonluk PATCH — sunucuda ön SELECT yok, 20 kolon yazımı yok.
  toggleYazdirildi: async (id: number, yazdirildi: boolean): Promise<Islem> => {
    // Değeri açıkça yazar (sunucuda tersine çevirme yok): yeniden göndermek güvenlidir.
    const response = await api.patch(`/islemler/${id}/yazdirildi`, { yazdirildi }, { retryOnNetworkError: true });
    return response.data;
  },

  updateDurum: async (id: number, is_durumu: 'acik' | 'tamamlandi'): Promise<Islem> => {
    const response = await api.patch(`/islemler/${id}/durum`, { is_durumu }, { retryOnNetworkError: true });
    return response.data;
  },
};
