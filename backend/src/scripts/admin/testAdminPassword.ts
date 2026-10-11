import pool, { query } from '../../db';
import bcrypt from 'bcryptjs';

const testAdminPassword = async () => {
  try {
    // Admin kullanıcısının hash'ini al
    const result = await query('SELECT username, password FROM admins WHERE username = $1', ['admin']);
    
    if (result.rows.length === 0) {
      console.log('Admin kullanıcısı bulunamadı!');
      return;
    }
    
    const admin = result.rows[0];
    console.log('Username:', admin.username);
    console.log('Hash (DB):', admin.password);
    
    // Şifre testi
    const testPassword = 'admin123';
    const isValid = await bcrypt.compare(testPassword, admin.password);
    
    console.log('\nŞifre testi:');
    console.log('Test edilen şifre:', testPassword);
    console.log('Şifre geçerli mi?:', isValid);
    
    // Yeni hash oluştur
    const newHash = await bcrypt.hash(testPassword, 10);
    console.log('\nYeni oluşturulan hash:', newHash);
    
    // Yeni hash ile test
    const isNewHashValid = await bcrypt.compare(testPassword, newHash);
    console.log('Yeni hash geçerli mi?:', isNewHashValid);
    
  } catch (error) {
    console.error('Hata:', error);
  } finally {
    await pool.end();
  }
};

testAdminPassword();
