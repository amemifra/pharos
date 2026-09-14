// Render app/icon.svg -> app/icon.png (512) and app/apple-icon.png (180, opaque square).
// Also produce review screenshots on dark/light tab backgrounds into docs/review/ (local-only).
// Run with NODE_PATH pointing at the canonical checkout's node_modules.
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const svg = readFileSync(path.join(root, 'app/icon.svg'), 'utf8');
const b64 = Buffer.from(svg).toString('base64');
const img = `data:image/svg+xml;base64,${b64}`;

const html = (size, bg, radius) => `<!doctype html><style>
html,body{margin:0;padding:0;background:${bg};width:${size}px;height:${size}px}
.wrap{width:${size}px;height:${size}px;border-radius:${radius}px;overflow:hidden}
img{width:${size}px;height:${size}px;display:block}
</style><div class="wrap"><img src="${img}"></div>`;

const browser = await chromium.launch();
const page = await browser.newPage();

async function shot(size, bg, radius, out) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(html(size, bg, radius));
  await page.screenshot({ path: out });
  console.log('wrote', out);
}

mkdirSync(path.join(root, 'docs/review'), { recursive: true });
await shot(512, 'transparent', 0, path.join(root, 'app/icon.png'));
await shot(180, 'transparent', 0, path.join(root, 'app/apple-icon.png'));
await shot(64, '#1e1e1e', 0, path.join(root, 'docs/review/favicon-dark-tab.png'));
await shot(64, '#ffffff', 0, path.join(root, 'docs/review/favicon-light-tab.png'));
await browser.close();
console.log('exit=0;command=node scripts/render-icons.mjs;status=pass');
