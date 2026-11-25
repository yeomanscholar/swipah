// End-to-end tests in a real (headless) Chromium: demo mode UI flows, the
// real-folder adapter on the browser's private storage (OPFS), and test.html.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from './pw.js';
import { startServer } from './server.js';

let server, browser, base;

before(async () => {
  server = await startServer(0);
  base = `http://localhost:${server.address().port}`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.close();
});

async function page(viewport = { width: 390, height: 800 }) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  return p;
}

/** Open the demo, apply setup tweaks, start sorting. */
async function startDemo(p, { mode = 'single', rename = false, other = false } = {}) {
  await p.goto(`${base}/?nosw`);
  await p.click('#demo');
  await p.waitForSelector('#screen-setup:not([hidden])');
  await p.check(`input[name="mode"][value="${mode}"]`, { force: true });
  if (rename) await p.check('#opt-rename', { force: true });
  if (other) await p.check('#opt-types input[value="other"]', { force: true });
  await p.click('#start');
  await p.waitForSelector('#screen-sort:not([hidden]) .card');
}

const files = (p) => p.evaluate(() => [...window.swipah.state.adapter.files.keys()].sort());
const progress = (p) => p.textContent('#progress-text');
const waitIdle = (p) => p.waitForFunction(() => !window.swipah.state.busy && window.swipah.state.card);

async function drag(p, dx, dy) {
  const box = await p.locator('.card').boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await p.mouse.move(x, y);
  await p.mouse.down();
  await p.mouse.move(x + dx / 2, y + dy / 2, { steps: 6 });
  await p.mouse.move(x + dx, y + dy, { steps: 6 });
  await p.mouse.up();
}

test('demo: drag + keyboard sorting, undo, recap', async () => {
  const p = await page();
  await startDemo(p);
  assert.equal(await progress(p), '1 / 15');

  await drag(p, 220, 0); // right → funny
  await waitIdle(p);
  assert.equal(await progress(p), '2 / 15');

  await drag(p, 30, 0); // too short → snaps back
  await p.waitForTimeout(300);
  assert.equal(await progress(p), '2 / 15');

  await p.keyboard.press('ArrowUp'); // reaction
  await waitIdle(p);
  await p.keyboard.press('ArrowLeft'); // trash
  await waitIdle(p);
  await p.keyboard.press(' '); // skip
  await waitIdle(p);
  assert.equal(await progress(p), '5 / 15');

  const f = await files(p);
  assert.ok(f.includes('funny/IMG_20260301_101522.png'), f.join());
  assert.ok(f.includes('reaction/IMG_20260304_090112.png'), f.join());
  assert.ok(f.includes('_trash/IMG_20260307_174409.png'), f.join());

  await p.keyboard.press('z'); // undo the skip
  await waitIdle(p);
  await p.keyboard.press('z'); // undo the trash
  await waitIdle(p);
  assert.equal(await progress(p), '3 / 15');
  assert.ok((await files(p)).includes('IMG_20260307_174409.png'));

  await p.click('#finish');
  await p.waitForSelector('#screen-recap:not([hidden])');
  const stats = await p.locator('.stat').allInnerTexts();
  assert.match(stats[0], /^2\s+sorted/);
  assert.equal(await p.locator('.reel').count(), 2);
  assert.equal(await p.locator('.reel .thumb').count(), 2);
  assert.equal(await p.isVisible('#keep-going'), true);

  // Log file written into the (demo) folder.
  await p.waitForFunction(() => window.swipah.state.adapter.files.has('.swipah/log.jsonl'));
  const log = await p.evaluate(async () => (await window.swipah.state.adapter.getFile('.swipah/log.jsonl')).text());
  const records = log.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(records[0].type, 'session_start');
  assert.deepEqual(records.filter((r) => r.type === 'action').map((r) => r.action), ['tag', 'tag', 'tag', 'skip', 'undo', 'undo']);
  assert.equal(records[1].file.fingerprint.startsWith('sha256:'), true);
  assert.deepEqual(p.errors, []);
});

test('demo: multi-tag mode with Done and double-tap', async () => {
  const p = await page();
  await startDemo(p, { mode: 'multi' });
  assert.equal(await p.isVisible('#done'), true);

  await p.keyboard.press('ArrowRight');
  await p.keyboard.press('ArrowUp');
  await p.keyboard.press('ArrowDown');
  await p.keyboard.press('ArrowDown'); // toggles wholesome back off
  assert.deepEqual(await p.locator('.tagchip').allInnerTexts(), ['funny', 'reaction']);
  assert.equal(await progress(p), '1 / 15'); // card stays put
  await p.click('#done');
  await waitIdle(p);

  let f = await files(p);
  assert.ok(f.includes('funny/IMG_20260301_101522.png'));
  assert.ok(f.includes('reaction/IMG_20260301_101522.png'));

  await drag(p, 0, -200); // swipe up toggles reaction on card 2
  await p.waitForTimeout(250);
  assert.deepEqual(await p.locator('.tagchip').allInnerTexts(), ['reaction']);
  await p.locator('.card').dblclick({ position: { x: 100, y: 100 } });
  await waitIdle(p);
  f = await files(p);
  assert.ok(f.includes('reaction/IMG_20260304_090112.png'), f.join());
  assert.equal(await progress(p), '3 / 15');
  assert.deepEqual(p.errors, []);
});

