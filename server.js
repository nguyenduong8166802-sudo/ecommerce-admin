require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const methodOverride = require('method-override');

const app = express();
const PORT = process.env.PORT || 10000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')
    ? { rejectUnauthorized: false }
    : false
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    store: new pgSession({
      pool,
      tableName: 'user_sessions',
      createTableIfMissing: true
    }),
    secret: process.env.SESSION_SECRET || 'duong_secret_123',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
  })
);

app.use(async (req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.cartCount = Array.isArray(req.session.cart) ? req.session.cart.reduce((a, i) => a + i.qty, 0) : 0;
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect('/login');
    if (!roles.includes(req.session.user.role)) return res.status(403).send('Không có quyền truy cập.');
    next();
  };
}
function currency(v) {
  return new Intl.NumberFormat('vi-VN').format(Number(v || 0)) + 'đ';
}
app.locals.currency = currency;

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      email VARCHAR(200) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role VARCHAR(20) NOT NULL DEFAULT 'buyer',
      commission_rate NUMERIC(5,2) NOT NULL DEFAULT 10.00,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      seller_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      name VARCHAR(180) NOT NULL,
      slug VARCHAR(220) UNIQUE NOT NULL,
      description TEXT,
      price NUMERIC(12,2) NOT NULL,
      image_url TEXT,
      stock INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS marketing_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      top_banner_text TEXT DEFAULT 'Miễn phí vận chuyển cho đơn từ 299.000đ | Flash sale mỗi ngày | Seller đối soát minh bạch',
      hero_title TEXT DEFAULT 'Marketplace kiểu WinMart cho bán lẻ, seller và hoa hồng',
      hero_subtitle TEXT DEFAULT 'Bản PRO có admin, seller dashboard, giỏ hàng, đơn hàng, commission và giao diện bán hàng chuyên nghiệp.',
      hero_cta_text TEXT DEFAULT 'Mua sắm ngay',
      popup_text TEXT DEFAULT 'Chào mừng bạn đến DUONG MART PRO',
      popup_enabled BOOLEAN NOT NULL DEFAULT false
    );

    CREATE TABLE IF NOT EXISTS flash_sales (
      id SERIAL PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      description TEXT,
      start_at TIMESTAMP NOT NULL,
      end_at TIMESTAMP NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS flash_sale_items (
      id SERIAL PRIMARY KEY,
      flash_sale_id INTEGER REFERENCES flash_sales(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
      sale_price NUMERIC(12,2),
      sale_percent NUMERIC(5,2),
      UNIQUE(flash_sale_id, product_id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      buyer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      full_name VARCHAR(150) NOT NULL,
      phone VARCHAR(50),
      address TEXT NOT NULL,
      note TEXT,
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
      seller_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      product_name VARCHAR(180) NOT NULL,
      qty INTEGER NOT NULL,
      unit_price NUMERIC(12,2) NOT NULL,
      line_total NUMERIC(12,2) NOT NULL,
      commission_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
      commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0
    );
  `);

  await pool.query(`INSERT INTO marketing_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;`);

  const categories = ['Rau củ - trái cây', 'Thịt - hải sản', 'Gia dụng', 'Khuyến mãi hot'];
  for (const name of categories) {
    await pool.query(`INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`, [name]);
  }

  await seedUsers();
  await seedProducts();
}

async function seedUsers() {
  const users = [
    {
      name: 'Admin Duong',
      email: process.env.INIT_ADMIN_EMAIL || 'admin@duongmart.vn',
      password: process.env.INIT_ADMIN_PASSWORD || 'admin123',
      role: 'admin',
      commission_rate: 0
    },
    {
      name: 'Seller One',
      email: process.env.INIT_SELLER_EMAIL || 'seller1@duongmart.vn',
      password: process.env.INIT_SELLER_PASSWORD || 'seller123',
      role: 'seller',
      commission_rate: 10
    },
    {
      name: 'Buyer One',
      email: process.env.INIT_BUYER_EMAIL || 'buyer1@duongmart.vn',
      password: process.env.INIT_BUYER_PASSWORD || 'buyer123',
      role: 'buyer',
      commission_rate: 0
    }
  ];

  for (const user of users) {
    const existing = await pool.query(`SELECT id FROM users WHERE email=$1`, [user.email]);
    if (!existing.rowCount) {
      const hash = await bcrypt.hash(user.password, 10);
      await pool.query(
        `INSERT INTO users (name, email, password_hash, role, commission_rate)
         VALUES ($1,$2,$3,$4,$5)`,
        [user.name, user.email, hash, user.role, user.commission_rate]
      );
    }
  }
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 200);
}

async function seedProducts() {
  const count = await pool.query(`SELECT COUNT(*)::int AS c FROM products`);
  if (count.rows[0].c > 0) return;

  const seller = await pool.query(`SELECT id FROM users WHERE role='seller' ORDER BY id LIMIT 1`);
  const categories = await pool.query(`SELECT id, name FROM categories ORDER BY id`);
  const catMap = Object.fromEntries(categories.rows.map(c => [c.name, c.id]));
  const sellerId = seller.rows[0].id;

  const items = [
    {
      name: 'Sườn nướng tứ quý',
      price: 120000,
      image_url: 'https://i.ibb.co/q3qKSNdr/SUON-NUONG.jpg',
      stock: 20,
      category: 'Thịt - hải sản',
      description: 'Sườn nướng ướp đậm vị, đóng gói đẹp để bán online.'
    },
    {
      name: 'Combo rau củ sạch',
      price: 59000,
      image_url: 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=800&q=80',
      stock: 50,
      category: 'Rau củ - trái cây',
      description: 'Set rau củ dùng cho gia đình, giao nhanh trong ngày.'
    },
    {
      name: 'Hộp bảo quản thực phẩm',
      price: 89000,
      image_url: 'https://images.unsplash.com/photo-1584263347416-85a696b4eda7?auto=format&fit=crop&w=800&q=80',
      stock: 35,
      category: 'Gia dụng',
      description: 'Hộp đựng thực phẩm tiện lợi cho gian bếp hiện đại.'
    }
  ];

  for (const item of items) {
    await pool.query(
      `INSERT INTO products (seller_id, category_id, name, slug, description, price, image_url, stock)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [sellerId, catMap[item.category], item.name, slugify(item.name + '-' + Math.random().toString(36).slice(2,6)), item.description, item.price, item.image_url, item.stock]
    );
  }
}

