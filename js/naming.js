// Filename and folder-name helpers. Pure functions (easy to test).

import { TRASH_TAG } from './config.js';

// Characters that break on Android (SAF), Windows or in URLs.
const UNSAFE = /[\\/:*?"<>|#%\u0000-\u001f\u007f]/g;

/** Split "not-like-us.jpg" into ["not-like-us", ".jpg"]. Dotfiles keep no ext. */
export function splitExt(name) {
  const i = name.lastIndexOf('.');
  if (i <= 0) return [name, ''];
  return [name.slice(0, i), name.slice(i)];
}

/** Clean a user-typed base name: trim, spaces → hyphens, drop unsafe chars. */
export function sanitizeBaseName(input, maxLen = 80) {
  let s = String(input ?? '')
    .normalize('NFC')
    .replace(UNSAFE, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.\-]+/, '') // no hidden files, no leading hyphen
    .replace(/[.\-]+$/, '');
  if (s.length > maxLen) s = s.slice(0, maxLen).replace(/[.\-]+$/, '');
  return s;
}

/** Tag names double as folder names: lowercase + sanitized. */
export function sanitizeTag(input) {
  const raw = String(input ?? '').trim();
  if (raw.toLowerCase() === TRASH_TAG) return TRASH_TAG;
  return sanitizeBaseName(raw, 40).toLowerCase().replace(/^_+/, '');
}

/** Apply a typed rename to an existing filename, keeping its extension. */
export function applyRename(originalName, typed) {
  const base = sanitizeBaseName(typed);
  if (!base) return originalName;
  const [, ext] = splitExt(originalName);
  // If the user typed the extension themselves, don't double it.
  if (ext && base.toLowerCase().endsWith(ext.toLowerCase())) return base;
  return base + ext;
}

/** "name.jpg" → "name-1.jpg", "name-1.jpg" → "name-2.jpg" style candidates. */
export function numberedName(name, n) {
  const [base, ext] = splitExt(name);
  return `${base}-${n}${ext}`;
}

/**
 * Find a free name in a folder. `exists(name)` is async and checks the folder.
 * Never overwrites: not-like-us.jpg → not-like-us-1.jpg → not-like-us-2.jpg …
 */
export async function uniqueName(name, exists) {
  if (!(await exists(name))) return name;
  for (let n = 1; n < 10000; n++) {
    const candidate = numberedName(name, n);
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error(`No free name for ${name}`);
}

export function joinPath(...parts) {
  return parts.filter(Boolean).join('/').replace(/\/{2,}/g, '/');
}

export function dirOf(path) {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

export function baseOf(path) {
  const i = path.lastIndexOf('/');
  return i < 0 ? path : path.slice(i + 1);
}

/** Natural sort: "img2" before "img10". */
export const naturalCompare = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare;

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
