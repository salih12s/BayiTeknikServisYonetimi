import { api } from './api';
import { Atolye, AtolyeCreateDto, AtolyeUpdateDto } from '../types';

export interface AtolyeStatusCountsRaw {
  total: number | string;
  beklemede: number | string;
  teslim_edildi: number | string;
  siparis_verildi: number | string;
  yapildi: number | string;
  fabrika_gitti: number | string;
  odeme_bekliyor: number | string;
  [key: string]: number | string;
}

// Atölye servisleri
export const atolyeService = {
  // Durum istatistikleri (ham sayaçlar — component string -> number çevirisini kendi yapıyor)
  getStatusCounts: async (): Promise<AtolyeStatusCountsRaw> => {
    const response = await api.get<AtolyeStatusCountsRaw>('/atolye/status-counts');
    return response.data;
  },

  // Tüm atölye kayıtlarını getir (sayfalama olmadan)
  getAll: async (): Promise<Atolye[]> => {
    const response = await api.get<Atolye[]>('/atolye?all=true');
    return response.data;
  },

  // Yeni kayıt için sıradaki ID
  getNextId: async (): Promise<{ nextId: number }> => {
    const response = await api.get<{ nextId: number }>('/atolye/next-id');
    return response.data;
  },

  // Tek kayıt getir
  getById: async (id: number): Promise<Atolye> => {
    const response = await api.get<Atolye>(`/atolye/${id}`);
    return response.data;
  },

  // Yeni kayıt oluştur
  create: async (data: AtolyeCreateDto): Promise<Atolye> => {
    const response = await api.post<Atolye>('/atolye', data);
    return response.data;
  },

  // Kayıt güncelle
  update: async (id: number, data: AtolyeUpdateDto): Promise<Atolye> => {
    // Aynı değerleri yazar: bağlantı koparsa yeniden göndermek güvenlidir.
    const response = await api.put<Atolye>(`/atolye/${id}`, data, { retryOnNetworkError: true });
    return response.data;
  },

  // Kayıt sil
  delete: async (id: number): Promise<void> => {
    await api.delete(`/atolye/${id}`);
  },
};
