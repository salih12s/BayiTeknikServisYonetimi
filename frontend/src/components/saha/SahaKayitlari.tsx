import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  Grid,
  Card,
  CardContent,
  InputAdornment,
  Chip,
  Alert,
  CircularProgress,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Collapse,
  Tooltip,
} from '@mui/material';
import {
  Search,
  Person,
  CalendarToday,
  FilterList,
  Refresh,
  ExpandMore,
  ExpandLess,
  PhotoCamera,
} from '@mui/icons-material';
import { useSnackbar } from '../../context/SnackbarContext';
import { sahaService } from '../../services/saha.service';
import { SahaKayit, SahaElemani } from '../../types';
import ImagePreviewDialog from './ImagePreviewDialog';
import { SahaPhoto } from '../../utils/sahaPhoto';
import { useSahaPhotoCache } from '../../hooks/useSahaPhotoCache';
import { buildKayitFallbackName } from './sahaPhotoName';
import PhotoLoadingOverlay from './PhotoLoadingOverlay';

// Önizleme: liste satırı hazır bir adres (initialSrc) verdiyse doğrudan o gösterilir.
// Vermediyse (eski biçimdeki kayıt) ya da adres açılamazsa (süresi dolmuş), görüntü
// viewport'a girdiğinde backend'den istenir. IntersectionObserver ve ortak bir cache kullanır.
interface LazyThumbnailProps {
  kayitId: number;
  initialSrc?: string;
  alt: string;
  width?: number | string;
  height?: number | string;
  borderRadius?: number;
  objectFit?: 'cover' | 'contain';
  onClick?: () => void;
  thumbnailCache: Record<number, string | null>;
  setThumbnailCache: React.Dispatch<React.SetStateAction<Record<number, string | null>>>;
}

const LazyThumbnail: React.FC<LazyThumbnailProps> = ({
  kayitId, initialSrc, alt, width = '100%', height = 180, borderRadius = 0, objectFit = 'cover', onClick,
  thumbnailCache, setThumbnailCache,
}) => {
  const ref = React.useRef<HTMLDivElement>(null);
  const [visible, setVisible] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [initialFailed, setInitialFailed] = React.useState(false);
  const cached = thumbnailCache[kayitId];
  const usingInitial = Boolean(initialSrc) && !initialFailed && !cached;
  const src = usingInitial ? initialSrc : cached;

  React.useEffect(() => {
    if (usingInitial || cached !== undefined) return; // adres hazır ya da zaten denendi
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      });
    }, { rootMargin: '200px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [cached, usingInitial]);

  React.useEffect(() => {
    if (!visible || usingInitial || cached !== undefined || loading) return;
    setLoading(true);
    sahaService.getKayitThumbnail(kayitId)
      .then((data) => {
        setThumbnailCache((prev) => ({ ...prev, [kayitId]: data || null }));
      })
      .catch(() => {
        setThumbnailCache((prev) => ({ ...prev, [kayitId]: null }));
      })
      .finally(() => setLoading(false));
  }, [visible, usingInitial, cached, kayitId, loading, setThumbnailCache]);

  const handleImageError = () => {
    if (usingInitial) {
      // Listedeki adres açılamadı: backend'den taze adres istenir.
      setInitialFailed(true);
    } else {
      setThumbnailCache((prev) => ({ ...prev, [kayitId]: null }));
    }
  };

  return (
    <Box
      ref={ref}
      onClick={onClick}
      sx={{
        width,
        height,
        borderRadius,
        overflow: 'hidden',
        cursor: onClick ? 'pointer' : 'default',
        bgcolor: '#e3f2fd',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        '&:hover': onClick ? { opacity: 0.9 } : undefined,
      }}
    >
      {src ? (
        <img
          src={src}
          alt={alt}
          style={{ width: '100%', height: '100%', objectFit }}
          loading="lazy"
          onError={handleImageError}
        />
      ) : loading ? (
        <CircularProgress size={24} />
      ) : (
        <PhotoCamera sx={{ color: '#1976d2', fontSize: typeof height === 'number' && height < 80 ? 24 : 60 }} />
      )}
    </Box>
  );
};

