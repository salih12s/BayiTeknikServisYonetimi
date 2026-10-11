import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  TextField,
  Card,
  CardContent,
  CardMedia,
  CardActions,
  Grid,
  IconButton,
  InputAdornment,
  Chip,
  Alert,
  Tooltip,
  CircularProgress,
  Pagination,
} from '@mui/material';
import {
  Add,
  Search,
  Delete,
  Edit,
  PhotoCamera,
  Person,
  CalendarToday,
  FilterList,
  Refresh,
  Today,
} from '@mui/icons-material';
import { useSnackbar } from '../../context/SnackbarContext';
import { sahaService } from '../../services/saha.service';
import { SahaKayit } from '../../types';
import { useAuth } from '../../context/AuthContext';
import SahaKayitDialog from './SahaKayitDialog';
import PhotoLoadingOverlay from './PhotoLoadingOverlay';
import ImageGalleryDialog from './ImageGalleryDialog';
import { SahaPhoto } from '../../utils/sahaPhoto';
import { useSahaPhotoCache } from '../../hooks/useSahaPhotoCache';
import { buildKayitFallbackName } from './sahaPhotoName';

const PAGE_SIZE = 50;

const SahaPanel: React.FC = () => {
  const [kayitlar, setKayitlar] = useState<SahaKayit[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDialog, setOpenDialog] = useState(false);
  const [editingKayit, setEditingKayit] = useState<SahaKayit | null>(null);
  const [dialogInitialPhotos, setDialogInitialPhotos] = useState<SahaPhoto[]>([]);
  const [searchText, setSearchText] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [todayFilter, setTodayFilter] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // Pagination + stats
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [totalStats, setTotalStats] = useState<{ toplam: number; bugun: number }>({ toplam: 0, bugun: 0 });

  // Fotoğraf galeri state
  const [selectedPhotos, setSelectedPhotos] = useState<SahaPhoto[]>([]);
  const [selectedFallbackName, setSelectedFallbackName] = useState('fotograf');
  const [photoLoading, setPhotoLoading] = useState(false);
  const photoCache = useSahaPhotoCache();
  // Önizleme adresi açılamayan (ör. süresi dolmuş) kayıtlar: simgeye düşülür.
  const [brokenPreviews, setBrokenPreviews] = useState<Set<number>>(new Set());

  const { showSnackbar } = useSnackbar();
  const { user } = useAuth();

  const loadKayitlar = useCallback(async (page = 1, overrides?: { search?: string; startDate?: string; endDate?: string; today?: boolean }) => {
    try {
      setLoading(true);
      const params: any = { page, limit: PAGE_SIZE };
      const s = overrides?.search !== undefined ? overrides.search : searchText;
      const sd = overrides?.startDate !== undefined ? overrides.startDate : startDate;
      const ed = overrides?.endDate !== undefined ? overrides.endDate : endDate;
      const td = overrides?.today !== undefined ? overrides.today : todayFilter;
      if (s) params.search = s;
      if (sd) params.startDate = sd;
      if (ed) params.endDate = ed;
      if (td) params.today = true;
      const resp = await sahaService.getKayitlar(params);
      setKayitlar(resp.data);
      setBrokenPreviews(new Set());
      setCurrentPage(resp.pagination.page);
      setTotalPages(resp.pagination.totalPages);
      setTotalRecords(resp.pagination.total);
      setTotalStats(resp.stats);
    } catch (error: any) {
      console.error('Kayıtlar yüklenirken hata:', error);
      showSnackbar(error?.response?.data?.message || 'Kayıtlar yüklenirken hata oluştu!', 'error');
    } finally {
      setLoading(false);
    }
  }, [searchText, startDate, endDate, todayFilter, showSnackbar]);

  useEffect(() => {
    loadKayitlar(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = () => {
    loadKayitlar(1);
  };

  const handleClearFilters = () => {
    setSearchText('');
    setStartDate('');
    setEndDate('');
    setTodayFilter(false);
    loadKayitlar(1, { search: '', startDate: '', endDate: '', today: false });
  };

  const handleToggleToday = () => {
    const next = !todayFilter;
    setTodayFilter(next);
    loadKayitlar(1, { today: next });
  };

  const handleOpenDialog = async (kayit?: SahaKayit) => {
    if (kayit) {
      let fotolar: SahaPhoto[] = [];
      if (kayit.has_photos) {
        try {
          fotolar = await photoCache.load(kayit.id);
        } catch {
          // Fotoğraflar okunamadan form açılırsa mevcut fotoğraflar boş görünür ve
          // kaydederken silinebilir; bu yüzden form hiç açılmaz.
          showSnackbar('Fotoğraflar yüklenemedi, kayıt düzenlenemiyor. Lütfen tekrar deneyin.', 'error');
          return;
        }
      }
      setEditingKayit(kayit);
      setDialogInitialPhotos(fotolar);
    } else {
      setEditingKayit(null);
      setDialogInitialPhotos([]);
    }
    setOpenDialog(true);
  };

  const handleCloseDialog = useCallback(() => {
    setOpenDialog(false);
    setEditingKayit(null);
    setDialogInitialPhotos([]);
  }, []);

  const handleDialogSaved = useCallback(() => {
    setOpenDialog(false);
    setEditingKayit(null);
    setDialogInitialPhotos([]);
    loadKayitlar(currentPage);
  }, [loadKayitlar, currentPage]);

  const handlePhotosChanged = photoCache.invalidate;

  const handleDelete = async (kayit: SahaKayit) => {
    if (!window.confirm(`${kayit.isim} ${kayit.soyisim} kaydını silmek istediğinize emin misiniz?`)) {
      return;
    }

    try {
      await sahaService.deleteKayit(kayit.id);
      photoCache.invalidate(kayit.id);
      showSnackbar('Kayıt başarıyla silindi!', 'success');
      loadKayitlar(currentPage);
    } catch (error: any) {
      console.error('Kayıt silinirken hata:', error);
      showSnackbar('Kayıt silinirken hata oluştu!', 'error');
    }
  };

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      {/* Header */}
      <Box sx={{ 
        display: 'flex', 
        flexDirection: { xs: 'column', sm: 'row' },
        justifyContent: 'space-between', 
        alignItems: { xs: 'stretch', sm: 'center' }, 
        mb: 3,
        gap: 2
      }}>
        <Box>
          <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' }, color: '#2C3E82' }}>
            Saha Kayıtları
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Hoşgeldin, {user?.ad_soyad || user?.username}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button
            variant={todayFilter ? 'contained' : 'outlined'}
            startIcon={<Today />}
            onClick={handleToggleToday}
            size="small"
            color={todayFilter ? 'success' : 'primary'}
            sx={!todayFilter ? {
              borderColor: '#0D3282',
              color: '#0D3282',
              '&:hover': { borderColor: '#082052', bgcolor: 'rgba(13, 50, 130, 0.04)' }
            } : undefined}
          >
            BUGÜN
          </Button>
          <Button
            variant="outlined"
            startIcon={<FilterList />}
            onClick={() => setShowFilters(!showFilters)}
            size="small"
            sx={{
              borderColor: '#0D3282',
              color: '#0D3282',
              '&:hover': {
                borderColor: '#082052',
                bgcolor: 'rgba(13, 50, 130, 0.04)',
              }
            }}
          >
            FİLTRELE
          </Button>
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => handleOpenDialog()}
            sx={{ bgcolor: '#0D3282', '&:hover': { bgcolor: '#082052' } }}
          >
            YENİ KAYIT
          </Button>
        </Box>
      </Box>

      {/* Filters */}
      {showFilters && (
        <Paper sx={{ p: 2, mb: 3 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                size="small"
                placeholder="İsim veya soyisim ara..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <Search />
                    </InputAdornment>
                  ),
                }}
              />
            </Grid>
            <Grid item xs={6} sm={2.5}>
              <TextField
                fullWidth
                size="small"
                type="date"
                label="Başlangıç"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={6} sm={2.5}>
              <TextField
                fullWidth
                size="small"
                type="date"
                label="Bitiş"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} sm={3}>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                  variant="contained"
                  onClick={handleSearch}
                  size="small"
                  sx={{ bgcolor: '#0D3282', '&:hover': { bgcolor: '#082052' } }}
                >
                  ARA
                </Button>
                <Button
                  variant="outlined"
                  onClick={handleClearFilters}
                  size="small"
                  startIcon={<Refresh />}
                  sx={{
                    borderColor: '#0D3282',
                    color: '#0D3282',
                    '&:hover': {
                      borderColor: '#082052',
                      bgcolor: 'rgba(13, 50, 130, 0.04)',
                    }
                  }}
                >
                  TEMİZLE
                </Button>
              </Box>
            </Grid>
          </Grid>
        </Paper>
      )}

      {/* Stats */}
      <Box sx={{ mb: 3, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Chip
          label={`Toplam Kayıtlarım: ${totalStats.toplam}`}
          color="primary"
          variant="outlined"
        />
        <Chip
          label={`Bugünkü Kayıtlarım: ${totalStats.bugun}`}
          color="success"
          variant={todayFilter ? 'filled' : 'outlined'}
          onClick={handleToggleToday}
          sx={{ cursor: 'pointer' }}
        />
        {(searchText || startDate || endDate || todayFilter) && (
          <Chip
            label={`Filtreli Sonuç: ${totalRecords}`}
            color="info"
            variant="outlined"
          />
        )}
      </Box>

      {/* Loading */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : kayitlar.length === 0 ? (
        <Alert severity="info" sx={{ mt: 2 }}>
          Henüz kayıt bulunmuyor. "Yeni Kayıt" butonuna tıklayarak ilk kaydınızı ekleyin.
        </Alert>
      ) : (
        /* Cards Grid */
        <Grid container spacing={2}>
          {kayitlar.map((kayit) => {
            const hasPhotos = kayit.has_photos;
            const fotoPreview = brokenPreviews.has(kayit.id) ? undefined : kayit.foto_preview;
            
            const handleViewPhotos = async (e: React.MouseEvent) => {
              e.stopPropagation();
              if (!hasPhotos && !fotoPreview) return;
              setSelectedFallbackName(buildKayitFallbackName(kayit));
              try {
                setPhotoLoading(true);
                setSelectedPhotos(await photoCache.load(kayit.id));
              } catch {
                showSnackbar('Fotoğraflar yüklenirken hata oluştu!', 'error');
              } finally {
                setPhotoLoading(false);
              }
            };
            
            return (
            <Grid item xs={12} sm={6} md={4} lg={3} key={kayit.id}>
              <Card sx={{ 
                height: '100%', 
                display: 'flex', 
                flexDirection: 'column',
                transition: 'transform 0.2s, box-shadow 0.2s',
                cursor: (hasPhotos || fotoPreview) ? 'pointer' : 'default',
                '&:hover': {
                  transform: 'translateY(-4px)',
                  boxShadow: 4,
                }
              }}
              onClick={handleViewPhotos}
              >
                {fotoPreview ? (
                  <Box sx={{ position: 'relative' }}>
                    <CardMedia
                      component="img"
                      height="200"
                      image={fotoPreview}
                      loading="lazy"
                      onError={() => setBrokenPreviews(prev => new Set(prev).add(kayit.id))}
                      alt={`${kayit.isim} ${kayit.soyisim}`}
                      sx={{ objectFit: 'cover' }}
                    />
                    <Box sx={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      bgcolor: 'rgba(0,0,0,0.5)',
                      color: 'white',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 0.5,
                      py: 0.5,
                    }}>
                      <PhotoCamera sx={{ fontSize: 16 }} />
                      <Typography variant="caption">Fotoğrafları Görüntüle</Typography>
                    </Box>
                  </Box>
                ) : hasPhotos ? (
                  <Box 
                    sx={{ 
                      height: 200, 
                      display: 'flex', 
                      flexDirection: 'column',
                      alignItems: 'center', 
                      justifyContent: 'center',
                      bgcolor: '#e3f2fd',
                      '&:hover': { bgcolor: '#bbdefb' },
                    }}
                  >
                    <PhotoCamera sx={{ fontSize: 60, color: '#1976d2' }} />
                    <Typography variant="caption" sx={{ mt: 1, color: '#1976d2', fontWeight: 500 }}>
                      Fotoğrafları Görüntüle
                    </Typography>
                  </Box>
                ) : (
                  <Box
                    sx={{
                      height: 200,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      bgcolor: '#f5f5f5',
                    }}
                  >
                    <Person sx={{ fontSize: 80, color: '#ccc' }} />
                  </Box>
                )}
                <CardContent sx={{ flexGrow: 1 }}>
                  <Typography variant="h6" component="div" gutterBottom>
                    {kayit.isim} {kayit.soyisim}
                  </Typography>
                  {kayit.notlar && (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      {kayit.notlar.length > 100 ? kayit.notlar.substring(0, 100) + '...' : kayit.notlar}
                    </Typography>
                  )}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1 }}>
                    <CalendarToday sx={{ fontSize: 14, color: 'text.secondary' }} />
                    <Typography variant="caption" color="text.secondary">
                      {new Date(kayit.created_at).toLocaleString('tr-TR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </Typography>
                  </Box>
                </CardContent>
                <CardActions sx={{ justifyContent: 'flex-end', pt: 0 }} onClick={(e) => e.stopPropagation()}>
                  <Tooltip title="Düzenle">
                    <IconButton size="small" color="primary" onClick={(e) => { e.stopPropagation(); handleOpenDialog(kayit); }}>
                      <Edit />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Sil">
                    <IconButton size="small" color="error" onClick={(e) => { e.stopPropagation(); handleDelete(kayit); }}>
                      <Delete />
                    </IconButton>
                  </Tooltip>
                </CardActions>
              </Card>
            </Grid>
          );
          })}
        </Grid>
      )}

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
          <Pagination
            count={totalPages}
            page={currentPage}
            onChange={(_, value) => loadKayitlar(value)}
            color="primary"
            size="medium"
          />
        </Box>
      )}

      {/* Add/Edit Dialog (extracted for performance) */}
      <SahaKayitDialog
        open={openDialog}
        editingKayit={editingKayit}
        initialPhotos={dialogInitialPhotos}
        onClose={handleCloseDialog}
        onSaved={handleDialogSaved}
        onPhotosChanged={handlePhotosChanged}
      />

      <PhotoLoadingOverlay open={photoLoading} />
      <ImageGalleryDialog
        photos={selectedPhotos}
        fallbackName={selectedFallbackName}
        onClose={() => setSelectedPhotos([])}
      />
    </Box>
  );
};

export default SahaPanel;
