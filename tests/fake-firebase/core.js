// Browser-side stand-in for the Firebase app/auth/firestore modules, backed by
// tests/fake-firebase/server.mjs. Implements only what the platform pages use.
const LS_KEY = "fakeFirebaseUser";
const err = (code, message) => Object.assign(new Error(message || code), { code, name: "FirebaseError" });

// ------------------------------------------------------------------ app
export function initializeApp(config) { return { options: config }; }

// ------------------------------------------------------------------ auth
const listeners = new Set();
function readUser() { try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch { return null; } }
function toUser(u) { return u && { uid: "fake-" + u.email, email: u.email, emailVerified: !!u.verified, displayName: u.name || null, photoURL: null }; }
const authObj = { get currentUser() { return toUser(readUser()); } };
export function getAuth() { return authObj; }
export function connectAuthEmulator() {}
export class GoogleAuthProvider {
  setCustomParameters(p) { this.params = p; }
  static credential(idToken) { return { idToken }; }
}
function setUser(u) {
  if (u) localStorage.setItem(LS_KEY, JSON.stringify(u)); else localStorage.removeItem(LS_KEY);
  const user = toUser(u);
  listeners.forEach((l) => setTimeout(() => l(user), 0));
  return user;
}
export async function signInWithCredential(_auth, cred) {
  const t = JSON.parse(cred.idToken);
  return { user: setUser({ email: t.email, verified: t.email_verified !== false, name: t.name }) };
}
export async function signInWithPopup() { throw err("auth/popup-closed-by-user"); }
export async function signOut() { setUser(null); }
export function onAuthStateChanged(_auth, cb) {
  listeners.add(cb);
  setTimeout(() => { if (listeners.has(cb)) cb(authObj.currentUser); }, 0);
  return () => listeners.delete(cb);
}

// ------------------------------------------------------------------ firestore
const DELETE = { __delete__: true };
export function initializeFirestore() { return { type: "firestore" }; }
export function getFirestore() { return { type: "firestore" }; }
export function connectFirestoreEmulator() {}
const join = (parts) => parts.join("/").split("/").filter(Boolean).join("/");
export function doc(_db, ...parts) { const path = join(parts); return { type: "doc", path, id: path.split("/").at(-1) }; }
export function collection(_db, ...parts) { const path = join(parts); return { type: "collection", path, id: path.split("/").at(-1) }; }
export function orderBy(field, dir = "asc") { return { kind: "orderBy", field, dir }; }
export function limit(n) { return { kind: "limit", n }; }
export function query(c, ...constraints) { return { type: "query", path: c.path, constraints: (c.constraints || []).concat(constraints) }; }
export function deleteField() { return DELETE; }

function headers() { const u = readUser(); return { "content-type": "application/json", ...(u ? { "x-fake-user": JSON.stringify(u) } : {}) }; }
async function call(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: headers() });
  const body = await r.json();
  if (!r.ok) throw err(body.code || "unknown", body.message);
  return body;
}
const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
function docSnap(ref, res) { const data = clone(res.data); return { id: ref.id, ref, exists: () => res.exists, data: () => (res.exists ? clone(data) : undefined) }; }
function querySnap(target, res) {
  let docs = res.docs.slice();
  for (const c of target.constraints || []) {
    if (c.kind === "orderBy") docs.sort((a, b) => { const x = a.data[c.field], y = b.data[c.field]; const r = x == null ? 1 : y == null ? -1 : x < y ? -1 : x > y ? 1 : 0; return c.dir === "desc" ? -r : r; });
    if (c.kind === "limit") docs = docs.slice(0, c.n);
  }
  const wrapped = docs.map((d) => ({ id: d.id, ref: doc(null, target.path, d.id), data: () => clone(d.data), exists: () => true }));
  return { docs: wrapped, size: wrapped.length, empty: !wrapped.length, forEach: (fn) => wrapped.forEach(fn) };
}
export async function getDoc(ref) { return docSnap(ref, await call("/__fake/doc?path=" + encodeURIComponent(ref.path))); }
export async function getDocs(q) { return querySnap(q, await call("/__fake/list?path=" + encodeURIComponent(q.path))); }
// Like real Firestore's latency compensation: listeners see a write before its promise resolves.
const activeListeners = new Set();
const write = async (ops) => {
  await call("/__fake/write", { method: "POST", body: JSON.stringify(ops) });
  await Promise.all([...activeListeners].map((f) => f()));
};
export async function setDoc(ref, data, opts) { await write([{ op: "set", path: ref.path, data, merge: !!(opts && opts.merge) }]); }
export async function updateDoc(ref, data) { await write([{ op: "update", path: ref.path, data }]); }
export async function deleteDoc(ref) { await write([{ op: "delete", path: ref.path }]); }
export function writeBatch() {
  const ops = [];
  return {
    set(ref, data, opts) { ops.push({ op: "set", path: ref.path, data, merge: !!(opts && opts.merge) }); return this; },
    update(ref, data) { ops.push({ op: "update", path: ref.path, data }); return this; },
    delete(ref) { ops.push({ op: "delete", path: ref.path }); return this; },
    commit() { return write(ops); },
  };
}
// Snapshot listeners: poll the server's change counter and refetch when it moves.
export function onSnapshot(target, next, onError) {
  let stopped = false, lastVersion = -1, lastJson = null;
  const fetchOnce = async () => {
    try {
      const snap = target.type === "doc" ? await getDoc(target) : await getDocs(target);
      const json = JSON.stringify(target.type === "doc" ? [snap.exists(), snap.data()] : snap.docs.map((d) => [d.id, d.data()]));
      if (!stopped && json !== lastJson) { lastJson = json; next(snap); }
    } catch (e) { if (!stopped && onError) onError(e); stopped = true; }
  };
  const tick = async () => {
    if (stopped) return;
    try { const { version } = await call("/__fake/version"); if (version !== lastVersion) { lastVersion = version; await fetchOnce(); } } catch {}
    if (!stopped) setTimeout(tick, 150);
  };
  activeListeners.add(fetchOnce);
  tick();
  return () => { stopped = true; activeListeners.delete(fetchOnce); };
}
