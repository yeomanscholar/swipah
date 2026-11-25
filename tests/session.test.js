// Unit tests for naming + the sorting session, run in Node against the
// in-memory adapter (Node 22 has File/Blob/crypto.subtle built in).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeBaseName, sanitizeTag, applyRename, uniqueName, splitExt } from '../js/naming.js';
import { MemoryAdapter } from '../js/adapters/memory.js';
import { Session } from '../js/session.js';
import { cleanDirections } from '../js/settings.js';
import { DEFAULT_SETTINGS } from '../js/config.js';

const dirs = { left: '_trash', right: 'funny', up: 'reaction', down: 'wholesome' };
const file = (name, body = name) => new File([body], name, { lastModified: 1_700_000_000_000 });

async function makeSession(names, settings = {}) {
  const adapter = new MemoryAdapter('Memes', names.map((n) => file(n)));
  const s = await Session.create(adapter, {
    directions: dirs,
    settings: { ...DEFAULT_SETTINGS, ...settings, types: { image: true, video: true, audio: true, other: true } },
  });
  return { s, adapter, paths: () => [...adapter.files.keys()].sort() };
}

test('sanitizeBaseName cleans typed names', () => {
  assert.equal(sanitizeBaseName('  not like us  '), 'not-like-us');
  assert.equal(sanitizeBaseName('a/b\\c:d*e?"f<g>h|i#j%'), 'abcdefghij');
  assert.equal(sanitizeBaseName('..hidden'), 'hidden');
  assert.equal(sanitizeBaseName('x'.repeat(100)).length, 80);
});

test('sanitizeTag lowercases and keeps _trash special', () => {
  assert.equal(sanitizeTag('Family Pics'), 'family-pics');
  assert.equal(sanitizeTag('_TRASH'), '_trash');
  assert.equal(sanitizeTag('_sneaky'), 'sneaky');
});

test('applyRename keeps the extension', () => {
  assert.equal(applyRename('IMG_1.jpg', 'not like us'), 'not-like-us.jpg');
  assert.equal(applyRename('IMG_1.jpg', 'not-like-us.jpg'), 'not-like-us.jpg');
  assert.equal(applyRename('IMG_1.jpg', '   '), 'IMG_1.jpg');
  assert.deepEqual(splitExt('.nomedia'), ['.nomedia', '']);
});

test('uniqueName never overwrites', async () => {
  const taken = new Set(['a.jpg', 'a-1.jpg']);
  assert.equal(await uniqueName('a.jpg', async (n) => taken.has(n)), 'a-2.jpg');
  assert.equal(await uniqueName('b.jpg', async (n) => taken.has(n)), 'b.jpg');
});

test('cleanDirections dedupes and sanitizes', () => {
  assert.deepEqual(cleanDirections({ left: '_trash', right: 'Funny', up: 'funny', down: '' }), {
    left: '_trash', right: 'funny', up: '', down: '',
  });
});

