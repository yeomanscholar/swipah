// Storage adapter for real folders via the File System Access API
// (Chrome/Edge desktop, Chrome for Android). Also works on the browser's
// private storage (OPFS), which the tests and test.html use.
//
// The rest of the app never touches handles directly. Everything goes through
// this interface, so later phases can swap in a native Android/iOS adapter:
//   listItems, getFile, exists, ensureFolder, move, copy, remove,
//   appendText, writeFile, capabilities, name

import { joinPath, dirOf, baseOf } from '../naming.js';
import { kindOf, mimeOf } from '../filetypes.js';

export class FsAccessAdapter {
  /** @param {FileSystemDirectoryHandle} root */
  constructor(root) {
    this.root = root;
    this.name = root.name || 'folder';
    this.kind = 'fs-access';
    this.capabilities = {
      // Native move() isn't everywhere (and can fail on some Android
      // providers), so move() below falls back to copy + delete.
      nativeMove: typeof FileSystemFileHandle !== 'undefined' && 'move' in FileSystemFileHandle.prototype,
      writeLog: true,
      persistentHandle: true,
    };
  }

  static isSupported() {
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  }

  /** Ask the user for a folder (needs a user gesture). */
  static async pick() {
    const handle = await window.showDirectoryPicker({ id: 'swipah', mode: 'readwrite' });
    return new FsAccessAdapter(handle);
  }

  /** Make sure we can still read+write (after a reload, permission may lapse). */
  async verifyPermission({ prompt = true } = {}) {
    const opts = { mode: 'readwrite' };
    if (!this.root.queryPermission) return true; // OPFS has no permission prompts
    if ((await this.root.queryPermission(opts)) === 'granted') return true;
    if (prompt && (await this.root.requestPermission(opts)) === 'granted') return true;
    return false;
  }

  async _dir(path, create = false) {
    let dir = this.root;
    if (!path) return dir;
    for (const part of path.split('/').filter(Boolean)) {
      dir = await dir.getDirectoryHandle(part, { create });
    }
    return dir;
  }

  async _fileHandle(path, create = false) {
    const dir = await this._dir(dirOf(path), create);
    return dir.getFileHandle(baseOf(path), { create });
  }

  /**
   * List files. `skip(dirPath)` returns true for folders to ignore.
   * `onProgress(count)` is called while scanning big folders.
   */
  async listItems({ recursive = false, skip = () => false, onProgress } = {}) {
    const out = [];
    const walk = async (dir, prefix) => {
      for await (const [name, handle] of dir.entries()) {
        const path = joinPath(prefix, name);
        if (handle.kind === 'directory') {
          if (recursive && !name.startsWith('.') && !skip(path)) await walk(handle, path);
          continue;
        }
        if (name.startsWith('.')) continue; // hidden files (.nomedia, .trashed-…)
        try {
          const file = await handle.getFile();
          out.push({
            path,
            name,
            size: file.size,
            mime: mimeOf(name, file.type),
            lastModified: file.lastModified,
            kind: kindOf(name, file.type),
          });
        } catch {
          // Unreadable entry (pending download, permission quirk). Skip it.
        }
        if (onProgress && out.length % 25 === 0) onProgress(out.length);
      }
    };
    await walk(this.root, '');
    return out;
  }

  async getFile(path) {
    return (await this._fileHandle(path)).getFile();
  }

  async exists(path) {
    try {
      const dir = await this._dir(dirOf(path));
      const name = baseOf(path);
      try {
        await dir.getFileHandle(name);
        return true;
      } catch (e) {
        if (e.name === 'TypeMismatchError') return true; // a folder has that name
        return false;
      }
    } catch {
      return false;
    }
  }

  async ensureFolder(path) {
    await this._dir(path, true);
  }

  /** Write a Blob/string to a path (creating folders), replacing contents. */
  async writeFile(path, data) {
    const fh = await this._fileHandle(path, true);
    const w = await fh.createWritable();
    await w.write(data);
    await w.close();
  }

  /** Append text to a file (creates it). Used for the .swipah/log.jsonl tag log. */
  async appendText(path, text) {
    const fh = await this._fileHandle(path, true);
    const size = (await fh.getFile()).size;
    const w = await fh.createWritable({ keepExistingData: true });
    await w.seek(size);
    await w.write(text);
    await w.close();
  }

  async copy(fromPath, toPath) {
    const file = await this.getFile(fromPath);
    await this.writeFile(toPath, file);
    return toPath;
  }

  async remove(path) {
    const dir = await this._dir(dirOf(path));
    await dir.removeEntry(baseOf(path));
  }

  /**
   * Move/rename a file. Caller picks a free destination name first.
   * Tries native move(); falls back to copy + delete and records which ran.
   */
  async move(fromPath, toPath) {
    if (fromPath === toPath) return toPath;
    if (this.capabilities.nativeMove) {
      try {
        const fh = await this._fileHandle(fromPath);
        const destDir = await this._dir(dirOf(toPath), true);
        await fh.move(destDir, baseOf(toPath));
        this.lastMoveMethod = 'native';
        return toPath;
      } catch (e) {
        // Some providers refuse native moves; copy + delete works there.
        this.lastMoveError = e;
      }
    }
    await this.copy(fromPath, toPath);
    // Only delete the original once the copy is verified to have the same size.
    const [a, b] = await Promise.all([this.getFile(fromPath), this.getFile(toPath)]);
    if (a.size !== b.size) {
      await this.remove(toPath).catch(() => {});
      throw new Error(`Copy of ${fromPath} came out the wrong size. Original kept.`);
    }
    await this.remove(fromPath);
    this.lastMoveMethod = 'copy+delete';
    return toPath;
  }
}
