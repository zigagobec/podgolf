// Usage: node tools/shot.mjs <url> <out.png> [width] [height] [waitMs] [evalJsBeforeWait]
import { chromium } from 'playwright';
const [url, out, w = '1280', h = '720', wait = '2500', js] = process.argv.slice(2);
const browser = await chromium.launch({
  channel: 'chromium-headless-shell',
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan', '--use-angle=vulkan', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(url);
await page.waitForFunction(() => !!window.__podgolf, null, { timeout: 30000 }).catch(() => logs.push('no __podgolf'));
if (js) console.log('eval:', JSON.stringify(await page.evaluate(js)));
await page.waitForTimeout(Number(wait));
await page.screenshot({ path: out });
console.log(logs.length ? logs.slice(0, 30).join('\n') : 'no console errors');
await browser.close();
