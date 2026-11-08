import React, { useEffect } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import { lastApiProtocol, reportClientEvent } from '../../services/clientLog';

interface LoadingProps {
  message?: string;
}

/** Bu süreden uzun görünen "Yükleniyor..." ekranı sunucu loguna bildirilir. */
const SLOW_LOADING_MS = 10_000;
/** Ekran hâlâ açıksa (takıldı ya da kullanıcı sayfayı kapattı) bu anda bir kez bildirilir. */
const STUCK_LOADING_MS = 15_000;

const Loading: React.FC<LoadingProps> = ({ message = 'Yükleniyor...' }) => {
  // Teşhis: CDN takılması gibi durumlarda kullanıcı bu ekranda bekliyor; sunucu bunu
  // göremez çünkü istek ona hiç ulaşmaz.
  useEffect(() => {
    const started = performance.now();
    let reported = false;
    const report = (ayrinti: string) => {
      if (reported) return;
      reported = true;
      reportClientEvent(
        { tur: 'yavas-yukleme', mesaj: message, ms: Math.round(performance.now() - started), ayrinti, protokol: lastApiProtocol() },
        `yavas-yukleme|${message}`,
      );
    };
    const stuckTimer = setTimeout(() => report('hâlâ bekliyor'), STUCK_LOADING_MS);
    return () => {
      clearTimeout(stuckTimer);
      if (performance.now() - started >= SLOW_LOADING_MS) report('sonunda açıldı');
    };
  }, [message]);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '400px',
        gap: 2,
      }}
    >
      <CircularProgress size={60} />
      <Typography variant="h6" color="text.secondary">
        {message}
      </Typography>
    </Box>
  );
};

export default Loading;
