/**
 * Hostinger (Node.js barındırma) için yayın paketi üretir.
 *
 * Çıktı: deploy/hostinger/projecrm-hostinger.zip
 *   package.json, package-lock.json   Hostinger'ın derleme adımı için (bağımlılık yok)
 *   dist/main.cjs                     sunucu: bütün bağımlılıklarıyla tek dosya
 *   dist/public/                      derlenmiş arayüz (sunucu bu klasörü sunar)
 *   dist/package.json, package-lock.json
 *
 * Sunucu tek dosyada toplandığı için barındırma tarafında paket kurulumuna bağlı
 * değildir. Arayüz API'ye ve Socket.IO'ya kendi adresinden (/api) bağlanacak şekilde
 * derlenir.
 *
 * Kullanım (depo kökünden):  node scripts/package-hostinger.cjs
 * Hostinger derleme ayarı:   app_type nest, node 24, output_directory dist,
 *                            build_script build, entry_file main.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const backend = path.join(root, 'backend');
const frontend = path.join(root, 'frontend');
const out = path.join(root, 'deploy', 'hostinger');
const dist = path.join(out, 'dist');
const zipName = 'projecrm-hostinger.zip';

function run(label, command, args, options = {}) {
  console.log(`\n> ${label}`);
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32', ...options });
  if (result.status !== 0) {
    console.error(`\nPaketleme durdu: "${label}" başarısız (çıkış kodu ${result.status})`);
    process.exit(1);
  }
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

// 1) Tip kontrolü: hatalı kod pakete girmesin.
run('backend tip kontrolü', 'npx', ['tsc', '--noEmit', '-p', '.'], { cwd: backend });
run('frontend tip kontrolü', 'npx', ['tsc', '--noEmit'], { cwd: frontend });

// 2) Arayüz. Adresler göreceli: arayüz ve API aynı sunucudadır. Yereldeki
//    .env.production başka bir API adresi verse bile burada verilen değer geçerlidir.
run('arayüz derlemesi', 'npx', ['vite', 'build', '--outDir', path.join(dist, 'public'), '--emptyOutDir'], {
  cwd: frontend,
  env: { ...process.env, VITE_API_URL: '/api', VITE_SOCKET_URL: '' },
});

// 3) Sunucu: bağımlılıklarıyla birlikte tek dosya.
console.log('\n> sunucu paketi (esbuild)');
const esbuild = require(path.join(frontend, 'node_modules', 'esbuild'));
const bundle = esbuild.buildSync({
  entryPoints: [path.join(backend, 'src', 'server.ts')],
  outfile: path.join(dist, 'main.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  // ws'in isteğe bağlı hızlandırıcıları; kurulu değilse ws saf JavaScript ile çalışır.
  external: ['bufferutil', 'utf-8-validate'],
  // Ortam değişkeni verilmemişse üretim modunda açıl (arayüzü sunmak buna bağlı).
  banner: { js: "process.env.NODE_ENV = process.env.NODE_ENV || 'production';" },
  legalComments: 'none',
  logLevel: 'warning',
  metafile: true,
});
const bundled = Object.keys(bundle.metafile.inputs);
// Taşıma araçları ve testler sunucuya girmemeli.
const unwanted = bundled.filter((file) => /[\\/](scripts|sharp|pg)[\\/]|\.test\.ts$/.test(file));
if (unwanted.length > 0) {
  console.error('Sunucu paketine girmemesi gereken dosyalar var:', unwanted.slice(0, 5));
  process.exit(1);
}

// 4) Paket tanımları. Bağımlılık yoktur; kilit dosyası da buna göre boştur.
const version = require(path.join(backend, 'package.json')).version;
const manifest = (extra) => ({ name: 'projecrm-hostinger', version, private: true, ...extra });
const lock = { name: 'projecrm-hostinger', version, lockfileVersion: 3, requires: true, packages: { '': { name: 'projecrm-hostinger', version } } };
const json = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
json(path.join(out, 'package.json'), manifest({ scripts: { build: 'node -e "console.log(\'hazir paket\')"', start: 'node dist/main.cjs' } }));
json(path.join(out, 'package-lock.json'), lock);
json(path.join(dist, 'package.json'), manifest({ main: 'main.cjs', scripts: { start: 'node main.cjs' } }));
json(path.join(dist, 'package-lock.json'), lock);

// 5) Zip. Windows'un kendi tar'ı zip'i ileri eğik çizgili yollarla yazar
//    (PowerShell Compress-Archive ters eğik çizgi kullanır, Linux'ta açılmaz).
const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
run('zip', tar, ['-a', '-cf', zipName, 'package.json', 'package-lock.json', 'dist'], { cwd: out, shell: false });

const size = (file) => `${(fs.statSync(file).size / 1048576).toFixed(2)} MB`;
console.log(`\nHazır: ${path.join(out, zipName)} (${size(path.join(out, zipName))})`);
console.log(`  sunucu  dist/main.cjs ${size(path.join(dist, 'main.cjs'))} (${bundled.length} kaynak dosya)`);
console.log(`  arayüz  dist/public`);
