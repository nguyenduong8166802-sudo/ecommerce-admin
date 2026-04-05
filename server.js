const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Demo in-memory data
let storeSettings = {
  siteName: 'DWG Mini Commerce',
  currency: 'VND',
  defaultCommissionPercent: 10,
  adminFeeNote: 'Hoa hồng mặc định cho người bán là 10% trên mỗi đơn hàng hoàn tất.'
};

let sellers = [
  { id: 1, name: 'Shop A', email: 'shopa@example.com', commissionPercent: 8 },
  { id: 2, name: 'Shop B', email: 'shopb@example.com', commissionPercent: 12 }
];

let products = [
  { id: 1, sellerId: 1, name: 'Áo thun basic', price: 120000, stock: 20 },
  { id: 2, sellerId: 1, name: 'Quần jean nam', price: 350000, stock: 12 },
  { id: 3, sellerId: 2, name: 'Túi xách nữ', price: 480000, stock: 8 }
];

let orders = [
  {
    id: 1,
    customerName: 'Nguyễn Văn A',
    productId: 1,
    qty: 2,
    status: 'completed'
  },
  {
    id: 2,
    customerName: 'Trần Thị B',
    productId: 3,
    qty: 1,
    status: 'pending'
  }
];

function getSellerById(id) {
  return sellers.find(s => s.id === Number(id));
}

function getProductById(id) {
  return products.find(p => p.id === Number(id));
}

function formatMoney(value) {
  return new Intl.NumberFormat('vi-VN').format(value) + ' đ';
}

function getCommissionPercentForSeller(sellerId) {
  const seller = getSellerById(sellerId);
  return seller?.commissionPercent ?? storeSettings.defaultCommissionPercent;
}

function buildOrderView(order) {
  const product = getProductById(order.productId);
  const seller = product ? getSellerById(product.sellerId) : null;
  const subtotal = product ? product.price * order.qty : 0;
  const commissionPercent = seller ? getCommissionPercentForSeller(seller.id) : 0;
  const commissionAmount = Math.round((subtotal * commissionPercent) / 100);
  const sellerReceive = subtotal - commissionAmount;

  return {
    ...order,
    product,
    seller,
    subtotal,
    commissionPercent,
    commissionAmount,
    sellerReceive
  };
}

app.locals.formatMoney = formatMoney;

app.get('/', (req, res) => {
  const productViews = products.map(p => ({
    ...p,
    seller: getSellerById(p.sellerId)
  }));
  res.render('index', { storeSettings, products: productViews });
});

app.post('/checkout', (req, res) => {
  const { customerName, productId, qty } = req.body;
  const product = getProductById(productId);

  if (!product) {
    return res.status(404).send('Không tìm thấy sản phẩm');
  }

  const quantity = Math.max(1, Number(qty || 1));
  if (product.stock < quantity) {
    return res.status(400).send('Sản phẩm không đủ tồn kho');
  }

  product.stock -= quantity;
  orders.push({
    id: orders.length + 1,
    customerName: customerName || 'Khách lẻ',
    productId: product.id,
    qty: quantity,
    status: 'completed'
  });

  res.redirect('/admin/orders');
});

app.get('/policy', (req, res) => {
  res.render('policy', { storeSettings, sellers });
});

app.get('/admin', (req, res) => {
  const completedOrders = orders.filter(o => o.status === 'completed').map(buildOrderView);
  const grossRevenue = completedOrders.reduce((sum, o) => sum + o.subtotal, 0);
  const totalCommission = completedOrders.reduce((sum, o) => sum + o.commissionAmount, 0);
  const totalSellerPayout = completedOrders.reduce((sum, o) => sum + o.sellerReceive, 0);

  res.render('admin', {
    storeSettings,
    sellers,
    products,
    orders: completedOrders,
    summary: { grossRevenue, totalCommission, totalSellerPayout }
  });
});

app.get('/admin/products', (req, res) => {
  res.render('admin-products', { storeSettings, products, sellers });
});

app.post('/admin/products', (req, res) => {
  const { name, price, stock, sellerId } = req.body;
  products.push({
    id: products.length + 1,
    name,
    price: Number(price),
    stock: Number(stock),
    sellerId: Number(sellerId)
  });
  res.redirect('/admin/products');
});

app.get('/admin/sellers', (req, res) => {
  res.render('admin-sellers', { storeSettings, sellers });
});

app.post('/admin/sellers', (req, res) => {
  const { name, email, commissionPercent } = req.body;
  sellers.push({
    id: sellers.length + 1,
    name,
    email,
    commissionPercent: Number(commissionPercent || storeSettings.defaultCommissionPercent)
  });
  res.redirect('/admin/sellers');
});

app.post('/admin/settings', (req, res) => {
  const { siteName, defaultCommissionPercent, adminFeeNote } = req.body;
  storeSettings.siteName = siteName;
  storeSettings.defaultCommissionPercent = Number(defaultCommissionPercent);
  storeSettings.adminFeeNote = adminFeeNote;
  res.redirect('/admin');
});

app.get('/admin/orders', (req, res) => {
  const orderViews = orders.map(buildOrderView);
  res.render('admin-orders', { storeSettings, orders: orderViews });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
