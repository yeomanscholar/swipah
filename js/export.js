// "Export for AI": a bundle you can hand to Claude, Gemini, etc. so it can
// learn how you tag and name things. Nothing is uploaded; the user carries
// the files over. See docs/SPEC.md §4.13.
//
// Bundle:
//   log.jsonl            the session's tag-log records
//   contact-sheet-NN.jpg numbered thumbnail grids
//   index.json           sheet + tile number → log entry
//   PROMPT.md            ready-to-paste instructions for the AI

import { META_DIR, APP_VERSION, TRASH_TAG } from './config.js';
import { joinPath } from './naming.js';
import { makeZip } from './zip.js';

const COLS = 5;
const ROWS = 6;
const TILE = 240;
const LABEL = 54;
const PAD = 8;

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function loadImage(url) {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = fail;
    img.src = url;
  });
}

function videoFrame(url) {
  return new Promise((ok, fail) => {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.src = url;
    const t = setTimeout(() => fail(new Error('timeout')), 4000);
    v.addEventListener('loadeddata', () => (v.currentTime = Math.min(0.5, (v.duration || 1) / 3)), { once: true });
    v.addEventListener('seeked', () => { clearTimeout(t); ok(v); }, { once: true });
    v.addEventListener('error', () => { clearTimeout(t); fail(new Error('video')); }, { once: true });
  });
}

function drawContain(ctx, src, w, h, x, y, size) {
  const s = Math.min(size / w, size / h); // fit the whole image: meme text at the edges matters to the AI
  const dw = w * s;
  const dh = h * s;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.clip();
  ctx.drawImage(src, x + (size - dw) / 2, y + (size - dh) / 2, dw, dh);
  ctx.restore();
}

function wrapText(ctx, text, x, y, maxW, lineH, maxLines) {
  const words = text.split(/(\s+|-)/);
  let line = '';
  let lines = 0;
  for (const w of words) {
    const test = line + w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line.trim(), x, y + lines * lineH);
      lines++;
      line = w.trimStart();
      if (lines >= maxLines) return;
    } else line = test;
  }
  if (line && lines < maxLines) ctx.fillText(line.trim(), x, y + lines * lineH);
}

async function drawTile(ctx, adapter, tile, x, y) {
  ctx.fillStyle = '#1b1d24';
  ctx.fillRect(x, y, TILE, TILE + LABEL);
  let drawn = false;
  if (tile.kind === 'image' || tile.kind === 'video') {
    let url;
    try {
      const file = await adapter.getFile(tile.path);
      url = URL.createObjectURL(file);
      if (tile.kind === 'image') {
        const img = await loadImage(url);
        drawContain(ctx, img, img.naturalWidth || TILE, img.naturalHeight || TILE, x, y, TILE);
      } else {
        const v = await videoFrame(url);
        drawContain(ctx, v, v.videoWidth || TILE, v.videoHeight || TILE, x, y, TILE);
      }
      drawn = true;
    } catch {
      // fall through to a text tile
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  }
  if (!drawn) {
    ctx.fillStyle = '#262933';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#9aa0b0';
    ctx.font = '600 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(tile.kind.toUpperCase(), x + TILE / 2, y + 70);
    ctx.fillStyle = '#f2f3f7';
    ctx.font = '600 17px system-ui, sans-serif';
    wrapText(ctx, tile.name, x + TILE / 2, y + 110, TILE - 24, 22, 5);
  }
  // Number badge in the label strip (not over the image, where meme text lives)
  const badgeW = 44;
  ctx.fillStyle = '#ffd23f';
  ctx.fillRect(x, y + TILE, badgeW, LABEL);
  ctx.fillStyle = '#1a1400';
  ctx.font = '900 20px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(String(tile.n), x + badgeW / 2, y + TILE + 34, badgeW - 6);
  // Label: tags + name
  const lx = x + badgeW + 6;
  const lw = TILE - badgeW - 10;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffd23f';
  ctx.font = '800 15px system-ui, sans-serif';
  ctx.fillText(tile.tags.join(', ') || '(skipped)', lx, y + TILE + 20, lw);
  ctx.fillStyle = '#f2f3f7';
  ctx.font = '500 13px system-ui, sans-serif';
  ctx.fillText(tile.name, lx, y + TILE + 42, lw);
}

async function contactSheets(adapter, tiles, onProgress) {
  const sheets = [];
  const per = COLS * ROWS;
  for (let s = 0; s * per < tiles.length; s++) {
    const chunk = tiles.slice(s * per, (s + 1) * per);
    const rows = Math.ceil(chunk.length / COLS);
    const canvas = document.createElement('canvas');
    canvas.width = COLS * (TILE + PAD) + PAD;
    canvas.height = rows * (TILE + LABEL + PAD) + PAD;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#121318';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < chunk.length; i++) {
      const x = PAD + (i % COLS) * (TILE + PAD);
      const y = PAD + Math.floor(i / COLS) * (TILE + LABEL + PAD);
      chunk[i].sheet = sheets.length + 1;
      await drawTile(ctx, adapter, chunk[i], x, y);
      onProgress?.(s * per + i + 1, tiles.length);
    }
    sheets.push(await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.85)));
  }
  return sheets;
}

