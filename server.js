
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const methodOverride = require('method-override');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;
const DATABASE_URL = process.env.DATABASE_URL;
const SESSION_SECRET = process.env.SESSION_SECRET || 'duongmart_secret';

if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

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
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

app.use(async (req, res, next) => {
  res.locals.currentUser = null;
  if (req.session.userId) {
    const { rows } = await pool.query('SELECT id, email, full_name, role FROM users WHERE id = $1', [req.session.userId]);
    res.locals.currentUser = rows[0] || null;
  }
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}
function requireAdmin(req, res, next) {
  if (!res.locals.currentUser || res.locals.currentUser.role !== 'admin') return res.status(403).send('Admin only');
  next();
}
function requireSeller(req, res, next) {
  if (!res.locals.currentUser || !['seller','admin'].includes(res.locals.currentUser.role)) return res.status(403).send('Seller only');
  next();
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      full_name VARCHAR(120) NOT NULL,
      email VARCHAR(190) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role VARCHAR(20) NOT NULL DEFAULT 'buyer',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      seller_id INT REFERENCES users(id) ON DELETE SET NULL,
      name VARCHAR(255) NOT NULL,
      price NUMERIC(18,2) NOT NULL DEFAULT 0,
      stock INT NOT NULL DEFAULT 0,
      image_url TEXT,
      description TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const adminEmail = 'admin@duongmart.vn';
  const sellerEmail = 'seller1@duongmart.vn';
  const buyerEmail = 'buyer1@duongmart.vn';

  async function ensureUser(fullName, email, password, role) {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rowCount) return existing.rows[0].id;
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO users(full_name, email, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id',
      [fullName, email, hash, role]
    );
    return rows[0].id;
  }

  const adminId = await ensureUser('Admin DUONG MART', adminEmail, 'admin123', 'admin');
  const sellerId = await ensureUser('Seller 1', sellerEmail, 'seller123', 'seller');
  await ensureUser('Buyer 1', buyerEmail, 'buyer123', 'buyer');

  const count = await pool.query('SELECT COUNT(*)::int AS c FROM products');
  if (!count.rows[0].c) {
    await pool.query(
      `INSERT INTO products (seller_id, name, price, stock, image_url, description, is_active)
       VALUES 
       ($1,'Sườn nướng BBQ',189000,30,'https://i.ibb.co/FkBztNtw/HINH-CHI-BAO.jpg','Sườn ướp sẵn, đậm vị BBQ, tiện chế biến.',TRUE),
       ($1,'Combo rau củ sạch',59000,50,'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=800&q=80','Combo rau củ sạch dùng cho gia đình.',TRUE),
       ($2,'Chỉ báo Smart Pro',2999000,100,'https://i.ibb.co/FkBztNtw/HINH-CHI-BAO.jpg','Sản phẩm số cho trader.',TRUE)`,
      [adminId, sellerId]
    );
  }
}

app.get('/', async (req, res) => {
  const { rows: products } = await pool.query(`
    SELECT p.*, u.full_name AS seller_name
    FROM products p
    LEFT JOIN users u ON u.id = p.seller_id
    WHERE p.is_active = TRUE
    ORDER BY p.id DESC
    LIMIT 12
  `);
  res.render('home', { products });
});

app.get('/login', (req, res) => res.render('login', { error: null }));

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  if (!rows.length) return res.render('login', { error: 'Sai email hoặc mật khẩu.' });
  const user = rows[0];
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.render('login', { error: 'Sai email hoặc mật khẩu.' });
  req.session.userId = user.id;
  if (user.role === 'admin') return res.redirect('/admin/products');
  if (user.role === 'seller') return res.redirect('/seller/products');
  return res.redirect('/');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.get('/seller/products', requireAuth, requireSeller, async (req, res) => {
  const user = res.locals.currentUser;
  let query, params;
  if (user.role === 'admin') {
    query = `SELECT p.*, u.full_name seller_name FROM products p LEFT JOIN users u ON u.id=p.seller_id ORDER BY p.id DESC`;
    params = [];
  } else {
    query = `SELECT p.*, u.full_name seller_name FROM products p LEFT JOIN users u ON u.id=p.seller_id WHERE seller_id = $1 ORDER BY p.id DESC`;
    params = [user.id];
  }
  const { rows: products } = await pool.query(query, params);
  res.render('seller-products', { products, pageTitle: 'Seller quản lý sản phẩm' });
});

app.get('/seller/products/new', requireAuth, requireSeller, async (req, res) => {
  res.render('product-form', { 
    pageTitle: 'Thêm sản phẩm',
    action: '/seller/products',
    method: 'POST',
    product: { name:'', price:'', stock:'', image_url:'', description:'', is_active:true, seller_id: res.locals.currentUser.id },
    sellers: [],
    isAdminMode: false
  });
});

