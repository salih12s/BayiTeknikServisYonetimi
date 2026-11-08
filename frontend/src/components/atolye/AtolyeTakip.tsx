import React, { useState, useEffect, useMemo, useCallback, memo } from 'react';
import {
  Box,
  Paper,
  Button,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { Add } from '@mui/icons-material';
import { Atolye } from '../../types';
import { atolyeService } from '../../services/atolye.service';
import { useSnackbar } from '../../context/SnackbarContext';
import { useAuth } from '../../context/AuthContext';
import AtolyeDialog from './AtolyeDialog.tsx';
import { useAtolyeSocket } from '../../hooks/useAtolyeSocket';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import AtolyeStatusFilterBar from './AtolyeStatusFilterBar';
import AtolyeCardView from './AtolyeCardView';
import AtolyeTableView, { FilterState } from './AtolyeTableView';

/**
 * AtolyeTakip — Part 3 / P3.E1 sonrası ince orchestrator.
 *
 * State + iş mantığı (fetch, socket, filtre, pagination) burada;
 * sunum katmanı `AtolyeStatusFilterBar`, `AtolyeCardView` (mobil) ve
 * `AtolyeTableView` (masaüstü) bileşenlerine bölündü. Davranış,
 * filtre semantiği, debounce süresi (700 ms), pagination boyut listesi
 * ([25,50,100,200]), socket olayları ve mobil/masaüstü ayrımı orijinaliyle
 * birebir aynı. Dead code (önceki inner kopya `formatDate` vs.) bu
 * refactor'da kaldırıldı.
 */

interface StatusCounts {
  total: number;
  beklemede: number;
  teslim_edildi: number;
  siparis_verildi: number;
  yapildi: number;
  fabrika_gitti: number;
  odeme_bekliyor: number;
}

const initialFilters: FilterState = {
  sira: '', teslim_durumu: '', tarih: '', bayi_adi: '', musteri_ad_soyad: '', tel_no: '',
  marka: '', kod: '', seri_no: '', sikayet: '', ozel_not: '', yapilan_islem: '', note_no: '', ucret: '', yapilma_tarihi: '',
};

const AtolyeTakip: React.FC = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [atolyeList, setAtolyeList] = useState<Atolye[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedAtolyeId, setSelectedAtolyeId] = useState<number | null>(null);
  const [activeStatusFilter, setActiveStatusFilter] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const { showSnackbar } = useSnackbar();
  const { user } = useAuth();

  // Pagination
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);

  // Status counts (badge ekranlarda kullanılmak üzere — orijinaldeki @ts-ignore
  // notu da korunmaya çalışıldı: setter kullanılır ama state state-of-truth
  // olarak şu an UI'de gösterilmez).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_statusCounts, setStatusCounts] = useState<StatusCounts>({
    total: 0, beklemede: 0, teslim_edildi: 0, siparis_verildi: 0, yapildi: 0, fabrika_gitti: 0, odeme_bekliyor: 0,
  });

  const isBayi = user?.role === 'bayi';
  const isAdmin = user?.role === 'admin';
  const bayiIsim = user?.bayiIsim || '';

  // Filter states
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const debouncedFilters = useDebouncedValue(filters, 700);
  const hasActiveFilters = useMemo(
    () => Object.values(filters).some((v) => v !== '') || activeStatusFilter !== '',
    [filters, activeStatusFilter]
  );

  const fetchStatusCounts = useCallback(async () => {
    try {
      const data = await atolyeService.getStatusCounts();
      setStatusCounts({
        total: parseInt(String(data.total)) || 0,
        beklemede: parseInt(String(data.beklemede)) || 0,
        teslim_edildi: parseInt(String(data.teslim_edildi)) || 0,
        siparis_verildi: parseInt(String(data.siparis_verildi)) || 0,
        yapildi: parseInt(String(data.yapildi)) || 0,
        fabrika_gitti: parseInt(String(data.fabrika_gitti)) || 0,
        odeme_bekliyor: parseInt(String(data.odeme_bekliyor)) || 0,
      });
    } catch (error) {
      console.error('Status counts alınamadı:', error);
    }
  }, []);

  const fetchAtolyeList = useCallback(async () => {
    setLoading(true);
    try {
      // HER ZAMAN tüm veriyi çek — filtreler client-side uygulanacak.
      const allData = await atolyeService.getAll();
      const sortedAllData = allData.sort((a: Atolye, b: Atolye) => b.id - a.id);
      if (isBayi) {
        const bayiData = sortedAllData.filter((item: Atolye) => item.bayi_adi === bayiIsim);
        setAtolyeList(bayiData);
      } else {
        setAtolyeList(sortedAllData);
      }
    } catch (error) {
      showSnackbar('Atölye kayıtları yüklenirken hata oluştu', 'error');
    } finally {
      setLoading(false);
    }
  }, [isBayi, bayiIsim, showSnackbar]);

  // ⚡ Tek yükleme noktası. Eskiden bu effect ile aşağıdaki mount effect'i
  // birlikte çalışıp ~3000 kayıtlık `?all=true` isteğini her açılışta İKİ KEZ
  // gönderiyordu.
  useEffect(() => {
    fetchAtolyeList();
    fetchStatusCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBayi, bayiIsim]);

  // Socket.IO gerçek zamanlı güncellemeler ortak hook ile.
  const handleYeniAtolye = useCallback((atolye: Atolye) => {
    if (atolye && atolye.id) {
      if (isBayi) {
        if (atolye.bayi_adi === bayiIsim) {
          setAtolyeList((prev) => [atolye, ...prev]);
          showSnackbar('Yeni atölye kaydı eklendi!', 'info');
        }
      } else {
        setAtolyeList((prev) => [atolye, ...prev]);
        showSnackbar('Yeni atölye kaydı eklendi!', 'info');
      }
    }
  }, [isBayi, bayiIsim, showSnackbar]);

  const handleAtolyeGuncellendi = useCallback((updatedAtolyeRecord: Atolye) => {
    if (updatedAtolyeRecord && updatedAtolyeRecord.id) {
      setAtolyeList((prev) =>
        prev.map((atolye) => (atolye.id === updatedAtolyeRecord.id ? updatedAtolyeRecord : atolye))
      );
      showSnackbar('Atölye kaydı güncellendi!', 'info');
    }
  }, [showSnackbar]);

  const handleAtolyeSilindi = useCallback((deletedId: number) => {
    if (deletedId) {
      setAtolyeList((prev) => prev.filter((atolye) => atolye.id !== deletedId));
      showSnackbar('Atölye kaydı silindi!', 'info');
    }
  }, [showSnackbar]);

  useAtolyeSocket({
    onYeniAtolye: handleYeniAtolye,
    onAtolyeGuncellendi: handleAtolyeGuncellendi,
    onAtolyeSilindi: handleAtolyeSilindi,
  });

  // useMemo ile filtrelemeyi optimize et — debounced filters kullan
  const filteredList = useMemo(() => {
    let filtered = [...atolyeList];

    // Quick status filter (butonlar ile)
    if (activeStatusFilter) {
      filtered = filtered.filter((item) => item.teslim_durumu === activeStatusFilter);
    }

    // Filter by teslim_durumu (select dropdown - exact match)
    if (debouncedFilters.teslim_durumu) {
      filtered = filtered.filter((item) => item.teslim_durumu === debouncedFilters.teslim_durumu);
    }

    // Filter by tarih (kayit_tarihi or created_at) — Ana sayfa mantığıyla
    if (debouncedFilters.tarih) {
      filtered = filtered.filter((item) => {
        const dateValue = item.kayit_tarihi || item.created_at;
        if (!dateValue) return false;
        try {
          return new Date(dateValue).toLocaleDateString('tr-TR').includes(debouncedFilters.tarih);
        } catch (error) {
          return false;
        }
      });
    }

    if (debouncedFilters.bayi_adi) {
      filtered = filtered.filter((item) =>
        item.bayi_adi?.toLocaleLowerCase('tr-TR').includes(debouncedFilters.bayi_adi.toLocaleLowerCase('tr-TR'))
      );
    }

    if (debouncedFilters.musteri_ad_soyad) {
      filtered = filtered.filter((item) =>
        item.musteri_ad_soyad?.toLocaleLowerCase('tr-TR').includes(debouncedFilters.musteri_ad_soyad.toLocaleLowerCase('tr-TR'))
      );
    }

    if (debouncedFilters.tel_no) {
      filtered = filtered.filter((item) =>
        item.tel_no?.includes(debouncedFilters.tel_no.replace(/\D/g, ''))
      );
    }

    if (debouncedFilters.marka) {
      filtered = filtered.filter((item) =>
        item.marka?.toLocaleLowerCase('tr-TR').includes(debouncedFilters.marka.toLocaleLowerCase('tr-TR'))
      );
    }

    if (debouncedFilters.kod) {
      filtered = filtered.filter((item) =>
        (item.kod || '').toLocaleLowerCase('tr-TR').includes(debouncedFilters.kod.toLocaleLowerCase('tr-TR'))
      );
    }

    if (debouncedFilters.seri_no) {
      filtered = filtered.filter((item) =>
        (item.seri_no || '').toLocaleLowerCase('tr-TR').includes(debouncedFilters.seri_no.toLocaleLowerCase('tr-TR'))
      );
    }

    if (debouncedFilters.sikayet) {
      filtered = filtered.filter((item) =>
        item.sikayet?.toLocaleLowerCase('tr-TR').includes(debouncedFilters.sikayet.toLocaleLowerCase('tr-TR'))
      );
    }

    if (debouncedFilters.ozel_not) {
      filtered = filtered.filter((item) =>
        (item.ozel_not || '').toLocaleLowerCase('tr-TR').includes(debouncedFilters.ozel_not.toLocaleLowerCase('tr-TR'))
      );
    }

    if (debouncedFilters.yapilan_islem) {
      filtered = filtered.filter((item) =>
        (item.yapilan_islem || '').toLocaleLowerCase('tr-TR').includes(debouncedFilters.yapilan_islem.toLocaleLowerCase('tr-TR'))
      );
    }

    if (debouncedFilters.note_no) {
      filtered = filtered.filter((item) =>
        (item.note_no || '').toLocaleLowerCase('tr-TR').includes(debouncedFilters.note_no.toLocaleLowerCase('tr-TR'))
      );
    }

    if (debouncedFilters.ucret) {
      filtered = filtered.filter((item) =>
        (item.ucret?.toString() || '').includes(debouncedFilters.ucret)
      );
    }

    if (debouncedFilters.yapilma_tarihi) {
      filtered = filtered.filter((item) => {
        if (!item.yapilma_tarihi) return false;
        try {
          return new Date(item.yapilma_tarihi).toLocaleDateString('tr-TR').includes(debouncedFilters.yapilma_tarihi);
        } catch (error) {
          return false;
        }
      });
    }

    // Sıra numarası olarak ID kullanılıyor
    if (debouncedFilters.sira) {
      filtered = filtered.filter((item) => item.id.toString().includes(debouncedFilters.sira));
    }

    return filtered;
  }, [atolyeList, debouncedFilters, activeStatusFilter]);

  // Pagination için slice edilmiş liste
  const displayedList = useMemo(() => {
    const startIndex = page * rowsPerPage;
    const endIndex = startIndex + rowsPerPage;
    return filteredList.slice(startIndex, endIndex);
  }, [filteredList, page, rowsPerPage]);

  const handleChangePage = useCallback((_event: unknown, newPage: number) => {
    setPage(newPage);
  }, []);

  const handleChangeRowsPerPage = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  }, []);

  // Filtre değiştiğinde sayfayı 0'a sıfırla
  useEffect(() => {
    if (hasActiveFilters) {
      setPage(0);
    }
  }, [debouncedFilters, activeStatusFilter, hasActiveFilters]);

  const handleFilterChange = useCallback((field: string, value: string) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleAdd = useCallback(() => {
    setSelectedAtolyeId(null);
    setDialogOpen(true);
  }, []);

  const handleEdit = useCallback((id: number) => {
    setSelectedAtolyeId(id);
    setDialogOpen(true);
  }, []);

  const handleDelete = useCallback(async (id: number) => {
    if (!window.confirm('Bu kaydı silmek istediğinize emin misiniz?')) return;
    try {
      await atolyeService.delete(id);
      showSnackbar('Kayıt başarıyla silindi', 'success');
      fetchAtolyeList();
    } catch (error) {
      showSnackbar('Kayıt silinirken hata oluştu', 'error');
    }
  }, [showSnackbar, fetchAtolyeList]);

  const handleDialogClose = useCallback((refresh?: boolean) => {
    setDialogOpen(false);
    setSelectedAtolyeId(null);
    if (refresh) {
      fetchAtolyeList();
    }
  }, [fetchAtolyeList]);

  // ⚡ Her durum için kayıt sayısı - tek geçişte.
  // Eskiden filtre çubuğundaki her buton için ayrı `filter()` çalışıyordu:
  // 7 buton × 3000 kayıt = her render'da 21.000 karşılaştırma.
  const statusCountMap = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of atolyeList) {
      const key = item.teslim_durumu || '';
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [atolyeList]);

  const getStatusCount = useCallback(
    (status: string) => (status === 'all' ? atolyeList.length : statusCountMap[status] || 0),
    [atolyeList.length, statusCountMap]
  );

  return (
    <Box sx={{ mt: 2 }}>
      <Paper elevation={3} sx={{ p: 3 }}>
        <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>Atölye Takip</h2>
            <AtolyeStatusFilterBar
              activeStatusFilter={activeStatusFilter}
              onChange={setActiveStatusFilter}
              getStatusCount={getStatusCount}
            />
          </Box>

          {!isBayi && (
            <Button
              variant="contained"
              startIcon={<Add />}
              onClick={handleAdd}
              sx={{ backgroundColor: '#0D3282', '&:hover': { backgroundColor: '#082052' } }}
            >
              Yeni Kayıt
            </Button>
          )}
        </Box>

        {isMobile ? (
          <AtolyeCardView
            atolyeList={filteredList}
            isBayi={isBayi}
            isAdmin={isAdmin}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        ) : (
          <AtolyeTableView
            displayedList={displayedList}
            totalCount={filteredList.length}
            atolyeList={atolyeList}
            loading={loading}
            isBayi={isBayi}
            isAdmin={isAdmin}
            filters={filters}
            onFilterChange={handleFilterChange}
            page={page}
            rowsPerPage={rowsPerPage}
            onChangePage={handleChangePage}
            onChangeRowsPerPage={handleChangeRowsPerPage}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        )}
      </Paper>

      {/* Bayi kayıt açamaz/düzenleyemez; pencere açılışta bayi, marka ve sıra numarası
          listelerini çektiği için bayiye hiç çizilmez (sunucu bunlara 403 döner). */}
      {!isBayi && (
        <AtolyeDialog
          open={dialogOpen}
          onClose={handleDialogClose}
          atolyeId={selectedAtolyeId}
        />
      )}
    </Box>
  );
};

export default memo(AtolyeTakip);
