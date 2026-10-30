// Approved cleanup: clear the single leftover cart line with the cart page's own controls
// ("Xóa hết sản phẩm" -> modal "Xóa"). Never touches checkout ("Đặt hàng").
// Verification happens separately over MCP stdio (scripts/mcp-read-check.py) because the
// persistent profile directory cannot be locked by two Chromium sessions at once.
import { chromium } from 'playwright';
import { profileDirectory } from '../src/profile.mjs';

const SITE = 'https://www.bachhoaxanh.com';
const ctx = await chromium.launchPersistentContext(profileDirectory(), { headless: true, serviceWorkers: 'block', offline: true, timeout: 30000, executablePath: process.env.BHX_CHROMIUM_PATH });
const page = ctx.pages()[0] ?? await ctx.newPage();
await ctx.setOffline(false);
await page.goto(SITE + '/gio-hang', { waitUntil: 'domcontentloaded', timeout: 40000 });
await page.waitForTimeout(9000);
await page.locator('button', { hasText: 'Xóa hết sản phẩm' }).first().click();
await page.waitForTimeout(3000);
await page.locator('button', { hasText: /^Xóa$/ }).first().click();
await page.waitForTimeout(5000);
const stillThere = await page.$$eval('button', els => els.filter(e => /Xóa hết sản phẩm/i.test((e.innerText || ''))).length);
console.log('clear_control_after=' + stillThere);
await ctx.close();
