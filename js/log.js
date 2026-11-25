// The tag log: one JSON object per line in <folder>/.swipah/log.jsonl, mirrored
// to IndexedDB. Built from day one so Phase 3 (AI learns your tagging and
// naming) has history to learn from. See docs/SPEC.md §4.12.

import { APP_VERSION, LOG_FILE, LOG_SCHEMA } from './config.js';
import { logStore } from './store.js';

const BIG = 8 * 1024 * 1024;
const EDGE = 4 * 1024 * 1024;

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Content fingerprint, so the same file is recognized after renames/moves.
 * Big files (videos) hash first 4 MB + last 4 MB + size to stay fast on phones.
 */
export async function fingerprint(file) {
  if (!crypto?.subtle) return null; // needs HTTPS (or localhost)
  if (file.size <= BIG) {
    return `sha256:${hex(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))}`;
  }
  const head = await file.slice(0, EDGE).arrayBuffer();
  const tail = await file.slice(file.size - EDGE).arrayBuffer();
  const size = new TextEncoder().encode(String(file.size));
  const joined = new Uint8Array(head.byteLength + tail.byteLength + size.byteLength);
  joined.set(new Uint8Array(head), 0);
  joined.set(new Uint8Array(tail), head.byteLength);
  joined.set(size, head.byteLength + tail.byteLength);
  return `sha256p:${hex(await crypto.subtle.digest('SHA-256', joined))}`;
}

export function newId() {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Buffers records and flushes them to the folder's log file + IndexedDB.
 * Writes are batched because each file write is slow-ish on Android.
 */
export class TagLog {
  constructor(adapter, sessionId) {
    this.adapter = adapter;
    this.sessionId = sessionId;
    this.pending = [];
    this.flushing = null;
    this.fileWritesOk = adapter.capabilities.writeLog;
    this.timer = setInterval(() => this.flush(), 3000);
  }

  sessionStart({ folderName, directions, mode, resumed = false }) {
    this.add({
      type: 'session_start',
      started_at: new Date().toISOString(),
      app_version: APP_VERSION,
      folder_name: folderName,
      preset: directions,
      dismiss_mode: mode,
      resumed,
    });
  }

  add(record) {
    this.pending.push({ schema: LOG_SCHEMA, session_id: this.sessionId, ts: new Date().toISOString(), ...record });
    // Write soon (not on a slow timer) so closing the tab doesn't lose swipes.
    clearTimeout(this.soon);
    this.soon = setTimeout(() => this.flush(), 250);
  }

  async flush() {
    if (this.flushing) {
      // A write is in progress; queue another pass for anything added since.
      await this.flushing;
      return this.flush();
    }
    if (!this.pending.length) return;
    const batch = this.pending.splice(0);
    this.flushing = (async () => {
      try {
        await logStore.addMany(batch);
      } catch (e) {
        console.warn('IndexedDB log write failed', e);
      }
      if (this.fileWritesOk) {
        try {
          await this.adapter.appendText(LOG_FILE, batch.map((r) => JSON.stringify(r)).join('\n') + '\n');
        } catch (e) {
          // Keep going: IndexedDB still has it and it's downloadable from the recap.
          console.warn('Log file write failed; log kept in browser storage only', e);
          this.fileWritesOk = false;
        }
      }
    })();
    try {
      await this.flushing;
    } finally {
      this.flushing = null;
    }
  }

  stop() {
    clearInterval(this.timer);
    clearTimeout(this.soon);
    return this.flush();
  }
}
