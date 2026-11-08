import jwt from 'jsonwebtoken';
import type { Server } from 'socket.io';
import { AuthPayload } from '../types';
import { isAccountActive } from './accountStatus';

/**
 * Canlı güncelleme (Socket.IO) yetkisi. Eskiden bağlantıda kimlik sorulmuyor ve her
 * olay (müşterinin adı, adresi, telefonu dahil) bağlı HERKESE gidiyordu: giriş yapmamış
 * biri de dinleyebiliyor, bayiler diğer bayilerin kayıtlarını alıyordu.
 *
 * Şimdi: bağlanırken bilet (JWT) zorunlu; olaylar odalara gider.
 *   staff        yönetici + kullanıcı: bütün işlem ve atölye olayları
 *   bayi:<isim>  o bayi: yalnızca kendi atölye kayıtlarının olayları
 *   saha         oda yok (saha paneli canlı olay kullanmıyor)
 */

export const STAFF_ROOM = 'staff';
export const bayiRoom = (bayiIsim: string) => `bayi:${bayiIsim}`;

export function roomsFor(user: Pick<AuthPayload, 'role' | 'bayiIsim'>): string[] {
  if (user.role === 'admin' || user.role === 'user') return [STAFF_ROOM];
  if (user.role === 'bayi' && user.bayiIsim) return [bayiRoom(user.bayiIsim)];
  return [];
}

export function setupSocketAuth(io: Server): void {
  io.use(async (socket, next) => {
    try {
      const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
      if (typeof token !== 'string' || !token) return next(new Error('Giriş gerekli'));
      const user = jwt.verify(token, process.env.JWT_SECRET || '') as AuthPayload;
      if (!(await isAccountActive(user.role, user.id))) return next(new Error('Hesap pasif ya da silinmiş'));
      socket.data.user = user;
      for (const room of roomsFor(user)) await socket.join(room);
      return next();
    } catch {
      return next(new Error('Geçersiz giriş'));
    }
  });
}

/** Testlerdeki basit sahte `io` nesnelerinde oda (`to`) olmayabilir. */
type Emitter = { emit: (event: string, payload: unknown) => unknown };
type RoomCapable = Emitter & { to?: (room: string | string[]) => Emitter };

function toRooms(io: RoomCapable | undefined, rooms: string[]): Emitter | undefined {
  if (!io) return undefined;
  return typeof io.to === 'function' ? io.to(rooms) : io;
}

/** İşlem olayları: yalnızca ofis. */
export function emitIslemEvent(io: RoomCapable | undefined, event: string, payload: unknown): void {
  toRooms(io, [STAFF_ROOM])?.emit(event, payload);
}

/** Atölye olayları: ofis + yalnızca kaydın sahibi bayi. */
export function emitAtolyeEvent(
  io: RoomCapable | undefined,
  event: string,
  payload: unknown,
  bayiAdi: string | null | undefined,
): void {
  toRooms(io, bayiAdi ? [STAFF_ROOM, bayiRoom(bayiAdi)] : [STAFF_ROOM])?.emit(event, payload);
}
