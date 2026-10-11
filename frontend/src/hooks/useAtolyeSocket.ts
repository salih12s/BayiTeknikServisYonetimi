import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { Atolye } from '../types';
import { SOCKET_EVENTS } from '../constants/socketEvents';
import { getSocketUrl } from '../services/socketUrl';

export interface UseAtolyeSocketHandlers {
  onYeniAtolye: (atolye: Atolye) => void;
  onAtolyeGuncellendi: (atolye: Atolye) => void;
  onAtolyeSilindi: (deletedId: number) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Owns the AtolyeTakip Socket.IO connection: connect, listener wiring, cleanup.
 *
 * - Socket URL, transports, reconnection options unchanged from the legacy
 *   AtolyeTakip inline useEffect.
 * - Event names ('yeni-atolye' / 'atolye-guncellendi' / 'atolye-silindi' /
 *   'connect' / 'connect_error') and payload shapes are unchanged.
 * - Default `onConnect` / `onError` preserve the original console.log /
 *   console.error wording when caller does not override.
 * - Cleanup disconnects the socket on unmount or when deps change.
 *
 * The hook does NOT own list state, snackbar, or status counts — caller
 * keeps full ownership via the callbacks.
 */
export function useAtolyeSocket(handlers: UseAtolyeSocketHandlers): void {
  const {
    onYeniAtolye,
    onAtolyeGuncellendi,
    onAtolyeSilindi,
    onConnect,
    onDisconnect,
    onError,
  } = handlers;

  useEffect(() => {
    const SOCKET_URL = getSocketUrl();

    const socket: Socket = io(SOCKET_URL, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => {
      if (onConnect) onConnect();
      else console.log('AtolyeTakip: Socket.IO bağlantısı kuruldu');
    });

    socket.on('connect_error', (error: Error) => {
      if (onError) onError(error);
      else console.error('AtolyeTakip: Socket.IO bağlantı hatası:', error);
    });

    if (onDisconnect) socket.on('disconnect', onDisconnect);

    socket.on(SOCKET_EVENTS.YENI_ATOLYE, (atolye: Atolye) => {
      onYeniAtolye(atolye);
    });

    socket.on(SOCKET_EVENTS.ATOLYE_GUNCELLENDI, (updatedAtolyeRecord: Atolye) => {
      onAtolyeGuncellendi(updatedAtolyeRecord);
    });

    socket.on(SOCKET_EVENTS.ATOLYE_SILINDI, (deletedId: number) => {
      onAtolyeSilindi(deletedId);
    });

    return () => {
      socket.disconnect();
    };
    // Handlers come from caller's useCallback (or fresh closures). We intentionally
    // depend only on the callback identities so the connection re-mounts when
    // caller deps change — matching legacy behavior of the original useEffect.
  }, [onYeniAtolye, onAtolyeGuncellendi, onAtolyeSilindi, onConnect, onDisconnect, onError]);
}
