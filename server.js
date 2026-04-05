
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const methodOverride = require('method-override');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres';
const SESSION_SECRET = process.env.SESSION_SECRET || 'duongmart_secret';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('render.com') || DATABASE_URL.includes('railway.app') ? { rejectUnauthorized: false } : false
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      email VARCHAR(180) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role VARCHAR(20) NOT NULL DEFAULT 'buyer',
      commission_rate NUMERIC(5,2) NOT NULL DEFAULT 10,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      seller_id INT REFERENCES users(id) ON DELETE SET NULL,
      name VARCHAR(180) NOT NULL,
      price NUMERIC(18,2) NOT NULL DEFAULT 0,
      stock INT NOT NULL DEFAULT 0,
      image_url TEXT,
      description TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      buyer_id INT REFERENCES users(id) ON DELETE SET NULL,
      total_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
      customer_name VARCHAR(180),
      customer_phone VARCHAR(50),
      customer_address TEXT,
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INT REFERENCES orders(id) ON DELETE CASCADE,
      product_id INT REFERENCES products(id) ON DELETE SET NULL,
      seller_id INT REFERENCES users(id) ON DELETE SET NULL,
      product_name VARCHAR(180) NOT NULL,
      price NUMERIC(18,2) NOT NULL DEFAULT 0,
      qty INT NOT NULL DEFAULT 1
    );
  `);

  const adminCheck = await pool.query(`SELECT id FROM users WHERE email = 'admin@duongmart.vn' LIMIT 1`);
  if (adminCheck.rowCount === 0) {
    const hash = await bcrypt.hash('admin123', 10);
    await pool.query(
      `INSERT INTO users(name, email, password_hash, role, commission_rate) VALUES ($1,$2,$3,'admin',0)`,
      ['Admin DUONG MART', 'admin@duongmart.vn', hash]
    );
  }
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));

app.use(session({
  store: new pgSession({
    pool,
    tableName: 'session'
  }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));

app.use(async (req, res, next) => {
  res.locals.currentUser = null;
  res.locals.baseUrl = PUBLIC_BASE_URL;
  if (req.session.userId) {
    const result = await pool.query('SELECT id, name, email, role, commission_rate FROM users WHERE id = $1', [req.session.userId]);
    res.locals.currentUser = result.rows[0] || null;
  }
  next();
});

function authRequired(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}
function roleRequired(...roles) {
  return async (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    const result = await pool.query('SELECT id, role FROM users WHERE id = $1', [req.session.userId]);
    const user = result.rows[0];
    if (!user || !roles.includes(user.role)) return res.status(403).send('Không có quyền truy cập');
    next();
  };
}

app.get('/', async (req, res) => {
  const products = await pool.query(`
    SELECT p.*, u.name AS seller_name
    FROM products p
    LEFT JOIN users u ON u.id = p.seller_id
    WHERE p.is_active = TRUE
    ORDER BY p.id DESC
    LIMIT 20
  `);
  res.render('home', { products: products.rows });
});

app.get('/register', (req, res) => {
  res.render('register', { error: null, success: null });
});

app.post('/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) {
      return res.render('register', { error: 'Vui lòng nhập đủ thông tin.', success: null });
    }
    const safeRole = ['buyer', 'seller'].includes(role) ? role : 'buyer';
    const exists = await pool.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [email.trim().toLowerCase()]);
    if (exists.rowCount > 0) {
      return res.render('register', { error: 'Email đã tồn tại.', success: null });
    }
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users(name, email, password_hash, role, commission_rate) VALUES ($1,$2,$3,$4,$5)',
      [name.trim(), email.trim().toLowerCase(), hash, safeRole, safeRole === 'seller' ? 10 : 0]
    );
    return res.render('register', { error: null, success: 'Đăng ký thành công. Bạn có thể đăng nhập ngay.' });
  } catch (err) {
    console.error(err);
    return res.render('register', { error: 'Có lỗi xảy ra khi đăng ký.', success: null });
  }
});

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE email = $1 LIMIT 1', [String(email || '').trim().toLowerCase()]);
    const user = result.rows[0];
    if (!user) return res.render('login', { error: 'Sai email hoặc mật khẩu.' });
    const ok = await bcrypt.compare(password || '', user.password_hash);
    if (!ok) return res.render('login', { error: 'Sai email hoặc mật khẩu.' });
    req.session.userId = user.id;
    if (user.role === 'admin') return res.redirect('/admin');
    if (user.role === 'seller') return res.redirect('/seller/products');
    return res.redirect('/');
  } catch (err) {
    console.error(err);
    res.render('login', { error: 'Không thể đăng nhập.' });
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.get('/admin', roleRequired('admin'), async (req, res) => {
  const users = await pool.query(`SELECT COUNT(*)::int AS total FROM users`);
  const sellers = await pool.query(`SELECT COUNT(*)::int AS total FROM users WHERE role = 'seller'`);
  const products = await pool.query(`SELECT COUNT(*)::int AS total FROM products`);
  res.render('admin-dashboard', {
    stats: {
      users: users.rows[0].total,
      sellers: sellers.rows[0].total,
      products: products.rows[0].total
    }
  });
});

app.get('/admin/products', roleRequired('admin'), async (req, res) => {
  const products = await pool.query(`
    SELECT p.*, u.name AS seller_name, u.email AS seller_email
    FROM products p
    LEFT JOIN users u ON u.id = p.seller_id
    ORDER BY p.id DESC
  `);
  res.render('admin-products', { products: products.rows });
});

app.get('/admin/products/new', roleRequired('admin'), async (req, res) => {
  const sellers = await pool.query(`SELECT id, name, email FROM users WHERE role='seller' ORDER BY id DESC`);
  res.render('admin-product-form', {
    product: null,
    sellers: sellers.rows,
    action: '/admin/products',
    method: 'POST',
    title: 'Thêm sản phẩm'
  });
});

app.post('/admin/products', roleRequired('admin'), async (req, res) => {
  const { seller_id, name, price, stock, image_url, description, is_active } = req.body;
  await pool.query(
    `INSERT INTO products (seller_id, name, price, stock, image_url, description, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [seller_id || null, name, Number(price || 0), Number(stock || 0), image_url || null, description || null, is_active === 'on']
  );
  res.redirect('/admin/products');
});

