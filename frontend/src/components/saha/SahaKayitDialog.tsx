import React, { useState, useEffect, useRef, memo } from 'react';
import {
  Box,
  Button,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Typography,
  CircularProgress,
} from '@mui/material';
import { Close, PhotoCamera } from '@mui/icons-material';
import { sahaService } from '../../services/saha.service';
import { SahaKayit, SahaKayitCreateDto } from '../../types';
import { useSnackbar } from '../../context/SnackbarContext';
import { SahaPhoto } from '../../utils/sahaPhoto';
import {
  MAX_PHOTOS,
  MAX_SOURCE_BYTES,
  PhotoPrepareError,
  pendingPhoto,
  preparePhoto,
  readIntoMemory,
  releasePendingPhoto,
  resolvePhotoIds,
} from '../../utils/sahaPhotoUpload';

interface Props {
  open: boolean;
  editingKayit: SahaKayit | null;
  initialPhotos: SahaPhoto[];
  onClose: () => void;
  onSaved: () => void;
  /** Kaydın fotoğrafları değişti; çağıran sakladığı listeyi atmalıdır. */
  onPhotosChanged: (id: number) => void;
}

const SahaKayitDialog: React.FC<Props> = ({ open, editingKayit, initialPhotos, onClose, onSaved, onPhotosChanged }) => {
  const [formIsim, setFormIsim] = useState('');
  const [formSoyisim, setFormSoyisim] = useState('');
  const [formNotlar, setFormNotlar] = useState('');
  const [formFotolar, setFormFotolar] = useState<SahaPhoto[]>([]);
  // Düzenlemede fotoğraf listesine dokunulmadıysa sunucuya hiç gönderilmez.
  const [photosDirty, setPhotosDirty] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  // Kaydetme başarısız olup yeniden denenirse yüklenmiş fotoğraf ikinci kez yüklenmez.
  const uploadedRef = useRef(new Map<SahaPhoto, number>());
  const fotolarRef = useRef<SahaPhoto[]>([]);
  fotolarRef.current = formFotolar;
  const { showSnackbar } = useSnackbar();

  // Dialog her açıldığında form yeniden doldurulur. Bu, effect içinde değil çizim
  // sırasında yapılır: effect çizimden SONRA çalışır ve form ilk karede bir önceki
  // açılışın içeriğini (o arada serbest bırakılmış önizleme adresleriyle) gösterirdi.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setFormIsim(editingKayit?.isim ?? '');
      setFormSoyisim(editingKayit?.soyisim ?? '');
      setFormNotlar(editingKayit?.notlar || '');
      setFormFotolar(editingKayit ? initialPhotos || [] : []);
      setPhotosDirty(false);
    }
  }

  useEffect(() => {
    if (open) uploadedRef.current = new Map();
  }, [open]);

  // Seçilmiş dosyalar için açılan geçici (blob:) adresler, form tamamen kapandıktan
  // (kapanış animasyonu bittikten) sonra ve sayfadan çıkılırken serbest bırakılır.
  const releasePendingPhotos = () => fotolarRef.current.forEach(releasePendingPhoto);
  useEffect(() => () => fotolarRef.current.forEach(releasePendingPhoto), []);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
    if (files.length === 0) return;
    if (formFotolar.length + files.length > MAX_PHOTOS) {
      showSnackbar(`Maksimum ${MAX_PHOTOS} fotoğraf yükleyebilirsiniz!`, 'warning');
      return;
    }

    const newPhotos: SahaPhoto[] = [];
    const failures: Array<{ name: string; reason: string }> = [];
    const failMessage = (error: unknown) =>
      error instanceof PhotoPrepareError ? error.message : 'Fotoğraf eklenemedi. Lütfen yeniden deneyin.';
    setPreparing(true);
    try {
      // Önce bütün dosyalar HEMEN belleğe alınır (bkz. readIntoMemory): telefondaki dosya
      // sonradan okunamaz hale gelebilir; küçültme sırası beklenirse geç kalınır.
      const sources = await Promise.all(
        files.map(async (file) => {
          if (file.size > MAX_SOURCE_BYTES) {
            failures.push({ name: file.name, reason: `${Math.round(MAX_SOURCE_BYTES / 1024 / 1024)} MB'tan büyük` });
            return null;
          }
          try {
            return { file, memory: await readIntoMemory(file) };
          } catch (error) {
            failures.push({ name: file.name, reason: failMessage(error) });
            return null;
          }
        })
      );

      for (const source of sources) {
        if (!source) continue;
        try {
          // Orijinal dosya adını sakla — indirirken aynı isimle gelmesi için.
          // (Kamera ile çekilen fotoğraflarda tarayıcı genelde "image.jpg" gibi
          // jenerik bir ad verir; o durumda indirme adı kayıttan üretilir.)
          newPhotos.push(pendingPhoto(await preparePhoto(source.memory), source.file.name || undefined));
        } catch (error) {
          failures.push({ name: source.file.name, reason: failMessage(error) });
        }
      }
    } finally {
      setPreparing(false);
    }

    if (newPhotos.length > 0) {
      setFormFotolar(prev => [...prev, ...newPhotos]);
      setPhotosDirty(true);
    }
    // Bildirim alanı tek mesaj gösterir: atlanan dosyalar ayrı mesajla bildirilirse
    // hemen ardından gelen "eklendi" mesajı onu siler ve kullanıcı atlananı görmez.
    if (failures.length > 0 && newPhotos.length === 0 && failures.length === 1) {
      // Tek fotoğraf (kamerayla çekim) eklenemedi: sebep ve ne yapılacağı açıkça söylenir.
      showSnackbar(failures[0].reason, 'error');
    } else if (failures.length > 0) {
      const list = failures.map((f) => `${f.name || 'fotoğraf'} (${f.reason})`).join(', ');
      showSnackbar(
        `${newPhotos.length} fotoğraf eklendi. Eklenemeyen: ${list}`,
        newPhotos.length > 0 ? 'warning' : 'error'
      );
    } else if (newPhotos.length > 0) {
      showSnackbar(`${newPhotos.length} fotoğraf eklendi!`, 'success');
    }
  };

  const handleRemovePhoto = (index: number) => {
    const removed = formFotolar[index];
    if (removed) releasePendingPhoto(removed);
    setFormFotolar(prev => prev.filter((_, i) => i !== index));
    setPhotosDirty(true);
  };

  const handleSubmit = async () => {
    if (!formIsim.trim() || !formSoyisim.trim()) {
      showSnackbar('İsim ve soyisim zorunludur!', 'warning');
      return;
    }
    try {
      setFormSubmitting(true);
      const data: SahaKayitCreateDto = {
        isim: formIsim.trim(),
        soyisim: formSoyisim.trim(),
        notlar: formNotlar.trim() || undefined,
      };

      const sendPhotos = editingKayit ? photosDirty : formFotolar.length > 0;
      if (sendPhotos) {
        try {
          data.foto_ids = await resolvePhotoIds(formFotolar, uploadedRef.current, (done, total) =>
            setUploadProgress({ done, total })
          );
        } catch (error: any) {
          console.error('Fotoğraf yüklenirken hata:', error);
          showSnackbar(
            error.response?.data?.message ||
              'Fotoğraflar yüklenemedi. İnternet bağlantınızı kontrol edip tekrar deneyin.',
            'error'
          );
          return;
        }
      }

      if (editingKayit) {
        await sahaService.updateKayit(editingKayit.id, data);
        if (sendPhotos) onPhotosChanged(editingKayit.id);
        showSnackbar('Kayıt başarıyla güncellendi!', 'success');
      } else {
        await sahaService.createKayit(data);
        showSnackbar('Kayıt başarıyla eklendi!', 'success');
      }
      onSaved();
    } catch (error: any) {
      console.error('Kayıt kaydedilirken hata:', error);
      // Sunucu fotoğrafları kabul etmediyse (ör. yüklemenin süresi dolmuş) bir sonraki
      // denemede yeniden yüklensinler.
      const status = error.response?.status;
      if (status === 400 || status === 409) uploadedRef.current = new Map();
      showSnackbar(error.response?.data?.message || 'Kayıt kaydedilirken hata oluştu!', 'error');
    } finally {
      setFormSubmitting(false);
      setUploadProgress(null);
    }
  };

  const busy = formSubmitting || preparing;
  const handleClose = () => {
    if (!formSubmitting) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      keepMounted={false}
      TransitionProps={{ onExited: releasePendingPhotos }}
    >
      <DialogTitle>
        {editingKayit ? 'Kaydı Düzenle' : 'Yeni Kayıt Ekle'}
        <IconButton onClick={handleClose} disabled={formSubmitting} sx={{ position: 'absolute', right: 8, top: 8 }}>
          <Close />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ mt: 2 }}>
          <Box sx={{ textAlign: 'center', mb: 3, p: 2, border: '2px dashed #ccc', borderRadius: 2, bgcolor: '#fafafa' }}>
            {formFotolar.length > 0 ? (
              <Box sx={{ mb: 2 }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  {formFotolar.length}/{MAX_PHOTOS} fotoğraf eklendi
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, justifyContent: 'center' }}>
                  {formFotolar.map((foto, index) => (
                    <Box key={index} sx={{ position: 'relative', display: 'inline-block' }}>
                      <img
                        src={foto.thumbUrl}
                        alt={foto.name || `Preview ${index + 1}`}
                        title={foto.name}
                        style={{ width: 80, height: 80, borderRadius: 8, objectFit: 'cover', border: '1px solid #ddd' }}
                      />
                      <IconButton
                        size="small"
                        onClick={() => handleRemovePhoto(index)}
                        disabled={formSubmitting}
                        sx={{ position: 'absolute', top: -8, right: -8, bgcolor: 'error.main', color: 'white', padding: 0.3, '&:hover': { bgcolor: 'error.dark' } }}
                      >
                        <Close sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Box>
                  ))}
                </Box>
              </Box>
            ) : (
              <>
                <PhotoCamera sx={{ fontSize: 48, color: '#ccc', mb: 1 }} />
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Fotoğraf yüklemek için aşağıdaki butonları kullanın (maks. {MAX_PHOTOS} adet)
                </Typography>
              </>
            )}

            <input type="file" accept="image/*" capture="environment" ref={cameraInputRef} onChange={handleFileSelect} style={{ display: 'none' }} />
            <input type="file" accept="image/*" multiple ref={fileInputRef} onChange={handleFileSelect} style={{ display: 'none' }} />

            {formFotolar.length < MAX_PHOTOS && (
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'center', mt: 1 }}>
                <Button
                  variant="contained"
                  color="primary"
                  startIcon={preparing ? <CircularProgress size={18} color="inherit" /> : <PhotoCamera />}
                  onClick={() => cameraInputRef.current?.click()}
                  disabled={busy}
                  sx={{ minWidth: 150, py: 1.5, fontSize: '1rem', fontWeight: 600 }}
                >
                  KAMERA AÇ
                </Button>
                <Button variant="outlined" onClick={() => fileInputRef.current?.click()} disabled={busy} sx={{ minWidth: 120 }}>
                  Galeriden Seç
                </Button>
              </Box>
            )}
          </Box>

          <TextField
            autoFocus
            fullWidth
            label="İsim"
            value={formIsim}
            onChange={(e) => setFormIsim(e.target.value)}
            sx={{ mb: 2 }}
            required
          />
          <TextField
            fullWidth
            label="Soyisim"
            value={formSoyisim}
            onChange={(e) => setFormSoyisim(e.target.value)}
            sx={{ mb: 2 }}
            required
          />
          <TextField
            fullWidth
            label="Notlar"
            value={formNotlar}
            onChange={(e) => setFormNotlar(e.target.value)}
            multiline
            rows={3}
            placeholder="Opsiyonel notlar..."
          />
        </Box>
      </DialogContent>
      <DialogActions>
        {uploadProgress && (
          <Typography variant="body2" color="text.secondary" sx={{ mr: 'auto', ml: 2 }}>
            Fotoğraflar yükleniyor {uploadProgress.done}/{uploadProgress.total}
          </Typography>
        )}
        <Button onClick={handleClose} disabled={formSubmitting}>İptal</Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={busy}
          sx={{ bgcolor: '#0D3282', '&:hover': { bgcolor: '#082052' } }}
        >
          {formSubmitting ? <CircularProgress size={20} /> : (editingKayit ? 'Güncelle' : 'Kaydet')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default memo(SahaKayitDialog);
