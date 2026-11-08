import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthPayload } from '../types';
import { isAccountActive } from '../services/accountStatus';

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

/**
 * Bileti (JWT) doğrular ve hesabın hâlâ var ve aktif olduğunu kontrol eder: pasif
 * yapılan ya da silinen hesabın elindeki bilet de hemen reddedilir (bkz. accountStatus).
 * Aynı istekte ikinci kez çağrılırsa (izin tablosu + route) yeniden kontrol etmez.
 */
const authMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  if (req.user && res.locals.authChecked) {
    next();
    return;
  }
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    res.status(401).json({ message: 'Token bulunamadı' });
    return;
  }

  let decoded: AuthPayload;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET || '') as AuthPayload;
  } catch {
    res.status(401).json({ message: 'Geçersiz token' });
    return;
  }

  if (!(await isAccountActive(decoded.role, decoded.id))) {
    res.status(401).json({ message: 'Hesap pasif ya da silinmiş' });
    return;
  }

  req.user = decoded;
  res.locals.authChecked = true;
  next();
};

export default authMiddleware;
