// Swipah app controller: screens, setup, the sorting loop, recap.

import { APP_VERSION, KOFI_URL, DIRECTIONS, DIRECTION_ARROWS, MILESTONES, TRASH_TAG } from './config.js';
import { FsAccessAdapter } from './adapters/fs-access.js';
import { Session } from './session.js';
import { TagLog } from './log.js';
import { kv, logStore } from './store.js';
import { loadPresets, savePreset, cleanDirections, loadSettings, saveSettings, loadNameHistory, rememberName } from './settings.js';
import { SwipeTracker } from './gestures.js';
import { renderCard, MediaCache, h } from './card.js';
import { toast } from './toasts.js';
import { splitExt, formatDuration, baseOf, sanitizeBaseName } from './naming.js';
import { KIND_ICON } from './filetypes.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const state = {
  adapter: null,
  session: null,
  settings: loadSettings(),
  directions: null,
  tagLog: null,
  cache: null,
  card: null,
  tracker: null,
  pending: [], // multi-tag mode: [{tag, dir}] toggled on the current card
  busy: false,
  shownAt: 0,
  recapUrls: [],
};
state.directions = cleanDirections(loadPresets()[state.settings.preset] || loadPresets().Memes);

const SUGGESTED_TAGS = ['funny', 'reaction', 'wholesome', 'cursed', 'family', 'friends', 'vacation', 'keep', 'favorites', 'screenshots', 'receipts', 'work', 'workout', 'chill', 'party', 'sports', 'pets', TRASH_TAG];

const tagLabel = (tag) => (tag === TRASH_TAG ? '🗑 trash' : tag);

// ---------------------------------------------------------------- screens