function activeFlashSaleSubquery() {
  return `
    SELECT fsi.product_id,
           COALESCE(fsi.sale_price,
                    ROUND(p.price * (100 - fsi.sale_percent) / 100.0, 2)) AS sale_price,
           fsi.sale_percent,
           fs.name AS flash_sale_name
    FROM flash_sale_items fsi
    JOIN flash_sales fs ON fs.id = fsi.flash_sale_id
    JOIN products p ON p.id = fsi.product_id
    WHERE fs.is_active = true
      AND NOW() BETWEEN fs.start_at AND fs.end_at
  `;
}

app.get('/', async (req, res) => {
  const marketing = (await pool.query(`SELECT * FROM marketing_settings WHERE id=1`)).rows[0];
  const products = await pool.query(`
    SELECT p.*, c.name AS category_name, u.name AS seller_name,
           sale.sale_price, sale.sale_percent, sale.flash_sale_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN users u ON u.id = p.seller_id
    LEFT JOIN (${activeFlashSaleSubquery()}) sale ON sale.product_id = p.id
    WHERE p.is_active = true
    ORDER BY p.created_at DESC
    LIMIT 12
  `);
  const flashProducts = products.rows.filter(p => p.sale_price);
  const categories = await pool.query(`SELECT * FROM categories ORDER BY id`);
  res.render('index', { marketing, products: products.rows, flashProducts, categories: categories.rows });
});

app.get('/products', async (req, res) => {
  const products = await pool.query(`
    SELECT p.*, c.name AS category_name, u.name AS seller_name,
           sale.sale_price, sale.sale_percent, sale.flash_sale_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN users u ON u.id = p.seller_id
    LEFT JOIN (${activeFlashSaleSubquery()}) sale ON sale.product_id = p.id
    WHERE p.is_active = true
    ORDER BY p.created_at DESC
  `);
  res.render('products', { products: products.rows });
});

