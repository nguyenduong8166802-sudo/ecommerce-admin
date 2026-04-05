
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const methodOverride = require('method-override');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;
const DATABASE_URL = process.env.DATABASE_URL;
const SESSION_SECRET = process.env.SESSION_SECRET || 'duongmartpro';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;

if (!DATABASE_URL) {
  console.error('DATABASE_URL is missing');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('render.com') ? { rejectUnauthorized: false } : false
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));

async function q(sql, params=[]) {
  return pool.query(sql, params);
}

async function initDb() {
  await q(`
    CREATE TABLE IF NOT EXISTS session (
      sid varchar NOT NULL PRIMARY KEY,
      sess json NOT NULL,
      expire timestamp(6) NOT NULL
    );
  `);
  await q(`CREATE INDEX IF NOT EXISTS IDX_session_expire ON session (expire);`);

  await q(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      email VARCHAR(160) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role VARCHAR(20) NOT NULL DEFAULT 'buyer',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const userCols = await q(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='users'
  `);
  const names = new Set(userCols.rows.map(r => r.column_name));
  const addCol = async (name, sql) => {
    if (!names.has(name)) await q(`ALTER TABLE users ADD COLUMN ${sql}`);
  };
  await addCol('wallet_balance', `wallet_balance NUMERIC(18,2) NOT NULL DEFAULT 0`);
  await addCol('referral_code', `referral_code VARCHAR(80)`);
  await addCol('referral_rate', `referral_rate NUMERIC(5,2) NOT NULL DEFAULT 20`);
  await addCol('commission_rate', `commission_rate NUMERIC(5,2) NOT NULL DEFAULT 20`);

  await q(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      seller_id INT REFERENCES users(id) ON DELETE SET NULL,
      name VARCHAR(180) NOT NULL,
      description TEXT,
      image_url TEXT,
      price NUMERIC(18,2) NOT NULL DEFAULT 0,
      stock INT NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      buyer_id INT REFERENCES users(id) ON DELETE SET NULL,
      seller_id INT REFERENCES users(id) ON DELETE SET NULL,
      product_id INT REFERENCES products(id) ON DELETE SET NULL,
      quantity INT NOT NULL DEFAULT 1,
      total_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const orderCols = await q(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='orders'
  `);
  const orderNames = new Set(orderCols.rows.map(r => r.column_name));
  if (!orderNames.has('ref_user_id')) {
    await q(`ALTER TABLE orders ADD COLUMN ref_user_id INT REFERENCES users(id) ON DELETE SET NULL`);
  }

  await q(`
    CREATE TABLE IF NOT EXISTS withdrawal_requests (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      amount NUMERIC(18,2) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await seed();
}

async function seed() {
  const exists = await q(`SELECT id FROM users WHERE email=$1`, ['admin@duongmart.vn']);
  if (exists.rowCount === 0) {
    const adminPass = await bcrypt.hash('admin123', 10);
    const sellerPass = await bcrypt.hash('seller123', 10);
    const buyerPass = await bcrypt.hash('buyer123', 10);

    await q(`INSERT INTO users(name,email,password_hash,role,referral_code,referral_rate,commission_rate) VALUES
      ('Admin','admin@duongmart.vn',$1,'admin','admin',0,0),
      ('Seller 1','seller1@duongmart.vn',$2,'seller','seller1',20,20),
      ('Buyer 1','buyer1@duongmart.vn',$3,'buyer','buyer1',0,0)
    `, [adminPass, sellerPass, buyerPass]);

    const seller = await q(`SELECT id FROM users WHERE email='seller1@duongmart.vn'`);
    const sid = seller.rows[0].id;
    await q(`INSERT INTO products(seller_id,name,description,image_url,price,stock,is_active) VALUES
      ($1,'Chỉ báo SMART PRO','Chỉ báo giao dịch chuyên nghiệp','https://i.ibb.co/FkBztNtw/HINH-CHI-BAO.jpg',2990000,999,TRUE),
      ($1,'Combo rau củ sạch','Sản phẩm demo cho marketplace','https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=900&q=80',59000,50,TRUE)
    `, [sid]);
  }
}

function ensureAuth(req,res,next){
  if(!req.session.user) return res.redirect('/login');
  next();
}
function ensureRole(roles){
  return (req,res,next)=>{
    if(!req.session.user) return res.redirect('/login');
    if(!roles.includes(req.session.user.role)) return res.status(403).send('Forbidden');
    next();
  }
}

app.use(session({
  store: new pgSession({
    pool,
    tableName: 'session',
    createTableIfMissing: true
  }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000*60*60*24*7 }
}));

app.use(async (req,res,next)=>{
  res.locals.currentUser = req.session.user || null;
  if (req.query.ref) req.session.ref = req.query.ref;
  next();
});

app.get('/', async (req,res)=>{
  const products = (await q(`
    SELECT p.*, u.name seller_name FROM products p
    LEFT JOIN users u ON u.id=p.seller_id
    WHERE p.is_active=TRUE ORDER BY p.id DESC
  `)).rows;
  res.render('home', { products, publicBaseUrl: PUBLIC_BASE_URL });
});

app.get('/register', (req,res)=> res.render('register', { error:null }));
app.post('/register', async (req,res)=>{
  try{
    const { name,email,password,role } = req.body;
    const r = ['buyer','seller'].includes(role) ? role : 'buyer';
    const hash = await bcrypt.hash(password, 10);
    const referralCode = email.split('@')[0].replace(/[^a-zA-Z0-9]/g,'').toLowerCase().slice(0,20) + Math.floor(Math.random()*1000);
    await q(`INSERT INTO users(name,email,password_hash,role,referral_code) VALUES($1,$2,$3,$4,$5)`,
      [name,email,hash,r,referralCode]);
    res.redirect('/login');
  } catch(e){
    res.render('register',{ error:'Email đã tồn tại hoặc dữ liệu chưa đúng.' });
  }
});

app.get('/login', (req,res)=> res.render('login', { error:null }));
app.post('/login', async (req,res)=>{
  const { email,password } = req.body;
  const rs = await q(`SELECT * FROM users WHERE email=$1`, [email]);
  if (!rs.rowCount) return res.render('login',{ error:'Sai email hoặc mật khẩu.'});
  const user = rs.rows[0];
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.render('login',{ error:'Sai email hoặc mật khẩu.'});
  req.session.user = { id:user.id, name:user.name, email:user.email, role:user.role };
  if (user.role === 'admin') return res.redirect('/admin');
  if (user.role === 'seller') return res.redirect('/seller/products');
  return res.redirect('/');
});

app.post('/logout', (req,res)=>{
  req.session.destroy(()=> res.redirect('/'));
});

app.get('/admin', ensureRole(['admin']), async (req,res)=>{
  const sellerCount = (await q(`SELECT COUNT(*)::int c FROM users WHERE role='seller'`)).rows[0].c;
  const buyerCount = (await q(`SELECT COUNT(*)::int c FROM users WHERE role='buyer'`)).rows[0].c;
  const productCount = (await q(`SELECT COUNT(*)::int c FROM products`)).rows[0].c;
  const orderCount = (await q(`SELECT COUNT(*)::int c FROM orders`)).rows[0].c;
  res.render('admin_dashboard',{ sellerCount,buyerCount,productCount,orderCount });
});

app.get('/admin/products', ensureRole(['admin']), async (req,res)=>{
  const products = (await q(`
    SELECT p.*, u.name seller_name FROM products p
    LEFT JOIN users u ON u.id=p.seller_id
    ORDER BY p.id DESC
  `)).rows;
  const sellers = (await q(`SELECT id,name,email FROM users WHERE role='seller' ORDER BY id DESC`)).rows;
  res.render('admin_products',{ products, sellers });
});

app.get('/admin/products/new', ensureRole(['admin']), async (req,res)=>{
  const sellers = (await q(`SELECT id,name,email FROM users WHERE role='seller' ORDER BY id DESC`)).rows;
  res.render('product_form',{ title:'Admin thêm sản phẩm', action:'/admin/products', method:'POST', product:null, sellers, isAdmin:true });
});

app.post('/admin/products', ensureRole(['admin']), async (req,res)=>{
  const { seller_id,name,description,image_url,price,stock,is_active } = req.body;
  await q(`INSERT INTO products(seller_id,name,description,image_url,price,stock,is_active)
          VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [seller_id || null, name, description, image_url, price || 0, stock || 0, is_active === 'on']);
  res.redirect('/admin/products');
});