app.get('/admin/products/:id/edit', roleRequired('admin'), async (req, res) => {
  const product = await pool.query(`SELECT * FROM products WHERE id = $1`, [req.params.id]);
  if (product.rowCount === 0) return res.status(404).send('Không tìm thấy sản phẩm');
  const sellers = await pool.query(`SELECT id, name, email FROM users WHERE role='seller' ORDER BY id DESC`);
  res.render('admin-product-form', {
    product: product.rows[0],
    sellers: sellers.rows,
    action: `/admin/products/${req.params.id}?_method=PUT`,
    method: 'POST',
    title: 'Sửa sản phẩm'
  });
});

app.put('/admin/products/:id', roleRequired('admin'), async (req, res) => {
  const { seller_id, name, price, stock, image_url, description, is_active } = req.body;
  await pool.query(
    `UPDATE products
     SET seller_id=$1, name=$2, price=$3, stock=$4, image_url=$5, description=$6, is_active=$7
     WHERE id=$8`,
    [seller_id || null, name, Number(price || 0), Number(stock || 0), image_url || null, description || null, is_active === 'on', req.params.id]
  );
  res.redirect('/admin/products');
});

app.delete('/admin/products/:id', roleRequired('admin'), async (req, res) => {
  await pool.query(`DELETE FROM products WHERE id=$1`, [req.params.id]);
  res.redirect('/admin/products');
});

app.get('/seller/products', roleRequired('seller', 'admin'), async (req, res) => {
  const isAdmin = res.locals.currentUser.role === 'admin';
  const sql = isAdmin
    ? `SELECT * FROM products ORDER BY id DESC`
    : `SELECT * FROM products WHERE seller_id = $1 ORDER BY id DESC`;
  const params = isAdmin ? [] : [req.session.userId];
  const result = await pool.query(sql, params);
  res.render('seller-products', { products: result.rows });
});

app.get('/seller/products/new', roleRequired('seller', 'admin'), async (req, res) => {
  res.render('seller-product-form', {
    product: null,
    action: '/seller/products',
    method: 'POST',
    title: 'Thêm sản phẩm'
  });
});

