export interface User {
  id: number;
  username: string;
  role?: 'admin' | 'user' | 'bayi' | 'saha';
  bayiIsim?: string;
  ad_soyad?: string;
}

export interface Islem {
  id: number;
  full_tarih: string;
  teknisyen_ismi?: string;
  teknisyen?: string;  // Alias for teknisyen_ismi
  yapilan_islem?: string;
  ariza?: string;  // Alias for sikayet
  aciklama?: string;  // Alias for yapilan_islem
  tutar?: number;
  ad_soyad: string;
  ilce: string;
  mahalle: string;
  cadde: string;
  sokak: string;
  kapi_no: string;
  apartman_site?: string;
  blok_no?: string;
  daire_no?: string;
  sabit_tel?: string;
  cep_tel: string;
  yedek_tel?: string;
  urun: string;
  marka: string;
  sikayet: string;
  montaj?: string; // Montaj listesi (virgülle ayrılmış)
  aksesuar?: string; // Aksesuar listesi (virgülle ayrılmış)
  atolye?: string; // Atölye ismi
  is_durumu: 'acik' | 'parca_bekliyor' | 'tamamlandi' | 'iptal';
  created_by?: string;
  updated_at: string;
  yazdirildi?: boolean; // Yazdırıldı mı? (yazıcı ikonu durumu)
}

export interface IslemCreateDto {
  ad_soyad: string;
  ilce: string;
  mahalle: string;
  cadde: string;
  sokak: string;
  kapi_no: string;
  apartman_site?: string;
  blok_no?: string;
  daire_no?: string;
  sabit_tel?: string;
  cep_tel: string;
  yedek_tel?: string;
  urun: string;
  marka: string;
  sikayet: string;
  montaj?: string; // Montaj listesi (virgülle ayrılmış)
  aksesuar?: string; // Aksesuar listesi (virgülle ayrılmış)
  atolye?: string; // Atölye ismi
  teknisyen_ismi?: string;
  yapilan_islem?: string;
  tutar?: number;
  is_durumu?: 'acik' | 'parca_bekliyor' | 'tamamlandi' | 'iptal';
}

export interface IslemUpdateDto {
  teknisyen_ismi?: string;
  yapilan_islem?: string;
  tutar?: number;
  ad_soyad: string;
  ilce: string;
  mahalle: string;
  cadde: string;
  sokak: string;
  kapi_no: string;
  apartman_site?: string;
  blok_no?: string;
  daire_no?: string;
  sabit_tel?: string;
  cep_tel: string;
  yedek_tel?: string;
  urun: string;
  marka: string;
  sikayet: string;
  montaj?: string; // Montaj listesi (virgülle ayrılmış)
  aksesuar?: string; // Aksesuar listesi (virgülle ayrılmış)
  atolye?: string; // Atölye ismi
  is_durumu: 'acik' | 'parca_bekliyor' | 'tamamlandi' | 'iptal';
  yazdirildi?: boolean; // IslemTable yıldız toggle için opsiyonel flag
}

export interface FilterParams {
  ad_soyad?: string;
  ilce?: string;
  mahalle?: string;
  cadde?: string;
  sokak?: string;
  kapi_no?: string;
  apartman_site?: string;
  blok_no?: string;
  daire_no?: string;
  sabit_tel?: string;
  cep_tel?: string;
  urun?: string;
  marka?: string;
  sikayet?: string;
  teknisyen_ismi?: string;
  is_durumu?: 'acik' | 'tamamlandi' | 'iptal' | '';
}

export interface Teknisyen {
  id: number;
  isim: string;
  created_at: string;
}

export interface Marka {
  id: number;
  isim: string;
  created_at: string;
}

export interface Bayi {
  id: number;
  isim: string;
  username: string;
  password: string;
  created_at: string;
}

export interface Montaj {
  id: number;
  isim: string;
  created_at: string;
}

export interface Aksesuar {
  id: number;
  isim: string;
  created_at: string;
}

export interface Urun {
  id: number;
  isim: string;
  created_at: string;
}

export interface Atolye {
  id: number;
  teslim_durumu: 'beklemede' | 'siparis_verildi' | 'yapildi' | 'fabrika_gitti' | 'odeme_bekliyor' | 'teslim_edildi';
  bayi_adi: string;
  musteri_ad_soyad: string;
  tel_no: string;
  marka: string;
  kod?: string;
  seri_no?: string;
  sikayet: string;
  ozel_not?: string;
  yapilan_islem?: string;
  note_no?: string;
  ucret?: number;
  yapilma_tarihi?: string;
  kayit_tarihi?: string;
  created_at: string;
  updated_at: string;
}

export interface AtolyeCreateDto {
  bayi_adi: string;
  musteri_ad_soyad: string;
  tel_no: string;
  marka: string;
  kod?: string;
  seri_no?: string;
  sikayet: string;
  ozel_not?: string;
  note_no?: string;
  kayit_tarihi?: string;
}

export interface AtolyeUpdateDto {
  teslim_durumu?: 'beklemede' | 'siparis_verildi' | 'yapildi' | 'fabrika_gitti' | 'odeme_bekliyor' | 'teslim_edildi';
  bayi_adi?: string;
  musteri_ad_soyad?: string;
  tel_no?: string;
  marka?: string;
  kod?: string;
  seri_no?: string;
  sikayet?: string;
  ozel_not?: string;
  yapilan_islem?: string;
  note_no?: string;
  ucret?: number;
  yapilma_tarihi?: string;
  kayit_tarihi?: string;
}

// Saha Elemanı
export interface SahaElemani {
  id: number;
  username: string;
  ad_soyad?: string;
  is_active: boolean;
  created_at: string;
  total_records?: number;
}

// Saha Kayıt (Kart)
export interface SahaKayit {
  id: number;
  saha_elemani_id: number;
  saha_elemani_username: string;
  saha_elemani_ad_soyad?: string;
  isim: string;
  soyisim: string;
  foto_url?: string;
  foto_data?: string;
  notlar?: string;
  created_at: string;
  updated_at: string;
  // Liste endpoint'inden gelen optimize alanlar (detay endpoint'inde olmayabilir):
  has_photos?: boolean;
  foto_preview?: string;
}

export interface SahaKayitCreateDto {
  isim: string;
  soyisim: string;
  /** Depoya yüklenmiş fotoğrafların numaraları (sırasıyla). */
  foto_ids?: number[];
  notlar?: string;
}

export interface SahaKayitUpdateDto {
  isim: string;
  soyisim: string;
  /**
   * Kaydın yeni fotoğraf listesi (sırasıyla). Gönderilmezse fotoğraflara dokunulmaz;
   * boş dizi bütün fotoğrafları kaldırır.
   */
  foto_ids?: number[];
  notlar?: string;
}

