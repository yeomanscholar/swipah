// Presets + settings + rename history, kept in localStorage.

import { DEFAULT_PRESETS, DEFAULT_SETTINGS, DIRECTIONS } from './config.js';
import { sanitizeTag } from './naming.js';

const K = { presets: 'swipah.presets', settings: 'swipah.settings', names: 'swipah.names' };

function read(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
const write = (key, v) => localStorage.setItem(key, JSON.stringify(v));

export function loadPresets() {
  return { ...DEFAULT_PRESETS, ...read(K.presets, {}) };
}

export function savePreset(name, directions) {
  const all = read(K.presets, {});
  all[name] = cleanDirections(directions);
  write(K.presets, all);
}

export function deletePreset(name) {
  const all = read(K.presets, {});
  delete all[name];
  write(K.presets, all);
}

/** Make sure every direction has a sanitized tag ('' = unused) and tags are unique. */
export function cleanDirections(dirs) {
  const out = {};
  const seen = new Set();
  for (const d of DIRECTIONS) {
    const tag = sanitizeTag(dirs?.[d] ?? '');
    out[d] = tag && !seen.has(tag) ? tag : '';
    if (tag) seen.add(tag);
  }
  return out;
}

export function loadSettings() {
  const s = read(K.settings, {});
  return { ...DEFAULT_SETTINGS, ...s, types: { ...DEFAULT_SETTINGS.types, ...s.types } };
}

export function saveSettings(settings) {
  write(K.settings, settings);
}

/** Names typed into the rename box, newest first (feeds autocomplete). */
export function loadNameHistory() {
  return read(K.names, []);
}

export function rememberName(base) {
  if (!base) return;
  const list = loadNameHistory().filter((n) => n !== base);
  list.unshift(base);
  write(K.names, list.slice(0, 500));
}
