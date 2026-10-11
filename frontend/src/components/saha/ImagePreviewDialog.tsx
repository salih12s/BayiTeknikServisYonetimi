import React, { useState, useRef, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  Typography,
  Box,
  Button,
} from '@mui/material';
import {
  ZoomIn,
  ZoomOut,
  Fullscreen,
  FullscreenExit,
  Close,
  Download,
} from '@mui/icons-material';
import { SahaPhoto, buildPhotoFileName, downloadPhoto } from '../../utils/sahaPhoto';

interface Props {
  photos: SahaPhoto[];
  /** Orijinal adı olmayan (eski) fotoğraflar için indirme adı tabanı. */
  fallbackName?: string;
  onClose: () => void;
}

const ImagePreviewDialog: React.FC<Props> = ({ photos, fallbackName = 'fotograf', onClose }) => {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [transformOrigin, setTransformOrigin] = useState({ x: 50, y: 50 });
  const [isPanning, setIsPanning] = useState(false);
  const [panPosition, setPanPosition] = useState({ x: 0, y: 0 });
  const [startPan, setStartPan] = useState({ x: 0, y: 0 });
  const [lastTouchDistance, setLastTouchDistance] = useState<number | null>(null);
  const [lastTouchCenter, setLastTouchCenter] = useState<{ x: number; y: number } | null>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);

  // Sürükleme gerçekten oldu mu? Fare bırakıldığında tarayıcı `mouseup`'tan
  // SONRA bir `click` daha ateşler; o sırada `isPanning` çoktan false olduğu
  // için zoom toggle'ı çalışıp görüntüyü sıfırlıyordu ("kaydırınca kendini
  // atıyor"). State yerine ref kullanılıyor: click handler'ının kapanışında
  // bayat kalmaz.
  const didPanRef = useRef(false);
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const PAN_THRESHOLD_PX = 4;

  const markPointerDown = (x: number, y: number) => {
    didPanRef.current = false;
    pointerDownRef.current = { x, y };
  };

  const markPointerMove = (x: number, y: number) => {
    const start = pointerDownRef.current;
    if (!start) return;
    if (Math.hypot(x - start.x, y - start.y) > PAN_THRESHOLD_PX) {
      didPanRef.current = true;
    }
  };

  // Yeni resim seti açıldığında durumları sıfırla
  useEffect(() => {
    if (photos.length > 0) {
      setCurrentImageIndex(0);
      setZoomLevel(1);
      setPanPosition({ x: 0, y: 0 });
      setTransformOrigin({ x: 50, y: 50 });
    }
  }, [photos]);

  const handleClose = () => {
    setZoomLevel(1);
    setIsFullscreen(false);
    setPanPosition({ x: 0, y: 0 });
    setTransformOrigin({ x: 50, y: 50 });
    onClose();
  };

  const isCompact = isFullscreen || (typeof window !== 'undefined' && window.innerWidth < 600);
  const compactColor = isCompact ? 'white' : 'inherit';

  const currentPhoto = photos[currentImageIndex];
  const currentFileName = currentPhoto
    ? buildPhotoFileName(currentPhoto, fallbackName, currentImageIndex, photos.length)
    : '';

  const handleDownload = () => {
    if (currentPhoto) downloadPhoto(currentPhoto, currentFileName);
  };

  return (
    <Dialog
      open={photos.length > 0}
      onClose={handleClose}
      maxWidth={isFullscreen ? false : 'lg'}
      fullWidth={!isFullscreen}
      fullScreen={isCompact}
      PaperProps={{
        sx: isCompact ? { bgcolor: 'rgba(0,0,0,0.95)' } : {},
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          color: compactColor,
          p: { xs: 1, sm: 2 },
        }}
      >
        <Typography variant="body1" sx={{ fontSize: { xs: '0.85rem', sm: '1rem' } }}>
          Fotoğraf {photos.length > 1 ? `(${currentImageIndex + 1}/${photos.length})` : ''}
        </Typography>
        <Box sx={{ display: 'flex', gap: { xs: 0, sm: 0.5 } }}>
          <IconButton
            size="small"
            onClick={() => setZoomLevel((prev) => Math.max(0.5, prev - 0.25))}
            disabled={zoomLevel <= 0.5}
            title="Küçült"
            sx={{ color: compactColor }}
          >
            <ZoomOut fontSize="small" />
          </IconButton>
          <Typography
            sx={{ display: 'flex', alignItems: 'center', minWidth: 40, justifyContent: 'center', fontSize: '0.8rem' }}
          >
            {Math.round(zoomLevel * 100)}%
          </Typography>
          <IconButton
            size="small"
            onClick={() => setZoomLevel((prev) => Math.min(5, prev + 0.25))}
            disabled={zoomLevel >= 5}
            title="Büyült"
            sx={{ color: compactColor }}
          >
            <ZoomIn fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            onClick={handleDownload}
            disabled={!currentPhoto}
            title={currentFileName ? `İndir: ${currentFileName}` : 'İndir'}
            sx={{ color: compactColor }}
          >
            <Download fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            onClick={() => setIsFullscreen((prev) => !prev)}
            title={isFullscreen ? 'Normal Mod' : 'Tam Ekran'}
            sx={{ color: compactColor, display: { xs: 'none', sm: 'inline-flex' } }}
          >
            {isFullscreen ? <FullscreenExit fontSize="small" /> : <Fullscreen fontSize="small" />}
          </IconButton>
          <IconButton size="small" onClick={handleClose} title="Kapat" sx={{ color: compactColor }}>
            <Close fontSize="small" />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent
        sx={{
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          p: { xs: 0.5, sm: 1 },
        }}
      >
        {photos.length > 0 && (
          <Box sx={{ textAlign: 'center', width: '100%' }}>
            <Box
              ref={imageContainerRef}
              sx={{
                overflow: 'hidden',
                maxHeight: isCompact ? 'calc(100vh - 180px)' : '70vh',
                minHeight: { xs: '50vh', sm: 'auto' },
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                cursor: zoomLevel > 1 ? (isPanning ? 'grabbing' : 'grab') : 'zoom-in',
                userSelect: 'none',
                position: 'relative',
                touchAction: 'none',
              }}
              onWheel={(e) => {
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                const x = ((e.clientX - rect.left) / rect.width) * 100;
                const y = ((e.clientY - rect.top) / rect.height) * 100;
                setTransformOrigin({ x, y });

                if (e.deltaY < 0) {
                  setZoomLevel((prev) => Math.min(5, prev + 0.25));
                } else {
                  setZoomLevel((prev) => {
                    const newZoom = Math.max(1, prev - 0.25);
                    if (newZoom === 1) {
                      setPanPosition({ x: 0, y: 0 });
                      setTransformOrigin({ x: 50, y: 50 });
                    }
                    return newZoom;
                  });
                }
              }}
              // Mouse events (desktop)
              onMouseDown={(e) => {
                markPointerDown(e.clientX, e.clientY);
                if (zoomLevel > 1) {
                  setIsPanning(true);
                  setStartPan({ x: e.clientX - panPosition.x, y: e.clientY - panPosition.y });
                }
              }}
              onMouseMove={(e) => {
                if (isPanning && zoomLevel > 1) {
                  markPointerMove(e.clientX, e.clientY);
                  setPanPosition({
                    x: e.clientX - startPan.x,
                    y: e.clientY - startPan.y,
                  });
                }
              }}
              onMouseUp={() => setIsPanning(false)}
              onMouseLeave={() => setIsPanning(false)}
              onClick={(e) => {
                // Sürükleme yapıldıysa bu click zoom'u değiştirmemeli.
                if (didPanRef.current) {
                  didPanRef.current = false;
                  return;
                }

                const rect = e.currentTarget.getBoundingClientRect();
                const x = ((e.clientX - rect.left) / rect.width) * 100;
                const y = ((e.clientY - rect.top) / rect.height) * 100;

                if (zoomLevel === 1) {
                  setTransformOrigin({ x, y });
                  setZoomLevel(2);
                } else if (zoomLevel >= 2) {
                  setZoomLevel(1);
                  setPanPosition({ x: 0, y: 0 });
                  setTransformOrigin({ x: 50, y: 50 });
                }
              }}
              // Touch events (mobile pinch-to-zoom + pan)
              onTouchStart={(e) => {
                if (e.touches.length === 2) {
                  e.preventDefault();
                  const dx = e.touches[0].clientX - e.touches[1].clientX;
                  const dy = e.touches[0].clientY - e.touches[1].clientY;
                  setLastTouchDistance(Math.hypot(dx, dy));
                  setLastTouchCenter({
                    x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
                    y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
                  });
                } else if (e.touches.length === 1) {
                  markPointerDown(e.touches[0].clientX, e.touches[0].clientY);
                  if (zoomLevel > 1) {
                    setIsPanning(true);
                    setStartPan({ x: e.touches[0].clientX - panPosition.x, y: e.touches[0].clientY - panPosition.y });
                  }
                }
              }}
              onTouchMove={(e) => {
                if (e.touches.length === 2 && lastTouchDistance !== null) {
                  e.preventDefault();
                  const dx = e.touches[0].clientX - e.touches[1].clientX;
                  const dy = e.touches[0].clientY - e.touches[1].clientY;
                  const newDist = Math.hypot(dx, dy);
                  const scale = newDist / lastTouchDistance;

                  setZoomLevel((prev) => {
                    const newZoom = Math.min(5, Math.max(1, prev * scale));
                    if (newZoom === 1) {
                      setPanPosition({ x: 0, y: 0 });
                      setTransformOrigin({ x: 50, y: 50 });
                    }
                    return newZoom;
                  });
                  setLastTouchDistance(newDist);

                  // Pan while pinching
                  if (lastTouchCenter) {
                    const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                    const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
                    setPanPosition((prev) => ({
                      x: prev.x + (cx - lastTouchCenter.x),
                      y: prev.y + (cy - lastTouchCenter.y),
                    }));
                    setLastTouchCenter({ x: cx, y: cy });
                  }
                } else if (e.touches.length === 1 && isPanning && zoomLevel > 1) {
                  markPointerMove(e.touches[0].clientX, e.touches[0].clientY);
                  setPanPosition({
                    x: e.touches[0].clientX - startPan.x,
                    y: e.touches[0].clientY - startPan.y,
                  });
                }
              }}
              onTouchEnd={(e) => {
                if (e.touches.length < 2) {
                  setLastTouchDistance(null);
                  setLastTouchCenter(null);
                }
                if (e.touches.length === 0) {
                  setIsPanning(false);
                }
              }}
            >
              <img
                src={photos[currentImageIndex]?.url}
                alt="Preview"
                draggable={false}
                style={{
                  transform: `scale(${zoomLevel}) translate(${panPosition.x / zoomLevel}px, ${panPosition.y / zoomLevel}px)`,
                  transformOrigin: `${transformOrigin.x}% ${transformOrigin.y}%`,
                  transition: isPanning ? 'none' : 'transform 0.2s ease',
                  maxWidth: '100%',
                  maxHeight: isCompact ? 'calc(100vh - 180px)' : '70vh',
                  objectFit: 'contain',
                  // pointerEvents:'none' kaldırıldı: tarayıcının sağ tık ->
                  // "Resmi farklı kaydet" menüsü ancak görsel olay hedefi
                  // olabildiğinde çıkıyor. Olaylar zaten kapsayıcıya
                  // baloncuklandığı için pan/zoom etkilenmiyor.
                  imageRendering: zoomLevel > 1 ? ('high-quality' as any) : 'auto',
                  WebkitBackfaceVisibility: 'hidden',
                  filter: zoomLevel > 1.5 ? 'contrast(1.02) saturate(1.02)' : 'none',
                }}
              />
            </Box>
            {photos.length > 1 && (
              <Box sx={{ display: 'flex', justifyContent: 'center', gap: { xs: 1, sm: 2 }, mt: 1.5 }}>
                <Button
                  variant="outlined"
                  size="small"
                  sx={{
                    color: compactColor,
                    borderColor: isCompact ? 'rgba(255,255,255,0.5)' : 'inherit',
                  }}
                  onClick={() => {
                    setCurrentImageIndex((prev) => (prev - 1 + photos.length) % photos.length);
                    setZoomLevel(1);
                    setPanPosition({ x: 0, y: 0 });
                    setTransformOrigin({ x: 50, y: 50 });
                  }}
                >
                  ← Önceki
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  sx={{
                    color: compactColor,
                    borderColor: isCompact ? 'rgba(255,255,255,0.5)' : 'inherit',
                  }}
                  onClick={() => {
                    setCurrentImageIndex((prev) => (prev + 1) % photos.length);
                    setZoomLevel(1);
                    setPanPosition({ x: 0, y: 0 });
                    setTransformOrigin({ x: 50, y: 50 });
                  }}
                >
                  Sonraki →
                </Button>
              </Box>
            )}
            {/* Thumbnails */}
            {photos.length > 1 && (
              <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center', mt: 1.5, flexWrap: 'wrap', pb: 1 }}>
                {photos.map((photo, idx) => (
                  <Box
                    key={idx}
                    onClick={() => {
                      setCurrentImageIndex(idx);
                      setZoomLevel(1);
                      setPanPosition({ x: 0, y: 0 });
                      setTransformOrigin({ x: 50, y: 50 });
                    }}
                    sx={{
                      width: { xs: 45, sm: 60 },
                      height: { xs: 45, sm: 60 },
                      cursor: 'pointer',
                      border: idx === currentImageIndex ? '3px solid #1976d2' : '1px solid rgba(255,255,255,0.3)',
                      borderRadius: 1,
                      overflow: 'hidden',
                      flexShrink: 0,
                    }}
                  >
                    <img
                      src={photo.thumbUrl}
                      alt={photo.name || `Thumb ${idx + 1}`}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ImagePreviewDialog;
