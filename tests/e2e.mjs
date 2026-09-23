// End-to-end test: real Chromium against the Firebase Auth + Firestore emulators.
// Run with:  npm run e2e   (the emulators are started by `firebase emulators:exec`)
// The Firebase SDK is served from node_modules instead of gstatic.com so it runs offline.
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

// FAKE=1 runs against the in-memory stand-in (tests/fake-firebase) instead of the emulators.
const FAKE = process.env.FAKE === '1';
const fake = FAKE ? await import('./fake-firebase/server.mjs') : null;

const here = path.dirname(new URL(import.meta.url).pathname);
const PUBLIC = path.resolve(here, '../public');
const SDK_DIR = path.resolve(here, 'node_modules/firebase');
const PORT = 5055;
const BASE = `http://127.0.0.1:${PORT}/`;
const SHOTS = process.env.SHOTS_DIR || path.resolve(here, 'shots');
const results = [];
const step = async (name, fn) => {
  try { await fn(); results.push(['PASS', name]); console.log('PASS', name); }
  catch (e) { results.push(['FAIL', name, e.message]); console.log('FAIL', name, '\n   ', e.message.split('\n').slice(0, 6).join('\n    ')); }
};

// ---------- static server
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer(async (req, res) => {
  if (fake && await fake.handle(req, res)) return;
  if (req.url === '/__fakesdk/core.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(await readFile(path.join(here, 'fake-firebase/core.js'))); }
  let p = decodeURIComponent(new URL(req.url, BASE).pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(PUBLIC, p);
  if (!f.startsWith(PUBLIC) || !existsSync(f)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  res.end(await readFile(f));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

// ---------- clear emulators
const PROJECT = 'kenwood-platform';
if (FAKE) fake.reset();
else {
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined), args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });

async function newPage(email, { width = 1280, height = 800 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
  await context.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, async (route) => {
    const file = route.request().url().match(/(firebase-[a-z-]+\.js)$/)[1];
    const body = FAKE ? `export * from "${BASE}__fakesdk/core.js";` : await readFile(path.join(SDK_DIR, file));
    route.fulfill({ status: 200, contentType: 'text/javascript', body });
  });
  // cdnjs libraries (html2canvas, jsPDF) from node_modules so exports work offline
  await context.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/(html2canvas|jspdf)\//, async (route) => {
    const f = route.request().url().includes('html2canvas') ? 'html2canvas/dist/html2canvas.min.js' : 'jspdf/dist/jspdf.umd.min.js';
    route.fulfill({ status: 200, contentType: 'text/javascript', body: await readFile(path.join(here, 'node_modules', f)) });
  });
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  page.signIn = async (url) => {
    await page.goto(BASE + url);
    await page.waitForFunction(() => window.__kenwoodTestSignIn && document.getElementById('k-signin'));
    await page.evaluate((e) => window.__kenwoodTestSignIn(e), email);
  };
  return page;
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name + '.png') });

