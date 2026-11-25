// Little pop-up messages at the top of the screen.

export function toast(message, { kind = 'brand', ms = 2600 } = {}) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast ${kind === 'brand' ? '' : kind}`;
  el.setAttribute('role', 'status');
  el.textContent = message;
  host.append(el);
  while (host.children.length > 3) host.firstElementChild.remove();
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 350);
  }, ms);
}