function show(name) {
  for (const el of $$('.screen')) el.hidden = el.id !== `screen-${name}`;
  document.body.dataset.screen = name;
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- landing

async function initLanding() {
  $('#about-version').textContent = APP_VERSION;
  for (const a of [$('#kofi-landing'), $('#kofi-recap')]) a.href = KOFI_URL;
  if (!FsAccessAdapter.isSupported()) {
    $('#unsupported').hidden = false;
    $('#pick').disabled = true;
  } else if (/Android/i.test(navigator.userAgent)) {
    $('#android-hint').hidden = false;
  }

  let saved = null;
  try {
    saved = await kv.get('session');
  } catch {
    /* private mode etc. */
  }
  if (saved && saved.queue.length - saved.cursor > 0 && FsAccessAdapter.isSupported()) {
    const done = saved.cursor;
    $('#resume-title').textContent = `Resume sorting “${saved.folderName}”?`;
    $('#resume-detail').textContent = `${done} of ${saved.queue.length} done${saved.savedAt ? ` · ${new Date(saved.savedAt).toLocaleString()}` : ''}`;
    $('#resume').hidden = false;
    $('#resume-go').onclick = () => resume(saved);
    $('#resume-drop').onclick = async () => {
      await kv.del('session');
      $('#resume').hidden = true;
    };
  }

  $('#pick').addEventListener('click', async () => {
    try {
      state.adapter = await FsAccessAdapter.pick();
      kv.set('handle', state.adapter.root).catch(() => {});
      openSetup();
    } catch (e) {
      if (e.name !== 'AbortError') toast(`Couldn’t open that folder: ${e.message}`, { kind: 'error', ms: 5000 });
    }
  });

  $('#demo').addEventListener('click', async () => {
    const { createDemoAdapter } = await import('./demo.js');
    state.adapter = await createDemoAdapter();
    openSetup();
  });
}

async function resume(saved) {
  try {
    let adapter = null;
    const handle = await kv.get('handle').catch(() => null);
    if (handle && handle.name === saved.folderName) {
      const a = new FsAccessAdapter(handle);
      if (await a.verifyPermission().catch(() => false)) adapter = a;
    }
    if (!adapter) {
      // Android forgets folder access between visits: ask for it again.
      toast(`Pick “${saved.folderName}” again to keep going`, { kind: 'info', ms: 3500 });
      adapter = await FsAccessAdapter.pick();
      kv.set('handle', adapter.root).catch(() => {});
      if (adapter.name !== saved.folderName && !confirm(`That folder is “${adapter.name}”, not “${saved.folderName}”. Use it anyway?`)) return;
    }
    state.adapter = adapter;
    state.settings = saved.settings;
    state.directions = saved.directions;
    state.session = await Session.restore(adapter, saved);
    beginSorting({ resumed: true });
  } catch (e) {
    if (e.name !== 'AbortError') toast(`Couldn’t resume: ${e.message}`, { kind: 'error', ms: 5000 });
  }
}

// ---------------------------------------------------------------- setup

function openSetup() {
  $('#setup-folder').textContent = `📂 ${state.adapter.name}`;
  $('#setup-status').textContent = '';
  renderPresetSelect();
  renderDirInputs();
  const s = state.settings;
  for (const r of $$('input[name="mode"]')) r.checked = r.value === s.mode;
  $('#opt-rename').checked = s.rename;
  $('#opt-recursive').checked = s.recursive;
  $('#opt-toasts').checked = s.toasts;
  $('#opt-order').value = s.order;
  for (const c of $$('#opt-types input')) c.checked = !!s.types[c.value];
  updateModeHint();
  show('setup');
}

function renderPresetSelect(selected = state.settings.preset) {
  const presets = loadPresets();
  const sel = $('#preset');
  sel.replaceChildren(...Object.keys(presets).map((n) => h('option', { value: n, text: n })));
  if (!presets[selected]) sel.append(h('option', { value: '', text: 'Custom' }));
  sel.value = presets[selected] ? selected : '';
  $('#tag-suggestions').replaceChildren(...SUGGESTED_TAGS.map((t) => h('option', { value: t })));
}

function renderDirInputs() {
  const grid = $('#dir-grid');
  grid.replaceChildren(
    ...DIRECTIONS.map((d) =>
      h('div', { class: `dir-row c-${d}` },
        h('div', { class: 'dir-badge', text: DIRECTION_ARROWS[d], 'aria-hidden': 'true' }),
        h('input', { type: 'text', 'data-dir': d, value: state.directions[d] || '', placeholder: 'off', list: 'tag-suggestions', 'aria-label': `Tag for swipe ${d}`, autocapitalize: 'off', autocomplete: 'off' }),
      ),
    ),
  );
}

function readSetup() {
  const dirs = {};
  for (const i of $$('#dir-grid input')) dirs[i.dataset.dir] = i.value;
  state.directions = cleanDirections(dirs);
  const types = {};
  for (const c of $$('#opt-types input')) types[c.value] = c.checked;
  state.settings = {
    ...state.settings,
    preset: $('#preset').value || state.settings.preset,
    mode: $('input[name="mode"]:checked')?.value || 'single',
    rename: $('#opt-rename').checked,
    recursive: $('#opt-recursive').checked,
    toasts: $('#opt-toasts').checked,
    order: $('#opt-order').value,
    types,
  };
  saveSettings(state.settings);
}

function updateModeHint() {
  const multi = $('input[name="mode"]:checked')?.value === 'multi';
  $('#mode-hint').textContent = multi
    ? 'Swipe to toggle tags on a file (as many as you like), then double-tap, press Enter or hit Done. It moves to the first tag and gets copied into the rest.'
    : 'One swipe and the file moves to that tag’s folder. Tap the card to skip.';
}

function initSetup() {
  $('#preset').addEventListener('change', (e) => {
    const p = loadPresets()[e.target.value];
    if (p) {
      state.directions = cleanDirections(p);
      state.settings.preset = e.target.value;
      renderDirInputs();
    }
  });
  $('#dir-grid').addEventListener('input', () => {
    // Editing tags turns the selection into "Custom" until saved.
    const sel = $('#preset');
    if (sel.value) {
      if (![...sel.options].some((o) => o.value === '')) sel.append(h('option', { value: '', text: 'Custom' }));
      sel.value = '';
    }
  });
  $('#preset-save').addEventListener('click', () => {
    const name = prompt('Name this preset (e.g. Memes, Music, Vacation pics):', $('#preset').value || '');
    if (!name?.trim()) return;
    readSetup();
    savePreset(name.trim(), state.directions);
    state.settings.preset = name.trim();
    saveSettings(state.settings);
    renderPresetSelect(name.trim());
    toast(`Saved preset “${name.trim()}”`, { kind: 'info' });
  });
  for (const r of $$('input[name="mode"]')) r.addEventListener('change', updateModeHint);

  $('#start').addEventListener('click', async () => {
    readSetup();
    if (!DIRECTIONS.some((d) => state.directions[d])) {
      toast('Give at least one direction a tag first', { kind: 'error' });
      return;
    }
    if (!Object.values(state.settings.types).some(Boolean)) {
      toast('Pick at least one file type', { kind: 'error' });
      return;
    }
    const status = $('#setup-status');
    const btn = $('#start');
    btn.disabled = true;
    status.textContent = 'Scanning…';
    try {
      if (!(await state.adapter.verifyPermission())) throw new Error('Swipah needs permission to edit this folder.');
      state.session = await Session.create(state.adapter, {
        directions: state.directions,
        settings: state.settings,
        onProgress: (n) => (status.textContent = `Scanning… ${n} files`),
      });
      if (!state.session.items.length) {
        status.textContent = 'No matching files in this folder. Try other file types, or include subfolders.';
        return;
      }
      status.textContent = '';
      beginSorting({ resumed: false });
    } catch (e) {
      status.textContent = `Couldn’t read the folder: ${e.message}`;
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------------------------------------------------------------- sorting

function beginSorting({ resumed }) {
  const s = state.session;
  state.tagLog?.stop();
  state.tagLog = new TagLog(state.adapter, s.id);
  state.tagLog.sessionStart({ folderName: s.folderName, directions: s.directions, mode: s.settings.mode, resumed });
  state.cache?.clear();
  state.cache = new MediaCache((p) => state.adapter.getFile(p));
  buildControls();
  refreshNameHistory();
  show('sort');
  showCurrent();
  persist();
}

function buildControls() {
  const { directions, settings } = state.session;
  const multi = settings.mode === 'multi';
  $('#controls').replaceChildren(
    ...DIRECTIONS.map((d) => {
      const tag = directions[d];
      const b = h('button', { class: `btn c-${d}`, 'data-dir': d, disabled: !tag, 'aria-label': tag ? `Swipe ${d}: ${tagLabel(tag)}` : `${d} (off)` },
        h('span', { class: 'arrow', text: DIRECTION_ARROWS[d] }),
        h('span', { class: 'lbl', text: tag ? tagLabel(tag) : 'off' }));
      b.addEventListener('click', () => act(d));
      return b;
    }),
  );
  for (const e of $$('.edge')) {
    const tag = directions[e.dataset.edge];
    e.textContent = tag ? `${DIRECTION_ARROWS[e.dataset.edge]} ${tagLabel(tag)}` : '';
    e.classList.toggle('unused', !tag);
  }
  $('#done').hidden = !multi;
  $('#skip').innerHTML = multi ? 'Skip' : 'Skip <span class="muted small">(tap)</span>';
  $('#rename-row').hidden = !settings.rename;
}

function refreshNameHistory() {
  $('#name-history').replaceChildren(...loadNameHistory().slice(0, 60).map((n) => h('option', { value: n })));
}

function updateProgress() {
  const s = state.session;
  const pos = Math.min(s.cursor + 1, s.queue.length);
  $('#progress-text').textContent = s.finished ? `${s.queue.length} / ${s.queue.length}` : `${pos} / ${s.queue.length}`;
  $('#progress-bar').style.width = `${(s.cursor / Math.max(1, s.queue.length)) * 100}%`;
  $('#undo').disabled = !s.canUndo;
}

async function showCurrent() {
  const s = state.session;
  state.tracker = null;
  state.card?.destroy();
  state.card = null;
  state.pending = [];
  updatePendingUI();
  setHot(null);
  updateProgress();
  const renameInput = $('#rename');
  renameInput.value = '';
  if (s.finished) return toRecap();

  const idx = s.currentIdx;
  const item = s.items[idx];
  const path = s.currentPath(idx);
  $('#rename-ext').textContent = splitExt(baseOf(path))[1];

  const card = await renderCard(item, state.cache, { path });
  if (s.currentIdx !== idx) return card.destroy(); // moved on while loading
  state.card = card;
  $('#stage').append(card.el);
  card.start();
  state.shownAt = performance.now();

  const multi = s.settings.mode === 'multi';
  state.tracker = new SwipeTracker(
    card.el,
    {
      onMove: ({ dx, dy, dir, progress }) => {
        card.el.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 22}deg)`;
        setHot(progress > 0.35 ? dir : null, true);
        const tag = dir && s.directions[dir];
        card.stamp.textContent = tag ? tagLabel(tag) : '';
        card.stamp.className = `stamp c-${dir}`;
        card.stamp.style.opacity = tag ? Math.min(1, progress * 1.2) : 0;
      },
      onSwipe: (dir) => act(dir, { fromGesture: true }),
      onCancel: () => snapBack(),
      onTap: () => (multi ? null : skip()),
      ...(multi ? { onDoubleTap: () => commitMulti() } : {}),
    },
    {
      isEnabled: () => !state.busy && document.activeElement !== renameInput,
      isDirectionEnabled: (d) => !!s.directions[d],
    },
  );

  // Warm up the next couple of files.
  for (const nextIdx of s.queue.slice(s.cursor + 1, s.cursor + 3)) {
    state.cache.preload(s.currentPath(nextIdx), s.items[nextIdx].kind);
  }
}

function setHot(dir, dragging = !!dir) {
  $('#stage').classList.toggle('dragging', dragging);
  for (const e of $$('.edge')) e.classList.toggle('hot', e.dataset.edge === dir);
}

function snapBack() {
  const el = state.card?.el;
  if (!el) return;
  el.classList.add('animating');
  el.style.transform = '';
  state.card.stamp.style.opacity = 0;
  setHot(null);
  setTimeout(() => el.classList.remove('animating'), 230);
}

function flyOut(dir) {
  const el = state.card?.el;
  if (!el) return Promise.resolve();
  const W = innerWidth * 1.4;
  const H = innerHeight * 1.4;
  const t = {
    left: `translate(${-W}px, 0) rotate(-28deg)`,
    right: `translate(${W}px, 0) rotate(28deg)`,
    up: `translate(0, ${-H}px)`,
    down: `translate(0, ${H}px)`,
    skip: 'scale(0.85)',
  }[dir];
  el.classList.add('animating');
  el.style.transform = t;
  el.style.opacity = '0';
  setHot(dir === 'skip' ? null : dir);
  return new Promise((ok) => setTimeout(ok, 220));
}

function unFly() {
  const el = state.card?.el;
  if (!el) return;
  el.style.opacity = '';
  snapBack();
}

/** A swipe/arrow/button in some direction. */
async function act(dir, { fromGesture = false } = {}) {
  const s = state.session;
  const tag = s?.directions[dir];
  if (!tag || state.busy || !state.card) return;
  if (s.settings.mode === 'multi') {
    const i = state.pending.findIndex((p) => p.dir === dir);
    if (i >= 0) state.pending.splice(i, 1);
    else state.pending.push({ tag, dir });
    updatePendingUI(dir);
    if (fromGesture) snapBack();
    else {
      // Little nudge so keyboard users see something happen.
      const el = state.card.el;
      const n = { left: '-24px,0', right: '24px,0', up: '0,-24px', down: '0,24px' }[dir];
      el.classList.add('animating');
      el.style.transform = `translate(${n})`;
      setTimeout(snapBack, 120);
    }
    return;
  }
  await commit([tag], [dir], dir);
}

function updatePendingUI(justToggled) {
  for (const b of $$('#controls .btn')) b.classList.toggle('on', state.pending.some((p) => p.dir === b.dataset.dir));
  const chips = state.card?.chips;
  if (!chips) return;
  chips.replaceChildren(
    ...state.pending.map((p) => h('span', { class: `tagchip c-${p.dir}${p.dir === justToggled ? ' pop' : ''}`, text: tagLabel(p.tag) })),
  );
}

async function commitMulti() {
  if (state.busy || !state.card) return;
  if (!state.pending.length) return skip();
  await commit(state.pending.map((p) => p.tag), state.pending.map((p) => p.dir), state.pending[0].dir);
}

async function commit(tags, dirs, flyDir) {
  const s = state.session;
  state.busy = true;
  const renameTo = s.settings.rename ? $('#rename').value.trim() : '';
  const dwellMs = Math.round(performance.now() - state.shownAt);
  try {
    const [entry] = await Promise.all([s.tag(tags, { directions: dirs, renameTo, dwellMs }), flyOut(flyDir)]);
    afterDecision(entry, 'tag', renameTo);
  } catch (e) {
    console.error(e);
    unFly();
    toast(`Couldn’t move that file: ${e.message}`, { kind: 'error', ms: 5000 });
    state.busy = false;
    return;
  }
  state.busy = false;
  showCurrent();
}

async function skip() {
  const s = state.session;
  if (state.busy || !state.card) return;
  state.busy = true;
  const renameTo = s.settings.rename ? $('#rename').value.trim() : '';
  try {
    const [entry] = await Promise.all([
      s.skip({ renameTo, dwellMs: Math.round(performance.now() - state.shownAt) }),
      flyOut('skip'),
    ]);
    afterDecision(entry, 'skip', renameTo);
  } catch (e) {
    unFly();
    toast(`Couldn’t rename that file: ${e.message}`, { kind: 'error', ms: 5000 });
    state.busy = false;
    return;
  }
  state.busy = false;
  showCurrent();
}

function afterDecision(entry, action, typed = '') {
  logAction(entry, action);
  if (entry.renamedTo) {
    rememberName(splitExt(sanitizeBaseName(typed))[0]); // what you typed, not the -1 version
    refreshNameHistory();
  }
  const line = MILESTONES[state.session.swipes];
  if (line && state.session.settings.toasts) toast(line, { ms: 3200 });
  persist();
}

async function undo() {
  const s = state.session;
  if (state.busy || !s?.canUndo) return;
  state.busy = true;
  try {
    const entry = await s.undo();
    logAction(entry, 'undo');
    toast(entry.action === 'tag' ? `Undid ${tagLabel(entry.tags[0])}: “${baseOf(entry.from)}” is back` : `Undid skip`, { kind: 'info' });
    persist();
  } catch (e) {
    toast(`Couldn’t undo: ${e.message}`, { kind: 'error', ms: 5000 });
  } finally {
    state.busy = false;
  }
  show('sort');
  showCurrent();
}

function logAction(entry, action) {
  const item = state.session.items[entry.idx];
  state.tagLog.add({
    type: 'action',
    action,
    file: {
      original_path: item.path,
      from_path: entry.from,
      final_paths: entry.finalPaths,
      size: item.size,
      mime: item.mime,
      last_modified: new Date(item.lastModified).toISOString(),
      fingerprint: entry.fingerprint,
    },
    tags: entry.tags,
    directions: entry.directions,
    renamed_from: entry.renamedFrom,
    renamed_to: entry.renamedTo,
    dwell_ms: entry.dwellMs,
    ...(action === 'undo' ? { undid: entry.action } : {}),
  });
}

let persistTimer;
function persist() {
  // Demo files live in memory only, so there's nothing to resume after reload.
  if (state.adapter?.kind !== 'fs-access' || !state.session) return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    kv.set('session', { ...state.session.toJSON(), savedAt: Date.now() }).catch((e) => console.warn('Save failed', e));
  }, 150);
}

function initSorting() {
  $('#undo').addEventListener('click', undo);
  $('#skip').addEventListener('click', () => (state.session.settings.mode === 'multi' ? skipMulti() : skip()));
  $('#done').addEventListener('click', commitMulti);
  $('#finish').addEventListener('click', toRecap);

  const rename = $('#rename');
  rename.addEventListener('focus', () => document.body.classList.add('typing'));
  rename.addEventListener('blur', () => document.body.classList.remove('typing'));

  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.screen !== 'sort' || e.altKey || e.metaKey && e.key !== 'z') return;
    if (e.target === rename) {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        rename.blur();
      }
      return;
    }
    const onButton = e.target.closest?.('button');
    const key = e.key;
    const dir = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[key];
    if (dir) {
      e.preventDefault();
      act(dir);
    } else if (key === ' ' && !onButton) {
      e.preventDefault();
      state.session.settings.mode === 'multi' ? skipMulti() : skip();
    } else if ((key === 'z' || key === 'Z') && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if (key === 'Enter' && !onButton && state.session.settings.mode === 'multi') {
      e.preventDefault();
      commitMulti();
    } else if ((key === 'r' || key === 'R' || key === '/') && state.session.settings.rename && !e.ctrlKey) {
      e.preventDefault();
      rename.focus();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') state.tagLog?.flush();
  });
  window.addEventListener('pagehide', () => state.tagLog?.flush());
}

function skipMulti() {
  state.pending = [];
  skip();
}

// ---------------------------------------------------------------- recap

function freeRecapUrls() {
  state.recapUrls.forEach((u) => URL.revokeObjectURL(u));
  state.recapUrls = [];
}

async function toRecap() {
  const s = state.session;
  state.card?.destroy();
  state.card = null;
  state.tracker = null;
  state.tagLog?.flush();
  freeRecapUrls();

  const st = s.stats();
  const titles = st.decided === 0
    ? ['Nothing sorted yet']
    : st.remaining === 0
      ? ['All sorted. Wicked good!', 'Done and done!', 'Look at you go!']
      : ['Nice work so far!', 'Good stopping point.'];
  $('#recap-title').textContent = titles[st.decided % titles.length];
  $('#recap-sub').textContent = st.decided
    ? `${st.decided} file${st.decided === 1 ? '' : 's'} in ${formatDuration(st.elapsedMs)}${st.perMinute ? ` · ${st.perMinute}/min` : ''}${st.remaining ? ` · ${st.remaining} left` : ''}`
    : `${st.remaining} file${st.remaining === 1 ? '' : 's'} waiting in “${s.folderName}”`;

  $('#stats').replaceChildren(
    ...[
      [st.sorted, 'sorted'],
      [st.trashed, 'trashed'],
      [st.skipped, 'skipped'],
      [st.renamed, 'renamed'],
      [formatDuration(st.elapsedMs), 'time'],
      [st.perMinute, 'per minute'],
    ].map(([v, l]) => h('div', { class: 'stat' }, h('b', { text: String(v) }), h('span', { text: l }))),
  );

  const reels = $('#reels');
  reels.replaceChildren();
  const dirOfTag = Object.fromEntries(DIRECTIONS.map((d) => [s.directions[d], d]));
  const groups = [...s.byTag()].filter(([, list]) => list.length);
  groups.sort(([a], [b]) => (a === TRASH_TAG) - (b === TRASH_TAG));
  for (const [tag, list] of groups) {
    const strip = h('div', { class: 'reel-strip' });
    for (const entry of list) strip.append(thumb(entry, tag));
    reels.append(
      h('div', { class: `reel c-${dirOfTag[tag] || 'none'}` },
        h('h3', {}, h('span', { class: 'dot' }), h('span', { text: `${tagLabel(tag)} · ${list.length}` })),
        strip),
    );
  }
  const skippedIdx = s.skippedIdx();
  $('#keep-going').hidden = s.finished;
  $('#review-skipped').hidden = !skippedIdx.length || !s.finished;
  $('#review-skipped').textContent = `Review ${skippedIdx.length} skipped`;
  $('#recap-undo').disabled = !s.canUndo;
  $('#export').disabled = !s.entries.length;
  $('#export-status').textContent = '';
  show('recap');
}

function thumb({ item, path }, tag) {
  const btn = h('button', { class: 'thumb', title: path, 'aria-label': `${baseOf(path)} (${tag})` });
  const name = h('span', { class: 'tname', text: baseOf(path) });
  if (item.kind === 'image' || item.kind === 'video') {
    state.adapter.getFile(path).then((file) => {
      const url = URL.createObjectURL(file);
      state.recapUrls.push(url);
      const media = item.kind === 'image'
        ? h('img', { src: url, alt: '', loading: 'lazy', decoding: 'async' })
        : h('video', { src: `${url}#t=0.5`, muted: true, preload: 'metadata', playsinline: true });
      media.addEventListener('error', () => media.replaceWith(h('span', { class: 'ticon', text: KIND_ICON[item.kind] })));
      btn.prepend(media);
    }).catch(() => btn.prepend(h('span', { class: 'ticon', text: '⚠️' })));
  } else {
    btn.append(h('span', { class: 'ticon', text: KIND_ICON[item.kind] }));
  }
  btn.append(name);
  btn.addEventListener('click', () => openLightbox(item, path, tag));
  return btn;
}

async function openLightbox(item, path, tag) {
  const box = $('#lb-media');
  box.replaceChildren();
  try {
    const url = URL.createObjectURL(await state.adapter.getFile(path));
    state.recapUrls.push(url);
    const el = item.kind === 'image' ? h('img', { src: url, alt: baseOf(path) })
      : item.kind === 'video' ? h('video', { src: url, controls: true, autoplay: true, playsinline: true })
      : item.kind === 'audio' ? h('audio', { src: url, controls: true, autoplay: true })
      : h('div', { class: 'placeholder' }, h('div', { class: 'big', text: KIND_ICON.other }));
    box.append(el);
  } catch {
    box.append(h('div', { class: 'placeholder', text: 'Couldn’t open this file.' }));
  }
  $('#lb-cap').textContent = `${tagLabel(tag)} · ${path}`;
  $('#lightbox').hidden = false;
}

function closeLightbox() {
  $('#lb-media').replaceChildren();
  $('#lightbox').hidden = true;
}

function initRecap() {
  $('#keep-going').addEventListener('click', () => {
    show('sort');
    showCurrent();
  });
  $('#review-skipped').addEventListener('click', () => {
    const n = state.session.reviewSkipped();
    toast(`Taking another look at ${n} skipped`, { kind: 'info' });
    show('sort');
    showCurrent();
    persist();
  });
  $('#recap-undo').addEventListener('click', undo);
  $('#another').addEventListener('click', async () => {
    await state.tagLog?.stop();
    state.tagLog = null;
    freeRecapUrls();
    state.cache?.clear();
    state.session = null;
    await kv.del('session').catch(() => {});
    $('#resume').hidden = true;
    show('landing');
  });
  $('#download-log').addEventListener('click', async () => {
    await state.tagLog?.flush();
    const { downloadBlob } = await import('./export.js');
    const all = await logStore.all();
    downloadBlob(new Blob([all.map((r) => JSON.stringify(r)).join('\n') + '\n'], { type: 'application/x-ndjson' }), 'swipah-log.jsonl');
  });
  $('#export').addEventListener('click', async () => {
    const status = $('#export-status');
    const btn = $('#export');
    btn.disabled = true;
    try {
      await state.tagLog?.flush();
      const { buildExport, saveExport } = await import('./export.js');
      status.textContent = 'Building contact sheets…';
      const records = await logStore.bySession(state.session.id);
      const { files, tiles } = await buildExport(state.session, records, (n, total) => {
        status.textContent = `Building contact sheets… ${n}/${total}`;
      });
      const res = await saveExport(state.session, files);
      status.textContent = res.where === 'folder'
        ? `✅ Saved ${tiles} items to ${res.path}. Attach those files in Claude or Gemini and paste PROMPT.md.`
        : `✅ Downloaded ${res.path} (${tiles} items). Unzip it, attach the files in Claude or Gemini and paste PROMPT.md.`;
    } catch (e) {
      console.error(e);
      status.textContent = `Export failed: ${e.message}`;
    } finally {
      btn.disabled = false;
    }
  });
  $('#lb-close').addEventListener('click', closeLightbox);
  $('#lightbox').addEventListener('click', (e) => {
    if (e.target.id === 'lightbox' || e.target.id === 'lb-media') closeLightbox();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#lightbox').hidden) closeLightbox();
  });
}

// ---------------------------------------------------------------- boot

function initCommon() {
  for (const b of $$('[data-go]')) b.addEventListener('click', () => show(b.dataset.go));
  for (const b of $$('[data-open]')) b.addEventListener('click', () => document.getElementById(b.dataset.open).showModal());
  if ('serviceWorker' in navigator && !new URLSearchParams(location.search).has('nosw')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

initCommon();
initSetup();
initSorting();
initRecap();
initLanding();
show('landing');

// Handy for debugging in the console (and used by the automated tests).
window.swipah = { state };
