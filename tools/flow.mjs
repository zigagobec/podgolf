// Menu flow with real key presses, then a bot match. Usage: node tools/flow.mjs <url> <prefix>
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
await page.evaluate(() => window.__podgolf.fixedDt(1 / 30));
const phase = () => page.evaluate(() => window.__podgolf.app.phase);
await page.keyboard.press('Space');
await page.waitForTimeout(300);
await page.screenshot({ path: `${prefix}-ready1.png` });
console.log('after space:', await phase());
await page.keyboard.press('KeyB');
await page.waitForTimeout(500);
console.log('after B (bot):', await phase());
const time = () => page.evaluate(() => window.__podgolf.app.world.time);
const waitGame = async (sec) => { const t0 = await time(); while ((await time()) - t0 < sec) await page.waitForTimeout(40); };
await waitGame(12);
const s = await page.evaluate(() => { const w = window.__podgolf.app.world; return { phase: window.__podgolf.app.phase, strokes: w.rats.map((r) => r.strokes), balls: w.balls.map((b) => b.pos.map((x) => +x.toFixed(1))) }; });
console.log('bot match:', JSON.stringify(s));
await page.screenshot({ path: `${prefix}-bot.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.screenshot({ path: `${prefix}-pause.png` });
console.log(logs.length ? logs.join('\n') : 'no console errors');
await browser.close();