// A small backup file in the same format the real export uses.
const sample = {
  format: 'kenwood-orgchart-export', version: 1, config: { orgTitle: 'Kenwood Organization Chart' },
  departments: { exec: { name: 'Executive', color: '#4f6bed' }, grants: { name: 'Grants', color: '#917840' } },
  people: { p1: { name: 'Pat Director', affiliation: '', headshotId: 'h1' }, p2: { name: 'Sam Grants', affiliation: 'Acme', headshotId: null } },
  positions: {
    ed: { id: 'ed', title: 'Executive Director', personId: 'p1', department: 'exec', reportsTo: null, responsibilities: ['Lead'], kpis: [], manual: false, x: 0, y: 0 },
    vg: { id: 'vg', title: 'VP of Grants', personId: 'p2', department: 'grants', reportsTo: 'ed', responsibilities: [], kpis: [], manual: false, x: 0, y: 0 },
    vac: { id: 'vac', title: 'Director of Finance', personId: null, department: 'exec', reportsTo: 'ed', responsibilities: [], kpis: [], manual: false, x: 0, y: 0 },
  },
  headshots: { h1: { dataUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAP8AAP///ywAAAAAAQABAAACAkQBADs=' } },
};
const samplePath = path.join(SHOTS, 'sample-backup.json');
await import('node:fs').then((m) => m.mkdirSync(SHOTS, { recursive: true }));
await writeFile(samplePath, JSON.stringify(process.env.IMPORT_FILE ? JSON.parse(await readFile(process.env.IMPORT_FILE, 'utf8')) : sample));
const expectedPositions = Object.keys(JSON.parse(await readFile(samplePath, 'utf8')).positions).length;

// ================================================================= scenarios
const owner = await newPage('connect@kenwoodusa.org');

await step('signed-out visitor sees the Kenwood sign-in screen', async () => {
  await owner.goto(BASE);
  await owner.waitForSelector('#k-signin');
  await shot(owner, '01-signin');
});

await step('owner signs in; platform seeds tools + divisions; tiles render', async () => {
  await owner.evaluate(() => window.__kenwoodTestSignIn('connect@kenwoodusa.org'));
  await owner.waitForSelector('.tile');
  const names = await owner.$$eval('.tile .name', (els) => els.map((e) => e.textContent));
  assert.deepEqual(names, ['Org Chart', 'Mentee Software', 'Milestones & Projects', 'People & access']);
  await owner.waitForFunction(() => document.querySelectorAll('#divisions .chip').length === 11);
  assert.ok(await owner.$('.k-bar a[href$="admin/"]'), 'admin link in bar');
  await shot(owner, '02-portal-owner');
});

await step('owner opens org chart: empty state offers import', async () => {
  await owner.click('a.tile[href="orgchart/"]');
  await owner.waitForSelector('#emptyState', { state: 'visible' });
  await owner.waitForSelector('#btnImportFirst', { state: 'visible' });
  await shot(owner, '03-orgchart-empty');
});

await step(`owner imports a backup (${expectedPositions} positions)`, async () => {
  await owner.setInputFiles('#importFile', samplePath);
  await owner.click('#confirmYes');
  await owner.waitForFunction((n) => document.querySelectorAll('.node').length === n, expectedPositions, { timeout: 30000 });
  await owner.waitForTimeout(800);
  await shot(owner, '04-orgchart-imported');
});

await step('imported headshots render as data: images', async () => {
  const srcs = await owner.$$eval('.node .avatar img', (els) => els.map((e) => e.src.slice(0, 11)));
  assert.ok(srcs.length > 0 && srcs.every((s) => s === 'data:image/'), JSON.stringify(srcs.slice(0, 3)));
});

await step('editing a position title persists across reload', async () => {
  await owner.click('.node >> nth=0');
  await owner.waitForSelector('#pfTitle');
  await owner.fill('#pfTitle', 'Renamed By Test');
  await owner.waitForTimeout(1200);
  await owner.reload();
  await owner.waitForFunction(() => [...document.querySelectorAll('.node-title')].some((e) => e.textContent === 'Renamed By Test'), null, { timeout: 15000 });
});

await step('adding a position and uploading a headshot works', async () => {
  const before = await owner.$$eval('.node', (n) => n.length);
  await owner.click('#btnAddRoot');
  await owner.waitForFunction((b) => document.querySelectorAll('.node').length === b + 1, before);
  await owner.selectOption('#pfPerson', { index: 1 });
  await owner.waitForSelector('#pfUploadBtn:not([disabled])');
  // 400x300 red PNG generated in the page
  const png = await owner.evaluate(() => { const c = document.createElement('canvas'); c.width = 400; c.height = 300; const x = c.getContext('2d'); x.fillStyle = '#c33'; x.fillRect(0, 0, 400, 300); return c.toDataURL('image/png').split(',')[1]; });
  await owner.setInputFiles('#pfHeadshotFile', { name: 'face.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await owner.waitForFunction(() => { const i = document.querySelector('#pfAvatar img'); return i && i.src.startsWith('data:image/jpeg'); }, null, { timeout: 15000 });
});

await step('PNG export downloads a file', async () => {
  const [dl] = await Promise.all([owner.waitForEvent('download', { timeout: 30000 }), owner.click('#btnExportPng')]);
  assert.match(dl.suggestedFilename(), /\.png$/);
});

await step('backup download produces a valid backup file', async () => {
  await owner.click('#btnData');
  const [dl] = await Promise.all([owner.waitForEvent('download'), owner.click('#backupDownload')]);
  const data = JSON.parse(await readFile(await dl.path(), 'utf8'));
  assert.equal(data.format, 'kenwood-orgchart-export');
  assert.equal(Object.keys(data.positions).length, expectedPositions + 1);
});

await step('owner sets access on the admin page (editor for editor@, none for blocked@)', async () => {
  await owner.goto(BASE + 'admin/');
  await owner.waitForSelector('#newEmail');
  await owner.fill('#newEmail', 'someone@gmail.com');
  await owner.click('#addBtn');
  assert.match(await owner.textContent('#addMsg'), /kenwoodusa\.org/);
  for (const e of ['editor@kenwoodusa.org', 'blocked@kenwoodusa.org']) {
    await owner.fill('#newEmail', e); await owner.click('#addBtn');
    await owner.waitForSelector(`tr[data-email="${e}"]`);
  }
  await owner.selectOption('tr[data-email="editor@kenwoodusa.org"] select[data-role="orgchart"]', 'editor');
  await owner.selectOption('tr[data-email="blocked@kenwoodusa.org"] select[data-role="orgchart"]', 'none');
  await owner.waitForTimeout(800);
  await shot(owner, '05-admin');
});

await step('mentee (default viewer) can see the chart but not edit', async () => {
  const p = await newPage('mentee@kenwoodusa.org');
  await p.signIn('orgchart/');
  await p.waitForFunction(() => document.querySelectorAll('.node').length > 0, null, { timeout: 15000 });
  assert.equal(await p.textContent('.k-role'), 'Viewer');
  assert.equal(await p.isDisabled('#btnAddRoot'), true);
  assert.equal(await p.isVisible('#roleBadge'), true);
  const denied = await p.evaluate(async () => {
    const { db, fs } = await import('../assets/platform.js');
    try { await fs.setDoc(fs.doc(db, 'orgchart/main/positions/hack'), { title: 'x' }); return 'written'; } catch (e) { return e.code; }
  });
  assert.equal(denied, 'permission-denied');
  await shot(p, '06-orgchart-viewer');
  await p.context().close();
});

await step('editor can add positions but gets no admin link', async () => {
  const p = await newPage('editor@kenwoodusa.org');
  await p.signIn('orgchart/');
  await p.waitForFunction(() => document.querySelectorAll('.node').length > 0, null, { timeout: 15000 });
  assert.equal(await p.textContent('.k-role'), 'Editor');
  const before = await p.$$eval('.node', (n) => n.length);
  await p.click('#btnAddRoot');
  await p.waitForFunction((b) => document.querySelectorAll('.node').length === b + 1, before);
  assert.equal(await p.$('.k-bar a[href$="admin/"]'), null);
  await p.click('#btnData');
  assert.equal(await p.$('#backupImport'), null, 'editors should not see import');
  await p.context().close();
});

await step('person set to "No access" is stopped at the door', async () => {
  const p = await newPage('blocked@kenwoodusa.org');
  await p.signIn('orgchart/');
  await p.waitForSelector('text=No access yet');
  await p.goto(BASE);
  await p.waitForSelector('.tile');
  assert.match(await p.textContent('.tile.muted >> nth=0'), /No access/);
  await p.context().close();
});

await step('non-Kenwood Google account is rejected and signed out', async () => {
  const p = await newPage('someone@gmail.com');
  await p.signIn('');
  await p.waitForSelector('#k-err:has-text("isn\'t a Kenwood account")');
  await shot(p, '07-rejected');
  await p.context().close();
});

await step('non-admin cannot open the admin page', async () => {
  const p = await newPage('editor@kenwoodusa.org');
  await p.signIn('admin/');
  await p.waitForSelector('text=Admins only');
  await p.context().close();
});

await step('turning someone off locks them out', async () => {
  await owner.goto(BASE + 'admin/');
  await owner.waitForSelector('tr[data-email="editor@kenwoodusa.org"]');
  await owner.check('tr[data-email="editor@kenwoodusa.org"] input[data-disabled]');
  await owner.waitForTimeout(800);
  const p = await newPage('editor@kenwoodusa.org');
  await p.signIn('orgchart/');
  await p.waitForSelector('text=Access turned off');
  await p.context().close();
});

await step('portal and org chart work on a phone-sized screen', async () => {
  const p = await newPage('mentee@kenwoodusa.org', { width: 390, height: 844 });
  await p.signIn('');
  await p.waitForSelector('.tile');
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, 'horizontal overflow ' + overflow);
  await shot(p, '08-portal-phone');
  await p.context().close();
});

await step('no uncaught page errors for the owner session', async () => {
  const real = owner.errors.filter((e) => !/favicon|Failed to load resource/.test(e));
  assert.deepEqual(real, []);
});

await browser.close();
server.close();
const failed = results.filter((r) => r[0] === 'FAIL');
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
