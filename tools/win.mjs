// Screenshot the intro swoop and the win sequence. Usage: node tools/win.mjs <url> <prefix>
import { chromium } from 'playwright';
const [url, prefix] = process.argv.slice(2);
const browser = await chromium.launch({
  channel: 'chromium-headless-shell',
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan', '--use-angle=vulkan', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(url);
await page.waitForFunction(() => !!window.__podgolf);
await page.evaluate(() => { window.__podgolf.fixedDt(1 / 30); window.__podgolf.start(); });
const time = () => page.evaluate(() => window.__podgolf.app.world.time);
const waitGame = async (sec) => { const t0 = await time(); while ((await time()) - t0 < sec) await page.waitForTimeout(40); };
await waitGame(0.9);
await page.screenshot({ path: `${prefix}-intro.png` });
await waitGame(2.8);
await page.evaluate(() => {
  const w = window.__podgolf.app.world;
  const h = w.course.hole;
  w.balls[0].pos = [h.x - 2.6, 0.25, h.z];
  w.balls[0].vel = [3.4, 0, 0];
  w.rats[0].pos = [h.x - 4.5, 0.36, h.z - 0.5];
  w.rats[0].yaw = Math.PI / 2;
});
await waitGame(0.9);
await page.screenshot({ path: `${prefix}-sinking.png` });
await waitGame(1.2);
await page.screenshot({ path: `${prefix}-won.png` });
await waitGame(1.8);
await page.screenshot({ path: `${prefix}-won2.png` });
console.log(await page.evaluate(() => window.__podgolf.app.phase), logs.length ? logs.join('\n') : 'no console errors');
await browser.close();
