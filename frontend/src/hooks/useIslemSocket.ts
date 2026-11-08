import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { Islem } from '../types';
import { SOCKET_EVENTS } from '../constants/socketEvents';
import { getSocketUrl, socketAuth } from '../services/socketUrl';

export interface UseIslemSocketHandlers {
  onYeniIslem: (islem: Islem) => void;
  onIslemGuncellendi: (islem: Islem) => void;
  onIslemSilindi: (id: number) => void;
  onIslemDurumDegisti: (islem: Islem) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Owns the Dashboard Socket.IO connection for işlem (job) events.
 *
 * - SOCKET_URL, transports, reconnection options unchanged from the legacy
 *   Dashboard inline useEffect.
 * - Event names ('yeni-islem' / 'islem-guncellendi' / 'islem-silindi' /
 *   'islem-durum-degisti' / 'connect' / 'connect_error') and payload shapes
 *   are unchanged.
 * - Default `onConnect` / `onError` preserve the original console.log /
 *   console.error wording when caller does not override.
 * - Uses a ref to hold the latest handlers so the socket connection is
 *   created exactly once on mount (mirrors the legacy empty-deps useEffect)
 *   without going stale.
 */
export function useIslemSocket(handlers: UseIslemSocketHandlers): void {
  // Latest-handlers ref pattern: socket connection lifecycle stays stable
  // (mount-only) while event callbacks always see fresh closures.
  const handlersRef = useRef<UseIslemSocketHandlers>(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const SOCKET_URL = getSocketUrl();

    const socket: Socket = io(SOCKET_URL, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
      transports: ['websocket', 'polling'],
      auth: socketAuth,
    });

    socket.on('connect', () => {
      const { onConnect } = handlersRef.current;
      if (onConnect) onConnect();
      else console.log('Socket.IO bağlantısı kuruldu');
    });

    socket.on('connect_error', (error: Error) => {
      const { onError } = handlersRef.current;
      if (onError) onError(error);
      else console.error('Socket.IO bağlantı hatası:', error);
    });

    socket.on('disconnect', () => {
      const { onDisconnect } = handlersRef.current;
      if (onDisconnect) onDisconnect();
    });

    socket.on(SOCKET_EVENTS.YENI_ISLEM, (islem: Islem) => {
      handlersRef.current.onYeniIslem(islem);
    });

    socket.on(SOCKET_EVENTS.ISLEM_GUNCELLENDI, (updatedIslem: Islem) => {
      handlersRef.current.onIslemGuncellendi(updatedIslem);
    });

    socket.on(SOCKET_EVENTS.ISLEM_SILINDI, (id: number) => {
      handlersRef.current.onIslemSilindi(id);
    });

    socket.on(SOCKET_EVENTS.ISLEM_DURUM_DEGISTI, (updatedIslem: Islem) => {
      handlersRef.current.onIslemDurumDegisti(updatedIslem);
    });

    return () => {
      socket.close();
    };
  }, []);
}
