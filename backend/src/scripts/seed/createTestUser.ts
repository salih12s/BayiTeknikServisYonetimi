import { query } from '../../db';
import bcrypt from 'bcryptjs';

async function createTestUser() {
  try {
    const username = 'ali01';
    const password = '123456';

    // Önce kullanıcı var mı kontrol et
    const existingUser = await query(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );

    if (existingUser.rows.length > 0) {
      console.log('⚠️  Kullanıcı zaten mevcut, siliniyor...');
      await query('DELETE FROM users WHERE username = $1', [username]);
    }

    // Şifreyi hashle
    const hashedPassword = await bcrypt.hash(password, 10);
    console.log('🔐 Hash oluşturuldu:', hashedPassword);

    // Kullanıcıyı oluştur
    const result = await query(
      'INSERT INTO users (username, password, created_at, is_active) VALUES ($1, $2, NOW(6), TRUE) RETURNING *',
      [username, hashedPassword]
    );

    console.log('✓ Kullanıcı oluşturuldu:', result.rows[0]);

    // Şifre doğrulamasını test et
    const isValid = await bcrypt.compare(password, hashedPassword);
    console.log('✓ Şifre doğrulama testi:', isValid ? 'BAŞARILI ✓' : 'BAŞARISIZ ✗');

    // Database'den kullanıcıyı çek ve test et
    const dbUser = await query('SELECT * FROM users WHERE username = $1', [username]);
    const dbPasswordValid = await bcrypt.compare(password, dbUser.rows[0].password);
    console.log('✓ Database şifre kontrolü:', dbPasswordValid ? 'BAŞARILI ✓' : 'BAŞARISIZ ✗');

    console.log('\n📌 Giriş Bilgileri:');
    console.log('   Kullanıcı Adı:', username);
    console.log('   Şifre:', password);
    console.log('   Aktif:', dbUser.rows[0].is_active);

    process.exit(0);
  } catch (error) {
    console.error('❌ Hata:', error);
    process.exit(1);
  }
}

createTestUser();