app.get('/admin/products/:id/edit', ensureRole(['admin']), async (req,res)=>{
  const product = (await q(`SELECT * FROM products WHERE id=$1`, [req.params.id])).rows[0];
  const sellers = (await q(`SELECT id,name,email FROM users WHERE role='seller' ORDER BY id DESC`)).rows;
  if (!product) return res.status(404).send('Not found');
  res.render('product_form',{ title:'Admin sửa sản phẩm', action:`/admin/products/${product.id}?_method=PUT`, method:'POST', product, sellers, isAdmin:true });
});

app.put('/admin/products/:id', ensureRole(['admin']), async (req,res)=>{
  const { seller_id,name,description,image_url,price,stock,is_active } = req.body;
  await q(`UPDATE products SET seller_id=$1,name=$2,description=$3,image_url=$4,price=$5,stock=$6,is_active=$7 WHERE id=$8`,
    [seller_id || null, name, description, image_url, price || 0, stock || 0, is_active === 'on', req.params.id]);
  res.redirect('/admin/products');
});

app.post('/admin/products/:id/delete', ensureRole(['admin']), async (req,res)=>{
  await q(`DELETE FROM products WHERE id=$1`, [req.params.id]);
  res.redirect('/admin/products');
});

app.get('/seller', ensureRole(['seller']), (req,res)=> res.redirect('/seller/products'));
app.get('/seller/products', ensureRole(['seller']), async (req,res)=>{
  const userId = req.session.user.id;
  const user = (await q(`SELECT * FROM users WHERE id=$1`, [userId])).rows[0];
  const products = (await q(`SELECT * FROM products WHERE seller_id=$1 ORDER BY id DESC`, [userId])).rows;
  res.render('seller_products',{ products, user, publicBaseUrl: PUBLIC_BASE_URL });
});

