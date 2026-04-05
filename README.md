FIXED V3.1

# DUONG MART PRO V3 - Affiliate nhiều tầng + Ví seller + Rút tiền

## Tính năng mới V3
- Affiliate nhiều tầng: F1 + F2
- Ví seller (`wallet_transactions`)
- Yêu cầu rút tiền (`withdrawal_requests`)
- Admin duyệt / từ chối rút tiền
- Gán parent seller trong `/admin/sellers`
- Cài đặt F1, F2, phí sàn và mức rút tối thiểu tại `/admin/affiliate`

## Tài khoản test
- Admin: `admin@duongmart.vn` / `admin123`
- Seller 1: `seller1@duongmart.vn` / `seller123`
- Seller 2: `seller2@duongmart.vn` / `seller123` (mặc định thuộc team của Seller 1)
- Buyer: `buyer1@duongmart.vn` / `buyer123`

## ENV
- `DATABASE_URL`
- `SESSION_SECRET`
- `PUBLIC_BASE_URL` = URL website của bạn

## Test nhanh
1. Login Seller 1 -> copy link ref.
2. Mở tab ẩn danh với link `/?ref=seller1` -> đăng ký Seller 2 hoặc buyer.
3. Tạo đơn hàng.
4. Quay lại Seller Dashboard xem ví, F1/F2 và yêu cầu rút tiền.
5. Admin vào `/admin/withdrawals` để duyệt.


V4 ready-deploy package generated on 2026-04-05.


Note: V3.1 keeps automatic DB init in server.js. Use Clear build cache & deploy after upload.
