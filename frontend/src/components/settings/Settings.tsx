import React, { useState, useEffect } from 'react';
import {
  Box,
  Tabs,
  Tab,
  Paper,
  TextField,
  Button,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  Typography,
  Tooltip,
} from '@mui/material';
import { Edit, Add, Delete, Link as LinkIcon } from '@mui/icons-material';
import BayiLinkDialog from './BayiLinkDialog';
import { Teknisyen, Marka, Bayi, Montaj, Aksesuar, Urun } from '../../types';
import { teknisyenService } from '../../services/teknisyen.service';
import { markaService } from '../../services/marka.service';
import { bayiService } from '../../services/bayi.service';
import { urunService } from '../../services/urun.service';
import { montajService } from '../../services/montaj.service';
import { aksesuarService } from '../../services/aksesuar.service';
import { useSnackbar } from '../../context/SnackbarContext';
import { useAuth } from '../../context/AuthContext';

const Settings: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [tabValue, setTabValue] = useState(0);
  const [teknisyenler, setTeknisyenler] = useState<Teknisyen[]>([]);
  const [markalar, setMarkalar] = useState<Marka[]>([]);
  const [bayiler, setBayiler] = useState<Bayi[]>([]);
  // Kayıt linki penceresi açık olan bayi.
  const [linkBayi, setLinkBayi] = useState<{ id: number; isim: string } | null>(null);
  const [montajlar, setMontajlar] = useState<Montaj[]>([]);
  const [aksesuarlar, setAksesuarlar] = useState<Aksesuar[]>([]);
  const [urunler, setUrunler] = useState<Urun[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState('');
  const [editType, setEditType] = useState<'montaj' | 'aksesuar' | null>(null);
  const { showSnackbar } = useSnackbar();

  useEffect(() => {
    fetchData();
  }, [tabValue]);

  const fetchData = async () => {
    try {
      if (tabValue === 0) {
        setTeknisyenler(await teknisyenService.getAll());
      } else if (tabValue === 1) {
        setMarkalar(await markaService.getAll());
      } else if (tabValue === 2) {
        setBayiler(await bayiService.getAll());
      } else if (tabValue === 3) {
        setUrunler(await urunService.getAll());
      } else if (tabValue === 4) {
        // Montaj ve Aksesuarlar - iki tablo yan yana
        const [montajData, aksesuarData] = await Promise.all([
          montajService.getAll(),
          aksesuarService.getAll(),
        ]);
        setMontajlar(montajData);
        setAksesuarlar(aksesuarData);
      }
    } catch (err) {
      showSnackbar('Veri yüklenirken hata oluştu', 'error');
    }
  };

  const handleAdd = () => {
    setEditMode(false);
    setCurrentId(null);
    setInputValue('');
    setError('');
    setDialogOpen(true);
  };

  const handleEdit = (id: number, name: string) => {
    setEditMode(true);
    setCurrentId(id);
    setInputValue(name);
    setError('');
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!inputValue.trim()) {
      setError('İsim alanı boş bırakılamaz');
      return;
    }

    try {
      // Aktif tab'a göre uygun servisi seç
      let service: { create: (d: { isim: string }) => Promise<unknown>; update: (id: number, d: { isim: string }) => Promise<unknown> } | null = null;
      if (tabValue === 0) service = teknisyenService;
      else if (tabValue === 1) service = markaService;
      else if (tabValue === 2) service = bayiService;
      else if (tabValue === 3) service = urunService;
      else if (tabValue === 4) {
        service = editType === 'aksesuar' ? aksesuarService : montajService;
      }

      if (!service) {
        setError('Geçersiz sekme');
        return;
      }

      const payload = { isim: inputValue.trim() };
      if (editMode && currentId) {
        await service.update(currentId, payload);
        showSnackbar('Başarıyla güncellendi', 'success');
      } else {
        await service.create(payload);
        showSnackbar('Başarıyla eklendi', 'success');
      }

      setDialogOpen(false);
      setEditType(null);
      fetchData();
    } catch (err: any) {
      const message = err.response?.data?.message || 'Bir hata oluştu';
      setError(message);
      showSnackbar(message, 'error');
    }
  };

  const handleDelete = async (id: number, name: string, type: string) => {
    if (!window.confirm(`"${name}" kaydını silmek istediğinize emin misiniz?`)) {
      return;
    }

    try {
      let service: { delete: (id: number) => Promise<void> } | null = null;
      if (type === 'teknisyen') service = teknisyenService;
      else if (type === 'marka') service = markaService;
      else if (type === 'bayi') service = bayiService;
      else if (type === 'urun') service = urunService;
      else if (type === 'montaj') service = montajService;
      else if (type === 'aksesuar') service = aksesuarService;

      if (!service) {
        showSnackbar('Geçersiz tür', 'error');
        return;
      }

      await service.delete(id);
      showSnackbar('Başarıyla silindi', 'success');
      fetchData();
    } catch (err: any) {
      const message = err.response?.data?.message || 'Silme işlemi sırasında hata oluştu';
      showSnackbar(message, 'error');
    }
  };

  return (
    <Box sx={{ mt: 2 }}>
      <Paper elevation={3} sx={{ p: { xs: 2, sm: 3 } }}>
        <Tabs
          value={tabValue}
          onChange={(_, newValue) => setTabValue(newValue)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ 
            borderBottom: 1, 
            borderColor: 'divider', 
            mb: 3,
            '& .MuiTab-root': {
              minWidth: { xs: 'auto', sm: 120 },
              fontSize: { xs: '0.75rem', sm: '0.875rem' },
              px: { xs: 1, sm: 2 },
            }
          }}
        >
          <Tab label="Teknisyenler" />
          <Tab label="Markalar" />
          <Tab label="Bayiler" />
          <Tab label="Ürünler" />
          <Tab label="Montaj & Aksesuarlar" />
        </Tabs>

        <Box sx={{ mb: 2 }}>
          {tabValue === 4 ? (
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 2 }}>
              <Button
                variant="contained"
                startIcon={<Add />}
                onClick={() => {
                  setEditMode(false);
                  setCurrentId(null);
                  setInputValue('');
                  setError('');
                  setEditType('montaj');
                  setDialogOpen(true);
                }}
                fullWidth
                sx={{ 
                  backgroundColor: '#0D3282', 
                  '&:hover': { backgroundColor: '#082052' },
                  maxWidth: { sm: 'auto' }
                }}
              >
                Yeni Montaj Ekle
              </Button>
              <Button
                variant="contained"
                startIcon={<Add />}
                onClick={() => {
                  setEditMode(false);
                  setCurrentId(null);
                  setInputValue('');
                  setError('');
                  setEditType('aksesuar');
                  setDialogOpen(true);
                }}
                fullWidth
                sx={{ 
                  backgroundColor: '#0D8220', 
                  '&:hover': { backgroundColor: '#085210' },
                  maxWidth: { sm: 'auto' }
                }}
              >
                Yeni Aksesuar Ekle
              </Button>
            </Box>
          ) : (
            <Button
              variant="contained"
              startIcon={<Add />}
              onClick={handleAdd}
              fullWidth
              sx={{ 
                backgroundColor: '#0D3282', 
                '&:hover': { backgroundColor: '#082052' },
                maxWidth: { sm: 300 }
              }}
            >
              {tabValue === 0 ? 'Yeni Teknisyen Ekle' : 
               tabValue === 1 ? 'Yeni Marka Ekle' : 
               tabValue === 2 ? 'Yeni Bayi Ekle' : 
               tabValue === 3 ? 'Yeni Ürün Ekle' : 
               'Yeni Ekle'}
            </Button>
          )}
        </Box>

        <List>
          {tabValue === 0 ? (
            teknisyenler.length === 0 ? (
              <Alert severity="info">Henüz teknisyen eklenmedi</Alert>
            ) : (
              teknisyenler.map((tek) => (
                <ListItem key={tek.id} sx={{ border: '1px solid #e0e0e0', mb: 1, borderRadius: 1 }}>
                  <ListItemText primary={tek.isim} />
                  <ListItemSecondaryAction>
                    <IconButton onClick={() => handleEdit(tek.id, tek.isim)}>
                      <Edit />
                    </IconButton>
                    {isAdmin && (
                      <IconButton 
                        onClick={() => handleDelete(tek.id, tek.isim, 'teknisyen')}
                        sx={{ color: 'error.main' }}
                      >
                        <Delete />
                      </IconButton>
                    )}
                  </ListItemSecondaryAction>
                </ListItem>
              ))
            )
          ) : tabValue === 1 ? (
            markalar.length === 0 ? (
              <Alert severity="info">Henüz marka eklenmedi</Alert>
            ) : (
              markalar.map((marka) => (
                <ListItem key={marka.id} sx={{ border: '1px solid #e0e0e0', mb: 1, borderRadius: 1 }}>
                  <ListItemText primary={marka.isim} />
                  <ListItemSecondaryAction>
                    <IconButton onClick={() => handleEdit(marka.id, marka.isim)}>
                      <Edit />
                    </IconButton>
                    {isAdmin && (
                      <IconButton 
                        onClick={() => handleDelete(marka.id, marka.isim, 'marka')}
                        sx={{ color: 'error.main' }}
                      >
                        <Delete />
                      </IconButton>
                    )}
                  </ListItemSecondaryAction>
                </ListItem>
              ))
            )
          ) : tabValue === 2 ? (
            bayiler.length === 0 ? (
              <Alert severity="info">Henüz bayi eklenmedi</Alert>
            ) : (
              bayiler.map((bayi) => (
                <ListItem key={bayi.id} sx={{ border: '1px solid #e0e0e0', mb: 1, borderRadius: 1 }}>
                  <ListItemText primary={bayi.isim} />
                  <ListItemSecondaryAction>
                    {isAdmin && (
                      <Tooltip title="Bayiye gönderilecek kayıt linki">
                        <IconButton onClick={() => setLinkBayi({ id: bayi.id, isim: bayi.isim })} sx={{ color: '#0D3282' }}>
                          <LinkIcon />
                        </IconButton>
                      </Tooltip>
                    )}
                    <IconButton onClick={() => handleEdit(bayi.id, bayi.isim)}>
                      <Edit />
                    </IconButton>
                    {isAdmin && (
                      <IconButton 
                        onClick={() => handleDelete(bayi.id, bayi.isim, 'bayi')}
                        sx={{ color: 'error.main' }}
                      >
                        <Delete />
                      </IconButton>
                    )}
                  </ListItemSecondaryAction>
                </ListItem>
              ))
            )
          ) : tabValue === 3 ? (
            urunler.length === 0 ? (
              <Alert severity="info">Henüz ürün eklenmedi</Alert>
            ) : (
              urunler.map((urun) => (
                <ListItem key={urun.id} sx={{ border: '1px solid #e0e0e0', mb: 1, borderRadius: 1 }}>
                  <ListItemText primary={urun.isim} />
                  <ListItemSecondaryAction>
                    <IconButton onClick={() => handleEdit(urun.id, urun.isim)}>
                      <Edit />
                    </IconButton>
                    {isAdmin && (
                      <IconButton 
                        onClick={() => handleDelete(urun.id, urun.isim, 'urun')}
                        sx={{ color: 'error.main' }}
                      >
                        <Delete />
                      </IconButton>
                    )}
                  </ListItemSecondaryAction>
                </ListItem>
              ))
            )
          ) : tabValue === 4 ? (
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 3 }}>
              {/* Montaj Listesi */}
              <Box sx={{ flex: 1 }}>
                <Paper elevation={2} sx={{ p: 2, bgcolor: '#f5f5f5' }}>
                  <Typography variant="h6" sx={{ mb: 2, color: '#0D3282', fontWeight: 'bold', fontSize: { xs: '1.1rem', sm: '1.25rem' } }}>
                    Montaj
                  </Typography>
                  <List>
                    {montajlar.length === 0 ? (
                      <Alert severity="info">Henüz montaj eklenmedi</Alert>
                    ) : (
                      montajlar.map((montaj) => (
                        <ListItem key={montaj.id} sx={{ border: '1px solid #e0e0e0', mb: 1, borderRadius: 1, bgcolor: 'white' }}>
                          <ListItemText primary={montaj.isim} />
                          <ListItemSecondaryAction>
                            <IconButton 
                              onClick={() => {
                                setEditType('montaj');
                                handleEdit(montaj.id, montaj.isim);
                              }}
                            >
                              <Edit />
                            </IconButton>
                            {isAdmin && (
                              <IconButton 
                                onClick={() => handleDelete(montaj.id, montaj.isim, 'montaj')}
                                sx={{ color: 'error.main' }}
                              >
                                <Delete />
                              </IconButton>
                            )}
                          </ListItemSecondaryAction>
                        </ListItem>
                      ))
                    )}
                  </List>
                </Paper>
              </Box>

              {/* Aksesuarlar Listesi */}
              <Box sx={{ flex: 1 }}>
                <Paper elevation={2} sx={{ p: 2, bgcolor: '#f5f5f5' }}>
                  <Typography variant="h6" sx={{ mb: 2, color: '#0D8220', fontWeight: 'bold', fontSize: { xs: '1.1rem', sm: '1.25rem' } }}>
                    Aksesuarlar
                  </Typography>
                  <List>
                    {aksesuarlar.length === 0 ? (
                      <Alert severity="info">Henüz aksesuar eklenmedi</Alert>
                    ) : (
                      aksesuarlar.map((aksesuar) => (
                        <ListItem key={aksesuar.id} sx={{ border: '1px solid #e0e0e0', mb: 1, borderRadius: 1, bgcolor: 'white' }}>
                          <ListItemText primary={aksesuar.isim} />
                          <ListItemSecondaryAction>
                            <IconButton 
                              onClick={() => {
                                setEditType('aksesuar');
                                handleEdit(aksesuar.id, aksesuar.isim);
                              }}
                            >
                              <Edit />
                            </IconButton>
                            {isAdmin && (
                              <IconButton 
                                onClick={() => handleDelete(aksesuar.id, aksesuar.isim, 'aksesuar')}
                                sx={{ color: 'error.main' }}
                              >
                                <Delete />
                              </IconButton>
                            )}
                          </ListItemSecondaryAction>
                        </ListItem>
                      ))
                    )}
                  </List>
                </Paper>
              </Box>
            </Box>
          ) : null}
        </List>
      </Paper>

      <BayiLinkDialog bayi={linkBayi} onClose={() => setLinkBayi(null)} />

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editMode ? 'Düzenle' : 'Yeni Ekle'} - {
            tabValue === 0 ? 'Teknisyen' : 
            tabValue === 1 ? 'Marka' : 
            tabValue === 2 ? 'Bayi' : 
            tabValue === 3 ? 'Ürün' :
            editType === 'aksesuar' ? 'Aksesuar' : 'Montaj'
          }
        </DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <TextField
            autoFocus
            margin="dense"
            label={
              tabValue === 0 ? 'Teknisyen İsmi' : 
              tabValue === 1 ? 'Marka İsmi' : 
              tabValue === 2 ? 'Bayi İsmi' : 
              editType === 'aksesuar' ? 'Aksesuar İsmi' : 'Montaj İsmi'
            }
            fullWidth
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSave()}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setDialogOpen(false);
            setEditType(null);
          }}>İptal</Button>
          <Button onClick={handleSave} variant="contained" sx={{ backgroundColor: '#0D3282' }}>
            Kaydet
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Settings;
