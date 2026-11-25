// A sorting session: the queue of files, every decision made, and undo.
// All file operations go through the storage adapter, and each decision
// stores the exact operations it performed so undo can reverse them.

import { TRASH_TAG, META_DIR, DIRECTIONS } from './config.js';
import { applyRename, uniqueName, joinPath, dirOf, baseOf, naturalCompare } from './naming.js';
import { fingerprint, newId } from './log.js';

export class Session {
  constructor(data) {
    Object.assign(this, {
      id: newId(),
      startedAt: Date.now(),
      queue: [],
      cursor: 0,
      entries: [], // decision history (undo pops from the end)
      swipes: 0,
      ...data,
    });
  }

  /** Scan the folder and build a fresh session. */
  static async create(adapter, { directions, settings, onProgress }) {
    const skipDirs = tagFolders(directions);
    let items = await adapter.listItems({
      recursive: settings.recursive,
      skip: (dirPath) => skipDirs.has(dirPath.split('/')[0]) || dirPath.split('/').some((p) => p.startsWith('.')),
      onProgress,
    });
    items = items.filter((it) => settings.types[it.kind]);
    sortItems(items, settings.order);
    return new Session({
      adapter,
      folderName: adapter.name,
      adapterKind: adapter.kind,
      directions,
      settings,
      items,
      queue: items.map((_, i) => i),
    });
  }

  /** Rebuild a saved session (after reload). Drops queued files that vanished. */
  static async restore(adapter, saved) {
    const s = new Session({ ...saved, adapter });
    const skipDirs = tagFolders(s.directions);
    const present = new Set(
      (await adapter.listItems({ recursive: s.settings.recursive, skip: (d) => skipDirs.has(d.split('/')[0]) })).map(
        (it) => `${it.path}|${it.size}`,
      ),
    );
    const done = s.queue.slice(0, s.cursor);
    const todo = s.queue.slice(s.cursor).filter((idx) => {
      const it = s.items[idx];
      return present.has(`${s.currentPath(idx)}|${it.size}`);
    });
    s.queue = [...done, ...todo];
    return s;
  }

  toJSON() {
    const { adapter, ...rest } = this;
    return rest;
  }

  get currentIdx() {
    return this.cursor < this.queue.length ? this.queue[this.cursor] : null;
  }

  get currentItem() {
    const idx = this.currentIdx;
    return idx == null ? null : this.items[idx];
  }

  get remaining() {
    return Math.max(0, this.queue.length - this.cursor);
  }

  get finished() {
    return this.remaining === 0;
  }

  /** Latest decision for an item (or undefined). */
  stateOf(idx) {
    for (let i = this.entries.length - 1; i >= 0; i--) if (this.entries[i].idx === idx) return this.entries[i];
    return undefined;
  }

  /** Where the file lives right now (it may have been moved or renamed already). */
  currentPath(idx) {
    return this.stateOf(idx)?.finalPaths?.[0] ?? this.items[idx].path;
  }

  /**
   * Tag the current file: move it into the first tag's folder, copy it into the
   * others. _trash wins over everything (no copies). Optional rename.
   */
  async tag(tags, { directions = [], renameTo = '', dwellMs = 0 } = {}) {
    const idx = this.currentIdx;
    if (idx == null) throw new Error('Nothing left to sort');
    let clean = [...new Set(tags.filter(Boolean))];
    if (!clean.length) return this.skip({ renameTo, dwellMs });
    if (clean.includes(TRASH_TAG)) clean = [TRASH_TAG];

    const from = this.currentPath(idx);
    const file = await this.adapter.getFile(from);
    const fp = await fingerprint(file).catch(() => null);
    const oldName = baseOf(from);
    const wanted = renameTo ? applyRename(oldName, renameTo) : oldName;

    const ops = [];
    const finalPaths = [];
    try {
      // Copies first (the source must still exist), then the move.
      for (const tag of clean.slice(1)) {
        const to = await this._freePath(tag, wanted);
        await this.adapter.copy(from, to);
        ops.push({ op: 'copy', to });
        finalPaths.push(to);
      }
      const to = await this._freePath(clean[0], wanted);
      await this.adapter.move(from, to);
      ops.push({ op: 'move', from, to });
      finalPaths.unshift(to);
    } catch (e) {
      await this._reverse(ops); // don't leave half-done copies behind
      throw e;
    }

    const entry = {
      idx,
      qpos: this.cursor,
      action: 'tag',
      tags: clean,
      directions,
      from,
      finalPaths,
      renamedFrom: wanted !== oldName ? oldName : null,
      renamedTo: wanted !== oldName ? baseOf(finalPaths[0]) : null,
      fingerprint: fp,
      ops,
      dwellMs,
      ts: Date.now(),
    };
    return this._record(entry);
  }

