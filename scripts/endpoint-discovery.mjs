// Discover auth endpoints from SPA JS bundles (no SMS, no OTP consumed).
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BASE = "https://www.bachhoaxanh.com";
const profileDir = "/tmp/bhx-endpoint-discovery";
const browser = await chromium.launch({
  headless: true,
  executablePath: "/home/openclaw/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome",
});
const ctx = await browser.newContext();
const page = await ctx.newPage();

// Capture all URLs seen in requests (network).
const urls = [];
page.on("request", (r) => urls.push(r.url()));

await page.goto(BASE + "/dang-nhap", { waitUntil: "networkidle", timeout: 45000 });

// Collect loaded script srcs.
const scripts = await page.evaluate(() =>
  Array.from(document.querySelectorAll("script[src]")).map((s) => s.src)
);
// Fetch each bundle text in-page and grep for api path fragments.
const found = new Set();
for (const src of scripts) {
  try {
    const text = await page.evaluate(async (u) => {
      const r = await fetch(u);
      return await r.text();
    }, src);
    const hits = text.match(/\/[a-zA-Z0-9_\-\/]*(?:aio|verify|otp|session|login)[a-zA-Z0-9_\-\/]*/gi) || [];
    for (const h of hits) found.add(h.toLowerCase());
  } catch (e) {
    found.add("ERR " + src + " " + String(e).slice(0, 40));
  }
}

writeFileSync("/tmp/bhx-endpoint-discovery.txt", JSON.stringify({
  scripts_count: scripts.length,
  unique_paths: Array.from(found).sort(),
  aio_paths: Array.from(found).filter((s) => s.includes("aio")).sort(),
}, null, 2));
console.log("done");
await browser.close();