app.get('/seller/products/new', ensureRole(['seller']), (req,res)=>{
  res.render('product_form',{ title:'Thêm sản phẩm', action:'/seller/products', method:'POST', product:null, sellers:[], isAdmin:false });
});

app.post('/seller/products', ensureRole(['seller']), async (req,res)=>{
  const { name,description,image_url,price,stock,is_active } = req.body;
  await q(`INSERT INTO products(seller_id,name,description,image_url,price,stock,is_active)
          VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [req.session.user.id, name, description, image_url, price || 0, stock || 0, is_active === 'on']);
  res.redirect('/seller/products');
});

app.get('/seller/products/:id/edit', ensureRole(['seller']), async (req,res)=>{
  const product = (await q(`SELECT * FROM products WHERE id=$1 AND seller_id=$2`, [req.params.id, req.session.user.id])).rows[0];
  if (!product) return res.status(404).send('Not found');
  res.render('product_form',{ title:'Sửa sản phẩm', action:`/seller/products/${product.id}?_method=PUT`, method:'POST', product, sellers:[], isAdmin:false });
});

app.put('/seller/products/:id', ensureRole(['seller']), async (req,res)=>{
  const { name,description,image_url,price,stock,is_active } = req.body;
  await q(`UPDATE products SET name=$1,description=$2,image_url=$3,price=$4,stock=$5,is_active=$6 WHERE id=$7 AND seller_id=$8`,
    [name, description, image_url, price || 0, stock || 0, is_active === 'on', req.params.id, req.session.user.id]);
  res.redirect('/seller/products');
});

app.post('/seller/products/:id/delete', ensureRole(['seller']), async (req,res)=>{
  await q(`DELETE FROM products WHERE id=$1 AND seller_id=$2`, [req.params.id, req.session.user.id]);
  res.redirect('/seller/products');
});

app.post('/buy/:id', ensureAuth, async (req,res)=>{
  const product = (await q(`SELECT * FROM products WHERE id=$1 AND is_active=TRUE`, [req.params.id])).rows[0];
  if (!product) return res.status(404).send('Không tìm thấy sản phẩm.');
  const qty = 1;
  const total = Number(product.price) * qty;
  let refUserId = null;
  if (req.session.ref) {
    const ref = await q(`SELECT id FROM users WHERE referral_code=$1 OR LOWER(email)=LOWER($1)`, [req.session.ref]);
    if (ref.rowCount) refUserId = ref.rows[0].id;
  }
  await q(`INSERT INTO orders(buyer_id,seller_id,product_id,quantity,total_amount,status,ref_user_id)
          VALUES($1,$2,$3,$4,$5,'pending',$6)`,
          [req.session.user.id, product.seller_id, product.id, qty, total, refUserId]);
  res.redirect('/');
});

app.use((err,req,res,next)=>{
  console.error(err);
  res.status(500).send('Internal Server Error');
});

initDb().then(()=>{
  app.listen(PORT, ()=> console.log(`DUONG MART chạy tại cổng ${PORT}`));
}).catch(err=>{
  console.error('Lỗi khởi tạo database:', err);
  process.exit(1);
});
