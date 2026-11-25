// App-wide constants. Change things here, not scattered through the code.

export const APP_VERSION = '0.1.0';

// Donation link. Placeholder until the owner sets up Ko-fi.
export const KOFI_URL = 'https://ko-fi.com/';

// Folders Swipah owns inside the folder you pick.
export const TRASH_TAG = '_trash';
export const META_DIR = '.swipah';
export const LOG_FILE = `${META_DIR}/log.jsonl`;

// Log record schema version (bump when the record shape changes).
export const LOG_SCHEMA = 1;

export const DIRECTIONS = ['left', 'right', 'up', 'down'];

export const DIRECTION_ARROWS = { left: '←', right: '→', up: '↑', down: '↓' };

// Milestone toasts. Original lines, light Boston flavor.
export const MILESTONES = {
  10: 'Ten down. Wicked good staht.',
  50: 'My boy got mad organized.',
  100: 'Hundred deep. You’re a regulah pro.',
  250: '250! Somebody call the Globe.',
  500: '500 swipes. Absolutely wicked.',
  1000: 'A thousand?! Kid, you’re a legend down the Cape.',
};

export const DEFAULT_PRESETS = {
  Memes: { left: TRASH_TAG, right: 'funny', up: 'reaction', down: 'wholesome' },
  Photos: { left: TRASH_TAG, right: 'family', up: 'vacation', down: 'keep' },
  Music: { left: TRASH_TAG, right: 'workout', up: 'chill', down: 'party' },
};

export const DEFAULT_SETTINGS = {
  preset: 'Memes',
  mode: 'single', // 'single' | 'multi'
  rename: false,
  recursive: false,
  order: 'name', // 'name' | 'newest' | 'oldest' | 'random'
  types: { image: true, video: true, audio: true, other: false },
  toasts: true,
};
