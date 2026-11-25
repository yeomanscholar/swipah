// Decide what kind of card a file gets, from its extension (MIME types from
// Android's folder picker are often empty, so extensions are more reliable).

const EXT = {
  image: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp', 'svg', 'heic', 'heif', 'jfif'],
  video: ['mp4', 'webm', 'mov', 'm4v', 'mkv', 'ogv', '3gp'],
  audio: ['mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'flac', 'weba'],
};

const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml',
  heic: 'image/heic', heif: 'image/heif',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4',
  mkv: 'video/x-matroska', ogv: 'video/ogg', '3gp': 'video/3gpp',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg',
  opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac', weba: 'audio/webm',
  txt: 'text/plain', pdf: 'application/pdf', json: 'application/json',
};

export function extOf(name) {
  const i = name.lastIndexOf('.');
  return i <= 0 ? '' : name.slice(i + 1).toLowerCase();
}

/** 'image' | 'video' | 'audio' | 'other' */
export function kindOf(name, mime = '') {
  const ext = extOf(name);
  for (const [kind, list] of Object.entries(EXT)) if (list.includes(ext)) return kind;
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'other';
}

export function mimeOf(name, fallback = '') {
  return fallback || MIME[extOf(name)] || 'application/octet-stream';
}

/** Chrome can't decode HEIC; show a placeholder card instead of a broken image. */
export function isUnrenderableImage(name) {
  return ['heic', 'heif'].includes(extOf(name));
}

export const KIND_ICON = { image: '🖼️', video: '🎬', audio: '🎵', other: '📄' };
