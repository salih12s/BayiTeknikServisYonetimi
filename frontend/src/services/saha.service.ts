import { api } from './api';
import { SahaKayit, SahaKayitCreateDto, SahaKayitUpdateDto, SahaElemani } from '../types';
import { SahaPhoto, photosFromResponse } from '../utils/sahaPhoto';

// Saha servisleri
export const sahaService = {
  // Saha elemanı girişi
  login: async (username: string, password: string) => {
    const response = await api.post('/saha/login', { username, password });
    if (response.data.token) {
      localStorage.setItem('token', response.data.token);
      localStorage.setItem('user', JSON.stringify(response.data.user));
    }
    return response.data;
  },

  // Yeni saha elemanı oluştur (admin)
  createSahaElemani: async (username: string, password: string, ad_soyad?: string) => {
    const response = await api.post('/saha/create', { username, password, ad_soyad });
    return response.data;
  },

  // Tüm saha elemanlarını listele (admin)
  getSahaElemanlari: async (): Promise<SahaElemani[]> => {
    const response = await api.get('/saha/users');
    return response.data;
  },

  // Saha elemanı aktif/pasif yap (admin)
  toggleSahaElemaniStatus: async (id: number) => {
    const response = await api.patch(`/saha/users/${id}/toggle`);
    return response.data;
  },

  // Saha elemanı sil (admin)
  deleteSahaElemani: async (id: number) => {
    const response = await api.delete(`/saha/users/${id}`);
    return response.data;
  },

  // Yeni kayıt ekle (saha elemanı)
  createKayit: async (data: SahaKayitCreateDto): Promise<SahaKayit> => {
    const response = await api.post('/saha/kayit', data);
    return response.data.kayit;
  },

  // Kendi kayıtlarını getir (saha elemanı) - paginated
  getKayitlar: async (params?: { search?: string; startDate?: string; endDate?: string; today?: boolean; page?: number; limit?: number }): Promise<{ data: SahaKayit[]; pagination: { page: number; limit: number; total: number; totalPages: number }; stats: { toplam: number; bugun: number } }> => {
    const response = await api.get('/saha/kayitlar', { params });
    return response.data;
  },

  // Tek kayıt getir
  getKayit: async (id: number): Promise<SahaKayit> => {
    const response = await api.get(`/saha/kayit/${id}`);
    return response.data;
  },

  // Kayıt güncelle
  updateKayit: async (id: number, data: SahaKayitUpdateDto): Promise<SahaKayit> => {
    const response = await api.put(`/saha/kayit/${id}`, data);
    return response.data.kayit;
  },

  // Kayıt sil
  deleteKayit: async (id: number) => {
    const response = await api.delete(`/saha/kayit/${id}`);
    return response.data;
  },

  // Tüm saha kayıtlarını getir (admin) - foto_data hariç, paginated
  getAllKayitlar: async (params?: { search?: string; startDate?: string; endDate?: string; sahaElemaniId?: number; today?: boolean; page?: number; limit?: number }): Promise<{ data: SahaKayit[]; pagination: { page: number; limit: number; total: number; totalPages: number }; stats: { toplam: number; bugun: number } }> => {
    const response = await api.get('/saha/all-kayitlar', { params, timeout: 60000 });
    return response.data;
  },

  // Tek kayıdın fotoğraflarını getir (lazy load)
  getKayitPhotos: async (id: number): Promise<SahaPhoto[]> => {
    const response = await api.get(`/saha/kayit-photos/${id}`, { timeout: 60000 });
    return photosFromResponse(response.data);
  },

  // Tek kayıdın sadece ilk fotoğrafını getir (liste önizlemesi için)
  getKayitThumbnail: async (id: number): Promise<string | null> => {
    const response = await api.get(`/saha/kayit-thumbnail/${id}`, { timeout: 30000 });
    return response.data.foto_preview;
  },

  // Saha elemanının kayıtlarını getir (admin)
  getUserKayitlar: async (username: string): Promise<SahaKayit[]> => {
    const response = await api.get(`/saha/user-kayitlar/${encodeURIComponent(username)}`);
    return response.data;
  },
};
