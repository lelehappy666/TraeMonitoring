import { chromium } from 'playwright';

const url = process.env.URL || 'http://localhost:5180/';
const out = process.env.OUT || 'assets/screenshot.png';
const width = Number(process.env.WIDTH || 1280);
const height = Number(process.env.HEIGHT || 800);

const run = async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: out, fullPage: true });
  await browser.close();
};

run().catch(() => process.exit(1));