app.get('/products/:id', async (req, res) => {
  const product = await pool.query(`
    SELECT p.*, c.name AS category_name, u.name AS seller_name,
           sale.sale_price, sale.sale_percent, sale.flash_sale_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN users u ON u.id = p.seller_id
    LEFT JOIN (${activeFlashSaleSubquery()}) sale ON sale.product_id = p.id
    WHERE p.id=$1
  `, [req.params.id]);
  if (!product.rowCount) return res.status(404).send('Không tìm thấy sản phẩm');
  res.render('product-detail', { product: product.rows[0] });
});

app.get('/register', (req, res) => res.render('register', { error: null }));
app.post('/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!['buyer', 'seller'].includes(role)) return res.render('register', { error: 'Vai trò không hợp lệ.' });
    const existing = await pool.query(`SELECT id FROM users WHERE email=$1`, [email]);
    if (existing.rowCount) return res.render('register', { error: 'Email đã tồn tại.' });
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, commission_rate)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, name, email, role, commission_rate`,
      [name, email, hash, role, role === 'seller' ? 10 : 0]
    );
    req.session.user = result.rows[0];
    res.redirect(role === 'seller' ? '/seller' : '/');
  } catch (e) {
    res.render('register', { error: 'Không thể đăng ký.' });
  }
});

app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const result = await pool.query(`SELECT * FROM users WHERE email=$1`, [email]);
  if (!result.rowCount) return res.render('login', { error: 'Sai email hoặc mật khẩu.' });
  const user = result.rows[0];
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.render('login', { error: 'Sai email hoặc mật khẩu.' });
  req.session.user = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    commission_rate: user.commission_rate
  };
  if (user.role === 'admin') return res.redirect('/admin');
  if (user.role === 'seller') return res.redirect('/seller');
  res.redirect('/');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.post('/cart/add', async (req, res) => {
  const productId = Number(req.body.product_id);
  const qty = Math.max(1, Number(req.body.qty || 1));
  const result = await pool.query(`
    SELECT p.*, sale.sale_price
    FROM products p
    LEFT JOIN (${activeFlashSaleSubquery()}) sale ON sale.product_id = p.id
    WHERE p.id=$1
  `, [productId]);
  if (!result.rowCount) return res.redirect('/products');
  const product = result.rows[0];
  req.session.cart = req.session.cart || [];
  const existing = req.session.cart.find(i => i.product_id === productId);
  const usePrice = Number(product.sale_price || product.price);
  if (existing) existing.qty += qty;
  else req.session.cart.push({
    product_id: productId,
    name: product.name,
    image_url: product.image_url,
    price: usePrice,
    qty
  });
  res.redirect('/cart');
});

app.get('/cart', (req, res) => {
  const cart = req.session.cart || [];
  const total = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
  res.render('cart', { cart, total });
});

app.post('/cart/remove', (req, res) => {
  const productId = Number(req.body.product_id);
  req.session.cart = (req.session.cart || []).filter(i => i.product_id !== productId);
  res.redirect('/cart');
});

app.get('/checkout', requireAuth, (req, res) => {
  const cart = req.session.cart || [];
  if (!cart.length) return res.redirect('/cart');
  const total = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
  res.render('checkout', { cart, total, error: null });
});

app.post('/checkout', requireAuth, async (req, res) => {
  const cart = req.session.cart || [];
  if (!cart.length) return res.redirect('/cart');
  const total = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
  const { full_name, phone, address, note } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const orderResult = await client.query(
      `INSERT INTO orders (buyer_id, full_name, phone, address, note, total_amount)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [req.session.user.id, full_name, phone, address, note, total]
    );
    const orderId = orderResult.rows[0].id;
    for (const item of cart) {
      const prod = await client.query(
        `SELECT p.*, u.commission_rate
         FROM products p
         JOIN users u ON u.id = p.seller_id
         WHERE p.id=$1`,
        [item.product_id]
      );
      if (!prod.rowCount) continue;
      const p = prod.rows[0];
      const rate = Number(p.commission_rate || 0);
      const lineTotal = item.price * item.qty;
      const commissionAmount = lineTotal * rate / 100;
      await client.query(
        `INSERT INTO order_items
         (order_id, product_id, seller_id, product_name, qty, unit_price, line_total, commission_rate, commission_amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [orderId, p.id, p.seller_id, p.name, item.qty, item.price, lineTotal, rate, commissionAmount]
      );
    }
    await client.query('COMMIT');
    req.session.cart = [];
    res.redirect('/orders/mine');
  } catch (e) {
    await client.query('ROLLBACK');
    const total = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
    res.render('checkout', { cart, total, error: 'Không thể tạo đơn hàng.' });
  } finally {
    client.release();
  }
});

app.get('/orders/mine', requireAuth, async (req, res) => {
  const orders = await pool.query(`SELECT * FROM orders WHERE buyer_id=$1 ORDER BY created_at DESC`, [req.session.user.id]);
  res.render('my-orders', { orders: orders.rows });
});

app.get('/admin', requireRole('admin'), async (req, res) => {
  const stats = {
    users: (await pool.query(`SELECT COUNT(*)::int AS c FROM users`)).rows[0].c,
    sellers: (await pool.query(`SELECT COUNT(*)::int AS c FROM users WHERE role='seller'`)).rows[0].c,
    products: (await pool.query(`SELECT COUNT(*)::int AS c FROM products`)).rows[0].c,
    orders: (await pool.query(`SELECT COUNT(*)::int AS c FROM orders`)).rows[0].c,
    revenue: (await pool.query(`SELECT COALESCE(SUM(total_amount),0)::numeric AS total FROM orders`)).rows[0].total
  };
  const latestOrders = await pool.query(`SELECT * FROM orders ORDER BY created_at DESC LIMIT 10`);
  res.render('admin-dashboard', { stats, latestOrders: latestOrders.rows });
});

app.get('/admin/sellers', requireRole('admin'), async (req, res) => {
  const sellers = await pool.query(`
    SELECT u.*,
           COALESCE(SUM(oi.line_total), 0) AS gross_sales,
           COALESCE(SUM(oi.commission_amount), 0) AS total_commission
    FROM users u
    LEFT JOIN order_items oi ON oi.seller_id = u.id
    WHERE u.role='seller'
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `);
  res.render('admin-sellers', { sellers: sellers.rows });
});

app.post('/admin/sellers/:id/commission', requireRole('admin'), async (req, res) => {
  const rate = Number(req.body.commission_rate || 0);
  await pool.query(`UPDATE users SET commission_rate=$1 WHERE id=$2 AND role='seller'`, [rate, req.params.id]);
  res.redirect('/admin/sellers');
});

app.get('/admin/marketing', requireRole('admin'), async (req, res) => {
  const marketing = (await pool.query(`SELECT * FROM marketing_settings WHERE id=1`)).rows[0];
  res.render('admin-marketing', { marketing });
});
app.post('/admin/marketing', requireRole('admin'), async (req, res) => {
  const { top_banner_text, hero_title, hero_subtitle, hero_cta_text, popup_text, popup_enabled } = req.body;
  await pool.query(
    `UPDATE marketing_settings
     SET top_banner_text=$1, hero_title=$2, hero_subtitle=$3, hero_cta_text=$4, popup_text=$5, popup_enabled=$6
     WHERE id=1`,
    [top_banner_text, hero_title, hero_subtitle, hero_cta_text, popup_text, popup_enabled === 'on']
  );
  res.redirect('/admin/marketing');
});

app.get('/admin/flash-sales', requireRole('admin'), async (req, res) => {
  const flashSales = await pool.query(`
    SELECT fs.*,
           COUNT(fsi.id)::int AS item_count
    FROM flash_sales fs
    LEFT JOIN flash_sale_items fsi ON fsi.flash_sale_id = fs.id
    GROUP BY fs.id
    ORDER BY fs.created_at DESC
  `);
  const products = await pool.query(`SELECT id, name, price FROM products WHERE is_active=true ORDER BY name`);
  res.render('admin-flash-sales', { flashSales: flashSales.rows, products: products.rows });
});

app.post('/admin/flash-sales', requireRole('admin'), async (req, res) => {
  const { name, description, start_at, end_at, sale_percent } = req.body;
  let productIds = req.body.product_ids || [];
  if (!Array.isArray(productIds)) productIds = [productIds];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const fs = await client.query(
      `INSERT INTO flash_sales (name, description, start_at, end_at, is_active)
       VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [name, description, start_at, end_at]
    );
    for (const pid of productIds.filter(Boolean)) {
      await client.query(
        `INSERT INTO flash_sale_items (flash_sale_id, product_id, sale_percent)
         VALUES ($1,$2,$3)`,
        [fs.rows[0].id, Number(pid), Number(sale_percent || 0)]
      );
    }
    await client.query('COMMIT');
    res.redirect('/admin/flash-sales');
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).send('Không tạo được flash sale.');
  } finally {
    client.release();
  }
});

