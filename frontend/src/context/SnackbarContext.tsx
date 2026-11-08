import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';
import { Snackbar, Alert, AlertColor } from '@mui/material';
import { reportClientEvent } from '../services/clientLog';

interface SnackbarContextType {
  showSnackbar: (message: string, severity?: AlertColor) => void;
}

const SnackbarContext = createContext<SnackbarContextType | undefined>(undefined);

export const SnackbarProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [severity, setSeverity] = useState<AlertColor>('info');

  // Stable identity so hook deps (useAtolyeSocket vb.) don't re-mount on every render.
  const showSnackbar = useCallback((msg: string, sev: AlertColor = 'info') => {
    // Teşhis: kullanıcının gördüğü her kırmızı hata mesajı sunucu loguna da gider
    // (uygulamadaki ~66 hata mesajının hepsi buradan geçer).
    if (sev === 'error') reportClientEvent({ tur: 'mesaj', mesaj: msg });
    setMessage(msg);
    setSeverity(sev);
    setOpen(true);
  }, []);

  const handleClose = useCallback((_event?: React.SyntheticEvent | Event, reason?: string) => {
    if (reason === 'clickaway') {
      return;
    }
    setOpen(false);
  }, []);

  const contextValue = useMemo<SnackbarContextType>(() => ({ showSnackbar }), [showSnackbar]);

  return (
    <SnackbarContext.Provider value={contextValue}>
      {children}
      <Snackbar
        open={open}
        autoHideDuration={4000}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Alert onClose={handleClose} severity={severity} variant="filled" sx={{ width: '100%' }}>
          {message}
        </Alert>
      </Snackbar>
    </SnackbarContext.Provider>
  );
};

export const useSnackbar = () => {
  const context = useContext(SnackbarContext);
  if (!context) {
    throw new Error('useSnackbar must be used within SnackbarProvider');
  }
  return context;
};
