const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const slugify = require('slugify');

const app = express();
const PORT = process.env.PORT || 10000;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'duong-ai-marketplace-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 }
}));

function currency(value) {
  return new Intl.NumberFormat('vi-VN').format(Number(value || 0)) + ' đ';
}

function uid(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function seedDb() {
  const adminPassword = bcrypt.hashSync('admin123', 10);
  const sellerPassword = bcrypt.hashSync('seller123', 10);
  return {
    settings: {
      siteName: 'DUONG MART PRO',
      heroTitle: 'Marketplace kiểu WinMart cho bán lẻ, seller và hoa hồng',
      heroSubtitle: 'Bản PRO có admin, seller dashboard, giỏ hàng, đơn hàng, commission và giao diện bán hàng chuyên nghiệp.',
      primaryBanner: 'Miễn phí vận chuyển cho đơn từ 299.000đ | Flash sale mỗi ngày | Seller đối soát minh bạch'
    },
    users: [
      {
        id: 'admin_1',
        role: 'admin',
        fullName: 'Super Admin',
        email: 'admin@duongmart.vn',
        passwordHash: adminPassword,
        commissionRate: 0,
        payoutInfo: 'N/A'
      },
      {
        id: 'seller_1',
        role: 'seller',
        fullName: 'Fresh Food Seller',
        email: 'seller1@duongmart.vn',
        passwordHash: sellerPassword,
        commissionRate: 8,
        payoutInfo: 'MB Bank - 123456789'
      },
      {
        id: 'seller_2',
        role: 'seller',
        fullName: 'Gia dụng Seller',
        email: 'seller2@duongmart.vn',
        passwordHash: sellerPassword,
        commissionRate: 12,
        payoutInfo: 'ACB - 99887766'
      }
    ],
    categories: [
      { id: 'cat_1', name: 'Rau củ - trái cây', slug: 'rau-cu-trai-cay' },
      { id: 'cat_2', name: 'Thịt - hải sản', slug: 'thit-hai-san' },
      { id: 'cat_3', name: 'Gia dụng', slug: 'gia-dung' },
      { id: 'cat_4', name: 'Khuyến mãi hot', slug: 'khuyen-mai-hot' }
    ],
    products: [
      {
        id: 'pro_1',
        sellerId: 'seller_1',
        categoryId: 'cat_1',
        name: 'Táo Envy New Zealand 1kg',
        slug: 'tao-envy-new-zealand-1kg',
        price: 129000,
        salePrice: 99000,
        stock: 120,
        imageUrl: 'https://images.unsplash.com/photo-1567306226416-28f0efdc88ce?auto=format&fit=crop&w=900&q=80',
        shortDesc: 'Táo nhập khẩu giòn ngọt, phù hợp gia đình.',
        description: 'Sản phẩm mẫu cho giao diện marketplace. Có thể chỉnh sửa trong admin.',
        featured: true
      },
      {
        id: 'pro_2',
        sellerId: 'seller_1',
        categoryId: 'cat_2',
        name: 'Cá hồi phi lê 500g',
        slug: 'ca-hoi-phi-le-500g',
        price: 219000,
        salePrice: 189000,
        stock: 80,
        imageUrl: 'https://images.unsplash.com/photo-1544943910-4c1dc44aab44?auto=format&fit=crop&w=900&q=80',
        shortDesc: 'Cá hồi tươi, đóng gói lạnh.',
        description: 'Phù hợp bán hàng siêu thị online, giao nhanh trong ngày.',
        featured: true
      },
      {
        id: 'pro_3',
        sellerId: 'seller_2',
        categoryId: 'cat_3',
        name: 'Nồi chiên không dầu 6L',
        slug: 'noi-chien-khong-dau-6l',
        price: 1890000,
        salePrice: 1590000,
        stock: 35,
        imageUrl: 'https://images.unsplash.com/photo-1585515656796-bb07d5ad7d6d?auto=format&fit=crop&w=900&q=80',
        shortDesc: 'Gia dụng bán chạy cho gia đình.',
        description: 'Có thể dùng làm sản phẩm mẫu cho gian hàng seller.',
        featured: true
      },
      {
        id: 'pro_4',
        sellerId: 'seller_2',
        categoryId: 'cat_4',
        name: 'Bộ lau nhà xoay 360',
        slug: 'bo-lau-nha-xoay-360',
        price: 399000,
        salePrice: 299000,
        stock: 50,
        imageUrl: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=900&q=80',
        shortDesc: 'Khuyến mãi mạnh, phù hợp banner hot deal.',
        description: 'Sản phẩm demo để hiển thị ở trang khuyến mãi.',
        featured: false
      }
    ],
    orders: [],
    withdrawals: []
  };
}

function loadDb() {
  if (!fs.existsSync(DATA_FILE)) {
    const initial = seedDb();
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveDb(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function db() {
  return loadDb();
}

function currentUser(req) {
  const database = db();
  return database.users.find(u => u.id === req.session.userId) || null;
}

function cartCount(cart = []) {
  return cart.reduce((sum, item) => sum + item.qty, 0);
}

function enrichProduct(database, product) {
  const seller = database.users.find(u => u.id === product.sellerId) || {};
  const category = database.categories.find(c => c.id === product.categoryId) || {};
  return { ...product, sellerName: seller.fullName, categoryName: category.name, finalPrice: product.salePrice || product.price };
}

app.use((req, res, next) => {
  const user = currentUser(req);
  const database = db();
  res.locals.site = database.settings;
  res.locals.currentUser = user;
  res.locals.cart = req.session.cart || [];
  res.locals.cartCount = cartCount(req.session.cart || []);
  res.locals.currency = currency;
  next();
});

function requireAuth(role) {
  return (req, res, next) => {
    const user = currentUser(req);
    if (!user || (role && user.role !== role)) return res.redirect('/login');
    req.user = user;
    next();
  };
}

app.get('/', (req, res) => {
  const database = db();
  const featured = database.products.filter(p => p.featured).map(p => enrichProduct(database, p));
  const flashSale = database.products.slice(0, 8).map(p => enrichProduct(database, p));
  res.render('home', { featured, flashSale, categories: database.categories, q: '' });
});

app.get('/shop', (req, res) => {
  const database = db();
  const q = (req.query.q || '').trim().toLowerCase();
  const category = req.query.category || '';
  let products = database.products;
  if (q) products = products.filter(p => p.name.toLowerCase().includes(q) || p.shortDesc.toLowerCase().includes(q));
  if (category) products = products.filter(p => p.categoryId === category);
  res.render('shop', {
    products: products.map(p => enrichProduct(database, p)),
    categories: database.categories,
    q,
    category
  });
});

app.get('/product/:slug', (req, res) => {
  const database = db();
  const product = database.products.find(p => p.slug === req.params.slug);
  if (!product) return res.status(404).send('Không tìm thấy sản phẩm');
  const related = database.products.filter(p => p.categoryId === product.categoryId && p.id !== product.id).slice(0, 4).map(p => enrichProduct(database, p));
  res.render('product-detail', { product: enrichProduct(database, product), related });
});

app.post('/cart/add', (req, res) => {
  const database = db();
  const product = database.products.find(p => p.id === req.body.productId);
  if (!product) return res.redirect('/shop');
  const qty = Math.max(1, Number(req.body.qty || 1));
  req.session.cart = req.session.cart || [];
  const found = req.session.cart.find(item => item.productId === product.id);
  if (found) found.qty += qty;
  else req.session.cart.push({ productId: product.id, qty });
  res.redirect('/cart');
});

app.get('/cart', (req, res) => {
  const database = db();
  const items = (req.session.cart || []).map(item => {
    const product = database.products.find(p => p.id === item.productId);
    if (!product) return null;
    const enriched = enrichProduct(database, product);
    return { ...enriched, qty: item.qty, lineTotal: enriched.finalPrice * item.qty };
  }).filter(Boolean);
  const total = items.reduce((sum, item) => sum + item.lineTotal, 0);
  res.render('cart', { items, total });
});

app.post('/cart/update', (req, res) => {
  req.session.cart = (req.session.cart || []).map(item => {
    if (item.productId === req.body.productId) return { ...item, qty: Math.max(1, Number(req.body.qty || 1)) };
    return item;
  });
  res.redirect('/cart');
});

app.post('/cart/remove', (req, res) => {
  req.session.cart = (req.session.cart || []).filter(item => item.productId !== req.body.productId);
  res.redirect('/cart');
});

app.get('/checkout', (req, res) => {
  const database = db();
  const items = (req.session.cart || []).map(item => {
    const product = database.products.find(p => p.id === item.productId);
    if (!product) return null;
    const enriched = enrichProduct(database, product);
    return { ...enriched, qty: item.qty, lineTotal: enriched.finalPrice * item.qty };
  }).filter(Boolean);
  const total = items.reduce((sum, item) => sum + item.lineTotal, 0);
  res.render('checkout', { items, total, error: null });
});

app.post('/checkout', (req, res) => {
  const database = db();
  const cart = req.session.cart || [];
  if (!cart.length) return res.redirect('/cart');

  const fullName = (req.body.fullName || '').trim();
  const phone = (req.body.phone || '').trim();
  const address = (req.body.address || '').trim();
  if (!fullName || !phone || !address) {
    const items = cart.map(item => {
      const product = database.products.find(p => p.id === item.productId);
      const enriched = enrichProduct(database, product);
      return { ...enriched, qty: item.qty, lineTotal: enriched.finalPrice * item.qty };
    });
    const total = items.reduce((sum, item) => sum + item.lineTotal, 0);
    return res.render('checkout', { items, total, error: 'Vui lòng điền đầy đủ thông tin nhận hàng.' });
  }

  const items = cart.map(item => {
    const product = database.products.find(p => p.id === item.productId);
    const enriched = enrichProduct(database, product);
    const seller = database.users.find(u => u.id === product.sellerId);
    const unitPrice = enriched.finalPrice;
    const lineTotal = unitPrice * item.qty;
    const commissionRate = Number(seller.commissionRate || 0);
    const commissionAmount = Math.round(lineTotal * commissionRate / 100);
    const sellerReceivable = lineTotal - commissionAmount;
    return {
      productId: product.id,
      productName: product.name,
      sellerId: product.sellerId,
      sellerName: seller.fullName,
      qty: item.qty,
      unitPrice,
      lineTotal,
      commissionRate,
      commissionAmount,
      sellerReceivable
    };
  });

  const total = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const commissionTotal = items.reduce((sum, item) => sum + item.commissionAmount, 0);
  const sellerTotal = items.reduce((sum, item) => sum + item.sellerReceivable, 0);

  database.orders.unshift({
    id: uid('ord'),
    code: 'DH' + String(Date.now()).slice(-8),
    createdAt: new Date().toISOString(),
    customer: { fullName, phone, address },
    status: 'pending',
    items,
    totals: { total, commissionTotal, sellerTotal }
  });
  saveDb(database);
  req.session.cart = [];
  res.render('order-success', { order: database.orders[0] });
});

app.get('/policy/commission', (req, res) => {
  const database = db();
  const sellers = database.users.filter(u => u.role === 'seller');
  res.render('commission-policy', { sellers });
});

app.get('/login', (req, res) => res.render('login', { error: null }));

app.post('/login', (req, res) => {
  const database = db();
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  const user = database.users.find(u => u.email.toLowerCase() === email);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.render('login', { error: 'Sai email hoặc mật khẩu.' });
  }
  req.session.userId = user.id;
  return res.redirect(user.role === 'admin' ? '/admin' : '/seller');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.get('/admin', requireAuth('admin'), (req, res) => {
  const database = db();
  const totalRevenue = database.orders.reduce((sum, order) => sum + order.totals.total, 0);
  const totalCommission = database.orders.reduce((sum, order) => sum + order.totals.commissionTotal, 0);
  const totalSellerPayout = database.orders.reduce((sum, order) => sum + order.totals.sellerTotal, 0);
  res.render('admin/dashboard', {
    stats: {
      products: database.products.length,
      sellers: database.users.filter(u => u.role === 'seller').length,
      orders: database.orders.length,
      totalRevenue,
      totalCommission,
      totalSellerPayout
    },
    recentOrders: database.orders.slice(0, 5)
  });
});

app.get('/admin/products', requireAuth('admin'), (req, res) => {
  const database = db();
  res.render('admin/products', {
    products: database.products.map(p => enrichProduct(database, p)),
    sellers: database.users.filter(u => u.role === 'seller'),
    categories: database.categories,
    editProduct: null
  });
});

app.get('/admin/products/:id/edit', requireAuth('admin'), (req, res) => {
  const database = db();
  res.render('admin/products', {
    products: database.products.map(p => enrichProduct(database, p)),
    sellers: database.users.filter(u => u.role === 'seller'),
    categories: database.categories,
    editProduct: database.products.find(p => p.id === req.params.id) || null
  });
});

app.post('/admin/products/save', requireAuth('admin'), (req, res) => {
  const database = db();
  const body = req.body;
  const slug = slugify(body.name || '', { lower: true, strict: true, locale: 'vi' });
  const payload = {
    sellerId: body.sellerId,
    categoryId: body.categoryId,
    name: body.name,
    slug,
    price: Number(body.price || 0),
    salePrice: Number(body.salePrice || 0),
    stock: Number(body.stock || 0),
    imageUrl: body.imageUrl,
    shortDesc: body.shortDesc,
    description: body.description,
    featured: body.featured === 'on'
  };
  if (body.id) {
    const idx = database.products.findIndex(p => p.id === body.id);
    if (idx >= 0) database.products[idx] = { ...database.products[idx], ...payload };
  } else {
    database.products.unshift({ id: uid('pro'), ...payload });
  }
  saveDb(database);
  res.redirect('/admin/products');
});

app.post('/admin/products/:id/delete', requireAuth('admin'), (req, res) => {
  const database = db();
  database.products = database.products.filter(p => p.id !== req.params.id);
  saveDb(database);
  res.redirect('/admin/products');
});

app.get('/admin/orders', requireAuth('admin'), (req, res) => {
  const database = db();
  res.render('admin/orders', { orders: database.orders });
});

app.post('/admin/orders/:id/status', requireAuth('admin'), (req, res) => {
  const database = db();
  const order = database.orders.find(o => o.id === req.params.id);
  if (order) order.status = req.body.status;
  saveDb(database);
  res.redirect('/admin/orders');
});

app.get('/admin/sellers', requireAuth('admin'), (req, res) => {
  const database = db();
  const sellers = database.users.filter(u => u.role === 'seller').map(seller => {
    const sellerOrders = database.orders.flatMap(o => o.items.filter(i => i.sellerId === seller.id));
    const gross = sellerOrders.reduce((sum, i) => sum + i.lineTotal, 0);
    const commission = sellerOrders.reduce((sum, i) => sum + i.commissionAmount, 0);
    const receivable = sellerOrders.reduce((sum, i) => sum + i.sellerReceivable, 0);
    return { ...seller, gross, commission, receivable };
  });
  res.render('admin/sellers', { sellers });
});

app.get('/seller', requireAuth('seller'), (req, res) => {
  const database = db();
  const sellerProducts = database.products.filter(p => p.sellerId === req.user.id).map(p => enrichProduct(database, p));
  const sellerItems = database.orders.flatMap(order => order.items.map(item => ({ ...item, orderCode: order.code, orderStatus: order.status, createdAt: order.createdAt }))).filter(item => item.sellerId === req.user.id);
  const gross = sellerItems.reduce((sum, i) => sum + i.lineTotal, 0);
  const commission = sellerItems.reduce((sum, i) => sum + i.commissionAmount, 0);
  const receivable = sellerItems.reduce((sum, i) => sum + i.sellerReceivable, 0);
  res.render('seller/dashboard', { sellerProducts, sellerItems, gross, commission, receivable });
});

app.get('/seller/products', requireAuth('seller'), (req, res) => {
  const database = db();
  const products = database.products.filter(p => p.sellerId === req.user.id).map(p => enrichProduct(database, p));
  const editProduct = database.products.find(p => p.id === req.query.edit && p.sellerId === req.user.id) || null;
  res.render('seller/products', { products, categories: database.categories, editProduct });
});

app.post('/seller/products/save', requireAuth('seller'), (req, res) => {
  const database = db();
  const body = req.body;
  const slug = slugify(body.name || '', { lower: true, strict: true, locale: 'vi' });
  const payload = {
    sellerId: req.user.id,
    categoryId: body.categoryId,
    name: body.name,
    slug,
    price: Number(body.price || 0),
    salePrice: Number(body.salePrice || 0),
    stock: Number(body.stock || 0),
    imageUrl: body.imageUrl,
    shortDesc: body.shortDesc,
    description: body.description,
    featured: body.featured === 'on'
  };
  if (body.id) {
    const idx = database.products.findIndex(p => p.id === body.id && p.sellerId === req.user.id);
    if (idx >= 0) database.products[idx] = { ...database.products[idx], ...payload };
  } else {
    database.products.unshift({ id: uid('pro'), ...payload });
  }
  saveDb(database);
  res.redirect('/seller/products');
});

app.post('/seller/products/:id/delete', requireAuth('seller'), (req, res) => {
  const database = db();
  database.products = database.products.filter(p => !(p.id === req.params.id && p.sellerId === req.user.id));
  saveDb(database);
  res.redirect('/seller/products');
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