const SahaKayitlari: React.FC = () => {
  const [kayitlar, setKayitlar] = useState<SahaKayit[]>([]);
  const [sahaElemanlari, setSahaElemanlari] = useState<SahaElemani[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedSahaElemani, setSelectedSahaElemani] = useState<number | ''>('');
  const [showFilters, setShowFilters] = useState(true);
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [selectedPhotos, setSelectedPhotos] = useState<SahaPhoto[]>([]);
  const [selectedFallbackName, setSelectedFallbackName] = useState('fotograf');
  const [photoLoading, setPhotoLoading] = useState(false);
  const photoCache = useSahaPhotoCache();
  const [thumbnailCache, setThumbnailCache] = useState<Record<number, string | null>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [todayFilter, setTodayFilter] = useState(false);
  const [globalStats, setGlobalStats] = useState<{ toplam: number; bugun: number }>({ toplam: 0, bugun: 0 });
  const pageSize = 50;
  
  const { showSnackbar } = useSnackbar();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async (page = 1) => {
    try {
      setLoading(true);
      const [kayitlarResponse, sahaElemanlariData] = await Promise.all([
        sahaService.getAllKayitlar({ page, limit: pageSize }),
        sahaService.getSahaElemanlari(),
      ]);
      setKayitlar(kayitlarResponse.data);
      setTotalRecords(kayitlarResponse.pagination.total);
      setTotalPages(kayitlarResponse.pagination.totalPages);
      setCurrentPage(kayitlarResponse.pagination.page);
      setGlobalStats(kayitlarResponse.stats);
      setSahaElemanlari(sahaElemanlariData);
    } catch (error: any) {
      console.error('Veriler yüklenirken hata:', error);
      showSnackbar('Veriler yüklenirken hata oluştu!', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Fotoğrafları lazy load ile aç
  const handleOpenPhotos = async (kayitId: number) => {
    const kayit = kayitlar.find(k => k.id === kayitId);
    setSelectedFallbackName(buildKayitFallbackName(kayit));

    try {
      setPhotoLoading(true);
      setSelectedPhotos(await photoCache.load(kayitId));
    } catch (error) {
      console.error('Fotoğraflar yüklenirken hata:', error);
      showSnackbar('Fotoğraflar yüklenirken hata oluştu!', 'error');
    } finally {
      setPhotoLoading(false);
    }
  };

  const buildParams = (page: number, overrides?: { today?: boolean; search?: string; startDate?: string; endDate?: string; sahaElemaniId?: number | '' }) => {
    const params: any = { page, limit: pageSize };
    const s = overrides?.search !== undefined ? overrides.search : searchText;
    const sd = overrides?.startDate !== undefined ? overrides.startDate : startDate;
    const ed = overrides?.endDate !== undefined ? overrides.endDate : endDate;
    const se = overrides?.sahaElemaniId !== undefined ? overrides.sahaElemaniId : selectedSahaElemani;
    const td = overrides?.today !== undefined ? overrides.today : todayFilter;
    if (s) params.search = s;
    if (sd) params.startDate = sd;
    if (ed) params.endDate = ed;
    if (se) params.sahaElemaniId = se;
    if (td) params.today = true;
    return params;
  };

  const applyLoad = async (page: number, overrides?: { today?: boolean; search?: string; startDate?: string; endDate?: string; sahaElemaniId?: number | '' }) => {
    try {
      setLoading(true);
      const response = await sahaService.getAllKayitlar(buildParams(page, overrides));
      setKayitlar(response.data);
      setTotalRecords(response.pagination.total);
      setTotalPages(response.pagination.totalPages);
      setCurrentPage(response.pagination.page);
      setGlobalStats(response.stats);
    } catch (error: any) {
      console.error('Yükleme hatası:', error);
      showSnackbar(error?.response?.data?.message || 'Yükleme sırasında hata oluştu!', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => applyLoad(1);
  const handlePageChange = (newPage: number) => applyLoad(newPage);

  const handleToggleToday = () => {
    const next = !todayFilter;
    setTodayFilter(next);
    applyLoad(1, { today: next });
  };

  const handleClearFilters = () => {
    setSearchText('');
    setStartDate('');
    setEndDate('');
    setSelectedSahaElemani('');
    setTodayFilter(false);
    applyLoad(1, { search: '', startDate: '', endDate: '', sahaElemaniId: '', today: false });
  };

  // İstatistikler
  const stats = {
    toplam: globalStats.toplam,
    bugun: globalStats.bugun,
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
        <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' }, color: '#2C3E82' }}>
          Saha Kayıtları Görüntüleme
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button
            variant={todayFilter ? 'contained' : 'outlined'}
            size="small"
            color={todayFilter ? 'success' : 'primary'}
            onClick={handleToggleToday}
            sx={!todayFilter ? {
              borderColor: '#0D3282',
              color: '#0D3282',
              '&:hover': { borderColor: '#082052', bgcolor: 'rgba(13, 50, 130, 0.04)' },
            } : undefined}
          >
            BUGÜN ({globalStats.bugun})
          </Button>
          <Button
            variant={viewMode === 'cards' ? 'contained' : 'outlined'}
            size="small"
            onClick={() => setViewMode('cards')}
            sx={{
              bgcolor: viewMode === 'cards' ? '#0D3282' : 'transparent',
              borderColor: '#0D3282',
              color: viewMode === 'cards' ? 'white' : '#0D3282',
              '&:hover': {
                bgcolor: viewMode === 'cards' ? '#082052' : 'rgba(13, 50, 130, 0.04)',
                borderColor: '#082052',
              }
            }}
          >
            KARTLAR
          </Button>
          <Button
            variant={viewMode === 'table' ? 'contained' : 'outlined'}
            size="small"
            onClick={() => setViewMode('table')}
            sx={{
              bgcolor: viewMode === 'table' ? '#0D3282' : 'transparent',
              borderColor: '#0D3282',
              color: viewMode === 'table' ? 'white' : '#0D3282',
              '&:hover': {
                bgcolor: viewMode === 'table' ? '#082052' : 'rgba(13, 50, 130, 0.04)',
                borderColor: '#082052',
              }
            }}
          >
            TABLO
          </Button>
        </Box>
      </Box>

      {/* Filters */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1 }}>
          <FilterList />
          <Typography variant="subtitle1" fontWeight={500}>Filtreler</Typography>
          <IconButton size="small" onClick={() => setShowFilters(!showFilters)}>
            {showFilters ? <ExpandLess /> : <ExpandMore />}
          </IconButton>
        </Box>
        
        <Collapse in={showFilters}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={3}>
              <FormControl fullWidth size="small">
                <InputLabel>Saha Elemanı</InputLabel>
                <Select
                  value={selectedSahaElemani}
                  label="Saha Elemanı"
                  onChange={(e) => setSelectedSahaElemani(e.target.value as number | '')}
                >
                  <MenuItem value="">Tümü</MenuItem>
                  {sahaElemanlari.map((se) => (
                    <MenuItem key={se.id} value={se.id}>
                      {se.ad_soyad || se.username}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={3}>
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
            <Grid item xs={6} sm={2}>
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
            <Grid item xs={6} sm={2}>
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
            <Grid item xs={12} sm={2}>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                  variant="contained"
                  onClick={handleSearch}
                  size="small"
                  fullWidth
                  sx={{ bgcolor: '#0D3282', '&:hover': { bgcolor: '#082052' } }}
                >
                  ARA
                </Button>
                <Button
                  variant="outlined"
                  onClick={handleClearFilters}
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
                  <Refresh />
                </Button>
              </Box>
            </Grid>
          </Grid>
        </Collapse>
      </Paper>

      {/* Stats */}
      <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
        <Chip 
          label={`Toplam: ${stats.toplam}`} 
          color="primary" 
          variant="outlined" 
        />
        <Chip 
          label={`Bugün: ${stats.bugun}`} 
          color="success" 
          variant={todayFilter ? 'filled' : 'outlined'}
          onClick={handleToggleToday}
          sx={{ cursor: 'pointer' }}
        />
        {(searchText || startDate || endDate || selectedSahaElemani || todayFilter) && (
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
          Henüz saha kaydı bulunmuyor.
        </Alert>
      ) : viewMode === 'cards' ? (
        /* Cards View */
        <Grid container spacing={2}>
          {kayitlar.map((kayit) => {
            const hasPhotos = kayit.has_photos;
            
            return (
            <Grid item xs={12} sm={6} md={4} lg={3} key={kayit.id}>
              <Card sx={{ 
                height: '100%', 
                display: 'flex', 
                flexDirection: 'column',
                transition: 'transform 0.2s, box-shadow 0.2s',
                '&:hover': {
                  transform: 'translateY(-4px)',
                  boxShadow: 4,
                }
              }}>
                {hasPhotos ? (
                  <Box sx={{ position: 'relative' }}>
                    <LazyThumbnail
                      kayitId={kayit.id}
                      initialSrc={kayit.foto_preview}
                      alt={`${kayit.isim} ${kayit.soyisim}`}
                      height={180}
                      onClick={() => handleOpenPhotos(kayit.id)}
                      thumbnailCache={thumbnailCache}
                      setThumbnailCache={setThumbnailCache}
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
                      pointerEvents: 'none',
                    }}>
                      <PhotoCamera sx={{ fontSize: 16 }} />
                      <Typography variant="caption">Fotoğrafları Görüntüle</Typography>
                    </Box>
                  </Box>
                ) : (
                  <Box
                    sx={{
                      height: 180,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      bgcolor: '#f5f5f5',
                    }}
                  >
                    <Person sx={{ fontSize: 60, color: '#ccc' }} />
                  </Box>
                )}
                <CardContent sx={{ flexGrow: 1 }}>
                  <Typography variant="h6" component="div" gutterBottom>
                    {kayit.isim} {kayit.soyisim}
                  </Typography>
                  
                  <Chip 
                    label={kayit.saha_elemani_ad_soyad || kayit.saha_elemani_username} 
                    size="small" 
                    color="info"
                    sx={{ mb: 1 }}
                  />
                  
                  {kayit.notlar && (
                    <Tooltip title={kayit.notlar} arrow placement="top">
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 1, cursor: 'help' }}>
                        {kayit.notlar.length > 80 ? kayit.notlar.substring(0, 80) + '...' : kayit.notlar}
                      </Typography>
                    </Tooltip>
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
              </Card>
            </Grid>
          );
          })}
        </Grid>
      ) : (
        /* Table View */
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#0D3282' }}>
                <TableCell sx={{ color: 'white', fontWeight: 600 }}>Fotoğraf</TableCell>
                <TableCell sx={{ color: 'white', fontWeight: 600 }}>İsim Soyisim</TableCell>
                <TableCell sx={{ color: 'white', fontWeight: 600 }}>Saha Elemanı</TableCell>
                <TableCell sx={{ color: 'white', fontWeight: 600 }}>Notlar</TableCell>
                <TableCell sx={{ color: 'white', fontWeight: 600 }}>Tarih</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {kayitlar.map((kayit) => {
                const hasPhotos = kayit.has_photos;
                
                return (
                <TableRow key={kayit.id} hover>
                  <TableCell>
                    {hasPhotos ? (
                      <LazyThumbnail
                        kayitId={kayit.id}
                        initialSrc={kayit.foto_preview}
                        alt={`${kayit.isim} ${kayit.soyisim}`}
                        width={50}
                        height={50}
                        borderRadius={1}
                        onClick={() => handleOpenPhotos(kayit.id)}
                        thumbnailCache={thumbnailCache}
                        setThumbnailCache={setThumbnailCache}
                      />
                    ) : (
                      <Box sx={{ 
                        width: 50, 
                        height: 50, 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center',
                        bgcolor: '#f5f5f5',
                        borderRadius: 1,
                      }}>
                        <Person sx={{ color: '#ccc' }} />
                      </Box>
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography fontWeight={500}>{kayit.isim} {kayit.soyisim}</Typography>
                  </TableCell>
                  <TableCell>
                    <Chip 
                      label={kayit.saha_elemani_ad_soyad || kayit.saha_elemani_username} 
                      size="small" 
                      color="info"
                    />
                  </TableCell>
                  <TableCell sx={{ maxWidth: 200 }}>
                    <Tooltip title={kayit.notlar || ''} arrow placement="top" disableHoverListener={!kayit.notlar}>
                      <Typography variant="body2" noWrap sx={{ cursor: kayit.notlar ? 'help' : 'default' }}>
                        {kayit.notlar || '-'}
                      </Typography>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    {new Date(kayit.created_at).toLocaleString('tr-TR', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </TableCell>
                </TableRow>
              );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Pagination */}
      {!loading && kayitlar.length > 0 && totalPages > 1 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 2, mt: 3 }}>
          <Button
            variant="outlined"
            size="small"
            disabled={currentPage <= 1}
            onClick={() => handlePageChange(currentPage - 1)}
          >
            Önceki
          </Button>
          <Typography variant="body2">
            Sayfa {currentPage} / {totalPages} (Toplam: {totalRecords})
          </Typography>
          <Button
            variant="outlined"
            size="small"
            disabled={currentPage >= totalPages}
            onClick={() => handlePageChange(currentPage + 1)}
          >
            Sonraki
          </Button>
        </Box>
      )}

      {/* Photo Loading Overlay */}
      <PhotoLoadingOverlay open={photoLoading} />

      {/* Image Preview Dialog */}
      <ImagePreviewDialog
        photos={selectedPhotos}
        fallbackName={selectedFallbackName}
        onClose={() => setSelectedPhotos([])}
      />
    </Box>
  );
};

export default SahaKayitlari;