function promptText(session, tileCount, sheetCount) {
  const dirs = Object.entries(session.directions).filter(([, t]) => t).map(([d, t]) => `${d} → ${t}`).join(', ');
  const sheetNames = sheetCount > 1
    ? `contact-sheet-01.jpg … contact-sheet-${String(sheetCount).padStart(2, '0')}.jpg`
    : 'contact-sheet-01.jpg';
  return `# Swipah export: learn my tagging style

I sorted files with **Swipah** (a swipe-to-sort app). Attached:

- **${sheetNames}**: ${tileCount} numbered thumbnails. Under each: the tags I gave it, then its final filename.
- **index.json**: maps each sheet/number to its log entry (tags, original → new filename, fingerprint).
- **log.jsonl**: the raw log, one JSON object per line (\`session_start\`, then one \`action\` per decision: \`tag\`, \`skip\` or \`undo\`).

My swipe setup: ${dirs}. \`${TRASH_TAG}\` means I threw it out.
When \`renamed_from\`/\`renamed_to\` are set, I typed that name myself. That's my naming style.

## What I'd like from you
1. Look at the images together with their tags and names.
2. Write down the rules you think I'm using for each tag (what makes something “${session.directions.right || 'funny'}” vs “${session.directions.up || 'reaction'}”, what I trash).
3. Describe my naming style for renames (length, words I reuse, how I describe the text in an image).
4. Point out anything that looks inconsistent.
5. Then, for new images I send, suggest a tag and a filename in my style.
`;
}

/**
 * Build the export bundle for a session.
 * @returns {Promise<Array<{name, data}>>}
 */
export async function buildExport(session, logRecords, onProgress) {
  const tiles = [];
  const latest = new Map();
  for (const e of session.entries) latest.set(e.idx, e);
  for (const e of latest.values()) {
    if (e.action !== 'tag' && !e.renamedTo) continue;
    const item = session.items[e.idx];
    tiles.push({
      n: tiles.length + 1,
      kind: item.kind,
      path: e.finalPaths[0],
      name: e.finalPaths[0].split('/').pop(),
      tags: e.tags,
      original_path: item.path,
      final_paths: e.finalPaths,
      renamed_from: e.renamedFrom,
      renamed_to: e.renamedTo,
      fingerprint: e.fingerprint,
    });
  }
  const sheets = await contactSheets(session.adapter, tiles, onProgress);
  const files = [];
  sheets.forEach((blob, i) => files.push({ name: `contact-sheet-${String(i + 1).padStart(2, '0')}.jpg`, data: blob }));
  files.push({
    name: 'index.json',
    data: JSON.stringify(
      {
        app: 'swipah',
        app_version: APP_VERSION,
        exported_at: new Date().toISOString(),
        session_id: session.id,
        folder_name: session.folderName,
        directions: session.directions,
        tiles: tiles.map(({ kind, path, name, ...t }) => ({ ...t, kind, final_name: name })),
      },
      null,
      2,
    ),
  });
  files.push({ name: 'log.jsonl', data: logRecords.map((r) => JSON.stringify(r)).join('\n') + '\n' });
  files.push({ name: 'PROMPT.md', data: promptText(session, tiles.length, sheets.length) });
  return { files, tiles: tiles.length, sheets: sheets.length };
}

export function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/**
 * Save the bundle: into <folder>/.swipah/export-…/ when we have a real folder,
 * otherwise (or if that fails) as a single .zip download.
 * @returns {Promise<{where: 'folder'|'download', path: string}>}
 */
export async function saveExport(session, files) {
  const dirName = `export-${stamp()}`;
  if (session.adapter.kind === 'fs-access') {
    try {
      for (const f of files) await session.adapter.writeFile(joinPath(META_DIR, dirName, f.name), f.data);
      return { where: 'folder', path: `${session.folderName}/${META_DIR}/${dirName}/` };
    } catch (e) {
      console.warn('Export to folder failed; downloading instead', e);
    }
  }
  const zip = await makeZip(files.map((f) => ({ name: `swipah-${dirName}/${f.name}`, data: f.data })));
  downloadBlob(zip, `swipah-${dirName}.zip`);
  return { where: 'download', path: `swipah-${dirName}.zip` };
}
