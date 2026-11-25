// Phone check (test.html): runs each file operation Swipah needs against a
// real folder and reports ✅/❌, so we know what works on this device.

import { FsAccessAdapter } from './adapters/fs-access.js';
import { APP_VERSION } from './config.js';

const $ = (s) => document.querySelector(s);
const resultsEl = $('#results');
const verdictEl = $('#verdict');
const log = [];

function report(ok, title, detail = '') {
  const icon = ok === true ? '✅' : ok === false ? '❌' : 'ℹ️';
  log.push(`${icon} ${title}${detail ? ` | ${detail}` : ''}`);
  const li = document.createElement('li');
  li.innerHTML = `<span>${icon}</span><span></span>`;
  li.children[1].textContent = title;
  if (detail) {
    const d = document.createElement('div');
    d.className = 'detail';
    d.textContent = detail;
    li.append(d);
  }
  resultsEl.append(li);
  return ok;
}

const errText = (e) => `${e?.name || 'Error'}: ${e?.message || e}`;

async function step(title, fn) {
  try {
    const detail = await fn();
    report(true, title, detail || '');
    return true;
  } catch (e) {
    report(false, title, errText(e));
    return false;
  }
}

async function runChecks(root, label) {
  resultsEl.replaceChildren();
  verdictEl.hidden = true;
  log.length = 0;
  $('#copy').hidden = true;

  const fs = new FsAccessAdapter(root);
  const TEST_DIR = '_swipah_test';
  const stamp = Date.now();
  const r = {};

  report(null, `Swipah ${APP_VERSION} · ${label}: “${fs.name}”`, navigator.userAgent);
  report('showDirectoryPicker' in window, 'Browser can open folders (showDirectoryPicker)');
  report(fs.capabilities.nativeMove ? true : null, 'Native file move() available',
    fs.capabilities.nativeMove ? '' : 'Not available. Swipah will copy + delete instead.');

  r.perm = await step('Read & write permission', async () => {
    const ok = await fs.verifyPermission();
    if (!ok) throw new Error('Permission was not granted');
  });

  r.list = await step('List what’s in the folder', async () => {
    let files = 0, dirs = 0;
    for await (const [, h] of root.entries()) h.kind === 'file' ? files++ : dirs++;
    return `${files} files, ${dirs} folders at the top level`;
  });

  r.read = await step('Read a file', async () => {
    for await (const [name, h] of root.entries()) {
      if (h.kind === 'file') {
        const f = await h.getFile();
        await f.slice(0, 1024).arrayBuffer();
        return `Read “${name}” (${f.size} bytes)`;
      }
    }
    return 'No files at the top level to read. Skipped (that’s fine).';
  });

  r.mkdir = await step('Create a subfolder', async () => {
    await fs.ensureFolder(TEST_DIR);
    return `${TEST_DIR}/`;
  });

  r.create = await step('Create a file', async () => {
    await fs.writeFile(`probe-a-${stamp}.txt`, 'swipah probe A');
    await fs.writeFile(`probe-b-${stamp}.txt`, 'swipah probe B');
  });

  // Native move, tested on its own so we know which path Swipah will take.
  r.nativeMove = await step('Move a file into the subfolder (native move)', async () => {
    if (!fs.capabilities.nativeMove) throw new Error('move() not available in this browser');
    const fh = await root.getFileHandle(`probe-a-${stamp}.txt`);
    const dest = await root.getDirectoryHandle(TEST_DIR);
    await fh.move(dest, `moved-a-${stamp}.txt`);
    if (!(await fs.exists(`${TEST_DIR}/moved-a-${stamp}.txt`))) throw new Error('File not found after move');
    if (await fs.exists(`probe-a-${stamp}.txt`)) throw new Error('Original still there after move');
  });

  r.copyMove = await step('Move a file by copy + delete (fallback)', async () => {
    await fs.copy(`probe-b-${stamp}.txt`, `${TEST_DIR}/moved-b-${stamp}.txt`);
    const copied = await fs.getFile(`${TEST_DIR}/moved-b-${stamp}.txt`);
    if ((await copied.text()) !== 'swipah probe B') throw new Error('Copied file has the wrong contents');
    await fs.remove(`probe-b-${stamp}.txt`);
    if (await fs.exists(`probe-b-${stamp}.txt`)) throw new Error('Original still there after delete');
  });

  r.rename = await step('Rename a file', async () => {
    const from = `${TEST_DIR}/moved-b-${stamp}.txt`;
    const to = `${TEST_DIR}/not-like-us-${stamp}.txt`;
    await fs.move(from, to);
    if (!(await fs.exists(to))) throw new Error('Renamed file not found');
    return `Worked using ${fs.lastMoveMethod}`;
  });

  r.log = await step('Write the tag log (append)', async () => {
    const path = `${TEST_DIR}/log-${stamp}.jsonl`;
    await fs.appendText(path, '{"n":1}\n');
    await fs.appendText(path, '{"n":2}\n');
    const text = await (await fs.getFile(path)).text();
    if (text !== '{"n":1}\n{"n":2}\n') throw new Error(`Unexpected contents: ${JSON.stringify(text)}`);
  });

  r.cleanup = await step('Clean up test files', async () => {
    // Best effort: remove leftovers from failed steps too.
    for (const name of [`probe-a-${stamp}.txt`, `probe-b-${stamp}.txt`]) {
      await root.removeEntry(name).catch(() => {});
    }
    await root.removeEntry(TEST_DIR, { recursive: true });
  });

  if (navigator.storage?.persisted) {
    report(null, 'Storage marked persistent', String(await navigator.storage.persisted()));
  }

  const canMove = r.nativeMove || r.copyMove;
  verdictEl.hidden = false;
  if (r.perm && r.list && r.mkdir && canMove && r.log) {
    verdictEl.className = 'verdict good';
    verdictEl.textContent = `✅ Swipah can sort this folder${r.nativeMove ? '' : ' (using copy + delete)'}. Wicked good.`;
  } else if (r.perm && r.list && r.log) {
    verdictEl.className = 'verdict meh';
    verdictEl.textContent = '⚠️ Swipah can tag files here but can’t move them. It will use tag-only mode (tags + renames saved to the log).';
  } else {
    verdictEl.className = 'verdict bad';
    verdictEl.textContent = '❌ Swipah can’t work with this folder. Try a different folder, or tap “Copy results” and send them over.';
  }
  log.unshift(verdictEl.textContent);
  $('#copy').hidden = false;
}

$('#run-folder').addEventListener('click', async () => {
  if (!('showDirectoryPicker' in window)) {
    resultsEl.replaceChildren();
    report(false, 'This browser can’t open folders', 'Swipah needs Chrome or Edge (desktop) or Chrome on Android. Firefox and Safari don’t support it yet.');
    return;
  }
  try {
    const root = await window.showDirectoryPicker({ id: 'swipah-test', mode: 'readwrite' });
    await runChecks(root, 'folder');
  } catch (e) {
    if (e.name !== 'AbortError') {
      resultsEl.replaceChildren();
      report(false, 'Couldn’t open that folder', errText(e));
    }
  }
});

$('#run-opfs').addEventListener('click', async () => {
  try {
    const root = await navigator.storage.getDirectory();
    await runChecks(root, 'private storage');
  } catch (e) {
    resultsEl.replaceChildren();
    report(false, 'Private storage not available', errText(e));
  }
});

$('#copy').addEventListener('click', async () => {
  const text = log.join('\n');
  try {
    await navigator.clipboard.writeText(text);
    $('#copy').textContent = 'Copied!';
  } catch {
    prompt('Copy these results:', text);
  }
});
