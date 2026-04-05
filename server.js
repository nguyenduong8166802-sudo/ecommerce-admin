
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
    store: new pgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || 'duong_secret_123',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
  })
);

app.use((req, res, next) => {
  if (req.query.ref) req.session.ref = String(req.query.ref).trim();
  next();
});

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.cartCount = Array.isArray(req.session.cart) ? req.session.cart.reduce((a, i) => a + i.qty, 0) : 0;
  res.locals.activeRef = req.session.ref || null;
  next();
});

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect('/login');
    if (!roles.includes(req.session.user.role)) return res.status(403).send('Không có quyền truy cập.');
    next();
  };
}
function currency(v) { return new Intl.NumberFormat('vi-VN').format(Number(v || 0)) + 'đ'; }
app.locals.currency = currency;
function slugify(text) {
  return String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g,'d').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'').slice(0,200);
}
async function getSettings() {
  const rs = await pool.query('SELECT * FROM affiliate_settings WHERE id=1');
  return rs.rows[0];
}
async function getWalletBalance(userId) {
  const rs = await pool.query(`SELECT COALESCE(SUM(amount),0)::numeric AS balance FROM wallet_transactions WHERE user_id=$1`, [userId]);
  return Number(rs.rows[0].balance || 0);
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      email VARCHAR(200) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role VARCHAR(20) NOT NULL DEFAULT 'buyer',
      commission_rate NUMERIC(5,2) NOT NULL DEFAULT 10.00,
      referral_rate NUMERIC(5,2) NOT NULL DEFAULT 5.00,
      referral_code VARCHAR(80) UNIQUE,
      parent_seller_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
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
      top_banner_text TEXT DEFAULT 'Flash Sale mỗi ngày | Affiliate nhiều tầng | Rút tiền seller minh bạch',
      hero_title TEXT DEFAULT 'Marketplace PRO có Affiliate nhiều tầng + ví seller',
      hero_subtitle TEXT DEFAULT 'Bản V3 có admin, seller dashboard, ví tiền, yêu cầu rút tiền, affiliate nhiều tầng và giỏ hàng chuyên nghiệp.',
      hero_cta_text TEXT DEFAULT 'Mua sắm ngay',
      popup_text TEXT DEFAULT 'Chào mừng bạn đến DUONG MART PRO V3',
      popup_enabled BOOLEAN NOT NULL DEFAULT false
    );

    CREATE TABLE IF NOT EXISTS affiliate_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      platform_fee_rate NUMERIC(5,2) NOT NULL DEFAULT 10.00,
      level1_rate NUMERIC(5,2) NOT NULL DEFAULT 5.00,
      level2_rate NUMERIC(5,2) NOT NULL DEFAULT 2.00,
      min_withdraw_amount NUMERIC(12,2) NOT NULL DEFAULT 100000
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
      ref_seller_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      level2_seller_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      ref_code VARCHAR(80),
      referral_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
      level2_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
      referral_commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      level2_commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
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

    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      type VARCHAR(30) NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      description TEXT,
      order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
      withdrawal_request_id INTEGER,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS withdrawal_requests (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      amount NUMERIC(12,2) NOT NULL,
      bank_name VARCHAR(120),
      bank_account_name VARCHAR(150),
      bank_account_number VARCHAR(80),
      note TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5,2) NOT NULL DEFAULT 10.00;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_rate NUMERIC(5,2) NOT NULL DEFAULT 5.00;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code VARCHAR(80);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_balance NUMERIC(12,2) NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_seller_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

    ALTER TABLE orders ADD COLUMN IF NOT EXISTS ref_seller_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS level2_seller_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS ref_code VARCHAR(80);
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS referral_rate NUMERIC(5,2) NOT NULL DEFAULT 0;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS level2_rate NUMERIC(5,2) NOT NULL DEFAULT 0;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS referral_commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS level2_commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
  `);

  await pool.query(`INSERT INTO marketing_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;`);
  await pool.query(`INSERT INTO affiliate_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;`);

  for (const name of ['Rau củ - trái cây','Thịt - hải sản','Gia dụng','Khuyến mãi hot']) {
    await pool.query(`INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`, [name]);
  }

  await seedUsers();
  await pool.query(`UPDATE users SET referral_rate = COALESCE(referral_rate, 0), commission_rate = COALESCE(commission_rate, 0)`);
  await pool.query(`UPDATE users SET referral_code = COALESCE(referral_code, LOWER(REPLACE(SPLIT_PART(email,'@',1),'.','-'))) WHERE role='seller' AND (referral_code IS NULL OR referral_code='')`);
  await seedProducts();
}

async function seedUsers() {
  const users = [
    { name: 'Admin Duong', email: process.env.INIT_ADMIN_EMAIL || 'admin@duongmart.vn', password: process.env.INIT_ADMIN_PASSWORD || 'admin123', role: 'admin', commission_rate: 0, referral_rate: 0 },
    { name: 'Seller One', email: process.env.INIT_SELLER_EMAIL || 'seller1@duongmart.vn', password: process.env.INIT_SELLER_PASSWORD || 'seller123', role: 'seller', commission_rate: 10, referral_rate: 5 },
    { name: 'Seller Two', email: 'seller2@duongmart.vn', password: 'seller123', role: 'seller', commission_rate: 10, referral_rate: 5 },
    { name: 'Buyer One', email: process.env.INIT_BUYER_EMAIL || 'buyer1@duongmart.vn', password: process.env.INIT_BUYER_PASSWORD || 'buyer123', role: 'buyer', commission_rate: 0, referral_rate: 0 }
  ];
  for (const user of users) {
    const existing = await pool.query(`SELECT id FROM users WHERE email=$1`, [user.email]);
    if (!existing.rowCount) {
      const hash = await bcrypt.hash(user.password, 10);
      const referralCode = user.role === 'seller' ? slugify(user.email.split('@')[0]) : null;
      await pool.query(`INSERT INTO users (name,email,password_hash,role,commission_rate,referral_rate,referral_code) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [user.name,user.email,hash,user.role,user.commission_rate,user.referral_rate,referralCode]);
    }
  }
  // set seller2 parent to seller1
  await pool.query(`
    UPDATE users child
    SET parent_seller_id = parent.id
    FROM users parent
    WHERE child.email='seller2@duongmart.vn' AND parent.email=$1 AND child.parent_seller_id IS NULL
  `,[process.env.INIT_SELLER_EMAIL || 'seller1@duongmart.vn']);
}

