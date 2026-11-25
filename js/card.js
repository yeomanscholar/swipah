// Builds the card for one file: image, GIF, video, audio player or a generic
// file card. Object URLs are tracked and revoked to keep phones from running
// out of memory on big folders.

import { kindOf, isUnrenderableImage, KIND_ICON, extOf } from './filetypes.js';
import { formatBytes } from './naming.js';

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  el.append(...kids);
  return el;
};
export { h };

/** Small cache of object URLs for the current + next couple of files. */
export class MediaCache {
  constructor(getFile, size = 4) {
    this.getFile = getFile;
    this.size = size;
    this.map = new Map(); // path → Promise<{file, url}>
    this.pinned = null; // the card on screen; never evicted (video/audio stream from its URL)
  }
  pin(path) {
    this.pinned = path;
  }
  get(path) {
    if (!this.map.has(path)) {
      this.map.set(
        path,
        this.getFile(path).then((file) => ({ file, url: URL.createObjectURL(file) })),
      );
      this._evict();
    }
    return this.map.get(path);
  }
  /** Warm up a file so the next card appears instantly. */
  preload(path, kind) {
    this.get(path)
      .then(({ url }) => {
        if (kind === 'image') new Image().src = url;
      })
      .catch(() => {});
  }
  _evict() {
    for (const key of [...this.map.keys()]) {
      if (this.map.size <= this.size) break;
      if (key !== this.pinned) this.drop(key);
    }
  }
  drop(path) {
    const p = this.map.get(path);
    this.map.delete(path);
    p?.then(({ url }) => setTimeout(() => URL.revokeObjectURL(url), 1000)).catch(() => {});
  }
  clear() {
    for (const k of [...this.map.keys()]) this.drop(k);
  }
}

function placeholder(icon, name, note) {
  return h('div', { class: 'placeholder' },
    h('div', { class: 'big', text: icon }),
    h('div', { class: 'pname', text: name }),
    note ? h('div', { class: 'small', text: note }) : '');
}

function fmtTime(s) {
  if (!isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function audioPlayer(url, name, cleanup) {
  const audio = h('audio', { src: url, preload: 'metadata' });
  const btn = h('button', { class: 'round-btn', 'data-nogesture': true, 'aria-label': 'Play', text: '▶' });
  const range = h('input', { type: 'range', min: 0, max: 1000, value: 0, 'data-nogesture': true, 'aria-label': 'Seek' });
  const time = h('span', { class: 'time', text: '0:00 / 0:00' });
  const wrap = h('div', { class: 'audio-card' },
    h('div', { class: 'disc' }),
    h('div', { class: 'aname', text: name }),
    h('div', { class: 'audio-controls' }, btn, range, time));
  const sync = () => {
    const playing = !audio.paused;
    btn.textContent = playing ? '❚❚' : '▶';
    btn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    wrap.classList.toggle('playing', playing);
  };
  btn.addEventListener('click', () => (audio.paused ? audio.play().catch(() => {}) : audio.pause()));
  audio.addEventListener('play', sync);
  audio.addEventListener('pause', sync);
  audio.addEventListener('timeupdate', () => {
    if (audio.duration) range.value = Math.round((audio.currentTime / audio.duration) * 1000);
    time.textContent = `${fmtTime(audio.currentTime)} / ${fmtTime(audio.duration)}`;
  });
  audio.addEventListener('loadedmetadata', () => (time.textContent = `0:00 / ${fmtTime(audio.duration)}`));
  range.addEventListener('input', () => {
    if (audio.duration) audio.currentTime = (range.value / 1000) * audio.duration;
  });
  wrap.append(audio);
  cleanup.push(() => {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  });
  return { el: wrap, media: audio };
}

/**
 * Render a card. Returns { el, stamp, chips, start(), destroy() }.
 * start() begins playback (videos/audio) once the card is on screen.
 */
export async function renderCard(item, cache, { path = item.path } = {}) {
  const cleanup = [];
  const mediaBox = h('div', { class: 'media' });
  const kind = item.kind || kindOf(item.name, item.mime);
  let playable = null;

  let file, url;
  cache.pin(path);
  try {
    ({ file, url } = await cache.get(path));
  } catch (e) {
    mediaBox.append(placeholder('⚠️', item.name, `Couldn’t read this file (${e.name || 'error'}). You can still skip or sort it.`));
  }

  if (url) {
    if (kind === 'image' && !isUnrenderableImage(item.name)) {
      const img = h('img', { src: url, alt: item.name, draggable: 'false', decoding: 'async' });
      img.addEventListener('error', () => img.replaceWith(placeholder(KIND_ICON.image, item.name, 'This browser can’t preview this image.')));
      mediaBox.append(img);
    } else if (kind === 'image') {
      mediaBox.append(placeholder(KIND_ICON.image, item.name, `${extOf(item.name).toUpperCase()} previews aren’t supported in this browser yet. You can still sort it.`));
    } else if (kind === 'video') {
      const v = h('video', { src: url, muted: true, loop: true, playsinline: true, preload: 'auto' });
      v.muted = true;
      v.addEventListener('error', () => v.replaceWith(placeholder(KIND_ICON.video, item.name, 'This browser can’t play this video.')));
      const unmute = h('button', { class: 'btn btn-small unmute-btn', 'data-nogesture': true, text: '🔇 Tap for sound' });
      unmute.addEventListener('click', () => {
        v.muted = !v.muted;
        unmute.textContent = v.muted ? '🔇 Tap for sound' : '🔊 Sound on';
      });
      mediaBox.append(v, unmute);
      playable = v;
      cleanup.push(() => v.pause());
    } else if (kind === 'audio') {
      const p = audioPlayer(url, item.name, cleanup);
      mediaBox.append(p.el);
      playable = p.media;
    } else {
      mediaBox.append(placeholder(KIND_ICON.other, item.name, `${formatBytes(file.size)} · ${item.mime || 'file'}`));
    }
  }

  const stamp = h('div', { class: 'stamp' });
  const chips = h('div', { class: 'tagchips' });
  const meta = h('div', { class: 'meta' },
    h('span', { text: KIND_ICON[kind] }),
    h('span', { class: 'fname', text: item.name, title: path }),
    h('span', { class: 'muted', text: file ? formatBytes(file.size) : '' }));
  const el = h('div', { class: 'card', 'data-kind': kind, tabindex: '-1' }, mediaBox, stamp, chips, meta);

  return {
    el,
    stamp,
    chips,
    start() {
      playable?.play().catch(() => {}); // autoplay may be blocked until a tap
    },
    destroy() {
      cleanup.forEach((fn) => fn());
      el.remove();
    },
  };
}
