const express = require('express');
const router = express.Router();

function ensureAdmin(req, res, next) {
  if (!req.session || !req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') return res.status(403).send('Forbidden');
  next();
}

async function ensureTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_marketing (
      id SERIAL PRIMARY KEY,
      top_banner TEXT NOT NULL DEFAULT '',
      hero_badge TEXT NOT NULL DEFAULT '',
      hero_title TEXT NOT NULL DEFAULT '',
      hero_description TEXT NOT NULL DEFAULT '',
      cta_primary_text TEXT NOT NULL DEFAULT '',
      cta_primary_url TEXT NOT NULL DEFAULT '',
      cta_secondary_text TEXT NOT NULL DEFAULT '',
      cta_secondary_url TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  const existing = await pool.query(`SELECT id FROM site_marketing ORDER BY id ASC LIMIT 1`);
  if (existing.rows.length === 0) {
    await pool.query(`
      INSERT INTO site_marketing
      (top_banner, hero_badge, hero_title, hero_description, cta_primary_text, cta_primary_url, cta_secondary_text, cta_secondary_url)
      VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8)
    `, [
      'Miễn phí vận chuyển đơn từ 299.000đ | Flash sale mỗi ngày | Seller đối soát minh bạch',
      'BẢN ỔN ĐỊNH AUTO DB',
      'TUYỂN CỘNG TÁC VIÊN BÁN HÀNG',
      'Đăng ký seller để tự đăng sản phẩm, có link affiliate F1 và hệ thống quản lý đơn cơ bản.',
      'Đăng ký seller',
      '/register?role=seller',
      'Đăng nhập',
      '/login'
    ]);
  }
}

router.get('/', ensureAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    await ensureTable(pool);
    const result = await pool.query(`SELECT * FROM site_marketing ORDER BY id ASC LIMIT 1`);
    res.render('admin-marketing', {
      pageTitle: 'Marketing',
      user: req.session.user,
      marketing: result.rows[0],
      success: req.query.success || ''
    });
  } catch (err) {
    console.error('Marketing GET error:', err);
    res.status(500).send('Internal Server Error');
  }
});

router.post('/', ensureAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  const {
    top_banner = '',
    hero_badge = '',
    hero_title = '',
    hero_description = '',
    cta_primary_text = '',
    cta_primary_url = '',
    cta_secondary_text = '',
    cta_secondary_url = ''
  } = req.body;

  try {
    await ensureTable(pool);
    const existing = await pool.query(`SELECT id FROM site_marketing ORDER BY id ASC LIMIT 1`);
    if (existing.rows.length === 0) {
      await pool.query(`
        INSERT INTO site_marketing
        (top_banner, hero_badge, hero_title, hero_description, cta_primary_text, cta_primary_url, cta_secondary_text, cta_secondary_url)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      `, [top_banner, hero_badge, hero_title, hero_description, cta_primary_text, cta_primary_url, cta_secondary_text, cta_secondary_url]);
    } else {
      await pool.query(`
        UPDATE site_marketing
        SET top_banner=$1,
            hero_badge=$2,
            hero_title=$3,
            hero_description=$4,
            cta_primary_text=$5,
            cta_primary_url=$6,
            cta_secondary_text=$7,
            cta_secondary_url=$8,
            updated_at=NOW()
        WHERE id=$9
      `, [top_banner, hero_badge, hero_title, hero_description, cta_primary_text, cta_primary_url, cta_secondary_text, cta_secondary_url, existing.rows[0].id]);
    }
    res.redirect('/admin/marketing?success=1');
  } catch (err) {
    console.error('Marketing POST error:', err);
    res.status(500).send('Internal Server Error');
  }
});

module.exports = { router, ensureMarketingTable: ensureTable };
