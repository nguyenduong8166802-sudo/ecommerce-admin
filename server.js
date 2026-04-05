const express = require('express');
const path = require('path');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 10000;
const BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'duongmart_secret',
  resave: false,
  saveUninitialized: true
}));

const users = [
  { id: 1, role: 'admin', name: 'Admin', email: 'admin@duongmart.vn', password: 'admin123', commissionRate: 10, wallet: 0 },
  { id: 2, role: 'seller', name: 'Seller 1', email: 'seller1@duongmart.vn', password: 'seller123', commissionRate: 20, wallet: 250000 },
  { id: 3, role: 'buyer', name: 'Buyer 1', email: 'buyer1@duongmart.vn', password: 'buyer123', commissionRate: 0, wallet: 0 }
];

let products = [
  { id: 1, sellerId: 2, name: 'Sườn Tứ Quý BBQ', price: 189000, oldPrice: 249000, image: 'https://i.ibb.co/FkBztNtw/HINH-CHI-BAO.jpg', description: 'Sườn ướp sẵn chuẩn vị BBQ, tiện nướng tại nhà.', stock: 30, flashSale: true },
  { id: 2, sellerId: 2, name: 'Combo Sườn Mật Ong', price: 219000, oldPrice: 299000, image: 'https://i.ibb.co/FkBztNtw/HINH-CHI-BAO.jpg', description: 'Vị đậm đà, phù hợp gia đình và tiệc nhỏ.', stock: 18, flashSale: false }
];

let orders = [
  { id: 1, buyerId: 3, sellerId: 2, total: 189000, status: 'completed', referralCode: 'seller1' }
];

let affiliateSettings = { f1: 20, platformFee: 5, minWithdraw: 100000 };
let withdrawals = [
  { id: 1, userId: 2, amount: 100000, status: 'pending', createdAt: new Date().toISOString() }
];
let marketing = {
  topBar: '🔥 Flash Sale mỗi ngày | Tuyển cộng tác viên toàn quốc | Hoa hồng hấp dẫn',
  heroTitle: 'DUONG MART PRO - MUA SẮM & HỢP TÁC KINH DOANH',
  heroText: 'Bán hàng dễ hơn với sản phẩm thật, giá thật và hệ thống seller cơ bản có sẵn.',
  ctaText: 'Đăng ký làm đối tác'
};

function currentUser(req) {
  return users.find(u => u.id === req.session.userId) || null;
}
function requireRole(role) {
  return (req, res, next) => {
    const user = currentUser(req);
    if (!user || user.role !== role) return res.redirect('/login');
    next();
  };
}
app.use((req, res, next) => {
  res.locals.currentUser = currentUser(req);
  res.locals.baseUrl = BASE_URL;
  next();
});

app.get('/', (req, res) => {
  res.render('index', { products, marketing });
});

app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email === email && u.password === password);
  if (!user) return res.status(400).render('login', { error: 'Sai email hoặc mật khẩu.' });
  req.session.userId = user.id;
  if (user.role === 'admin') return res.redirect('/admin');
  if (user.role === 'seller') return res.redirect('/seller');
  return res.redirect('/');
});
app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.get('/seller', requireRole('seller'), (req, res) => {
  const user = currentUser(req);
  const sellerProducts = products.filter(p => p.sellerId === user.id);
  const sellerOrders = orders.filter(o => o.sellerId === user.id);
  const referralLink = `${BASE_URL}/?ref=seller${user.id}`;
  res.render('seller', { user, sellerProducts, sellerOrders, referralLink, withdrawals: withdrawals.filter(w => w.userId === user.id), affiliateSettings });
});
app.get('/seller/products/new', requireRole('seller'), (req, res) => res.render('product-form', { product: null }));
app.post('/seller/products/new', requireRole('seller'), (req, res) => {
  const user = currentUser(req);
  const nextId = products.length ? Math.max(...products.map(p => p.id)) + 1 : 1;
  products.push({
    id: nextId,
    sellerId: user.id,
    name: req.body.name,
    price: Number(req.body.price || 0),
    oldPrice: Number(req.body.oldPrice || 0),
    image: req.body.image,
    description: req.body.description,
    stock: Number(req.body.stock || 0),
    flashSale: !!req.body.flashSale
  });
  res.redirect('/seller');
});
app.post('/seller/withdraw', requireRole('seller'), (req, res) => {
  const user = currentUser(req);
  const amount = Number(req.body.amount || 0);
  if (amount >= affiliateSettings.minWithdraw && amount <= user.wallet) {
    withdrawals.push({ id: withdrawals.length + 1, userId: user.id, amount, status: 'pending', createdAt: new Date().toISOString() });
    user.wallet -= amount;
  }
  res.redirect('/seller');
});

app.get('/admin', requireRole('admin'), (req, res) => {
  const sellerCount = users.filter(u => u.role === 'seller').length;
  const buyerCount = users.filter(u => u.role === 'buyer').length;
  res.render('admin', { users, products, orders, sellerCount, buyerCount });
});
app.get('/admin/affiliate', requireRole('admin'), (req, res) => res.render('admin-affiliate', { affiliateSettings }));
app.post('/admin/affiliate', requireRole('admin'), (req, res) => {
  affiliateSettings = {
    f1: Number(req.body.f1 || affiliateSettings.f1),
    platformFee: Number(req.body.platformFee || affiliateSettings.platformFee),
    minWithdraw: Number(req.body.minWithdraw || affiliateSettings.minWithdraw)
  };
  res.redirect('/admin/affiliate');
});
app.get('/admin/withdrawals', requireRole('admin'), (req, res) => {
  const withdrawalRows = withdrawals.map(w => ({ ...w, user: users.find(u => u.id === w.userId) }));
  res.render('admin-withdrawals', { withdrawalRows });
});
app.post('/admin/withdrawals/:id/:status', requireRole('admin'), (req, res) => {
  const row = withdrawals.find(w => w.id === Number(req.params.id));
  if (row) row.status = req.params.status;
  res.redirect('/admin/withdrawals');
});
app.get('/admin/marketing', requireRole('admin'), (req, res) => res.render('admin-marketing', { marketing }));
app.post('/admin/marketing', requireRole('admin'), (req, res) => {
  marketing.topBar = req.body.topBar;
  marketing.heroTitle = req.body.heroTitle;
  marketing.heroText = req.body.heroText;
  marketing.ctaText = req.body.ctaText;
  res.redirect('/admin/marketing');
});

app.listen(PORT, () => console.log(`DUONG MART PRO chạy tại cổng ${PORT}`));
