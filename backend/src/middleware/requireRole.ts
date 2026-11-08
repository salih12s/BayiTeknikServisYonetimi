import { RequestHandler } from 'express';
import type {} from './auth'; // req.user tip tanımı (çalışma anında bir şey yüklemez)

/**
 * Sunucu tarafı yetki kontrolü. Ekrandaki düğme gizlemeleri güvenlik DEĞİLDİR: isteği
 * doğrudan gönderen biri için tek engel buradaki kurallardır.
 */

export type Role = 'admin' | 'user' | 'bayi' | 'saha';
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
/** Hangi yöntemle hangi roller gelebilir; listede olmayan yöntem herkese kapalıdır. */
export type AccessPolicy = Partial<Record<HttpMethod, readonly Role[]>>;

/** Ofis çalışanları: yönetici ve kullanıcı. */
export const STAFF: readonly Role[] = ['admin', 'user'];
export const ADMIN: readonly Role[] = ['admin'];

/** Saf karar fonksiyonu: bu rol bu yöntemle gelebilir mi? */
export function isAllowed(policy: AccessPolicy, method: string, role: string | undefined): boolean {
  const normalized = (method.toUpperCase() === 'HEAD' ? 'GET' : method.toUpperCase()) as HttpMethod;
  const roles = policy[normalized];
  return !!role && !!roles && (roles as readonly string[]).includes(role);
}

/** İzin tablosunu uygular. authMiddleware'den SONRA kullanılır (req.user dolu olmalı). */
export function allowRoles(policy: AccessPolicy): RequestHandler {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json({ message: 'Giriş gerekli' });
      return;
    }
    if (!isAllowed(policy, req.method, req.user.role)) {
      res.status(403).json({ message: 'Bu işlem için yetkiniz yok' });
      return;
    }
    next();
  };
}

/** Tek bir uç için: yalnızca verilen roller. */
export function requireRole(...roles: Role[]): RequestHandler {
  const policy: AccessPolicy = { GET: roles, POST: roles, PUT: roles, PATCH: roles, DELETE: roles };
  return allowRoles(policy);
}

/** Tanımlamalar (marka, ürün, teknisyen...): ofis okur, yalnızca yönetici değiştirir. */
export const READ_STAFF_WRITE_ADMIN: AccessPolicy = { GET: STAFF, POST: ADMIN, PUT: ADMIN, PATCH: ADMIN, DELETE: ADMIN };
