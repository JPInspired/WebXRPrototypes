// The teacher's key: only the real teacher's headset can run the class (Teacher menu: pause, lock, remove…).
//
// Before this, a headset simply said "I am the teacher" when it joined, so a student could add host=1 to the
// address and take over. Now:
//  • The teacher's headset makes a secret key pair when it starts a session (kept on that device, for that
//    session code). Its public half has a short fingerprint.
//  • When it meets another headset it signs its own connection id with the secret half. A copied signature
//    is useless: it only matches the teacher's own connection.
//  • Students know which fingerprint to trust: it comes with the code (the lessons page asks the teacher's
//    lesson) or the teacher's shared link (&teacher=…). Otherwise a headset trusts the fingerprint most
//    headsets in the session already trust, and keeps it for the session.
// Uses the browser's own cryptography (WebCrypto, ECDSA P-256). Nothing is sent to any server.

const ALG = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN = { name: 'ECDSA', hash: 'SHA-256' };
const KEYS = 'webxr-classes:teacher-keys'; // { code: { pub, priv, at } } on the teacher's device
const PINS = 'webxr-classes:teacher-pin'; // { code: fingerprint } on students' devices (this tab)
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const FP_RE = /^[0-9a-f]{20}$/;
const subtle = () => globalThis.crypto?.subtle ?? null;

/** Can this browser check teachers' keys? (Needs a secure page: https, or localhost.) */
export const keysSupported = () => !!subtle();

const read = (store, key) => {
  try { return JSON.parse(store.getItem(key) || '{}'); } catch { return {}; }
};
const write = (store, key, v) => {
  try { store.setItem(key, JSON.stringify(v)); } catch { /* not remembered: fine */ }
};

async function fingerprintOf(rawPub) {
  return hex(await subtle().digest('SHA-256', rawPub)).slice(0, 20);
}

/**
 * The teacher's key pair for this session code: the same one after a reload or a reconnection (kept on
 * this device for a few sessions), a new one for a new session.
 */
export async function teacherKey(code) {
  if (!subtle()) return null;
  const all = read(localStorage, KEYS);
  let rec = all[code];
  let priv, rawPub;
  if (rec) {
    try {
      priv = await subtle().importKey('jwk', rec.priv, ALG, false, ['sign']);
      rawPub = unb64(rec.pub);
    } catch { rec = null; }
  }
  if (!rec) {
    const pair = await subtle().generateKey(ALG, true, ['sign', 'verify']);
    rawPub = new Uint8Array(await subtle().exportKey('raw', pair.publicKey));
    const jwk = await subtle().exportKey('jwk', pair.privateKey);
    priv = await subtle().importKey('jwk', jwk, ALG, false, ['sign']);
    all[code] = { pub: b64(rawPub), priv: jwk, at: Date.now() };
    // keep only the latest few sessions' keys
    const recent = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, 6);
    write(localStorage, KEYS, Object.fromEntries(recent));
  }
  return { priv, pub: b64(rawPub), fp: await fingerprintOf(rawPub) };
}

/** The teacher's proof for one connection: { pub, sig } (sig signs "code|connection id"). */
export async function prove(key, code, selfId) {
  const sig = await subtle().sign(SIGN, key.priv, enc.encode(`${code}|${selfId}`));
  return { pub: key.pub, sig: b64(sig) };
}

/** Check another headset's proof. Resolves its fingerprint if the proof is good for that connection, else null. */
export async function check(proof, code, peerId) {
  if (!subtle() || !proof || typeof proof.pub !== 'string' || typeof proof.sig !== 'string') return null;
  if (proof.pub.length > 200 || proof.sig.length > 200) return null;
  try {
    const raw = unb64(proof.pub);
    const pub = await subtle().importKey('raw', raw, ALG, false, ['verify']);
    const ok = await subtle().verify(SIGN, pub, unb64(proof.sig), enc.encode(`${code}|${peerId}`));
    return ok ? fingerprintOf(raw) : null;
  } catch {
    return null;
  }
}

/** The fingerprint this tab trusts for a session code (from the code, the link, or chosen earlier). */
export function pinned(code) {
  return read(sessionStorage, PINS)[code] ?? null;
}

export function pin(code, fp) {
  if (!FP_RE.test(fp)) return;
  const all = read(sessionStorage, PINS);
  all[code] = fp;
  write(sessionStorage, PINS, all);
}
