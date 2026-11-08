import React, { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import {
  Box,
  Container,
  Button,
  CircularProgress,
} from '@mui/material';
import {
  Add as AddIcon,
  Download as DownloadIcon,
} from '@mui/icons-material';
import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { islemService } from '../../services/islem.service';
import { Islem } from '../../types';
import { useIslemSocket } from '../../hooks/useIslemSocket';
import IslemTable from '../islem/IslemTable.tsx';
import IslemFilters from '../islem/IslemFilters.tsx';
import IslemDialog from '../islem/IslemDialog.tsx';
// ⚡ PERFORMANS: Büyük componentleri lazy loading ile yükle.
const Settings = lazy(() => import('../settings/Settings'));
const MusteriGecmisi = lazy(() => import('../musteri/MusteriGecmisi.tsx'));
const AtolyeTakip = lazy(() => import('../atolye/AtolyeTakip.tsx'));
const AdminPanel = lazy(() => import('../admin/AdminPanel.tsx'));
const SahaPanel = lazy(() => import('../saha/SahaPanel.tsx'));
const SahaKayitlari = lazy(() => import('../saha/SahaKayitlari.tsx'));
import Loading from '../common/Loading';
import ErrorMessage from '../common/ErrorMessage';
import { useSnackbar } from '../../context/SnackbarContext';
import { useTheme, useMediaQuery, Alert } from '@mui/material';
import { usePhoneDesktopView } from '../../hooks/usePhoneDesktopView';
import DashboardAppBar from './DashboardAppBar';
import DashboardDrawer from './DashboardDrawer';
import DashboardTabs from './DashboardTabs';
import DashboardStatsBar, { StatusFilter } from './DashboardStatsBar';
import OnHoldCards from './OnHoldCards';
import TamamlaConfirmDialog from './TamamlaConfirmDialog';

/**
 * Dashboard (Part 3 / P3.E2 sonrası).
 *
 * Sayfa-iskeleti + tüm iş mantığı (state, refs, server-fetch, socket,
 * filter handler'ları, dialog handler'ları, on-hold yönetimi) burada
 * kalır. JSX katmanları DashboardAppBar / DashboardDrawer / DashboardTabs
 * / DashboardStatsBar / OnHoldCards / TamamlaConfirmDialog alt
 * bileşenlerine devredildi.
 */
const Dashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { showSnackbar } = useSnackbar();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  // --- Veri ---
  const [islemler, setIslemler] = useState<Islem[]>([]);
  const [filteredIslemler, setFilteredIslemler] = useState<Islem[]>([]);
  const [tableFilteredIslemler, setTableFilteredIslemler] = useState<Islem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [totalRecords, setTotalRecords] = useState(0);
  const PAGE_SIZE = 100;

  // --- Dialog / form ---
  const [openDialog, setOpenDialog] = useState(false);
  const [selectedIslem, setSelectedIslem] = useState<Islem | null>(null);
  const [cloneFromRecord, setCloneFromRecord] = useState<Islem | null>(null);
  const [openTamamlaModal, setOpenTamamlaModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- UI / nav ---
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [exporting, setExporting] = useState(false);
  const [showTodayOnly, setShowTodayOnly] = useState(false);
  const [showYazdirilmamis, setShowYazdirilmamis] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; islem: Islem | null }>({ open: false, islem: null });

  // --- Hold form ---
  const [onHoldFormData, setOnHoldFormData] = useState<any[]>([]);
  const [activeHoldIndex, setActiveHoldIndex] = useState<number | null>(null);
  const [shouldRestoreForm, setShouldRestoreForm] = useState(false);

  // --- Server stats / refs ---
  const [serverStats, setServerStats] = useState<any>(null);
  const columnFiltersRef = useRef<Record<string, string>>({});
  const columnFilterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstColumnFilterRef = useRef(true);
  const adminFiltersActiveRef = useRef(false);
  // Stale closure'lardan korunmak için aktif filtre değerlerini ref olarak tut
  const statusFilterRef = useRef<StatusFilter>('all');
  const showTodayOnlyRef = useRef(false);
  const showYazdirilmamisRef = useRef(false);

  // Güvenli rol kontrolü - eğer user yoksa veya role tanımlı değilse en kısıtlı mod
  const isBayi = user?.role === 'bayi';
  const isAdmin = user?.role === 'admin';
  const isSaha = user?.role === 'saha';

  // Telefon yan çevrilince ofis ekranları bilgisayardaki düzeniyle gösterilir. Saha paneli
  // telefon için tasarlandığından kapsam dışıdır.
  const phoneView = usePhoneDesktopView(!isSaha);
  const [rotateHintClosed, setRotateHintClosed] = useState(false);
  const showRotateHint = !isSaha && phoneView.phone && !phoneView.landscape && !rotateHintClosed;

  // Socket.IO işlem gerçek-zamanlı güncellemeleri ortak hook ile.
  useIslemSocket({
    onYeniIslem: (islem) => {
      if (islem && islem.id) {
        setIslemler((prev) => [islem, ...prev]);
        scheduleStatsRefresh();
        showSnackbar('Yeni işlem eklendi!', 'info');
      }
    },
    onIslemGuncellendi: (updatedIslem) => {
      if (updatedIslem && updatedIslem.id) {
        setIslemler((prev) => prev.map((islem) => (islem.id === updatedIslem.id ? updatedIslem : islem)));
        scheduleStatsRefresh();
        showSnackbar('İşlem güncellendi!', 'info');
      }
    },
    onIslemSilindi: (id) => {
      if (id) {
        setIslemler((prev) => prev.filter((islem) => islem.id !== id));
        scheduleStatsRefresh();
        showSnackbar('İşlem silindi!', 'info');
      }
    },
    onIslemDurumDegisti: (updatedIslem) => {
      if (updatedIslem && updatedIslem.id) {
        setIslemler((prev) => prev.map((islem) => (islem.id === updatedIslem.id ? updatedIslem : islem)));
        scheduleStatsRefresh();
        showSnackbar('İş durumu güncellendi!', 'success');
      }
    },
  });

  // İşlem listesi yalnız ofis içindir (yönetici + kullanıcı). Bayi ve saha bu ekranı
  // görmez; sunucu da onlara 403 döner (backend routes/index.ts izin tablosu).
  useEffect(() => {
    if (isBayi || isSaha) return;
    loadIslemler();
    loadStats();
  }, []);

  // Sunucu taraflı filtre parametrelerini oluştur
  const getServerFilters = (overrides?: { status?: string; todayOnly?: boolean; yazdirilmamisOnly?: boolean }) => {
    const s = overrides?.status ?? statusFilterRef.current;
    const t = overrides?.todayOnly ?? showTodayOnlyRef.current;
    const y = overrides?.yazdirilmamisOnly ?? showYazdirilmamisRef.current;
    const params: any = {};
    if (s && s !== 'all') params.is_durumu = s;
    if (t) params.today = 'true';
    if (y) params.yazdirilmamis = 'true';

    // Kolon filtrelerini ekle (IslemTable'dan gelen)
    const cf = columnFiltersRef.current;
    for (const [key, value] of Object.entries(cf)) {
      if (!value) continue;
      if (key === 'teknisyen') params.teknisyen_ismi = value;
      else if (key === 'durum' || key === 'sira' || key === 'tarih') continue; // client-side kalacak
      else params[key] = value;
    }

    return params;
  };

  const loadIslemler = async (
    page = 1,
    append = false,
    overrides?: { status?: string; todayOnly?: boolean; yazdirilmamisOnly?: boolean },
    silent = false
  ) => {
    try {
      if (!silent) {
        if (page === 1) setLoading(true);
        else setLoadingMore(true);
      }
      setError(null);

      const hasAdminActiveFilters = adminFiltersActiveRef.current;

      if (hasAdminActiveFilters) {
        // Filtre aktifken tüm veriyi çek (pagination yok)
        const filters = getServerFilters(overrides);
        const response = await islemService.getAll(filters);
        const data = Array.isArray(response) ? response : response.data;
        const sortedData = [...data].sort((a: Islem, b: Islem) => b.id - a.id);
        setIslemler(sortedData);
        setCurrentPage(1);
        setTotalRecords(sortedData.length);
        setHasMore(false);
      } else {
        // Normal sayfalanmış yükleme
        const filters = { ...getServerFilters(overrides), page, limit: PAGE_SIZE };
        const response = (await islemService.getAll(filters)) as {
          data: Islem[];
          pagination: { page: number; limit: number; total: number; totalPages: number };
        };
        const newData = response.data.sort((a, b) => b.id - a.id);

        if (append) setIslemler((prev) => [...prev, ...newData]);
        else setIslemler(newData);
        setCurrentPage(response.pagination.page);
        setTotalRecords(response.pagination.total);
        setHasMore(response.pagination.page < response.pagination.totalPages);
      }
    } catch (error: any) {
      console.error('İşlemler yüklenirken hata:', error);
      setError(error.response?.data?.message || 'İşlemler yüklenirken bir hata oluştu');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const loadStats = async () => {
    try {
      const data = await islemService.getStats();
      setServerStats(data);
    } catch (error) {
      console.error('İstatistikler yüklenirken hata:', error);
    }
  };

  // ⚡ Socket olayları peş peşe gelebiliyor (toplu güncelleme, çok kullanıcı).
  // Her olayda /stats çağırmak sunucuda tam tablo taraması demek; 1 sn'lik
  // pencerede tek çağrıya indiriyoruz.
  const scheduleStatsRefresh = useCallback(() => {
    if (statsTimerRef.current) return;
    statsTimerRef.current = setTimeout(() => {
      statsTimerRef.current = null;
      loadStats();
    }, 1000);
  }, []);

  useEffect(() => {
    return () => {
      if (statsTimerRef.current) clearTimeout(statsTimerRef.current);
      if (columnFilterTimerRef.current) clearTimeout(columnFilterTimerRef.current);
    };
  }, []);

  const handleLoadMore = () => {
    if (!loadingMore && hasMore) loadIslemler(currentPage + 1, true);
  };

  // IslemTable kolon filtreleri değiştiğinde sunucudan yeniden çek
  const handleColumnFiltersChange = useCallback((filters: Record<string, string>) => {
    const hasAnyFilter = Object.values(filters).some((v) => v);
    const hadAnyFilter = Object.values(columnFiltersRef.current).some((v) => v);

    columnFiltersRef.current = filters;

    // İlk çağrıyı (mount) atla
    if (isFirstColumnFilterRef.current) {
      isFirstColumnFilterRef.current = false;
      return;
    }
    // Filtre yoksa ve önceden de yoksa, tekrar çekme
    if (!hasAnyFilter && !hadAnyFilter) return;

    if (columnFilterTimerRef.current) clearTimeout(columnFilterTimerRef.current);
    columnFilterTimerRef.current = setTimeout(() => {
      loadIslemler(1, false, undefined, true);
    }, 400);
  }, []);

  // Admin filtreleri aktif/pasif durumu (IslemFilters'dan gelir)
  const handleAdminFiltersActiveChange = useCallback((active: boolean) => {
    const wasActive = adminFiltersActiveRef.current;
    adminFiltersActiveRef.current = active;
    if (active !== wasActive) loadIslemler(1, false, undefined, true);
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // ⚡ Aşağıdaki dört handler IslemTable'a prop olarak iniyor ve orada
  // `columnConfigs` useMemo'sunun bağımlılığı. useCallback OLMADAN her
  // Dashboard render'ında kimlikleri değişiyor, bu da kolon konfigürasyonunu
  // ve dolayısıyla TÜM satırların memo'sunu geçersiz kılıyordu.
  const handleOpenDialog = useCallback((islem?: Islem) => {
    setSelectedIslem(islem || null);
    setCloneFromRecord(null);
    setOpenDialog(true);
    setShouldRestoreForm(false);
  }, []);

  // Çift tıklama ile klonlama
  const handleCloneRecord = useCallback((islem: Islem) => {
    setCloneFromRecord(islem);
    setSelectedIslem(null);
    setOpenDialog(true);
    setShouldRestoreForm(false);
  }, []);

  const handleCloseDialog = () => {
    setOpenDialog(false);
    setSelectedIslem(null);
    setCloneFromRecord(null);
    setOpenTamamlaModal(false);

    // Eğer beklemeye alınmış bir form açıldıysa ve iptal ediliyorsa, kartı da sil
    if (shouldRestoreForm && activeHoldIndex !== null) {
      clearOnHoldData(activeHoldIndex);
    }
    setShouldRestoreForm(false);
  };

  // Bekleme durumu değiştiğinde
  const handleHoldChange = (isOnHold: boolean, formData?: any, holdIndex?: number) => {
    if (isOnHold) {
      console.log('Beklemeye alınan form verileri:', formData);
      setOnHoldFormData((prev) => [...prev, formData]);
      setOpenDialog(false);
      setSelectedIslem(null);
      setShouldRestoreForm(false);
    } else {
      if (holdIndex !== undefined && holdIndex !== null) {
        const selectedHoldData = onHoldFormData[holdIndex];
        console.log('Beklemeden çıkılan form verileri:', selectedHoldData);
        setActiveHoldIndex(holdIndex);
        setShouldRestoreForm(true);
        setOpenDialog(true);
      }
    }
  };

  // Bekleyen formu tamamen temizle
  const clearOnHoldData = (holdIndex?: number) => {
    if (holdIndex !== undefined && holdIndex !== null) {
      setOnHoldFormData((prev) => prev.filter((_, i) => i !== holdIndex));
    } else {
      if (activeHoldIndex !== null) {
        setOnHoldFormData((prev) => prev.filter((_, i) => i !== activeHoldIndex));
        setActiveHoldIndex(null);
      }
    }
    setShouldRestoreForm(false);
  };

  // ⚡ PERFORMANS: Socket.IO zaten real-time güncelleme yapıyor.
  const handleSaveIslem = async () => {
    handleCloseDialog();
    if (shouldRestoreForm) clearOnHoldData();
  };

  const handleToggleDurum = useCallback((islem: Islem) => {
    setSelectedIslem(islem);
    setOpenTamamlaModal(true);
    setOpenDialog(true);
  }, []);

  const handleConfirmTamamla = async () => {
    if (!confirmDialog.islem) return;
    try {
      await islemService.updateDurum(confirmDialog.islem.id, 'tamamlandi');
      showSnackbar('İş durumu tamamlandı olarak güncellendi!', 'success');
      setConfirmDialog({ open: false, islem: null });
    } catch (error) {
      console.error('Durum güncellenirken hata:', error);
      showSnackbar('Durum güncellenirken hata oluştu!', 'error');
    }
  };

  const handleDelete = useCallback(async (islem: Islem) => {
    if (!window.confirm(`"${islem.ad_soyad}" müşterisine ait işlemi silmek istediğinize emin misiniz?`)) return;
    try {
      await islemService.delete(islem.id);
      showSnackbar('İşlem başarıyla silindi!', 'success');
    } catch (error) {
      console.error('İşlem silinirken hata:', error);
      showSnackbar('İşlem silinirken hata oluştu!', 'error');
    }
  }, [showSnackbar]);

  const handleCancelTamamla = () => setConfirmDialog({ open: false, islem: null });

  // ⚡ xlsx (~400 kB) sadece "Excel İndir"e basılınca indirilir; ana bundle'da yer almaz.
  const handleExport = async () => {
    if (exporting) return;
    try {
      setExporting(true);
      let listToExport = tableFilteredIslemler.length > 0 ? tableFilteredIslemler : filteredIslemler;
      // Liste ekrana sayfa sayfa (100'er) gelir. Henüz hepsi yüklenmediyse yalnızca
      // ekrandakini değil, o anki filtreye uyan kayıtların TAMAMINI sunucudan al.
      if (hasMore) {
        const all = await islemService.getAllMatching(getServerFilters());
        listToExport = [...all].sort((a, b) => b.id - a.id);
      }
      const { exportToExcel } = await import('../../utils/excel.ts');
      exportToExcel(listToExport);
      showSnackbar(`${listToExport.length} kayıt Excel'e aktarıldı!`, 'success');
    } catch (error) {
      console.error('Excel aktarımı sırasında hata:', error);
      showSnackbar('Excel hazırlanırken hata oluştu, lütfen tekrar deneyin.', 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleTableFilterChange = useCallback((filtered: Islem[]) => {
    setTableFilteredIslemler(filtered);
  }, []);

  const handleStatusFilterClick = useCallback((filter: StatusFilter) => {
    setStatusFilter(filter);
    setShowTodayOnly(false);
    setShowYazdirilmamis(false);
    statusFilterRef.current = filter;
    showTodayOnlyRef.current = false;
    showYazdirilmamisRef.current = false;
    loadIslemler(1, false, { status: filter, todayOnly: false, yazdirilmamisOnly: false });
  }, []);

  const handleTodayFilter = useCallback(() => {
    const newValue = !showTodayOnly;
    setShowTodayOnly(newValue);
    showTodayOnlyRef.current = newValue;
    if (newValue) {
      setStatusFilter('all');
      setShowYazdirilmamis(false);
      statusFilterRef.current = 'all';
      showYazdirilmamisRef.current = false;
    }
    loadIslemler(1, false, { status: 'all', todayOnly: newValue, yazdirilmamisOnly: false });
  }, [showTodayOnly]);

  const handleYazdirilmamisFilter = useCallback(() => {
    const newValue = !showYazdirilmamis;
    setShowYazdirilmamis(newValue);
    showYazdirilmamisRef.current = newValue;
    if (newValue) {
      setStatusFilter('all');
      setShowTodayOnly(false);
      statusFilterRef.current = 'all';
      showTodayOnlyRef.current = false;
    }
    loadIslemler(1, false, { status: 'all', todayOnly: false, yazdirilmamisOnly: newValue });
  }, [showYazdirilmamis]);

  const handleClearDateFilters = () => {
    setShowTodayOnly(false);
    setShowYazdirilmamis(false);
  };

  const handleDrawerToggle = () => setMobileDrawerOpen((v) => !v);
  const handleDrawerNavigation = (tabIndex: number) => {
    setActiveTab(tabIndex);
    setMobileDrawerOpen(false);
  };

  // ⚡ PERFORMANS: İşlem istatistiklerini sunucudan al
  const stats = useMemo(() => {
    if (serverStats) {
      // Bütün işlemlerin toplamı sunucuda hesaplanır (yalnızca yöneticiye gönderilir).
      // Eskiden yalnızca ekranda yüklü satırlar (en yeni 100 kayıt) toplanıyordu.
      const toplamTutar = isAdmin ? Number(serverStats.toplam_tutar) || 0 : 0;

      return {
        acikCount: parseInt(serverStats.acik) || 0,
        parcaBekleCount: parseInt(serverStats.parca_bekliyor) || 0,
        tamamlandiCount: parseInt(serverStats.tamamlandi) || 0,
        iptalCount: parseInt(serverStats.iptal) || 0,
        totalCount: parseInt(serverStats.total) || 0,
        bugunCount: parseInt(serverStats.bugun) || 0,
        yazdirilmamisCount: parseInt(serverStats.yazdirilmamis) || 0,
        toplamTutar,
      };
    }
    return {
      acikCount: 0,
      parcaBekleCount: 0,
      tamamlandiCount: 0,
      iptalCount: 0,
      totalCount: 0,
      bugunCount: 0,
      yazdirilmamisCount: 0,
      toplamTutar: 0,
    };
  }, [serverStats, isAdmin]);

  return (
    <Box sx={{ flexGrow: 1 }}>
      <DashboardAppBar
        isMobile={isMobile}
        isAdmin={isAdmin}
        isBayi={isBayi}
        isSaha={isSaha}
        username={user?.username}
        toplamTutar={stats.toplamTutar}
        onDrawerToggle={handleDrawerToggle}
        onLogout={handleLogout}
      />

      {/* Mobile Drawer - Sadece Admin için (Bayi ve Saha hariç) */}
      {!isBayi && !isSaha && (
        <DashboardDrawer
          open={mobileDrawerOpen}
          onClose={handleDrawerToggle}
          activeTab={activeTab}
          isAdmin={isAdmin}
          onNavigate={handleDrawerNavigation}
        />
      )}

      {showRotateHint && (
        <Alert severity="info" onClose={() => setRotateHintClosed(true)} sx={{ borderRadius: 0, py: 0.25 }}>
          Bilgisayardaki görünüm için telefonu yan çevirin.
        </Alert>
      )}

      <DashboardTabs
        activeTab={activeTab}
        onChange={setActiveTab}
        isBayi={isBayi}
        isSaha={isSaha}
        isAdmin={isAdmin}
      />

      <Container maxWidth="xl" sx={{ mt: { xs: 2, sm: 4 }, mb: { xs: 2, sm: 4 }, px: { xs: 1, sm: 2 } }}>
        {isSaha ? (
          <Suspense fallback={<Loading message="Yükleniyor..." />}>
            <SahaPanel />
          </Suspense>
        ) : isBayi ? (
          <AtolyeTakip />
        ) : (
          <>
            {activeTab === 0 ? (
              // Ana Sayfa Tab
              error ? (
                <ErrorMessage message={error} onRetry={loadIslemler} />
              ) : loading ? (
                <Loading message="İşlemler yükleniyor..." />
              ) : (
                <>
                  {/* Tablo Başlığı ve Filtreler */}
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, gap: 2, flexWrap: 'wrap' }}>
                    <DashboardStatsBar
                      stats={stats}
                      statusFilter={statusFilter}
                      showTodayOnly={showTodayOnly}
                      showYazdirilmamis={showYazdirilmamis}
                      onStatusFilterClick={handleStatusFilterClick}
                      onTodayFilter={handleTodayFilter}
                      onYazdirilmamisFilter={handleYazdirilmamisFilter}
                      onClearDateFilters={handleClearDateFilters}
                    />

                    {/* Filtreler - Sağ taraf */}
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                      <IslemFilters
                        islemler={islemler}
                        onFilterChange={setFilteredIslemler}
                        statusFilter={statusFilter}
                        dateFilter=""
                        showTodayOnly={showTodayOnly}
                        showYazdirilmamis={showYazdirilmamis}
                        onAdminFiltersActive={handleAdminFiltersActiveChange}
                      />

                      <Button
                        variant="outlined"
                        startIcon={<DownloadIcon sx={{ fontSize: '1rem' }} />}
                        onClick={handleExport}
                        disabled={exporting}
                        size="small"
                        sx={{
                          fontSize: '0.65rem',
                          py: 0.4,
                          px: 0.8,
                          color: '#0D3282',
                          borderColor: '#0D3282',
                          '&:hover': { borderColor: '#0a2461', bgcolor: 'rgba(13, 50, 130, 0.04)' },
                        }}
                      >
                        Excel İndir
                      </Button>
                      <Button
                        variant="contained"
                        startIcon={<AddIcon sx={{ fontSize: '1rem' }} />}
                        onClick={() => handleOpenDialog()}
                        size="small"
                        sx={{
                          fontSize: '0.65rem',
                          py: 0.4,
                          px: 0.8,
                          boxShadow: 2,
                          '&:hover': { boxShadow: 4 },
                        }}
                      >
                        Yeni İşlem
                      </Button>
                    </Box>
                  </Box>

                  <IslemTable
                    islemler={filteredIslemler}
                    loading={loading}
                    onEdit={handleOpenDialog}
                    onClone={handleCloneRecord}
                    onToggleDurum={handleToggleDurum}
                    onDelete={handleDelete}
                    isAdminMode={isAdmin}
                    isBayi={isBayi}
                    onFilteredChange={handleTableFilterChange}
                    onColumnFiltersChange={handleColumnFiltersChange}
                  />

                  {/* Daha Fazla Yükle Butonu */}
                  {hasMore && !loading && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2, mb: 2 }}>
                      <Button
                        variant="outlined"
                        onClick={handleLoadMore}
                        disabled={loadingMore}
                        sx={{
                          px: 4,
                          py: 1,
                          borderColor: '#0D3282',
                          color: '#0D3282',
                          '&:hover': { bgcolor: 'rgba(13, 50, 130, 0.04)' },
                        }}
                      >
                        {loadingMore ? <CircularProgress size={20} sx={{ mr: 1 }} /> : null}
                        {loadingMore ? 'Yükleniyor...' : `Daha Fazla Yükle (${islemler.length} / ${totalRecords})`}
                      </Button>
                    </Box>
                  )}
                </>
              )
            ) : activeTab === 1 ? (
              <Suspense fallback={<Loading />}>
                <MusteriGecmisi />
              </Suspense>
            ) : activeTab === 2 ? (
              <Suspense fallback={<Loading />}>
                <AtolyeTakip />
              </Suspense>
            ) : activeTab === 3 ? (
              <Suspense fallback={<Loading />}>
                <Settings />
              </Suspense>
            ) : activeTab === 4 && isAdmin ? (
              <Suspense fallback={<Loading />}>
                <AdminPanel />
              </Suspense>
            ) : activeTab === 5 ? (
              <Suspense fallback={<Loading />}>
                <SahaKayitlari />
              </Suspense>
            ) : (
              <Suspense fallback={<Loading />}>
                <Settings />
              </Suspense>
            )}
          </>
        )}

        <IslemDialog
          open={openDialog}
          islem={selectedIslem}
          onClose={handleCloseDialog}
          onSave={handleSaveIslem}
          openTamamlaModal={openTamamlaModal}
          onHold={handleHoldChange}
          restoreFormData={shouldRestoreForm && activeHoldIndex !== null ? onHoldFormData[activeHoldIndex] : undefined}
          cloneFromRecord={cloneFromRecord || undefined}
        />

        <TamamlaConfirmDialog
          open={confirmDialog.open}
          onCancel={handleCancelTamamla}
          onConfirm={handleConfirmTamamla}
        />

        <OnHoldCards
          onHoldFormData={onHoldFormData}
          openDialog={openDialog}
          onResume={(idx) => handleHoldChange(false, undefined, idx)}
          onClear={(idx) => clearOnHoldData(idx)}
        />
      </Container>
    </Box>
  );
};

export default Dashboard;
