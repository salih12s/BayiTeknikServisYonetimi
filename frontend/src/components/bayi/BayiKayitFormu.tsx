import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Divider,
  Grid,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import { CheckCircle, Send } from '@mui/icons-material';
import {
  BayiKayitError,
  BayiKayitFormData,
  BayiKayitInput,
  bayiKayitService,
} from '../../services/bayiKayit.service';

/**
 * Bayiye gönderilen linkle açılan, giriş gerektirmeyen kayıt formu. Bayi müşteri
 * bilgilerini doldurur; kayıt doğrudan işlem listesine düşer. Telefonda doldurulacağı
 * için tek kolon ve telefonun kendi seçim listeleri (native select) kullanılır.
 */

const EMPTY: BayiKayitInput = {
  ad_soyad: '',
  ilce: '',
  mahalle: '',
  cadde: '',
  sokak: '',
  kapi_no: '',
  apartman_site: '',
  blok_no: '',
  daire_no: '',
  cep_tel: '',
  yedek_tel: '',
  urun: '',
  marka: '',
  sikayet: '',
};

const digits = (value: string): string => value.replace(/\D/g, '');

/** Sunucudaki kuralların aynısı; hata varsa ilk hatanın metnini döner. */
function validate(form: BayiKayitInput): string | null {
  if (!form.ad_soyad.trim()) return 'Ad Soyad alanı zorunludur';
  if (!digits(form.cep_tel)) return 'Cep Telefonu alanı zorunludur';
  if (digits(form.cep_tel).length !== 11) return 'Cep telefonu 11 haneli olmalıdır (05XX XXX XX XX)';
  if (digits(form.yedek_tel) && digits(form.yedek_tel).length !== 11) return 'Yedek telefon numarası 11 haneli olmalıdır';
  if (!form.ilce) return 'İlçe alanı zorunludur';
  if (!form.mahalle) return 'Mahalle alanı zorunludur';
  if (!form.cadde.trim() && !form.sokak.trim()) return 'Cadde veya Sokak alanlarından en az biri doldurulmalıdır';
  if (!form.kapi_no.trim()) return 'Kapı No alanı zorunludur';
  if (!form.daire_no.trim()) return 'Daire No alanı zorunludur';
  if (!form.urun) return 'Ürün alanı zorunludur';
  if (!form.marka) return 'Marka alanı zorunludur';
  if (!form.sikayet.trim()) return 'Şikayet alanı zorunludur';
  return null;
}

