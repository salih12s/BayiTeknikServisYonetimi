import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Grid,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { Atolye, AtolyeCreateDto, AtolyeUpdateDto, Bayi, Marka } from '../../types';
import { atolyeService } from '../../services/atolye.service';
import { bayiService } from '../../services/bayi.service';
import { markaService } from '../../services/marka.service';
import { useSnackbar } from '../../context/SnackbarContext';
import AtolyeEditOnlyFields from './dialog/AtolyeEditOnlyFields';
import AtolyeBayiAutocomplete from './dialog/AtolyeBayiAutocomplete';
import AtolyeMarkaAutocomplete from './dialog/AtolyeMarkaAutocomplete';

interface AtolyeDialogProps {
  open: boolean;
  onClose: (refresh?: boolean) => void;
  atolyeId: number | null;
}

const STATUS_OPTIONS = [
  { value: 'beklemede', label: 'Beklemede' },
  { value: 'siparis_verildi', label: 'Sipariş Verildi' },
  { value: 'yapildi', label: 'Yapıldı' },
  { value: 'fabrika_gitti', label: 'Fabrika Gitti' },
  { value: 'odeme_bekliyor', label: 'Ödeme Bekliyor' },
  { value: 'teslim_edildi', label: 'Teslim Edildi' },
];

