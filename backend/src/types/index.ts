export interface User {
  id: number;
  username: string;
  password: string;
  created_at: Date;
}

export interface Islem {
  id: number;
  full_tarih: Date;
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
  is_durumu: 'acik' | 'parca_bekliyor' | 'tamamlandi' | 'iptal';
  created_by?: string;
  updated_at: Date;
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
  is_durumu: 'acik' | 'parca_bekliyor' | 'tamamlandi' | 'iptal';
}

export interface AuthPayload {
  id: number;
  username: string;
  /**
   * JWT'de eklenen rol bilgisi (`'user'` / `'bayi'` / future: `'admin'`,
   * `'saha'`). Optional — eski tokenlar bu alanı taşımayabilir.
   */
  role?: string;
  /**
   * Bayi token'larında doldurulan bayi ismi. Sadece `role === 'bayi'`
   * olduğunda set edilir.
   */
  bayiIsim?: string;
}

export interface Teknisyen {
  id: number;
  isim: string;
  created_at: Date;
}

export interface Marka {
  id: number;
  isim: string;
  created_at: Date;
}

export interface Bayi {
  id: number;
  isim: string;
  username: string;
  password: string;
  created_at: Date;
}

export interface Montaj {
  id: number;
  isim: string;
  created_at: Date;
}

export interface Aksesuar {
  id: number;
  isim: string;
  created_at: Date;
}

export interface Urun {
  id: number;
  isim: string;
  created_at: Date;
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
  yapilma_tarihi?: Date;
  kayit_tarihi?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface AtolyeCreateDto {
  /** Aynı bilgilerle kaç ayrı kayıt açılacağı (varsayılan 1). */
  adet?: number;
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
  yapilma_tarihi?: Date;
  kayit_tarihi?: string;
}
