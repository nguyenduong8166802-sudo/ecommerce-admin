# Marketplace PRO V1 (PostgreSQL)

Bản này dùng PostgreSQL thật, có:
- đăng ký / đăng nhập buyer, seller, admin
- admin chỉnh % hoa hồng theo seller
- seller thêm / sửa / xóa sản phẩm
- marketing message đầu trang
- flash sale
- giỏ hàng + tạo đơn hàng
- dữ liệu lưu trong PostgreSQL

## 1) Cài local
```bash
npm install
cp .env.example .env
npm start
```

Mở:
```bash
http://localhost:10000
```

## 2) Deploy Render
- Build Command: `npm install`
- Start Command: `npm start`

Environment Variables:
- `DATABASE_URL`
- `SESSION_SECRET`
- `PORT=10000`

## 3) Tài khoản mặc định
Khi app chạy lần đầu, nó sẽ tự tạo:
- Admin: `admin@duongmart.vn` / `admin123`
- Seller: `seller1@duongmart.vn` / `seller123`
- Buyer: `buyer1@duongmart.vn` / `buyer123`

## 4) Các trang chính
- `/` trang chủ
- `/products` danh sách sản phẩm
- `/login`
- `/register`
- `/cart`
- `/checkout`
- `/admin`
- `/admin/sellers`
- `/admin/marketing`
- `/admin/flash-sales`
- `/seller`
- `/seller/products/new`

## 5) Lưu ý
- Bản này dùng `image_url` để nhập link ảnh trực tiếp.
- Flash sale sẽ áp dụng lên sản phẩm được chọn.
- Session đang lưu trong PostgreSQL, phù hợp hơn MemoryStore.
