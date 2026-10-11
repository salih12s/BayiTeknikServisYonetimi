import { RequestParamHandler } from 'express';

/**
 * URL'deki kayıt numarasının tam sayı olduğunu doğrular.
 *
 * PostgreSQL sayı olmayan bir numarayı (`/atolye/12abc`) hata vererek reddediyordu.
 * MySQL aynı değeri sessizce 12'ye çevirir ve 12 numaralı kaydı okur, günceller ya
 * da siler. Bu yüzden değer veritabanına gitmeden burada reddedilir.
 */
const requireIntegerParam: RequestParamHandler = (_req, res, next, value) => {
  if (!/^-?\d+$/.test(String(value))) {
    // Route'lar hata metnini kimi yerde "message", kimi yerde "error" anahtarıyla veriyor.
    res.status(400).json({ message: 'Geçersiz kayıt numarası', error: 'Geçersiz kayıt numarası' });
    return;
  }
  next();
};

export default requireIntegerParam;
