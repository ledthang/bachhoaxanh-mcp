// OBSERVE the OTP screen after Tiếp tục: dump innerText + visible inputs + api traffic.
// Sends 1 SMS to BHX_PHONE. Confirms the OTP selector + which verify endpoint the SPA hits.
import { chromium } from 'playwright';

const PHONE = process.env.BHX_PHONE || '0969745020';
const DIR = '/tmp/bhx-obs';

(async () => {
  const ctx = await chromium.launchPersistentContext(DIR, {
    executablePath: process.env.BHX_CHROMIUM_PATH,
    headless: true,
    args: ['--disable-dev-shm-usage', '--ignore-certificate-errors'],
    viewport: { width: 430, height: 900 },
  });
  const p = ctx.pages()[0] || await ctx.newPage();
  p.on('response', async (r) => {
    const u = r.url();
    if (/api|aio|otp|verify|session|identity|auth/i.test(u) && !/\.(png|jpg|css|woff2?|ico|svg)(\?|$)/i.test(u)) {
      let b = '';
      try { b = (await r.text()).replace(/\s+/g, ' ').slice(0, 160); } catch {}
      console.log('NET', r.status(), u.slice(0, 130), '||', b);
    }
  });
  await p.goto('https://www.bachhoaxanh.com/dang-nhap', { waitUntil: 'networkidle', timeout: 60000 });
  console.log('--- after open ---');
  console.log('TEXT:', (await p.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))).slice(0, 500));
  const phone = p.locator('input[name=phone], input[aria-label="Số điện thoại"]').first();
  await phone.fill(PHONE);
  await p.locator('button:has-text("TIẾP TỤC"), button:has-text("Tiếp tục")').first().click();
  for (let i = 0; i < 12; i++) {
    await p.waitForTimeout(4000);
    const t = await p.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
    const ins = await p.evaluate(() => [...document.querySelectorAll('input')].filter(x => x.getClientRects().length).map(x => ({ aria: x.getAttribute('aria-label'), ph: x.placeholder, name: x.name, type: x.type })));
    if (i === 11 || /mã|otp|gửi lại|xác nhận/i.test(t)) {
      console.log('--- after click (t=' + (i + 1) * 4 + 's) ---');
      console.log('TEXT:', t.slice(0, 700));
      console.log('INPUTS:', JSON.stringify(ins));
      if (/mã|otp|gửi lại/i.test(t)) break;
    }
  }
  await ctx.close();
})();
