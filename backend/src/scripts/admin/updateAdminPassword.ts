import pool, { query } from '../../db';
import bcrypt from 'bcryptjs';

const updateAdminPassword = async () => {
  try {
    // Önce mevcut admin kullanıcısını sil
    await query('DELETE FROM admins WHERE username = $1', ['admin']);
    console.log('✓ Eski admin kullanıcısı silindi');
    
    // Yeni hash oluştur
    const password = 'admin123';
    const hash = await bcrypt.hash(password, 10);
    console.log('✓ Yeni hash oluşturuldu:', hash);
    
    // Yeni admin kullanıcısı ekle
    await query(
      'INSERT INTO admins (username, password) VALUES ($1, $2)',
      ['admin', hash]
    );
    console.log('✓ Yeni admin kullanıcısı oluşturuldu');
    console.log('\nGiriş bilgileri:');
    console.log('Username: admin');
    console.log('Password: admin123');
    
  } catch (error) {
    console.error('Hata:', error);
  } finally {
    await pool.end();
  }
};

updateAdminPassword();
