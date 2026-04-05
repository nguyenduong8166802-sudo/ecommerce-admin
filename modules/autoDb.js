async function initAutoDb(pool) {
  // Base tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(120),
      email VARCHAR(180) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(20) NOT NULL DEFAULT 'buyer',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      seller_id INT REFERENCES users(id) ON DELETE SET NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      image_url TEXT,
      price NUMERIC(18,2) NOT NULL DEFAULT 0,
      stock INT NOT NULL DEFAULT 0,
      is_visible BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      buyer_id INT REFERENCES users(id) ON DELETE SET NULL,
      total NUMERIC(18,2) NOT NULL DEFAULT 0,
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INT REFERENCES orders(id) ON DELETE CASCADE,
      product_id INT REFERENCES products(id) ON DELETE SET NULL,
      qty INT NOT NULL DEFAULT 1,
      price NUMERIC(18,2) NOT NULL DEFAULT 0
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS withdrawal_requests (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      amount NUMERIC(18,2) NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      note TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_marketing (
      id SERIAL PRIMARY KEY,
      banner_text TEXT,
      badge TEXT,
      title TEXT,
      description TEXT,
      cta1 TEXT,
      cta2 TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS session (
      sid varchar NOT NULL,
      sess json NOT NULL,
      expire timestamp(6) NOT NULL,
      PRIMARY KEY (sid)
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS IDX_session_expire ON session (expire);`);

  // Safe additive columns for old databases
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code VARCHAR(100);`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_id INT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_balance NUMERIC(18,2) NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_rate NUMERIC(5,2) NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5,2) NOT NULL DEFAULT 20;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS ref_user_id INT;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS referral_amount NUMERIC(18,2) NOT NULL DEFAULT 0;`);

  // Seed one marketing row if missing
  const mk = await pool.query(`SELECT COUNT(*)::int AS count FROM site_marketing;`);
  if (mk.rows[0].count === 0) {
    await pool.query(`
      INSERT INTO site_marketing (banner_text, badge, title, description, cta1, cta2)
      VALUES ($1,$2,$3,$4,$5,$6)
    `, [
      'Miễn phí vận chuyển đơn từ 299.000đ',
      'AUTO DB PRO',
      'TUYỂN CỘNG TÁC VIÊN BÁN HÀNG',
      'Đăng ký seller để tự đăng sản phẩm, có link affiliate và quản lý đơn cơ bản.',
      'Đăng ký seller',
      'Đăng nhập'
    ]);
  }

  // Seed admin if missing (simple default, change password after login)
  const admin = await pool.query(`SELECT id FROM users WHERE email = 'admin@duongmart.vn' LIMIT 1;`);
  if (admin.rowCount === 0) {
    await pool.query(`
      INSERT INTO users (name, email, password, role, referral_code, referral_rate, commission_rate)
      VALUES ('Admin', 'admin@duongmart.vn', 'admin123', 'admin', 'ADMIN001', 0, 0)
    `);
  }
}

module.exports = { initAutoDb };