app.post('/admin/flash-sales/:id/toggle', requireRole('admin'), async (req, res) => {
  await pool.query(`UPDATE flash_sales SET is_active = NOT is_active WHERE id=$1`, [req.params.id]);
  res.redirect('/admin/flash-sales');
});

app.get('/seller', requireRole('seller'), async (req, res) => {
  const sellerId = req.session.user.id;
  const stats = {
    products: (await pool.query(`SELECT COUNT(*)::int AS c FROM products WHERE seller_id=$1`, [sellerId])).rows[0].c,
    orders: (await pool.query(`SELECT COUNT(DISTINCT order_id)::int AS c FROM order_items WHERE seller_id=$1`, [sellerId])).rows[0].c,
    gross: (await pool.query(`SELECT COALESCE(SUM(line_total),0)::numeric AS total FROM order_items WHERE seller_id=$1`, [sellerId])).rows[0].total,
    commission: (await pool.query(`SELECT COALESCE(SUM(commission_amount),0)::numeric AS total FROM order_items WHERE seller_id=$1`, [sellerId])).rows[0].total
  };
  const products = await pool.query(`SELECT * FROM products WHERE seller_id=$1 ORDER BY created_at DESC`, [sellerId]);
  res.render('seller-dashboard', { stats, products: products.rows });
});