test('single tag moves the file into the tag folder', async () => {
  const { s, paths } = await makeSession(['a.png', 'b.png']);
  const e = await s.tag(['funny'], { directions: ['right'] });
  assert.deepEqual(e.finalPaths, ['funny/a.png']);
  assert.match(e.fingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(paths(), ['b.png', 'funny/a.png']);
  assert.equal(s.cursor, 1);
});

test('multi-tag moves to the first tag and copies to the rest', async () => {
  const { s, paths } = await makeSession(['a.png']);
  await s.tag(['reaction', 'funny'], { directions: ['up', 'right'] });
  assert.deepEqual(paths(), ['funny/a.png', 'reaction/a.png']);
});

test('trash wins over other tags', async () => {
  const { s, paths } = await makeSession(['a.png']);
  const e = await s.tag(['funny', '_trash']);
  assert.deepEqual(e.tags, ['_trash']);
  assert.deepEqual(paths(), ['_trash/a.png']);
});

test('rename + name collision adds -1', async () => {
  const { s, adapter, paths } = await makeSession(['a.png', 'b.png']);
  await adapter.writeFile('funny/not-like-us.png', new Blob(['existing']));
  const e = await s.tag(['funny'], { renameTo: 'not like us' });
  assert.equal(e.renamedFrom, 'a.png');
  assert.equal(e.renamedTo, 'not-like-us-1.png');
  assert.deepEqual(paths(), ['b.png', 'funny/not-like-us-1.png', 'funny/not-like-us.png']);
  assert.equal(await (await adapter.getFile('funny/not-like-us.png')).text(), 'existing');
});

test('undo reverses moves, copies and renames', async () => {
  const { s, paths } = await makeSession(['a.png', 'b.png']);
  await s.tag(['reaction', 'funny'], { renameTo: 'squabble-up' });
  assert.deepEqual(paths(), ['b.png', 'funny/squabble-up.png', 'reaction/squabble-up.png']);
  const undone = await s.undo();
  assert.equal(undone.idx, 0);
  assert.equal(s.cursor, 0);
  assert.deepEqual(paths(), ['a.png', 'b.png']);
  assert.equal(s.canUndo, false);
});

test('skip leaves the file, or renames it in place', async () => {
  const { s, paths } = await makeSession(['a.png', 'b.png']);
  await s.skip();
  await s.skip({ renameTo: 'luther' });
  assert.deepEqual(paths(), ['a.png', 'luther.png']);
  assert.equal(s.finished, true);
  await s.undo();
  assert.deepEqual(paths(), ['a.png', 'b.png']);
});

test('review skipped puts skipped files back in the queue', async () => {
  const { s, paths } = await makeSession(['a.png', 'b.png', 'c.png']);
  await s.skip();
  await s.tag(['funny']);
  await s.skip();
  assert.equal(s.finished, true);
  assert.equal(s.reviewSkipped(), 2);
  assert.equal(s.currentItem.name, 'a.png');
  await s.tag(['wholesome']);
  assert.deepEqual(s.skippedIdx().map((i) => s.items[i].name), ['c.png']);
  assert.deepEqual(paths(), ['c.png', 'funny/b.png', 'wholesome/a.png']);
});

test('stats and byTag reflect the latest decision per file', async () => {
  const { s } = await makeSession(['a.png', 'b.png', 'c.png', 'd.png']);
  await s.tag(['funny', 'reaction']);
  await s.tag(['_trash']);
  await s.skip();
  await s.tag(['funny'], { renameTo: 'gnx' });
  const st = s.stats();
  assert.equal(st.sorted, 2);
  assert.equal(st.trashed, 1);
  assert.equal(st.skipped, 1);
  assert.equal(st.renamed, 1);
  const by = s.byTag();
  assert.deepEqual(by.get('funny').map((x) => x.path), ['funny/a.png', 'funny/gnx.png']);
  assert.deepEqual(by.get('reaction').map((x) => x.path), ['reaction/a.png']);
});

test('tag folders and hidden folders are not scanned', async () => {
  const adapter = new MemoryAdapter('Memes', [file('a.png'), file('funny/old.png'), file('.swipah/log.jsonl'), file('sub/b.png'), file('.hidden/c.png')]);
  const s = await Session.create(adapter, { directions: dirs, settings: { ...DEFAULT_SETTINGS, recursive: true } });
  assert.deepEqual(s.items.map((i) => i.path).sort(), ['a.png', 'sub/b.png']);
  const flat = await Session.create(adapter, { directions: dirs, settings: { ...DEFAULT_SETTINGS, recursive: false } });
  assert.deepEqual(flat.items.map((i) => i.path), ['a.png']);
});

test('file type filter', async () => {
  const adapter = new MemoryAdapter('Mixed', [file('a.png'), file('song.mp3'), file('clip.mp4'), file('notes.txt')]);
  const s = await Session.create(adapter, { directions: dirs, settings: { ...DEFAULT_SETTINGS, types: { image: false, video: false, audio: true, other: false } } });
  assert.deepEqual(s.items.map((i) => i.name), ['song.mp3']);
});

test('restore drops files that vanished and keeps progress', async () => {
  const { s, adapter } = await makeSession(['a.png', 'b.png', 'c.png']);
  await s.tag(['funny']);
  const saved = JSON.parse(JSON.stringify(s.toJSON()));
  await adapter.remove('c.png');
  const r = await Session.restore(adapter, saved);
  assert.equal(r.cursor, 1);
  assert.deepEqual(r.queue.slice(r.cursor).map((i) => r.items[i].name), ['b.png']);
  await r.undo();
  assert.equal(await adapter.exists('a.png'), true);
});

test('failed move rolls back copies', async () => {
  const { s, adapter, paths } = await makeSession(['a.png']);
  adapter.move = async () => {
    throw new Error('disk full');
  };
  await assert.rejects(s.tag(['funny', 'reaction']), /disk full/);
  assert.deepEqual(paths(), ['a.png']);
  assert.equal(s.cursor, 0);
});
