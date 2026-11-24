// Removed from a session (Teacher menu › Players › Remove, pressed twice).
// The removed headset remembers it for 12 hours and will not join that session code again (the lesson opens
// on its own instead, and the join box on the lessons page says why). Everyone else stops listening to that
// headset too (Presence.block), even if it does not leave. Clearing the browser's data forgets it: removal
// keeps a class orderly, it is not a lock.

const KEY = 'webxr-classes:removed';
const FOR_MS = 12 * 3600 * 1000;

function list() {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || '{}');
    return Object.fromEntries(Object.entries(all).filter(([, t]) => typeof t === 'number' && Date.now() - t < FOR_MS));
  } catch {
    return {};
  }
}

/** Was this headset removed from this session code (in the last 12 hours)? */
export function wasRemoved(code) {
  return !!list()[code];
}

/** This headset has been removed from this session code. */
export function markRemoved(code) {
  const all = list();
  all[code] = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* not remembered */ }
}