async function seedProducts() {
  const count = await pool.query(`SELECT COUNT(*)::int AS c FROM products`);
  if (count.rows[0].c > 0) return;
  const seller = await pool.query(`SELECT id FROM users WHERE role='seller' ORDER BY id LIMIT 1`);
  const categories = await pool.query(`SELECT id, name FROM categories ORDER BY id`);
  const catMap = Object.fromEntries(categories.rows.map(c => [c.name, c.id]));
  const sellerId = seller.rows[0].id;
  const items = [
    { name:'Sườn nướng tứ quý',price:120000,image_url:'https://i.ibb.co/q3qKSNdr/SUON-NUONG.jpg',stock:20,category:'Thịt - hải sản',description:'Sườn nướng ướp đậm vị, đóng gói đẹp để bán online.'},
    { name:'Combo BBQ cuối tuần',price:189000,image_url:'https://i.ibb.co/FkBztNtw/HINH-CHI-BAO.jpg',stock:15,category:'Khuyến mãi hot',description:'Combo sườn + sốt + rau ăn kèm dễ bán cho gia đình.'},
    { name:'Nồi chiên mini gia đình',price:890000,image_url:'https://images.unsplash.com/photo-1585515320310-259814833e62?q=80&w=1200&auto=format&fit=crop',stock:8,category:'Gia dụng',description:'Gia dụng phù hợp bán kèm cho khách thích nấu nhanh.'}
  ];
  for (const item of items) {
    await pool.query(`INSERT INTO products (seller_id, category_id, name, slug, description, price, image_url, stock) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [sellerId,catMap[item.category],item.name,slugify(item.name+'-'+Math.random().toString(36).slice(2,6)),item.description,item.price,item.image_url,item.stock]);
  }
}

async function getActiveFlashSaleMap() {
  const result = await pool.query(`
    SELECT p.id AS product_id,
           COALESCE(fsi.sale_price, ROUND(p.price * (100 - COALESCE(fsi.sale_percent,0))/100.0, 0)) AS sale_price,
           COALESCE(fsi.sale_percent, ROUND((p.price - COALESCE(fsi.sale_price,p.price))*100.0 / NULLIF(p.price,0), 2)) AS sale_percent,
           fs.name AS flash_sale_name
    FROM flash_sales fs
    JOIN flash_sale_items fsi ON fsi.flash_sale_id = fs.id
    JOIN products p ON p.id = fsi.product_id
    WHERE fs.is_active = true AND NOW() BETWEEN fs.start_at AND fs.end_at
  `);
  const map = {};
  for (const row of result.rows) map[row.product_id] = row;
  return map;
}

app.get('/', async (req, res) => {
  const marketing = (await pool.query(`SELECT * FROM marketing_settings WHERE id=1`)).rows[0];
  const categories = (await pool.query(`SELECT * FROM categories ORDER BY name`)).rows;
  const flashMap = await getActiveFlashSaleMap();
  const productsQ = await pool.query(`
    SELECT p.*, c.name AS category_name, u.name AS seller_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN users u ON u.id = p.seller_id
    WHERE p.is_active=true
    ORDER BY p.created_at DESC
    LIMIT 12`);
  const products = productsQ.rows.map(p => ({ ...p, flash: flashMap[p.id] || null }));
  let referredSeller = null;
  if (req.session.ref) {
    const refQ = await pool.query(`SELECT id, name, referral_code FROM users WHERE role='seller' AND referral_code=$1`, [req.session.ref]);
    if (refQ.rowCount) referredSeller = refQ.rows[0];
  }
  res.render('index', { marketing, categories, products, referredSeller });
});

app.get('/products', async (req, res) => {
  const flashMap = await getActiveFlashSaleMap();
  const result = await pool.query(`
    SELECT p.*, c.name AS category_name, u.name AS seller_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN users u ON u.id = p.seller_id
    WHERE p.is_active=true
    ORDER BY p.created_at DESC`);
  const products = result.rows.map(p => ({ ...p, flash: flashMap[p.id] || null }));
  res.render('products', { products });
});
app.get('/products/:slug', async (req, res) => {
  const flashMap = await getActiveFlashSaleMap();
  const result = await pool.query(`
    SELECT p.*, c.name AS category_name, u.name AS seller_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN users u ON u.id = p.seller_id
    WHERE p.slug=$1`, [req.params.slug]);
  if (!result.rowCount) return res.status(404).send('Không tìm thấy sản phẩm');
  const product = result.rows[0];
  product.flash = flashMap[product.id] || null;
  res.render('product-detail', { product });
});

app.get('/register', (req, res) => res.render('register', { error: null }));
app.post('/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!['buyer', 'seller'].includes(role)) return res.render('register', { error: 'Vai trò không hợp lệ.' });
    const existing = await pool.query(`SELECT id FROM users WHERE email=$1`, [email]);
    if (existing.rowCount) return res.render('register', { error: 'Email đã tồn tại.' });
    const hash = await bcrypt.hash(password, 10);
    let parentSellerId = null;
    if (role === 'seller' && req.session.ref) {
      const refSeller = await pool.query(`SELECT id FROM users WHERE role='seller' AND referral_code=$1`, [req.session.ref]);
      if (refSeller.rowCount) parentSellerId = refSeller.rows[0].id;
    }
    await pool.query(`INSERT INTO users (name,email,password_hash,role,commission_rate,referral_rate,referral_code,parent_seller_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [name,email,hash,role,role==='seller'?10:0,role==='seller'?5:0,role==='seller'?slugify(email.split('@')[0]):null,parentSellerId]);
    const user = (await pool.query(`SELECT id,name,email,role FROM users WHERE email=$1`, [email])).rows[0];
    req.session.user = user;
    res.redirect(role === 'seller' ? '/seller' : '/');
  } catch (e) {
    console.error(e); res.render('register', { error: 'Không tạo được tài khoản.' });
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
  req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
  if (user.role === 'admin') return res.redirect('/admin');
  if (user.role === 'seller') return res.redirect('/seller');
  res.redirect('/');
});
app.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

app.post('/cart/add', async (req, res) => {
  const id = Number(req.body.product_id);
  const product = (await pool.query(`SELECT * FROM products WHERE id=$1 AND is_active=true`, [id])).rows[0];
  if (!product) return res.redirect('/products');
  if (!Array.isArray(req.session.cart)) req.session.cart = [];
  const existing = req.session.cart.find(i => i.product_id === id);
  const flashMap = await getActiveFlashSaleMap();
  const price = flashMap[id] ? Number(flashMap[id].sale_price) : Number(product.price);
  if (existing) existing.qty += 1; else req.session.cart.push({ product_id:id, name:product.name, price, image_url:product.image_url, qty:1, slug:product.slug });
  res.redirect('/cart');
});
app.get('/cart', (req, res) => { const cart = req.session.cart || []; const total = cart.reduce((a,i)=>a+i.price*i.qty,0); res.render('cart',{cart,total}); });
app.get('/checkout', requireRole('buyer','seller'), (req, res) => { const cart = req.session.cart || []; const total = cart.reduce((a,i)=>a+i.price*i.qty,0); if (!cart.length) return res.redirect('/cart'); res.render('checkout',{cart,total}); });
app.post('/checkout', requireRole('buyer','seller'), async (req, res) => {
  const cart = req.session.cart || [];
  if (!cart.length) return res.redirect('/cart');
  const { full_name, phone, address, note } = req.body;
  const total = cart.reduce((a,i)=>a+i.price*i.qty,0);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const settings = (await client.query(`SELECT * FROM affiliate_settings WHERE id=1`)).rows[0];
    let refSellerId = null, refCode = null, level1Rate = 0, level1Amount = 0, level2SellerId = null, level2Rate = 0, level2Amount = 0;
    if (req.session.ref) {
      const refSeller = await client.query(`SELECT id, referral_code, COALESCE(referral_rate,$2) AS referral_rate, parent_seller_id FROM users WHERE role='seller' AND referral_code=$1`, [req.session.ref, settings.level1_rate]);
      if (refSeller.rowCount) {
        const seller = refSeller.rows[0];
        refSellerId = seller.id; refCode = seller.referral_code; level1Rate = Number(seller.referral_rate || settings.level1_rate); level1Amount = total * level1Rate / 100;
        if (seller.parent_seller_id) { level2SellerId = seller.parent_seller_id; level2Rate = Number(settings.level2_rate || 0); level2Amount = total * level2Rate / 100; }
      }
    }
    const inserted = await client.query(`INSERT INTO orders (buyer_id, ref_seller_id, level2_seller_id, ref_code, referral_rate, level2_rate, referral_commission_amount, level2_commission_amount, full_name, phone, address, note, total_amount)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`, [req.session.user.id, refSellerId, level2SellerId, refCode, level1Rate, level2Rate, level1Amount, level2Amount, full_name, phone, address, note, total]);
    const orderId = inserted.rows[0].id;
    for (const item of cart) {
      const prod = (await client.query(`SELECT p.*, u.commission_rate FROM products p JOIN users u ON u.id = p.seller_id WHERE p.id=$1`, [item.product_id])).rows[0];
      const lineTotal = Number(item.price) * Number(item.qty);
      const rate = Number(prod.commission_rate || settings.platform_fee_rate || 10);
      const commissionAmount = lineTotal * rate / 100;
      await client.query(`INSERT INTO order_items (order_id, product_id, seller_id, product_name, qty, unit_price, line_total, commission_rate, commission_amount) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [orderId, prod.id, prod.seller_id, prod.name, item.qty, item.price, lineTotal, rate, commissionAmount]);
      // seller earning after platform fee
      const sellerNet = lineTotal - commissionAmount;
      await client.query(`INSERT INTO wallet_transactions (user_id, type, amount, description, order_id) VALUES ($1,'sale_income',$2,$3,$4)`, [prod.seller_id, sellerNet, 'Doanh thu bán sản phẩm #' + orderId, orderId]);
    }
    if (refSellerId && level1Amount > 0) {
      await client.query(`INSERT INTO wallet_transactions (user_id, type, amount, description, order_id) VALUES ($1,'referral_level1',$2,$3,$4)`, [refSellerId, level1Amount, 'Hoa hồng giới thiệu F1 đơn #' + orderId, orderId]);
    }
    if (level2SellerId && level2Amount > 0) {
      await client.query(`INSERT INTO wallet_transactions (user_id, type, amount, description, order_id) VALUES ($1,'referral_level2',$2,$3,$4)`, [level2SellerId, level2Amount, 'Hoa hồng giới thiệu F2 đơn #' + orderId, orderId]);
    }
    await client.query('COMMIT');
    req.session.cart = [];
    res.redirect('/my-orders');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).send('Không tạo được đơn hàng.');
  } finally { client.release(); }
});

app.get('/my-orders', requireRole('buyer','seller'), async (req,res)=>{
  const orders = (await pool.query(`SELECT * FROM orders WHERE buyer_id=$1 ORDER BY created_at DESC`, [req.session.user.id])).rows;
  res.render('my-orders',{orders});
});

app.get('/admin', requireRole('admin'), async (req,res)=>{
  const stats = {
    products: (await pool.query(`SELECT COUNT(*)::int AS c FROM products`)).rows[0].c,
    sellers: (await pool.query(`SELECT COUNT(*)::int AS c FROM users WHERE role='seller'`)).rows[0].c,
    orders: (await pool.query(`SELECT COUNT(*)::int AS c FROM orders`)).rows[0].c,
    sales: (await pool.query(`SELECT COALESCE(SUM(total_amount),0)::numeric AS total FROM orders`)).rows[0].total,
    pendingWithdrawals: (await pool.query(`SELECT COUNT(*)::int AS c FROM withdrawal_requests WHERE status='pending'`)).rows[0].c
  };
  res.render('admin-dashboard',{stats});
});

app.get('/admin/sellers', requireRole('admin'), async (req,res)=>{
  const sellers = (await pool.query(`
    SELECT u.*,
      parent.name AS parent_name,
      COALESCE(prod.gross_sales,0) AS gross_sales,
      COALESCE(prod.total_commission,0) AS total_commission,
      COALESCE(ref.ref_orders,0) AS ref_orders,
      COALESCE(ref.ref_revenue,0) AS ref_revenue,
      COALESCE(ref.ref_commission,0) AS ref_commission,
      COALESCE(w.balance,0) AS wallet_balance
    FROM users u
    LEFT JOIN users parent ON parent.id=u.parent_seller_id
    LEFT JOIN (SELECT seller_id, COALESCE(SUM(line_total),0) AS gross_sales, COALESCE(SUM(commission_amount),0) AS total_commission FROM order_items GROUP BY seller_id) prod ON prod.seller_id=u.id
    LEFT JOIN (SELECT ref_seller_id, COUNT(*)::int AS ref_orders, COALESCE(SUM(total_amount),0) AS ref_revenue, COALESCE(SUM(referral_commission_amount),0) AS ref_commission FROM orders WHERE ref_seller_id IS NOT NULL GROUP BY ref_seller_id) ref ON ref.ref_seller_id=u.id
    LEFT JOIN (SELECT user_id, COALESCE(SUM(amount),0) AS balance FROM wallet_transactions GROUP BY user_id) w ON w.user_id=u.id
    WHERE u.role='seller' ORDER BY u.created_at DESC`)).rows;
  const allSellers = (await pool.query(`SELECT id,name,referral_code FROM users WHERE role='seller' ORDER BY name`)).rows;
  res.render('admin-sellers',{sellers, allSellers});
});
app.post('/admin/sellers/:id/commission', requireRole('admin'), async (req,res)=>{
  const rate = Number(req.body.commission_rate||0), referralRate = Number(req.body.referral_rate||0);
  const parentSellerId = req.body.parent_seller_id ? Number(req.body.parent_seller_id) : null;
  await pool.query(`UPDATE users SET commission_rate=$1, referral_rate=$2, parent_seller_id=$3 WHERE id=$4 AND role='seller'`, [rate, referralRate, parentSellerId, req.params.id]);
  res.redirect('/admin/sellers');
});
app.get('/admin/affiliate', requireRole('admin'), async (req,res)=>{
  const settings = await getSettings();
  res.render('admin-affiliate',{settings});
});
app.post('/admin/affiliate', requireRole('admin'), async (req,res)=>{
  const { platform_fee_rate, level1_rate, level2_rate, min_withdraw_amount } = req.body;
  await pool.query(`UPDATE affiliate_settings SET platform_fee_rate=$1, level1_rate=$2, level2_rate=$3, min_withdraw_amount=$4 WHERE id=1`, [Number(platform_fee_rate), Number(level1_rate), Number(level2_rate), Number(min_withdraw_amount)]);
  res.redirect('/admin/affiliate');
});
app.get('/admin/withdrawals', requireRole('admin'), async (req,res)=>{
  const requests = (await pool.query(`SELECT wr.*, u.name, u.email FROM withdrawal_requests wr JOIN users u ON u.id=wr.user_id ORDER BY wr.created_at DESC`)).rows;
  res.render('admin-withdrawals',{requests});
});
app.post('/admin/withdrawals/:id/:action', requireRole('admin'), async (req,res)=>{
  const id = Number(req.params.id);
  const action = req.params.action;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const reqQ = await client.query(`SELECT * FROM withdrawal_requests WHERE id=$1 FOR UPDATE`, [id]);
    if (!reqQ.rowCount) throw new Error('Không tìm thấy yêu cầu');
    const wr = reqQ.rows[0];
    if (wr.status !== 'pending') throw new Error('Yêu cầu đã xử lý');
    if (action === 'approve') {
      await client.query(`UPDATE withdrawal_requests SET status='approved', reviewed_by=$1, reviewed_at=NOW() WHERE id=$2`, [req.session.user.id, id]);
      await client.query(`INSERT INTO wallet_transactions (user_id, type, amount, description, withdrawal_request_id) VALUES ($1,'withdrawal', $2, $3, $4)`, [wr.user_id, -Math.abs(Number(wr.amount)), 'Rút tiền được duyệt #' + id, id]);
    } else {
      await client.query(`UPDATE withdrawal_requests SET status='rejected', reviewed_by=$1, reviewed_at=NOW() WHERE id=$2`, [req.session.user.id, id]);
    }
    await client.query('COMMIT');
    res.redirect('/admin/withdrawals');
  } catch (e) { await client.query('ROLLBACK'); console.error(e); res.status(500).send(e.message); } finally { client.release(); }
});

app.get('/admin/marketing', requireRole('admin'), async (req,res)=>{ const marketing=(await pool.query(`SELECT * FROM marketing_settings WHERE id=1`)).rows[0]; res.render('admin-marketing',{marketing}); });
app.post('/admin/marketing', requireRole('admin'), async (req,res)=>{ const { top_banner_text, hero_title, hero_subtitle, hero_cta_text, popup_text, popup_enabled } = req.body; await pool.query(`UPDATE marketing_settings SET top_banner_text=$1, hero_title=$2, hero_subtitle=$3, hero_cta_text=$4, popup_text=$5, popup_enabled=$6 WHERE id=1`, [top_banner_text, hero_title, hero_subtitle, hero_cta_text, popup_text, popup_enabled === 'on']); res.redirect('/admin/marketing'); });
app.get('/admin/flash-sales', requireRole('admin'), async (req,res)=>{ const flashSales=(await pool.query(`SELECT fs.*, COUNT(fsi.id)::int AS item_count FROM flash_sales fs LEFT JOIN flash_sale_items fsi ON fsi.flash_sale_id=fs.id GROUP BY fs.id ORDER BY fs.created_at DESC`)).rows; const products=(await pool.query(`SELECT id,name,price FROM products WHERE is_active=true ORDER BY name`)).rows; res.render('admin-flash-sales',{flashSales,products}); });
app.post('/admin/flash-sales', requireRole('admin'), async (req,res)=>{ const { name, description, start_at, end_at, sale_percent } = req.body; let productIds = req.body.product_ids || []; if (!Array.isArray(productIds)) productIds = [productIds]; const client=await pool.connect(); try { await client.query('BEGIN'); const fs=await client.query(`INSERT INTO flash_sales (name,description,start_at,end_at,is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`, [name,description,start_at,end_at]); for (const pid of productIds.filter(Boolean)) { await client.query(`INSERT INTO flash_sale_items (flash_sale_id, product_id, sale_percent) VALUES ($1,$2,$3)`, [fs.rows[0].id, Number(pid), Number(sale_percent||0)]); } await client.query('COMMIT'); res.redirect('/admin/flash-sales'); } catch(e){ await client.query('ROLLBACK'); console.error(e); res.status(500).send('Không tạo được flash sale.'); } finally { client.release(); } });
app.post('/admin/flash-sales/:id/toggle', requireRole('admin'), async (req,res)=>{ await pool.query(`UPDATE flash_sales SET is_active=NOT is_active WHERE id=$1`, [req.params.id]); res.redirect('/admin/flash-sales'); });

app.get('/seller', requireRole('seller'), async (req,res)=>{
  const sellerId = req.session.user.id;
  const seller = (await pool.query(`SELECT u.*, parent.name AS parent_name, parent.referral_code AS parent_referral_code FROM users u LEFT JOIN users parent ON parent.id=u.parent_seller_id WHERE u.id=$1`, [sellerId])).rows[0];
  const stats = {
    products: (await pool.query(`SELECT COUNT(*)::int AS c FROM products WHERE seller_id=$1`, [sellerId])).rows[0].c,
    orders: (await pool.query(`SELECT COUNT(DISTINCT order_id)::int AS c FROM order_items WHERE seller_id=$1`, [sellerId])).rows[0].c,
    gross: (await pool.query(`SELECT COALESCE(SUM(line_total),0)::numeric AS total FROM order_items WHERE seller_id=$1`, [sellerId])).rows[0].total,
    referralOrders: (await pool.query(`SELECT COUNT(*)::int AS c FROM orders WHERE ref_seller_id=$1`, [sellerId])).rows[0].c,
    referralRevenue: (await pool.query(`SELECT COALESCE(SUM(total_amount),0)::numeric AS total FROM orders WHERE ref_seller_id=$1`, [sellerId])).rows[0].total,
    referralCommission: (await pool.query(`SELECT COALESCE(SUM(referral_commission_amount),0)::numeric AS total FROM orders WHERE ref_seller_id=$1`, [sellerId])).rows[0].total,
    level2Commission: (await pool.query(`SELECT COALESCE(SUM(level2_commission_amount),0)::numeric AS total FROM orders WHERE level2_seller_id=$1`, [sellerId])).rows[0].total
  };
  const walletBalance = await getWalletBalance(sellerId);
  const products = (await pool.query(`SELECT * FROM products WHERE seller_id=$1 ORDER BY created_at DESC`, [sellerId])).rows;
  const referralOrders = (await pool.query(`SELECT id, full_name, status, total_amount, referral_commission_amount, level2_commission_amount, created_at FROM orders WHERE ref_seller_id=$1 OR level2_seller_id=$1 ORDER BY created_at DESC LIMIT 20`, [sellerId])).rows;
  const walletTransactions = (await pool.query(`SELECT * FROM wallet_transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20`, [sellerId])).rows;
  const withdrawals = (await pool.query(`SELECT * FROM withdrawal_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20`, [sellerId])).rows;
  const settings = await getSettings();
  const team = (await pool.query(`SELECT id,name,email,referral_code,created_at FROM users WHERE parent_seller_id=$1 ORDER BY created_at DESC`, [sellerId])).rows;
  const baseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
  const referralLink = `${baseUrl}/?ref=${seller.referral_code}`;
  res.render('seller-dashboard',{ stats, products, seller, referralLink, referralOrders, walletBalance, walletTransactions, withdrawals, settings, team });
});
app.post('/seller/withdrawals', requireRole('seller'), async (req,res)=>{
  const sellerId = req.session.user.id;
  const amount = Number(req.body.amount || 0);
  const settings = await getSettings();
  const balance = await getWalletBalance(sellerId);
  if (amount < Number(settings.min_withdraw_amount)) return res.status(400).send('Số tiền rút thấp hơn mức tối thiểu.');
  if (amount > balance) return res.status(400).send('Số dư ví không đủ.');
  await pool.query(`INSERT INTO withdrawal_requests (user_id, amount, bank_name, bank_account_name, bank_account_number, note) VALUES ($1,$2,$3,$4,$5,$6)`, [sellerId, amount, req.body.bank_name, req.body.bank_account_name, req.body.bank_account_number, req.body.note]);
  res.redirect('/seller');
});

app.get('/seller/products/new', requireRole('seller'), async (req,res)=>{ const categories=(await pool.query(`SELECT * FROM categories ORDER BY name`)).rows; res.render('seller-product-form',{product:null,categories,action:'/seller/products',method:'POST'}); });
app.post('/seller/products', requireRole('seller'), async (req,res)=>{ const { name, description, price, image_url, category_id, stock } = req.body; const slug=`${slugify(name)}-${Date.now().toString().slice(-6)}`; await pool.query(`INSERT INTO products (seller_id, category_id, name, slug, description, price, image_url, stock) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [req.session.user.id, category_id||null, name, slug, description, Number(price), image_url, Number(stock||0)]); res.redirect('/seller'); });
app.get('/seller/products/:id/edit', requireRole('seller'), async (req,res)=>{ const categories=(await pool.query(`SELECT * FROM categories ORDER BY name`)).rows; const result=await pool.query(`SELECT * FROM products WHERE id=$1 AND seller_id=$2`, [req.params.id, req.session.user.id]); if (!result.rowCount) return res.status(404).send('Không tìm thấy sản phẩm'); res.render('seller-product-form',{product:result.rows[0],categories,action:`/seller/products/${req.params.id}?_method=PUT`,method:'POST'}); });
app.put('/seller/products/:id', requireRole('seller'), async (req,res)=>{ const { name, description, price, image_url, category_id, stock, is_active } = req.body; await pool.query(`UPDATE products SET name=$1, description=$2, price=$3, image_url=$4, category_id=$5, stock=$6, is_active=$7 WHERE id=$8 AND seller_id=$9`, [name,description,Number(price),image_url,category_id||null,Number(stock||0),is_active==='on',req.params.id,req.session.user.id]); res.redirect('/seller'); });
app.delete('/seller/products/:id', requireRole('seller'), async (req,res)=>{ await pool.query(`DELETE FROM products WHERE id=$1 AND seller_id=$2`, [req.params.id, req.session.user.id]); res.redirect('/seller'); });
app.get('/seller/orders', requireRole('seller'), async (req,res)=>{ const items=(await pool.query(`SELECT oi.*, o.status, o.full_name, o.phone, o.address, o.created_at FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.seller_id=$1 ORDER BY o.created_at DESC`, [req.session.user.id])).rows; res.render('seller-orders',{items}); });
app.get('/admin/orders', requireRole('admin'), async (req,res)=>{ const orders=(await pool.query(`SELECT * FROM orders ORDER BY created_at DESC`)).rows; res.render('admin-orders',{orders}); });

app.use((err, req, res, next) => { console.error(err); res.status(500).send('Đã có lỗi xảy ra.'); });
initDb().then(()=>{ app.listen(PORT, ()=>console.log(`Server running at http://localhost:${PORT}`)); }).catch(err=>{ console.error('DB init failed:', err); process.exit(1); });
