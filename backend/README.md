# ProjeCRM Backend

ProjeCRM’in sunucu katmanı; kimlik doğrulama, rol bazlı erişim, iş kuralları, MySQL/MariaDB veri erişimi, Cloudflare R2 fotoğraf depolama ve gerçek zamanlı olay yönetiminden sorumludur.

## Sorumluluklar

- Yönetici, standart kullanıcı, bayi ve saha personeli oturumları
- Servis ve müşteri geçmişi işlemleri
- Atölye kayıtları ve durum akışları
- Saha personeli ile fotoğraflı çalışma kayıtları
- Teknisyen, ürün, marka, bayi, montaj ve aksesuar tanımları
- Kullanıcı aktivitesi ve yönetsel özetler
- Socket.IO üzerinden servis ve atölye değişikliklerinin yayınlanması

## Katmanlar

```text
src/
├── routes/       REST kaynakları ve iş akışları
├── middleware/   JWT doğrulama ve istek kontrolleri
├── services/     Ortak uygulama servisleri
├── constants/    Paylaşılan olay ve sabit tanımları
├── types/        TypeScript veri sözleşmeleri
├── scripts/      Şema, indeks ve bakım araçları
├── db.ts         MySQL/MariaDB bağlantı havuzu (mysql2)
├── migrations/   mysql/ güncel şema; postgres-archive/ eski PostgreSQL taslakları
└── server.ts     Express ve Socket.IO uygulaması
```

## Teknik yaklaşım

- Parametreli MySQL/MariaDB sorguları
- Bağlantı havuzu ve geçici hatalar için sınırlı yeniden deneme
- Durum, tarih, telefon ve sıralama alanlarında performans indeksleri
- JWT tabanlı korunan kaynaklar
- Frontend ile ortak isimlendirilen Socket.IO olayları
- TypeScript ile tip güvenli istek ve veri sözleşmeleri

Backend katmanı, arayüzden bağımsız bir operasyon merkezi olarak tasarlanmıştır; veri bütünlüğü ve rol kontrolleri sunucu tarafında korunur.
