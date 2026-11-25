// In-memory storage adapter: powers demo mode (for browsers without folder
// access, like Firefox and iPhone Safari) and the automated tests.
// Same interface as FsAccessAdapter.

import { dirOf } from '../naming.js';
import { kindOf, mimeOf } from '../filetypes.js';

export class MemoryAdapter {
  /** @param {string} name  @param {Array<File>} files (File.name may contain "a/b.png" paths) */
  constructor(name, files = []) {
    this.name = name;
    this.kind = 'memory';
    this.files = new Map(); // path → File
    this.folders = new Set(['']);
    this.capabilities = { nativeMove: true, writeLog: true, persistentHandle: false };
    for (const f of files) this._put(f.name, f);
  }

  _put(path, blob, lastModified) {
    const name = path.split('/').pop();
    const file = blob instanceof File && blob.name === name
      ? blob
      : new File([blob], name, { type: blob.type || mimeOf(name), lastModified: lastModified ?? blob.lastModified ?? Date.now() });
    this.files.set(path, file);
    let d = dirOf(path);
    while (d) {
      this.folders.add(d);
      d = dirOf(d);
    }
  }

  async verifyPermission() {
    return true;
  }

  async listItems({ recursive = false, skip = () => false } = {}) {
    const out = [];
    for (const [path, file] of this.files) {
      const name = path.split('/').pop();
      if (name.startsWith('.')) continue;
      const parts = path.split('/');
      if (parts.length > 1) {
        if (!recursive) continue;
        // Skip if any ancestor folder is hidden or skipped.
        let hidden = false;
        for (let i = 1; i < parts.length; i++) {
          const ancestor = parts.slice(0, i).join('/');
          if (parts[i - 1].startsWith('.') || skip(ancestor)) hidden = true;
        }
        if (hidden) continue;
      }
      out.push({ path, name, size: file.size, mime: mimeOf(name, file.type), lastModified: file.lastModified, kind: kindOf(name, file.type) });
    }
    return out;
  }

  async getFile(path) {
    const f = this.files.get(path);
    if (!f) throw new DOMException(`Not found: ${path}`, 'NotFoundError');
    return f;
  }

  async exists(path) {
    return this.files.has(path) || this.folders.has(path);
  }

  async ensureFolder(path) {
    this.folders.add(path);
  }

  async writeFile(path, data) {
    const blob = data instanceof Blob ? data : new Blob([data]);
    this._put(path, blob, Date.now());
  }

  async appendText(path, text) {
    const prev = this.files.get(path);
    const blob = new Blob(prev ? [prev, text] : [text], { type: 'text/plain' });
    this._put(path, blob, Date.now());
  }

  async copy(fromPath, toPath) {
    const f = await this.getFile(fromPath);
    this._put(toPath, f.slice(0, f.size, f.type), f.lastModified);
    return toPath;
  }

  async remove(path) {
    if (!this.files.delete(path)) throw new DOMException(`Not found: ${path}`, 'NotFoundError');
  }

  async move(fromPath, toPath) {
    if (fromPath === toPath) return toPath;
    const f = await this.getFile(fromPath);
    this.files.delete(fromPath);
    this._put(toPath, f.slice(0, f.size, f.type), f.lastModified);
    return toPath;
  }
}
