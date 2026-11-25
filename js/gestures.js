// Turns touch / mouse drags into swipe directions (Pointer Events), with
// live feedback while dragging. Taps and double-taps are reported too.
//
// onMove({dx, dy, dir, progress}) - while dragging (progress 0..1 toward commit)
// onSwipe(dir)                    - released past the threshold (or a fast flick)
// onCancel()                      - released short of the threshold
// onTap() / onDoubleTap()

const TAP_SLOP = 10; // px of movement still counted as a tap
const TAP_MS = 350;
const DOUBLE_MS = 300;
const FLICK_SPEED = 0.6; // px/ms
const FLICK_MIN = 45; // px

export function directionOf(dx, dy) {
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'up' : 'down';
}

export class SwipeTracker {
  constructor(el, handlers, { isEnabled = () => true, isDirectionEnabled = () => true } = {}) {
    this.el = el;
    this.h = handlers;
    this.isEnabled = isEnabled;
    this.isDirectionEnabled = isDirectionEnabled;
    this.start = null;
    this.lastTap = 0;
    this.tapTimer = null;
    this._down = this._down.bind(this);
    this._move = this._move.bind(this);
    this._up = this._up.bind(this);
    el.addEventListener('pointerdown', this._down);
    el.addEventListener('pointermove', this._move);
    el.addEventListener('pointerup', this._up);
    el.addEventListener('pointercancel', this._up);
    // Stop the browser's own image drag / long-press menu.
    el.addEventListener('dragstart', (e) => e.preventDefault());
    el.addEventListener('contextmenu', (e) => {
      if (e.pointerType !== 'mouse') e.preventDefault();
    });
  }

  threshold() {
    const r = this.el.parentElement.getBoundingClientRect();
    return { x: Math.max(70, r.width * 0.25), y: Math.max(70, r.height * 0.2) };
  }

  _down(e) {
    if (!this.isEnabled() || e.button > 0) return;
    if (e.target.closest('[data-nogesture]')) return; // play buttons, sliders…
    this.start = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    this.samples = [{ x: e.clientX, y: e.clientY, t: this.start.t }];
    this.el.setPointerCapture?.(e.pointerId);
  }

  _move(e) {
    if (!this.start || e.pointerId !== this.start.id) return;
    const dx = e.clientX - this.start.x;
    const dy = e.clientY - this.start.y;
    const now = performance.now();
    this.samples.push({ x: e.clientX, y: e.clientY, t: now });
    if (this.samples.length > 6) this.samples.shift();
    if (Math.hypot(dx, dy) < TAP_SLOP) return;
    const dir = directionOf(dx, dy);
    const th = this.threshold();
    const progress = Math.min(1, dir === 'left' || dir === 'right' ? Math.abs(dx) / th.x : Math.abs(dy) / th.y);
    this.h.onMove?.({ dx, dy, dir: this.isDirectionEnabled(dir) ? dir : null, progress });
  }

  _up(e) {
    if (!this.start || e.pointerId !== this.start.id) return;
    const dx = e.clientX - this.start.x;
    const dy = e.clientY - this.start.y;
    const dt = performance.now() - this.start.t;
    this.start = null;
    this.el.releasePointerCapture?.(e.pointerId);
    if (e.type === 'pointercancel') return this.h.onCancel?.();

    const dist = Math.hypot(dx, dy);
    if (dist < TAP_SLOP && dt < TAP_MS) return this._tap();

    const dir = directionOf(dx, dy);
    const th = this.threshold();
    const far = dir === 'left' || dir === 'right' ? Math.abs(dx) >= th.x : Math.abs(dy) >= th.y;
    const first = this.samples[0];
    const last = this.samples.at(-1);
    const speed = Math.hypot(last.x - first.x, last.y - first.y) / Math.max(1, last.t - first.t);
    const flick = speed > FLICK_SPEED && dist > FLICK_MIN;
    if ((far || flick) && this.isDirectionEnabled(dir)) this.h.onSwipe?.(dir);
    else this.h.onCancel?.();
  }

  _tap() {
    const now = performance.now();
    if (this.h.onDoubleTap && now - this.lastTap < DOUBLE_MS) {
      clearTimeout(this.tapTimer);
      this.lastTap = 0;
      return this.h.onDoubleTap();
    }
    this.lastTap = now;
    if (this.h.onDoubleTap) {
      // Wait to see whether a second tap follows.
      this.tapTimer = setTimeout(() => this.h.onTap?.(), DOUBLE_MS);
    } else {
      this.h.onTap?.();
    }
  }
}