const AtolyeDialog: React.FC<AtolyeDialogProps> = ({ open, onClose, atolyeId }) => {
  const isEdit = atolyeId !== null;
  const { showSnackbar } = useSnackbar();
  const [adet, setAdet] = useState('1');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const [bayiler, setBayiler] = useState<Bayi[]>([]);
  const [markalar, setMarkalar] = useState<Marka[]>([]);
  const [markaInputValue, setMarkaInputValue] = useState('');
  const [bayiInputValue, setBayiInputValue] = useState('');
  const [nextSiraNo, setNextSiraNo] = useState<number | null>(null);
  const [formData, setFormData] = useState<AtolyeUpdateDto & AtolyeCreateDto>({
    bayi_adi: '',
    musteri_ad_soyad: '',
    tel_no: '',
    marka: '',
    kod: '',
    seri_no: '',
    sikayet: '',
    ozel_not: '',
    yapilan_islem: '',
    note_no: '',
    ucret: undefined,
    yapilma_tarihi: undefined,
    teslim_durumu: 'beklemede',
    kayit_tarihi: new Date().toISOString().split('T')[0], // Bugünün tarihi
  });

  useEffect(() => {
    fetchBayiler();
    fetchMarkalar();
    if (isEdit) {
      fetchAtolyeData();
    } else {
      resetForm();
      fetchNextSiraNo();
    }
  }, [atolyeId, open]);

  const fetchNextSiraNo = async () => {
    try {
      const data = await atolyeService.getNextId();
      setNextSiraNo(data.nextId);
    } catch (error) {
      console.error('Sıra numarası alınamadı:', error);
    }
  };

  const fetchBayiler = async () => {
    try {
      setBayiler(await bayiService.getAll());
    } catch (error) {
      showSnackbar('Bayiler yüklenirken hata oluştu', 'error');
    }
  };

  const fetchMarkalar = async () => {
    try {
      setMarkalar(await markaService.getAll());
    } catch (error) {
      showSnackbar('Markalar yüklenirken hata oluştu', 'error');
    }
  };

  const fetchAtolyeData = async () => {
    if (!atolyeId) return;
    try {
      const data: Atolye = await atolyeService.getById(atolyeId);

      const processedDate = data.kayit_tarihi ? String(data.kayit_tarihi).substring(0, 10) : new Date().toISOString().substring(0, 10);

      // Yapılma tarihini timezone farkı olmadan işle
      let processedYapilmaTarihi: string | undefined = undefined;
      if (data.yapilma_tarihi) {
        // UTC tarihini local timezone'a çevir
        const yapilmaDate = new Date(data.yapilma_tarihi);
        const year = yapilmaDate.getFullYear();
        const month = String(yapilmaDate.getMonth() + 1).padStart(2, '0');
        const day = String(yapilmaDate.getDate()).padStart(2, '0');
        processedYapilmaTarihi = `${year}-${month}-${day}`;
      } else {
        // Eğer yoksa bugünün tarihini kullan
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        processedYapilmaTarihi = `${year}-${month}-${day}`;
      }

      setBayiInputValue(data.bayi_adi || '');
      setMarkaInputValue(data.marka || '');
      setFormData({
        bayi_adi: data.bayi_adi || '',
        musteri_ad_soyad: data.musteri_ad_soyad,
        tel_no: data.tel_no,
        marka: data.marka,
        kod: data.kod || '',
        seri_no: data.seri_no || '',
        sikayet: data.sikayet,
        ozel_not: data.ozel_not || '',
        yapilan_islem: data.yapilan_islem || '',
        note_no: data.note_no || '',
        ucret: data.ucret,
        yapilma_tarihi: processedYapilmaTarihi,
        kayit_tarihi: processedDate,
        teslim_durumu: data.teslim_durumu,
      });
    } catch (error) {
      showSnackbar('Kayıt yüklenirken hata oluştu', 'error');
    }
  };

  const resetForm = () => {
    setAdet('1');
    setBayiInputValue('');
    setMarkaInputValue('');
    setFormData({
      bayi_adi: '',
      musteri_ad_soyad: '',
      tel_no: '',
      marka: '',
      kod: '',
      seri_no: '',
      sikayet: '',
      ozel_not: '',
      yapilan_islem: '',
      note_no: '',
      ucret: undefined,
      yapilma_tarihi: undefined,
      teslim_durumu: 'beklemede',
      kayit_tarihi: new Date().toISOString().split('T')[0], // Bugünün tarihi
    });
  };

  const handleChange = (field: string, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const cleaned = e.target.value.replace(/\D/g, '');
    if (cleaned.length <= 11) {
      handleChange('tel_no', cleaned);
    }
  };

  const formatPhoneNumber = (phone: string) => {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 11) {
      return `${cleaned.slice(0, 4)} ${cleaned.slice(4, 7)} ${cleaned.slice(7, 9)} ${cleaned.slice(9)}`;
    }
    return cleaned;
  };

  // Adet alanı yalnızca yeni kayıtta kullanılır.
  const adetGecersiz = !isEdit && !/^([1-9]|[1-9][0-9]|100)$/.test(adet.trim());
  const adetSayisi = isEdit || adetGecersiz ? 1 : Number(adet.trim());

  const handleSubmit = async () => {
    if (adetGecersiz) {
      showSnackbar('Adet 1 ile 100 arasında bir sayı olmalıdır!', 'error');
      return;
    }
    // Bayi Adı VEYA Müşteri Adı kontrolü - en az biri dolu olmalı
    const hasBayi = formData.bayi_adi && formData.bayi_adi.trim() !== '';
    const hasMusteri = formData.musteri_ad_soyad && formData.musteri_ad_soyad.trim() !== '';
    
    if (!hasBayi && !hasMusteri) {
      showSnackbar('Bayi Adı veya Müşteri Ad Soyad alanlarından en az biri doldurulmalıdır!', 'error');
      return;
    }

    // Bayi kontrolü - eğer doldurulmuşsa tanımlı listede olmalı
    if (hasBayi) {
      const bayiExists = bayiler.some(b => b.isim === formData.bayi_adi);
      if (!bayiExists) {
        showSnackbar('Lütfen listeden bir bayi seçiniz! Sadece tanımlı bayiler kabul edilir.', 'error');
        return;
      }
    }

    // Marka zorunlu kontrolü
    if (!formData.marka || formData.marka.trim() === '') {
      showSnackbar('Marka alanı zorunludur!', 'error');
      return;
    }

    // Marka kontrolü - tanımlı listede olmalı
    const markaExists = markalar.some(m => m.isim === formData.marka);
    if (!markaExists) {
      showSnackbar('Lütfen listeden bir marka seçiniz! Sadece tanımlı markalar kabul edilir.', 'error');
      return;
    }

    // Model zorunlu kontrolü
    if (!formData.kod || formData.kod.trim() === '') {
      showSnackbar('Model alanı zorunludur!', 'error');
      return;
    }

    // Şikayet zorunlu kontrolü
    if (!formData.sikayet || formData.sikayet.trim() === '') {
      showSnackbar('Şikayet alanı zorunludur!', 'error');
      return;
    }

    // Özel Not zorunlu kontrolü
    if (!formData.ozel_not || formData.ozel_not.trim() === '') {
      showSnackbar('Özel Not alanı zorunludur!', 'error');
      return;
    }

    // Telefon kontrolü - eğer doldurulmuşsa 11 haneli olmalı
    if (formData.tel_no && formData.tel_no.length > 0 && formData.tel_no.length !== 11) {
      showSnackbar('Telefon numarası 11 haneli olmalıdır', 'error');
      return;
    }

    try {
      if (isEdit) {
        // Tarihe 12:00:00 ekleyerek timezone kaymasını önle
        const kayitTarihiWithTime = formData.kayit_tarihi ? `${formData.kayit_tarihi}T12:00:00` : undefined;

        const updateDto: AtolyeUpdateDto = {
          ...formData,
          kayit_tarihi: kayitTarihiWithTime,
          ucret: formData.ucret || undefined,
        };
        await atolyeService.update(atolyeId!, updateDto);
        showSnackbar('Kayıt başarıyla güncellendi', 'success');
      } else {
        // Tarihe 12:00:00 ekleyerek timezone kaymasını önle
        const kayitTarihiWithTime = formData.kayit_tarihi ? `${formData.kayit_tarihi}T12:00:00` : undefined;

        const createDto: AtolyeCreateDto = {
          bayi_adi: formData.bayi_adi,
          musteri_ad_soyad: formData.musteri_ad_soyad,
          tel_no: formData.tel_no,
          marka: formData.marka,
          kod: formData.kod,
          // Çoklu girişte her ürünün seri numarası farklıdır; sonradan tek tek girilir.
          seri_no: adetSayisi > 1 ? '' : formData.seri_no,
          sikayet: formData.sikayet,
          ozel_not: formData.ozel_not,
          kayit_tarihi: kayitTarihiWithTime,
          adet: adetSayisi,
        };

        if (
          adetSayisi > 1 &&
          !window.confirm(`Aynı bilgilerle ${adetSayisi} ayrı kayıt oluşturulacak. Devam edilsin mi?`)
        ) {
          return;
        }
        await atolyeService.create(createDto);
        showSnackbar(
          adetSayisi > 1 ? `${adetSayisi} kayıt başarıyla oluşturuldu` : 'Kayıt başarıyla oluşturuldu',
          'success'
        );
      }
      onClose(true);
    } catch (error: any) {
      const message = error.response?.data?.error || 'Bir hata oluştu';
      showSnackbar(message, 'error');
    }
  };
  
  return (
    <Dialog open={open} onClose={() => onClose()} maxWidth="md" fullWidth fullScreen={isMobile}>
      <DialogTitle sx={{ textAlign: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px' }}>
          <span>{isEdit ? 'Kaydı Düzenle' : 'Yeni Kayıt Ekle'}</span>
          <TextField
            type="date"
            size="small"
            value={
              formData.kayit_tarihi 
                ? (formData.kayit_tarihi.length > 10 ? formData.kayit_tarihi.substring(0, 10) : formData.kayit_tarihi)
                : new Date().toISOString().split('T')[0]
            }
            onChange={(e) => handleChange('kayit_tarihi', e.target.value)}
            InputLabelProps={{
              shrink: true,
            }}
            sx={{ width: '150px' }}
          />
        </div>
        {!isEdit && nextSiraNo && (
          <div style={{ 
            fontSize: '2rem', 
            fontWeight: 700, 
            color: '#0D3282',
            marginTop: '8px'
          }}>
            {nextSiraNo}
          </div>
        )}
      </DialogTitle>
      <DialogContent>
        <Grid container spacing={1.5} sx={{ mt: 0.5 }}>
          {/* Bayi Adı - Autocomplete */}
          <Grid item xs={12} md={6}>
            <AtolyeBayiAutocomplete
              bayiler={bayiler}
              value={formData.bayi_adi || ''}
              inputValue={bayiInputValue}
              setInputValue={setBayiInputValue}
              onChange={(isim) => handleChange('bayi_adi', isim)}
            />
          </Grid>

          {/* Müşteri Ad Soyad */}
          <Grid item xs={12} md={6}>
            <TextField
              name="musteri_ad_soyad"
              label="Müşteri Ad Soyad"
              fullWidth
              value={formData.musteri_ad_soyad}
              onChange={(e) => handleChange('musteri_ad_soyad', e.target.value)}
            />
          </Grid>

          {/* Telefon No */}
          <Grid item xs={12} md={6}>
            <TextField
              label="Telefon No"
              fullWidth
              value={formatPhoneNumber(formData.tel_no)}
              onChange={handlePhoneChange}
              placeholder="0544 448 88 88"
            />
          </Grid>

          {/* Marka */}
          <Grid item xs={12} md={6}>
            <AtolyeMarkaAutocomplete
              markalar={markalar}
              value={formData.marka || ''}
              inputValue={markaInputValue}
              setInputValue={setMarkaInputValue}
              onChange={(isim) => handleChange('marka', isim)}
            />
          </Grid>

          {/* Model */}
          <Grid item xs={12} md={6}>
            <TextField
              name="model"
              required
              label="Model"
              fullWidth
              value={formData.kod}
              onChange={(e) => handleChange('kod', e.target.value)}
            />
          </Grid>

          {/* Seri No */}
          <Grid item xs={12} md={6}>
            <TextField
              label="Seri No"
              fullWidth
              value={adetSayisi > 1 ? '' : formData.seri_no}
              onChange={(e) => handleChange('seri_no', e.target.value)}
              disabled={adetSayisi > 1}
              helperText={adetSayisi > 1 ? 'Çoklu girişte boş kalır, sonradan her kayıtta ayrı girilir' : undefined}
            />
          </Grid>

          {/* Adet: aynı üründen birden çok geldiyse tek seferde hepsi için kayıt açılır */}
          {!isEdit && (
            <Grid item xs={12} md={6}>
              <TextField
                label="Adet"
                type="number"
                fullWidth
                value={adet}
                onChange={(e) => setAdet(e.target.value)}
                inputProps={{ min: 1, max: 100, inputMode: 'numeric' }}
                error={adetGecersiz}
                helperText={
                  adetGecersiz
                    ? '1 ile 100 arasında bir sayı girin'
                    : adetSayisi > 1
                      ? `Aynı bilgilerle ${adetSayisi} ayrı kayıt açılır, her birinin sıra numarası farklı olur`
                      : 'Aynı üründen birden çok geldiyse adedini yazın'
                }
              />
            </Grid>
          )}

          {/* Şikayet */}
          <Grid item xs={12}>
            <TextField
              required
              label="Şikayet"
              fullWidth
              multiline
              rows={1}
              value={formData.sikayet}
              onChange={(e) => handleChange('sikayet', e.target.value)}
            />
          </Grid>

          {/* Özel Not - Sadece yeni kayıtta */}
          {!isEdit && (
            <Grid item xs={12}>
              <TextField
                label="Özel Not"
                fullWidth
                multiline
                rows={1}
                value={formData.ozel_not}
                onChange={(e) => handleChange('ozel_not', e.target.value)}
              />
            </Grid>
          )}

          {/* Edit Mode Only Fields */}
          {isEdit && (
            <AtolyeEditOnlyFields
              formData={formData}
              statusOptions={STATUS_OPTIONS}
              handleChange={handleChange}
            />
          )}
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onClose()}>İptal</Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          sx={{ backgroundColor: '#0D3282', '&:hover': { backgroundColor: '#082052' } }}
        >
          {isEdit ? 'Güncelle' : 'Kaydet'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default AtolyeDialog;
