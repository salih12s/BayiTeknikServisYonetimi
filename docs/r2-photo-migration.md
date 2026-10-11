# Saha fotoğrafları: Cloudflare R2

Saha kayıtlarının fotoğrafları veritabanında değil, Cloudflare R2'de durur. Veritabanında
yalnızca dosyaların adresleri (`saha_fotograflari` tablosu) tutulur.

## Nasıl çalışır

1. Tarayıcı fotoğrafı küçültür: en uzun kenar 2000 px JPEG (kalite 82) ve 400 px önizleme.
   Küçültülmüş hali orijinalden büyük çıkarsa orijinal saklanır.
2. `POST /api/saha/foto-yukleme` her dosya için imzalı bir yükleme adresi verir. Tarayıcı
   dosyayı doğrudan R2'ye yükler; fotoğraf API sunucusundan geçmez. Dosyanın boyutu ve
   tipi imzaya dahildir, farklı bir dosya gönderilirse R2 reddeder.
3. Kayıt kaydedilirken yalnızca fotoğraf numaraları (`foto_ids`) gönderilir. Sunucu
   dosyaların gerçekten yüklendiğini doğrular ve fotoğrafları kayda bağlar.
4. Görüntüleme ve indirme, süreli imzalı adreslerle yapılır. Depo dışarıya kapalıdır.
5. Kayıt ya da saha elemanı silinince dosyaların adresleri `r2_silme_kuyrugu` tablosuna
   yazılır ve dosyalar işlem tamamlandıktan sonra R2'den silinir. Kayda bağlanmayan
   yüklemeler 24 saat sonra temizlenir (sunucu saatte bir temizlik yapar).

Eski biçimdeki (veritabanında `foto_data` içinde base64) fotoğraflar okunmaya devam eder.

## Ortam değişkenleri (backend)

| Değişken | Açıklama |
| --- | --- |
| `R2_ENDPOINT` | `https://<HESAP_NO>.r2.cloudflarestorage.com` |
| `R2_BUCKET` | Depo adı |
| `R2_ACCESS_KEY_ID` | Cloudflare R2 API anahtarı |
| `R2_SECRET_ACCESS_KEY` | Cloudflare R2 API gizli anahtarı |

Dördü de tanımlı değilse fotoğraf yükleme `503` döner; uygulamanın geri kalanı çalışır.

Depo CORS ayarı, arayüzün açıldığı adrese `PUT`, `GET` ve `HEAD` izni vermelidir
(izin verilen başlık: `content-type`).

## Veritabanı

`backend/src/migrations/mysql/002_saha_fotograflari.sql` bir kez çalıştırılır.

## Eski fotoğrafların toplu taşınması

`backend/src/scripts/migrateSahaPhotosToR2.ts`, eski PostgreSQL veritabanındaki
fotoğrafları R2'ye taşır. Kaynaktan **yalnızca okur**; hiçbir şeyi silmez ya da değiştirmez.
Komutlar `backend` klasöründen çalıştırılır.

```bash
# 1) Fotoğrafları oku, küçült, R2'ye yükle. Yarıda kesilirse aynı komut kaldığı yerden devam eder.
npx ts-node src/scripts/migrateSahaPhotosToR2.ts upload \
  --source-env .env.production --r2-env .env.r2.local --registry <defter.jsonl>

# 2) Kaynağı defterle karşılaştır ve depodaki her dosyayı kontrol et.
npx ts-node src/scripts/migrateSahaPhotosToR2.ts verify \
  --source-env .env.production --registry <defter.jsonl> --check-storage --r2-env .env.r2.local

# 3) Taşınan fotoğrafları yeni (MySQL) veritabanındaki kayıtlara bağla.
npx ts-node src/scripts/migrateSahaPhotosToR2.ts import \
  --target-env .env.hostinger.local --registry <defter.jsonl> [--remote]
```

- **Kayıt defteri** (`--registry`) taşınan her kaydın sonucunu tutan yerel bir dosyadır.
  Taşıma bitene kadar silinmemelidir. Müşteri adlarından türeyen dosya adları içerir;
  depo (git) klasörünün dışında tutun.
- `upload` yeniden çalıştırıldığında yalnızca taşınmamış, kaynakta değişmiş ya da hatalı
  kalmış kayıtları işler. Geçiş günü son bir kez çalıştırmak yeni gelenleri taşır.
- `--limit <n>` ve `--newest` küçük bir deneme taşıması için kullanılır.
- Açılamayan bir fotoğraf atılmaz; olduğu gibi saklanır ve `verify` raporunda görünür.
- `import` yeniden çalıştırılabilir: taşınmış satırları defterden baştan kurar.

## Testler

```bash
npm test          # birim testleri (veritabanı ve ağ gerektirmez)
npm run test:db   # gerçek MariaDB'ye karşı API testleri (.env.test.local, adı _test ile biten veritabanı)
```