  /** Leave the file where it is (renaming it in place if a name was typed). */
  async skip({ renameTo = '', dwellMs = 0 } = {}) {
    const idx = this.currentIdx;
    if (idx == null) throw new Error('Nothing left to sort');
    const from = this.currentPath(idx);
    const oldName = baseOf(from);
    const wanted = renameTo ? applyRename(oldName, renameTo) : oldName;
    const ops = [];
    let path = from;
    if (wanted !== oldName) {
      path = await this._freePath(dirOf(from), wanted);
      await this.adapter.move(from, path);
      ops.push({ op: 'move', from, to: path });
    }
    const entry = {
      idx,
      qpos: this.cursor,
      action: 'skip',
      tags: [],
      directions: [],
      from,
      finalPaths: [path],
      renamedFrom: path !== from ? oldName : null,
      renamedTo: path !== from ? baseOf(path) : null,
      fingerprint: null,
      ops,
      dwellMs,
      ts: Date.now(),
    };
    return this._record(entry);
  }

  /** Reverse the most recent decision and put that card back in front. */
  async undo() {
    const entry = this.entries.at(-1);
    if (!entry) return null;
    await this._reverse(entry.ops);
    this.entries.pop();
    this.cursor = entry.qpos;
    return entry;
  }

  get canUndo() {
    return this.entries.length > 0;
  }

  /** Put every currently-skipped file back in the queue for another look. */
  reviewSkipped() {
    const queued = new Set(this.queue.slice(this.cursor));
    const skipped = this.skippedIdx().filter((i) => !queued.has(i));
    this.queue.push(...skipped);
    return skipped.length;
  }

  skippedIdx() {
    const seen = new Set();
    const out = [];
    for (const idx of this.queue.slice(0, this.cursor)) {
      if (seen.has(idx)) continue;
      seen.add(idx);
      if (this.stateOf(idx)?.action === 'skip') out.push(idx);
    }
    return out;
  }

  /** Current outcome per tag: Map(tag → [{idx, item, path, entry}]) in sort order. */
  byTag() {
    const map = new Map();
    for (const d of DIRECTIONS) if (this.directions[d]) map.set(this.directions[d], []);
    const seen = new Set();
    for (const e of this.entries) seen.add(e.idx);
    for (const idx of seen) {
      const e = this.stateOf(idx);
      if (e.action !== 'tag') continue;
      e.tags.forEach((tag, i) => {
        if (!map.has(tag)) map.set(tag, []);
        map.get(tag).push({ idx, item: this.items[idx], path: e.finalPaths[i], entry: e });
      });
    }
    return map;
  }

  stats() {
    const latest = new Map();
    for (const e of this.entries) latest.set(e.idx, e);
    let sorted = 0, trashed = 0, skipped = 0, renamed = 0;
    for (const e of latest.values()) {
      if (e.action === 'skip') skipped++;
      else if (e.tags.includes(TRASH_TAG)) trashed++;
      else sorted++;
      if (e.renamedTo) renamed++;
    }
    const first = this.entries[0]?.ts;
    const last = this.entries.at(-1)?.ts;
    const elapsedMs = first ? Math.max(1000, last - first + (this.entries[0].dwellMs || 0)) : 0;
    const decided = sorted + trashed + skipped;
    return {
      sorted, trashed, skipped, renamed, decided,
      total: this.items.length,
      remaining: this.remaining,
      elapsedMs,
      perMinute: elapsedMs ? Math.round((decided / elapsedMs) * 60000) : 0,
    };
  }

  // ---- internals ----

  _record(entry) {
    this.entries.push(entry);
    this.cursor++;
    this.swipes++;
    return entry;
  }

  async _freePath(folder, name) {
    if (folder) await this.adapter.ensureFolder(folder);
    const free = await uniqueName(name, (n) => this.adapter.exists(joinPath(folder, n)));
    return joinPath(folder, free);
  }

  async _reverse(ops) {
    for (const op of [...ops].reverse()) {
      if (op.op === 'copy') {
        await this.adapter.remove(op.to).catch(() => {});
      } else if (op.op === 'move') {
        // If something else took the original name meanwhile, don't overwrite it.
        let back = op.from;
        if (await this.adapter.exists(back)) back = await this._freePath(dirOf(op.from), baseOf(op.from));
        await this.adapter.move(op.to, back);
      }
    }
  }
}

/** Folders Swipah shouldn't scan: its own meta folder, trash and tag folders. */
export function tagFolders(directions) {
  const set = new Set([TRASH_TAG, META_DIR]);
  for (const d of DIRECTIONS) if (directions[d]) set.add(directions[d]);
  return set;
}

export function sortItems(items, order) {
  if (order === 'random') {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
  } else if (order === 'newest') {
    items.sort((a, b) => b.lastModified - a.lastModified);
  } else if (order === 'oldest') {
    items.sort((a, b) => a.lastModified - b.lastModified);
  } else {
    items.sort((a, b) => naturalCompare(a.path, b.path));
  }
  return items;
}
