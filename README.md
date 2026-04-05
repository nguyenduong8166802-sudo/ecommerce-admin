
# DUONG MART PRO - Admin + Seller quản lý sản phẩm full

## Chức năng
- Admin quản lý toàn bộ sản phẩm
- Seller quản lý sản phẩm của mình
- Admin có thể thêm/sửa/xóa sản phẩm thay seller
- Admin có thể gán seller sở hữu sản phẩm
- Auto init PostgreSQL khi chạy

## Tài khoản mẫu
- Admin: admin@duongmart.vn / admin123
- Seller: seller1@duongmart.vn / seller123
- Buyer: buyer1@duongmart.vn / buyer123

## Biến môi trường
- DATABASE_URL
- SESSION_SECRET

## Chạy local
```bash
npm install
npm start
```

## Route chính
- /
- /login
- /seller/products
- /admin/products
