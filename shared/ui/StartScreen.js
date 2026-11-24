// The lesson start screen's top row and behaviour, shared by every lesson (styles in shared/ui/start.css):
// back to the lessons, light/dark theme (shared with the lessons page), fold the box away to explore,
// and the lesson's picture coming alive.
const THEME_KEY = 'webxr-classes:theme';

const SUN = '<svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = '<svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
const FOLD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12"/></svg>';
const UNFOLD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12M12 6v12"/></svg>';

/** Set up the start screen inside #overlay. Returns the overlay (or null when the page has none). */
export function initStartScreen(lessonsURL) {
  const overlay = document.getElementById('overlay');
  if (!overlay) return null;
  if (overlay.querySelector('.start-top')) return overlay;

  const top = document.createElement('div');
  top.className = 'start-top';
  top.innerHTML = `<a class="back-link" href="${lessonsURL}">← All Prototypes</a>
    <button type="button" class="icon" id="btn-theme" aria-label="Switch light or dark">${SUN}${MOON}</button>
    <button type="button" class="icon" id="btn-fold" aria-label="Fold the start box away" aria-expanded="true">${FOLD}</button>`;
  overlay.prepend(top);

  top.querySelector('#btn-theme').onclick = () => {
    const root = document.documentElement;
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch {}
  };
  const fold = top.querySelector('#btn-fold');
  fold.onclick = () => setMini(!overlay.classList.contains('mini'));

  // "Explore on screen": fold the box away so the lesson behind it can be seen
  const buttons = overlay.querySelector('.buttons');
  if (buttons && !buttons.querySelector('#btn-screen')) {
    const screen = document.createElement('button');
    screen.type = 'button';
    screen.id = 'btn-screen';
    screen.className = 'secondary';
    screen.textContent = 'Explore on Screen';
    screen.onclick = () => setMini(true);
    buttons.appendChild(screen);
  }

  // the picture: the still shows at once, the moving loop takes over once it has loaded
  const img = overlay.querySelector('.shot img');
  const motionOK = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (img?.dataset.loop && motionOK) {
    const loop = new Image();
    loop.onload = () => { img.src = loop.src; };
    loop.src = img.dataset.loop;
  }
  if (img) img.onerror = () => img.closest('.shot')?.remove();

  function setMini(on) {
    overlay.classList.toggle('mini', on);
    fold.innerHTML = on ? UNFOLD : FOLD;
    fold.setAttribute('aria-expanded', String(!on));
    fold.setAttribute('aria-label', on ? 'Show the start box' : 'Fold the start box away');
  }
  overlay.setMini = setMini;
  return overlay;
}
