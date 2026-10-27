// Scripted playtest: start a match, drive P1 with a few charge/release shots, screenshot along the way.
// Usage: node tools/play.mjs <url> <outPrefix> [w] [h]
import { chromium } from 'playwright';
const [url, prefix, w = '1280', h = '720'] = process.argv.slice(2);
const browser = await chromium.launch({
  channel: 'chromium-headless-shell',
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan', '--use-angle=vulkan', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(url);
await page.waitForFunction(() => !!window.__podgolf);
// Advance game time in fixed steps per rendered frame so slow software rendering doesn't matter.
await page.evaluate(() => { window.__podgolf.fixedDt(1 / 30); window.__podgolf.start(); });
const time = () => page.evaluate(() => window.__podgolf.app.world.time);
const waitGame = async (sec) => { const t0 = await time(); while ((await time()) - t0 < sec) await page.waitForTimeout(50); };
const state = () => page.evaluate(() => {
  const w = window.__podgolf.app.world;
  const r = (v) => v.map((x) => +x.toFixed(2));
  return { phase: window.__podgolf.app.phase, t: +w.time.toFixed(2), balls: w.balls.map((b) => ({ pos: r(b.pos), sunk: b.sunk })), rats: w.rats.map((x) => ({ pos: r(x.pos), strokes: x.strokes, charge: +x.charge.toFixed(2) })) };
});
await waitGame(3.4);
console.log('after intro', JSON.stringify(await state()));
await page.screenshot({ path: `${prefix}-1-start.png` });
// P1 walks up and charges.
await page.evaluate(() => window.__podgolf.setInput(0, { throttle: 0.4, steer: 0, action: false }));
await waitGame(0.35);
await page.evaluate(() => window.__podgolf.setInput(0, { throttle: 0, steer: 0, action: true }));
await waitGame(0.75);
await page.screenshot({ path: `${prefix}-2-charge.png` });
console.log('charging', JSON.stringify(await state()));
await page.evaluate(() => window.__podgolf.setInput(0, { throttle: 0, steer: 0, action: false }));
await waitGame(0.25);
await page.screenshot({ path: `${prefix}-3-hit.png` });
await waitGame(1.2);
await page.screenshot({ path: `${prefix}-4-roll.png` });
console.log('after shot', JSON.stringify(await state()));
console.log(logs.length ? logs.slice(0, 20).join('\n') : 'no console errors');
await browser.close();