test('demo: rename box, collision and name history', async () => {
  const p = await page();
  await startDemo(p, { rename: true });
  assert.equal(await p.textContent('#rename-ext'), '.png');

  await p.keyboard.press('r'); // focuses rename box
  await p.keyboard.type('not like us');
  await p.keyboard.press('ArrowRight'); // ignored while typing
  assert.equal(await progress(p), '1 / 15');
  await p.keyboard.press('Enter'); // leaves the box
  await p.keyboard.press('ArrowRight');
  await waitIdle(p);

  await p.fill('#rename', 'not-like-us');
  await p.click('#controls [data-dir="right"]');
  await waitIdle(p);

  const f = await files(p);
  assert.ok(f.includes('funny/not-like-us.png'), f.join());
  assert.ok(f.includes('funny/not-like-us-1.png'), f.join());
  assert.equal(await p.inputValue('#rename'), '');
  assert.equal(await p.locator('#name-history option').first().getAttribute('value'), 'not-like-us');
  assert.deepEqual(p.errors, []);
});

test('demo: audio + other cards render', async () => {
  const p = await page();
  await startDemo(p, { other: true });
  const kinds = [];
  for (let i = 0; i < 16; i++) {
    await waitIdle(p);
    const kind = await p.getAttribute('.card', 'data-kind');
    kinds.push(kind);
    if (kind === 'audio') assert.equal(await p.isVisible('.audio-card .round-btn'), true);
    if (kind === 'other') assert.equal(await p.isVisible('.placeholder:has-text("notes.txt")'), true);
    await p.keyboard.press(' ');
  }
  assert.deepEqual([...new Set(kinds)].sort(), ['audio', 'image', 'other']);
  await p.waitForSelector('#screen-recap:not([hidden])');
  assert.equal(await p.isVisible('#review-skipped'), true);
  await p.click('#review-skipped');
  await p.waitForSelector('#screen-sort:not([hidden]) .card');
  assert.equal(await progress(p), '17 / 32');
  assert.deepEqual(p.errors, []);
});

test('demo: milestone toast at 10 swipes and export bundle', async () => {
  const p = await page();
  await startDemo(p);
  const keys = ['ArrowRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft'];
  for (let i = 0; i < 10; i++) {
    await p.keyboard.press(keys[i % 4]);
    await waitIdle(p);
  }
  await p.waitForSelector('.toast:has-text("Wicked good staht")');
  await p.click('#finish');
  await p.waitForSelector('#screen-recap:not([hidden])');

  const [download] = await Promise.all([p.waitForEvent('download'), p.click('#export')]);
  assert.match(download.suggestedFilename(), /^swipah-export-\d{8}-\d{4}\.zip$/);
  const buf = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c));
  const names = [...buf.toString('latin1').matchAll(/swipah-export-[\d-]+\/([\w.-]+)/g)].map((m) => m[1]);
  for (const n of ['contact-sheet-01.jpg', 'index.json', 'log.jsonl', 'PROMPT.md']) assert.ok(names.includes(n), `${n} missing from ${names}`);
  await p.waitForSelector('#export-status:has-text("Downloaded")');
  assert.deepEqual(p.errors, []);
});

test('real-folder adapter works on browser storage (OPFS), incl. session + undo', async () => {
  const p = await page();
  await p.goto(`${base}/test.html?nosw`);
  const result = await p.evaluate(async () => {
    const { FsAccessAdapter } = await import('./js/adapters/fs-access.js');
    const { Session } = await import('./js/session.js');
    const { DEFAULT_SETTINGS } = await import('./js/config.js');
    const root = await navigator.storage.getDirectory();
    for await (const [name] of root.entries()) await root.removeEntry(name, { recursive: true });
    const fs = new FsAccessAdapter(root);
    await fs.writeFile('a.png', new Blob(['aaa']));
    await fs.writeFile('b.mp3', new Blob(['bbb']));
    await fs.writeFile('funny/a.png', new Blob(['old']));
    const s = await Session.create(fs, {
      directions: { left: '_trash', right: 'funny', up: 'reaction', down: '' },
      settings: DEFAULT_SETTINGS,
    });
    const listed = s.items.map((i) => i.path);
    const e1 = await s.tag(['funny', 'reaction'], { renameTo: 'tv off' });
    await s.tag(['_trash']);
    const list = async () => (await fs.listItems({ recursive: true })).map((i) => i.path).sort();
    const afterTag = await list();
    await fs.appendText('.swipah/log.jsonl', 'x\n');
    await fs.appendText('.swipah/log.jsonl', 'y\n');
    const logText = await (await fs.getFile('.swipah/log.jsonl')).text();
    await s.undo();
    await s.undo();
    const afterUndo = await list();
    return { listed, e1, afterTag, afterUndo, logText, oldKept: await (await fs.getFile('funny/a.png')).text() };
  });
  assert.deepEqual(result.listed, ['a.png', 'b.mp3']);
  // Moved into the first tag, copied into the second (same order as tags).
  assert.deepEqual(result.e1.finalPaths, ['funny/tv-off.png', 'reaction/tv-off.png']);
  assert.deepEqual(result.afterTag, ['_trash/b.mp3', 'funny/a.png', 'funny/tv-off.png', 'reaction/tv-off.png']);
  assert.deepEqual(result.afterUndo, ['a.png', 'b.mp3', 'funny/a.png']);
  assert.equal(result.logText, 'x\ny\n');
  assert.equal(result.oldKept, 'old');
  assert.deepEqual(p.errors, []);
});

