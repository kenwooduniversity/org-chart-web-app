// In-memory stand-in for Firestore used by the offline browser test (e2e.mjs with FAKE=1).
// The real security rules are tested against Google's emulator in rules.test.mjs; this
// mirrors the same access logic in JS so the UI's permission paths are exercised too.
const OWNERS = ['connect@kenwoodusa.org'];
const store = new Map(); // "coll/id/sub/id" -> data
let version = 0;

const isDelete = (v) => v && typeof v === 'object' && v.__delete__ === true;
function deepMerge(target, src) {
  const out = { ...(target || {}) };
  for (const [k, v] of Object.entries(src)) {
    if (isDelete(v)) delete out[k];
    else if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) out[k] = deepMerge(out[k], v);
    else if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = deepMerge({}, v);
    else out[k] = v;
  }
  return out;
}
function applyUpdate(doc, data) {
  const out = structuredClone(doc);
  for (const [k, v] of Object.entries(data)) {
    const parts = k.split('.');
    let o = out;
    for (let i = 0; i < parts.length - 1; i++) { o[parts[i]] = o[parts[i]] && typeof o[parts[i]] === 'object' ? o[parts[i]] : {}; o = o[parts[i]]; }
    if (isDelete(v)) delete o[parts.at(-1)]; else o[parts.at(-1)] = v;
  }
  return out;
}

// ---------- access mirror of firestore.rules
function access(user) {
  const email = (user?.email || '').toLowerCase();
  const kenwood = !!user && user.verified && /^[^@]+@kenwoodusa\.org$/.test(email);
  const member = store.get('members/' + email);
  const disabled = !!member?.disabled;
  const active = kenwood && !disabled;
  const padmin = active && (OWNERS.includes(email) || !!member?.platformAdmin);
  const roleIn = (m) => padmin ? 'admin' : (member?.roles?.[m] ?? store.get('modules/' + m)?.defaultRole ?? 'none');
  return { email, kenwood, active, padmin,
    canRead: (m) => active && ['viewer', 'editor', 'admin'].includes(roleIn(m)),
    canWrite: (m) => active && ['editor', 'admin'].includes(roleIn(m)) };
}
const PROFILE = ['email', 'displayName', 'photoURL', 'lastSignInAt'];
function allowed(user, op, path, newData, oldData) {
  const a = access(user), seg = path.split('/');
  if (seg[0] === 'members') {
    if (op === 'read') return a.kenwood && (seg[1] === a.email || a.padmin);
    if (a.padmin) return true;
    if (op === 'delete' || !a.kenwood || seg[1] !== a.email) return false;
    const changed = oldData ? Object.keys({ ...oldData, ...newData }).filter((k) => JSON.stringify(oldData[k]) !== JSON.stringify(newData[k])) : Object.keys(newData);
    return changed.every((k) => PROFILE.includes(k));
  }
  if (seg[0] === 'modules' || seg[0] === 'divisions') return op === 'read' ? a.active : a.padmin;
  if (seg[0] === 'orgchart') {
    if (op === 'read') return a.canRead('orgchart');
    if (!a.canWrite('orgchart')) return false;
    if (seg.length === 2) return true;
    if (!['positions', 'people', 'departments', 'versions', 'headshots'].includes(seg[2])) return false;
    if (seg[2] === 'headshots' && op !== 'delete') return typeof newData?.dataUrl === 'string' && newData.dataUrl.length < 400000;
    return true;
  }
  return false;
}

function children(collPath) {
  const depth = collPath.split('/').length + 1, out = [];
  for (const [k, v] of store) if (k.startsWith(collPath + '/') && k.split('/').length === depth) out.push({ id: k.split('/').at(-1), data: v });
  return out;
}

export function reset() { store.clear(); version++; }

/** Handles /__fake/* requests. Returns true if handled. */
export async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith('/__fake/')) return false;
  const user = req.headers['x-fake-user'] ? JSON.parse(req.headers['x-fake-user']) : null;
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const denied = () => send(403, { code: 'permission-denied' });
  try {
    if (url.pathname === '/__fake/version') return send(200, { version }), true;
    if (url.pathname === '/__fake/doc') {
      const p = url.searchParams.get('path');
      if (!allowed(user, 'read', p)) return denied(), true;
      return send(200, { exists: store.has(p), data: store.get(p) ?? null }), true;
    }
    if (url.pathname === '/__fake/list') {
      const p = url.searchParams.get('path');
      if (!allowed(user, 'read', p + '/x')) return denied(), true;
      return send(200, { docs: children(p) }), true;
    }
    if (url.pathname === '/__fake/write' && req.method === 'POST') {
      let body = ''; for await (const c of req) body += c;
      const ops = JSON.parse(body);
      const staged = new Map(store);
      for (const op of ops) {
        const old = staged.get(op.path);
        let next;
        if (op.op === 'delete') next = undefined;
        else if (op.op === 'update') { if (!old) return send(404, { code: 'not-found' }), true; next = applyUpdate(old, op.data); }
        else next = op.merge ? deepMerge(old, op.data) : deepMerge({}, op.data);
        if (!allowed(user, op.op === 'delete' ? 'delete' : 'write', op.path, next, old)) return denied(), true;
        if (next === undefined) staged.delete(op.path); else staged.set(op.path, next);
      }
      store.clear(); for (const [k, v] of staged) store.set(k, v);
      version++;
      return send(200, { ok: true }), true;
    }
    if (url.pathname === '/__fake/reset') { reset(); return send(200, { ok: true }), true; }
    send(404, { code: 'not-found' }); return true;
  } catch (e) { send(500, { code: 'internal', message: String(e) }); return true; }
}