app.post('/seller/products', requireAuth, requireSeller, async (req, res) => {
  const user = res.locals.currentUser;
  const { name, price, stock, image_url, description, is_active } = req.body;
  const sellerId = user.role === 'admin' && req.body.seller_id ? req.body.seller_id : user.id;
  await pool.query(
    `INSERT INTO products(seller_id, name, price, stock, image_url, description, is_active, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,CURRENT_TIMESTAMP)`,
    [sellerId, name, price || 0, stock || 0, image_url || null, description || null, is_active === 'on']
  );
  res.redirect('/seller/products');
});

app.get('/seller/products/:id/edit', requireAuth, requireSeller, async (req, res) => {
  const user = res.locals.currentUser;
  const { rows } = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).send('Không tìm thấy sản phẩm');
  const product = rows[0];
  if (user.role !== 'admin' && product.seller_id !== user.id) return res.status(403).send('Không có quyền');
  res.render('product-form', {
    pageTitle: 'Sửa sản phẩm',
    action: `/seller/products/${product.id}?_method=PUT`,
    method: 'POST',
    product,
    sellers: [],
    isAdminMode: false
  });
});

app.put('/seller/products/:id', requireAuth, requireSeller, async (req, res) => {
  const user = res.locals.currentUser;
  const { rows } = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).send('Không tìm thấy sản phẩm');
  const product = rows[0];
  if (user.role !== 'admin' && product.seller_id !== user.id) return res.status(403).send('Không có quyền');

  const { name, price, stock, image_url, description, is_active } = req.body;
  await pool.query(
    `UPDATE products
     SET name=$1, price=$2, stock=$3, image_url=$4, description=$5, is_active=$6, updated_at=CURRENT_TIMESTAMP
     WHERE id=$7`,
    [name, price || 0, stock || 0, image_url || null, description || null, is_active === 'on', product.id]
  );
  res.redirect('/seller/products');
});

app.delete('/seller/products/:id', requireAuth, requireSeller, async (req, res) => {
  const user = res.locals.currentUser;
  const { rows } = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).send('Không tìm thấy sản phẩm');
  const product = rows[0];
  if (user.role !== 'admin' && product.seller_id !== user.id) return res.status(403).send('Không có quyền');
  await pool.query('DELETE FROM products WHERE id = $1', [product.id]);
  res.redirect('/seller/products');
});

app.get('/admin/products', requireAuth, requireAdmin, async (req, res) => {
  const { rows: products } = await pool.query(`
    SELECT p.*, u.full_name seller_name
    FROM products p
    LEFT JOIN users u ON u.id = p.seller_id
    ORDER BY p.id DESC
  `);
  res.render('admin-products', { products });
});

app.get('/admin/products/new', requireAuth, requireAdmin, async (req, res) => {
  const { rows: sellers } = await pool.query(`SELECT id, full_name, email FROM users WHERE role IN ('seller','admin') ORDER BY id`);
  res.render('product-form', {
    pageTitle: 'Admin thêm sản phẩm',
    action: '/admin/products',
    method: 'POST',
    product: { name:'', price:'', stock:'', image_url:'', description:'', is_active:true, seller_id:'' },
    sellers,
    isAdminMode: true
  });
});

app.post('/admin/products', requireAuth, requireAdmin, async (req, res) => {
  const { name, price, stock, image_url, description, is_active, seller_id } = req.body;
  await pool.query(
    `INSERT INTO products(seller_id, name, price, stock, image_url, description, is_active, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,CURRENT_TIMESTAMP)`,
    [seller_id || null, name, price || 0, stock || 0, image_url || null, description || null, is_active === 'on']
  );
  res.redirect('/admin/products');
});

app.get('/admin/products/:id/edit', requireAuth, requireAdmin, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM products WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).send('Không tìm thấy sản phẩm');
  const { rows: sellers } = await pool.query(`SELECT id, full_name, email FROM users WHERE role IN ('seller','admin') ORDER BY id`);
  res.render('product-form', {
    pageTitle: 'Admin sửa sản phẩm',
    action: `/admin/products/${req.params.id}?_method=PUT`,
    method: 'POST',
    product: rows[0],
    sellers,
    isAdminMode: true
  });
});

app.put('/admin/products/:id', requireAuth, requireAdmin, async (req, res) => {
  const { name, price, stock, image_url, description, is_active, seller_id } = req.body;
  await pool.query(
    `UPDATE products
     SET seller_id=$1, name=$2, price=$3, stock=$4, image_url=$5, description=$6, is_active=$7, updated_at=CURRENT_TIMESTAMP
     WHERE id=$8`,
    [seller_id || null, name, price || 0, stock || 0, image_url || null, description || null, is_active === 'on', req.params.id]
  );
  res.redirect('/admin/products');
});

app.delete('/admin/products/:id', requireAuth, requireAdmin, async (req, res) => {
  await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
  res.redirect('/admin/products');
});

app.get('/admin', requireAuth, requireAdmin, (req, res) => res.redirect('/admin/products'));

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
  })
  .catch(err => {
    console.error('DB init failed', err);
    process.exit(1);
  });