app.post('/seller/products', roleRequired('seller', 'admin'), async (req, res) => {
  const { name, price, stock, image_url, description, is_active } = req.body;
  await pool.query(
    `INSERT INTO products (seller_id, name, price, stock, image_url, description, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [req.session.userId, name, Number(price || 0), Number(stock || 0), image_url || null, description || null, is_active === 'on']
  );
  res.redirect('/seller/products');
});

app.get('/seller/products/:id/edit', roleRequired('seller', 'admin'), async (req, res) => {
  const q = await pool.query(`SELECT * FROM products WHERE id=$1`, [req.params.id]);
  if (q.rowCount === 0) return res.status(404).send('Không tìm thấy sản phẩm');
  const product = q.rows[0];
  if (res.locals.currentUser.role !== 'admin' && product.seller_id !== req.session.userId) {
    return res.status(403).send('Không có quyền sửa sản phẩm này');
  }
  res.render('seller-product-form', {
    product,
    action: `/seller/products/${req.params.id}?_method=PUT`,
    method: 'POST',
    title: 'Sửa sản phẩm'
  });
});

app.put('/seller/products/:id', roleRequired('seller', 'admin'), async (req, res) => {
  const q = await pool.query(`SELECT * FROM products WHERE id=$1`, [req.params.id]);
  if (q.rowCount === 0) return res.status(404).send('Không tìm thấy sản phẩm');
  const product = q.rows[0];
  if (res.locals.currentUser.role !== 'admin' && product.seller_id !== req.session.userId) {
    return res.status(403).send('Không có quyền sửa sản phẩm này');
  }
  const { name, price, stock, image_url, description, is_active } = req.body;
  await pool.query(
    `UPDATE products
     SET name=$1, price=$2, stock=$3, image_url=$4, description=$5, is_active=$6
     WHERE id=$7`,
    [name, Number(price || 0), Number(stock || 0), image_url || null, description || null, is_active === 'on', req.params.id]
  );
  res.redirect('/seller/products');
});

app.delete('/seller/products/:id', roleRequired('seller', 'admin'), async (req, res) => {
  const q = await pool.query(`SELECT * FROM products WHERE id=$1`, [req.params.id]);
  if (q.rowCount === 0) return res.status(404).send('Không tìm thấy sản phẩm');
  const product = q.rows[0];
  if (res.locals.currentUser.role !== 'admin' && product.seller_id !== req.session.userId) {
    return res.status(403).send('Không có quyền xóa sản phẩm này');
  }
  await pool.query(`DELETE FROM products WHERE id=$1`, [req.params.id]);
  res.redirect('/seller/products');
});

app.get('/cart', (req, res) => {
  if (!req.session.cart) req.session.cart = [];
  res.render('cart', { cart: req.session.cart });
});

app.post('/cart/add/:id', async (req, res) => {
  const q = await pool.query(`SELECT * FROM products WHERE id=$1 AND is_active=TRUE`, [req.params.id]);
  if (q.rowCount === 0) return res.redirect('/');
  const p = q.rows[0];
  if (!req.session.cart) req.session.cart = [];
  const found = req.session.cart.find(item => item.id === p.id);
  if (found) found.qty += 1;
  else req.session.cart.push({ id: p.id, name: p.name, price: Number(p.price), qty: 1, seller_id: p.seller_id });
  res.redirect('/cart');
});

app.post('/checkout', authRequired, async (req, res) => {
  const cart = req.session.cart || [];
  if (!cart.length) return res.redirect('/cart');
  const customer_name = res.locals.currentUser.name;
  const total = cart.reduce((sum, item) => sum + Number(item.price) * Number(item.qty), 0);
  const order = await pool.query(
    `INSERT INTO orders (buyer_id, total_amount, customer_name, status)
     VALUES ($1,$2,$3,'pending') RETURNING id`,
    [req.session.userId, total, customer_name]
  );
  const orderId = order.rows[0].id;
  for (const item of cart) {
    await pool.query(
      `INSERT INTO order_items (order_id, product_id, seller_id, product_name, price, qty)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [orderId, item.id, item.seller_id, item.name, item.price, item.qty]
    );
  }
  req.session.cart = [];
  res.redirect('/');
});

app.listen(PORT, async () => {
  try {
    await initDb();
    console.log(`DUONG MART PRO V1.1 chạy tại cổng ${PORT}`);
  } catch (err) {
    console.error('Lỗi khởi tạo database:', err);
    process.exit(1);
  }
});