app.get('/seller/products/new', requireRole('seller'), async (req, res) => {
  const categories = await pool.query(`SELECT * FROM categories ORDER BY name`);
  res.render('seller-product-form', { product: null, categories: categories.rows, action: '/seller/products', method: 'POST' });
});
app.post('/seller/products', requireRole('seller'), async (req, res) => {
  const { name, description, price, image_url, category_id, stock } = req.body;
  const slugBase = slugify(name);
  const slug = `${slugBase}-${Date.now().toString().slice(-6)}`;
  await pool.query(
    `INSERT INTO products (seller_id, category_id, name, slug, description, price, image_url, stock)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [req.session.user.id, category_id || null, name, slug, description, Number(price), image_url, Number(stock || 0)]
  );
  res.redirect('/seller');
});
app.get('/seller/products/:id/edit', requireRole('seller'), async (req, res) => {
  const categories = await pool.query(`SELECT * FROM categories ORDER BY name`);
  const result = await pool.query(`SELECT * FROM products WHERE id=$1 AND seller_id=$2`, [req.params.id, req.session.user.id]);
  if (!result.rowCount) return res.status(404).send('Không tìm thấy sản phẩm');
  res.render('seller-product-form', { product: result.rows[0], categories: categories.rows, action: `/seller/products/${req.params.id}?_method=PUT`, method: 'POST' });
});
app.put('/seller/products/:id', requireRole('seller'), async (req, res) => {
  const { name, description, price, image_url, category_id, stock, is_active } = req.body;
  await pool.query(
    `UPDATE products
     SET name=$1, description=$2, price=$3, image_url=$4, category_id=$5, stock=$6, is_active=$7
     WHERE id=$8 AND seller_id=$9`,
    [name, description, Number(price), image_url, category_id || null, Number(stock || 0), is_active === 'on', req.params.id, req.session.user.id]
  );
  res.redirect('/seller');
});
app.delete('/seller/products/:id', requireRole('seller'), async (req, res) => {
  await pool.query(`DELETE FROM products WHERE id=$1 AND seller_id=$2`, [req.params.id, req.session.user.id]);
  res.redirect('/seller');
});

app.get('/seller/orders', requireRole('seller'), async (req, res) => {
  const result = await pool.query(`
    SELECT oi.*, o.status, o.full_name, o.phone, o.address, o.created_at
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE oi.seller_id=$1
    ORDER BY o.created_at DESC
  `, [req.session.user.id]);
  res.render('seller-orders', { items: result.rows });
});

app.get('/admin/orders', requireRole('admin'), async (req, res) => {
  const orders = await pool.query(`SELECT * FROM orders ORDER BY created_at DESC`);
  res.render('admin-orders', { orders: orders.rows });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Đã có lỗi xảy ra.');
});

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('DB init failed:', err);
    process.exit(1);
  });
