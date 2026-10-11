import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import { ContentCopy } from '@mui/icons-material';
import { useSnackbar } from '../../context/SnackbarContext';
import { bayiKayitService } from '../../services/bayiKayit.service';

interface Props {
  /** Linki yönetilen bayi; null ise pencere kapalıdır. */
  bayi: { id: number; isim: string } | null;
  onClose: () => void;
}

/**
 * Bayinin kayıt linkini oluşturur, kopyalar, yeniler ya da iptal eder. Linki açan kişi
 * giriş yapmadan yeni işlem kaydı doldurabilir; bu yüzden link yalnızca o bayiye verilir.
 */
const BayiLinkDialog: React.FC<Props> = ({ bayi, onClose }) => {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const { showSnackbar } = useSnackbar();

  useEffect(() => {
    if (!bayi) return;
    setToken(null);
    setLoading(true);
    bayiKayitService
      .getLinks()
      .then((links) => setToken(links.find((link) => link.bayi_id === bayi.id)?.token ?? null))
      .catch(() => showSnackbar('Link bilgisi alınamadı!', 'error'))
      .finally(() => setLoading(false));
  }, [bayi, showSnackbar]);

  const url = token ? bayiKayitService.linkUrl(token) : '';

  const run = async (action: () => Promise<void>, failMessage: string) => {
    try {
      setWorking(true);
      await action();
    } catch (error: any) {
      showSnackbar(error?.response?.data?.message || failMessage, 'error');
    } finally {
      setWorking(false);
    }
  };

  const handleCreate = () => {
    if (!bayi) return;
    if (token && !window.confirm('Link yenilenirse bayiye daha önce gönderdiğiniz link ÇALIŞMAZ olur. Devam edilsin mi?')) return;
    run(async () => {
      setToken(await bayiKayitService.createLink(bayi.id));
      showSnackbar(token ? 'Link yenilendi; eski link artık çalışmıyor.' : 'Link oluşturuldu.', 'success');
    }, 'Link oluşturulamadı!');
  };

  const handleRevoke = () => {
    if (!bayi) return;
    if (!window.confirm(`${bayi.isim} için link iptal edilsin mi? Bayi bu linkle artık kayıt açamaz.`)) return;
    run(async () => {
      await bayiKayitService.revokeLink(bayi.id);
      setToken(null);
      showSnackbar('Link iptal edildi.', 'success');
    }, 'Link iptal edilemedi!');
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      showSnackbar('Link kopyalandı.', 'success');
    } catch {
      showSnackbar('Kopyalanamadı; linki elle seçip kopyalayın.', 'warning');
    }
  };

  return (
    <Dialog open={bayi !== null} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Kayıt Linki — {bayi?.isim}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Bu linki bayiye gönderin. Bayi linki açıp müşteri bilgilerini doldurur; kayıt giriş
          yapmadan doğrudan ana sayfadaki listeye düşer ve bu bayiden geldiği görünür.
        </Typography>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={28} />
          </Box>
        ) : token ? (
          <>
            <TextField
              fullWidth
              size="small"
              label="Bayiye gönderilecek link"
              value={url}
              InputProps={{ readOnly: true }}
              onFocus={(event) => event.target.select()}
            />
            <Button startIcon={<ContentCopy />} onClick={handleCopy} variant="contained" sx={{ mt: 1.5, bgcolor: '#0D3282', '&:hover': { bgcolor: '#082052' } }}>
              LİNKİ KOPYALA
            </Button>
            <Alert severity="warning" sx={{ mt: 2 }}>
              Linki elinde bulunduran herkes bu bayi adına kayıt açabilir. Link başkasının eline
              geçtiyse yenileyin ya da iptal edin.
            </Alert>
          </>
        ) : (
          <Alert severity="info">Bu bayinin henüz kayıt linki yok.</Alert>
        )}
      </DialogContent>
      <DialogActions>
        {token && (
          <Button color="error" onClick={handleRevoke} disabled={working} sx={{ mr: 'auto' }}>
            İptal Et
          </Button>
        )}
        <Button onClick={handleCreate} disabled={loading || working}>
          {token ? 'Yenile' : 'Link Oluştur'}
        </Button>
        <Button onClick={onClose}>Kapat</Button>
      </DialogActions>
    </Dialog>
  );
};

export default BayiLinkDialog;