test('test.html phone check passes on private storage', async () => {
  const p = await page();
  await p.goto(`${base}/test.html?nosw`);
  await p.click('#run-opfs');
  await p.waitForSelector('#verdict:not([hidden])');
  assert.match(await p.textContent('#verdict'), /Swipah can sort this folder/);
  assert.equal(await p.locator('#results li:has-text("❌")').count(), 0);
});

test('desktop layout renders without errors', async () => {
  const p = await page({ width: 1280, height: 800 });
  await startDemo(p);
  assert.equal(await p.isVisible('#controls'), true);
  assert.deepEqual(p.errors, []);
});

test('real folder flow: pick, sort, reload, resume, export into folder', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  // Headless Chrome can't show a folder picker, so hand it a folder in OPFS.
  await ctx.addInitScript(() => {
    window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('Memes', { create: true });
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${base}/?nosw`);
  await p.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry('Memes', { recursive: true }).catch(() => {});
    const dir = await root.getDirectoryHandle('Memes', { create: true });
    const { FsAccessAdapter } = await import('./js/adapters/fs-access.js');
    const fs = new FsAccessAdapter(dir);
    // Tiny valid PNG so the card and contact sheet can render it.
    const png = await new Promise((ok) => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      c.getContext('2d').fillRect(0, 0, 32, 32);
      c.toBlob(ok, 'image/png');
    });
    for (const n of ['a.png', 'b.png', 'c.png', 'd.png']) await fs.writeFile(n, png);
  });

  await p.click('#pick');
  await p.waitForSelector('#screen-setup:not([hidden])');
  assert.match(await p.textContent('#setup-folder'), /Memes/);
  await p.click('#start');
  await p.waitForSelector('#screen-sort .card');
  await p.keyboard.press('ArrowRight');
  await waitIdle(p);
  await p.keyboard.press('ArrowLeft');
  await waitIdle(p);
  await p.waitForTimeout(800); // let the session + log save (they write within ~250 ms)

  await p.reload();
  await p.waitForSelector('#resume:not([hidden])');
  assert.match(await p.textContent('#resume-detail'), /2 of 4 done/);
  await p.click('#resume-go');
  await p.waitForSelector('#screen-sort:not([hidden]) .card');
  assert.equal(await progress(p), '3 / 4');
  await p.keyboard.press('ArrowUp');
  await waitIdle(p);
  await p.keyboard.press('z'); // undo works after a resume too
  await waitIdle(p);
  await p.keyboard.press('ArrowDown');
  await waitIdle(p);
  await p.keyboard.press('ArrowUp');
  await p.waitForSelector('#screen-recap:not([hidden])');

  await p.click('#export');
  await p.waitForSelector('#export-status:has-text("Saved")');

  const tree = await p.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Memes');
    const out = [];
    const walk = async (d, pre) => {
      for await (const [n, h] of d.entries()) h.kind === 'directory' ? await walk(h, `${pre}${n}/`) : out.push(pre + n);
    };
    await walk(dir, '');
    const log = await (await (await dir.getDirectoryHandle('.swipah')).getFileHandle('log.jsonl')).getFile();
    return { files: out.sort(), log: await log.text() };
  });
  const sorted = tree.files.filter((f) => !f.startsWith('.swipah/'));
  assert.deepEqual(sorted, ['_trash/b.png', 'funny/a.png', 'reaction/d.png', 'wholesome/c.png']);
  assert.ok(tree.files.some((f) => /^\.swipah\/export-\d{8}-\d{4}\/contact-sheet-01\.jpg$/.test(f)), tree.files.join());
  assert.ok(tree.files.some((f) => /^\.swipah\/export-[\d-]+\/PROMPT\.md$/.test(f)));
  const actions = tree.log.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(actions.filter((r) => r.type === 'session_start').length, 2); // original + resumed
  assert.deepEqual(actions.filter((r) => r.type === 'action').map((r) => `${r.action}:${r.tags.join('+')}`), [
    'tag:funny', 'tag:_trash', 'tag:reaction', 'undo:reaction', 'tag:wholesome', 'tag:reaction',
  ]);
  assert.deepEqual(errors, []);
  await ctx.close();
});