const BayiKayitFormu: React.FC = () => {
  const { token = '' } = useParams();
  const [data, setData] = useState<BayiKayitFormData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<BayiKayitInput>(EMPTY);
  const [mahalleler, setMahalleler] = useState<string[]>([]);
  const [mahalleLoading, setMahalleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  useEffect(() => {
    document.title = 'Servis Kayıt Formu';
    bayiKayitService
      .getForm(token)
      .then(setData)
      .catch((err: BayiKayitError) => setLoadError(err.message));
  }, [token]);

  const set = (key: keyof BayiKayitInput) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((prev) => ({ ...prev, [key]: event.target.value }));
  };

  const handleIlce = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const ilce = event.target.value;
    setForm((prev) => ({ ...prev, ilce, mahalle: '' }));
    setMahalleler([]);
    const selected = data?.ilceler.find((item) => item.isim === ilce);
    if (!selected) return;
    try {
      setMahalleLoading(true);
      setMahalleler(await bayiKayitService.getMahalleler(selected.ilce_id));
    } catch {
      setError('Mahalle listesi alınamadı. Lütfen ilçeyi yeniden seçin.');
    } finally {
      setMahalleLoading(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    const invalid = validate(form);
    if (invalid) {
      setError(invalid);
      return;
    }
    try {
      setSubmitting(true);
      setError(null);
      const result = await bayiKayitService.submit(token, form);
      setDone(result.sira_no);
      window.scrollTo({ top: 0 });
    } catch (err) {
      setError((err as BayiKayitError).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleNew = () => {
    setForm(EMPTY);
    setMahalleler([]);
    setError(null);
    setDone(null);
  };

  const native = { native: true };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#f3f5f9', py: { xs: 0, sm: 4 } }}>
      <Container maxWidth="sm" disableGutters sx={{ px: { xs: 0, sm: 2 } }}>
        <Paper elevation={0} sx={{ borderRadius: { xs: 0, sm: 2 }, overflow: 'hidden', border: { sm: '1px solid #dfe3ec' } }}>
          <Box sx={{ bgcolor: '#0D3282', color: 'white', px: 2.5, py: 2 }}>
            <Typography variant="overline" sx={{ opacity: 0.8, letterSpacing: 1.2 }}>
              Teknik Servis
            </Typography>
            <Typography variant="h6" component="h1" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
              Servis Kayıt Formu
            </Typography>
            {data && (
              <Typography variant="body2" sx={{ mt: 0.5, opacity: 0.9 }}>
                Bayi: <strong>{data.bayi}</strong>
              </Typography>
            )}
          </Box>

          <Box sx={{ p: 2.5 }}>
            {loadError ? (
              <Alert severity="error">{loadError}</Alert>
            ) : !data ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                <CircularProgress />
              </Box>
            ) : done !== null ? (
              <Box sx={{ textAlign: 'center', py: 4 }}>
                <CheckCircle sx={{ fontSize: 64, color: 'success.main' }} />
                <Typography variant="h6" sx={{ mt: 1, fontWeight: 700 }}>
                  Kaydınız alındı
                </Typography>
                <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                  Kayıt numarası: <strong>{done}</strong>
                </Typography>
                <Button variant="contained" onClick={handleNew} sx={{ mt: 3, bgcolor: '#0D3282', '&:hover': { bgcolor: '#082052' } }}>
                  YENİ KAYIT GİR
                </Button>
              </Box>
            ) : (
              <Box component="form" onSubmit={handleSubmit} noValidate>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Müşteri
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12}>
                    <TextField label="Ad Soyad" required fullWidth value={form.ad_soyad} onChange={set('ad_soyad')} autoComplete="off" inputProps={{ maxLength: 100 }} />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField label="Cep Telefonu" required fullWidth type="tel" placeholder="05XX XXX XX XX" value={form.cep_tel} onChange={set('cep_tel')} inputProps={{ inputMode: 'numeric', maxLength: 16 }} />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField label="Yedek Telefon" fullWidth type="tel" value={form.yedek_tel} onChange={set('yedek_tel')} inputProps={{ inputMode: 'numeric', maxLength: 16 }} />
                  </Grid>
                </Grid>

                <Divider sx={{ my: 2.5 }} />
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Adres
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <TextField select label="İlçe" required fullWidth value={form.ilce} onChange={handleIlce} SelectProps={native} InputLabelProps={{ shrink: true }}>
                      <option value="">Seçin</option>
                      {data.ilceler.map((ilce) => (
                        <option key={ilce.ilce_id} value={ilce.isim}>{ilce.isim}</option>
                      ))}
                    </TextField>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField select label="Mahalle" required fullWidth value={form.mahalle} onChange={set('mahalle')} SelectProps={native} InputLabelProps={{ shrink: true }} disabled={!form.ilce || mahalleLoading}>
                      <option value="">{mahalleLoading ? 'Yükleniyor...' : form.ilce ? 'Seçin' : 'Önce ilçe seçin'}</option>
                      {mahalleler.map((mahalle) => (
                        <option key={mahalle} value={mahalle}>{mahalle}</option>
                      ))}
                    </TextField>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField label="Cadde" fullWidth value={form.cadde} onChange={set('cadde')} inputProps={{ maxLength: 100 }} helperText="Cadde ya da sokaktan en az biri" />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField label="Sokak" fullWidth value={form.sokak} onChange={set('sokak')} inputProps={{ maxLength: 100 }} />
                  </Grid>
                  <Grid item xs={6}>
                    <TextField label="Kapı No" required fullWidth value={form.kapi_no} onChange={set('kapi_no')} inputProps={{ maxLength: 20 }} />
                  </Grid>
                  <Grid item xs={6}>
                    <TextField label="Daire No" required fullWidth value={form.daire_no} onChange={set('daire_no')} inputProps={{ maxLength: 20 }} />
                  </Grid>
                  <Grid item xs={8}>
                    <TextField label="Apartman / Site" fullWidth value={form.apartman_site} onChange={set('apartman_site')} inputProps={{ maxLength: 100 }} />
                  </Grid>
                  <Grid item xs={4}>
                    <TextField label="Blok" fullWidth value={form.blok_no} onChange={set('blok_no')} inputProps={{ maxLength: 20 }} />
                  </Grid>
                </Grid>

                <Divider sx={{ my: 2.5 }} />
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Ürün
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <TextField select label="Ürün" required fullWidth value={form.urun} onChange={set('urun')} SelectProps={native} InputLabelProps={{ shrink: true }}>
                      <option value="">Seçin</option>
                      {data.urunler.map((urun) => (
                        <option key={urun} value={urun}>{urun}</option>
                      ))}
                    </TextField>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField select label="Marka" required fullWidth value={form.marka} onChange={set('marka')} SelectProps={native} InputLabelProps={{ shrink: true }}>
                      <option value="">Seçin</option>
                      {data.markalar.map((marka) => (
                        <option key={marka} value={marka}>{marka}</option>
                      ))}
                    </TextField>
                  </Grid>
                  <Grid item xs={12}>
                    <TextField label="Şikayet" required fullWidth multiline minRows={3} value={form.sikayet} onChange={set('sikayet')} inputProps={{ maxLength: 1000 }} placeholder="Arıza ya da istenen işlem" />
                  </Grid>
                </Grid>

                {error && (
                  <Alert severity="error" sx={{ mt: 2 }} role="alert">
                    {error}
                  </Alert>
                )}
                <Button
                  type="submit"
                  variant="contained"
                  fullWidth
                  size="large"
                  disabled={submitting}
                  startIcon={submitting ? <CircularProgress size={18} color="inherit" /> : <Send />}
                  sx={{ mt: 2.5, py: 1.4, fontWeight: 700, bgcolor: '#0D3282', '&:hover': { bgcolor: '#082052' } }}
                >
                  KAYDI GÖNDER
                </Button>
              </Box>
            )}
          </Box>
        </Paper>
      </Container>
    </Box>
  );
};

export default BayiKayitFormu;
