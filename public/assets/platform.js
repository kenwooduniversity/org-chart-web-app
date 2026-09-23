// Kenwood internal platform — shared shell used by every page/module.
//
// One Firebase project, one sign-in, one Firestore database. Each page calls
// startPage({ moduleId }) which: signs the person in with Google (Kenwood accounts
// only), loads their per-module role, draws the shared top bar, and returns a
// context object. Access is ENFORCED by firestore.rules; the role here only
// decides what the UI shows.

const SDK = "12.19.0";
const { initializeApp } = await import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-app.js`);
const fbAuth = await import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-auth.js`);
const fs = await import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-firestore.js`);

export const firebaseConfig = {
  apiKey: "AIzaSyAyM4MyGpB89vY1vNFMWy8Kc8IVb-Utd6Q",
  authDomain: "kenwood-platform.firebaseapp.com",
  projectId: "kenwood-platform",
  storageBucket: "kenwood-platform.firebasestorage.app",
  messagingSenderId: "1053166770197",
  appId: "1:1053166770197:web:81dc03f96383b873f0161c",
};

export const ALLOWED_DOMAIN = "kenwoodusa.org";
// Keep in sync with owners() in firestore.rules.
export const OWNERS = ["connect@kenwoodusa.org"];
export const ROLES = ["none", "viewer", "editor", "admin"];
export const ROLE_LABELS = { none: "No access", viewer: "Viewer", editor: "Editor", admin: "Admin" };

// Site root (works at "/" on Firebase Hosting and at "/org-chart-web-app/" on GitHub Pages).
export const siteRoot = new URL("../", import.meta.url);

const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
export const usingEmulators = isLocal && new URLSearchParams(location.search).get("live") !== "1";

export const app = initializeApp(firebaseConfig);
export const auth = fbAuth.getAuth(app);
export const db = fs.initializeFirestore(app, { ignoreUndefinedProperties: true });
export { fs, fbAuth };

if (usingEmulators) {
  fbAuth.connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  fs.connectFirestoreEmulator(db, "127.0.0.1", 8080);
  // Test hook (emulator only): sign in as any Google identity without a popup.
  window.__kenwoodTestSignIn = (email, verified = true) =>
    fbAuth.signInWithCredential(auth, fbAuth.GoogleAuthProvider.credential(
      JSON.stringify({ sub: "test-" + email, email, email_verified: verified, name: email.split("@")[0] })));
}

// ---------------------------------------------------------------- helpers
export function esc(s) {
  return (s == null ? "" : String(s)).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
export function normEmail(e) { return (e || "").trim().toLowerCase(); }
export function isKenwoodEmail(e) { return /^[^@\s]+@kenwoodusa\.org$/.test(normEmail(e)); }
export function rank(role) { return Math.max(0, ROLES.indexOf(role || "none")); }

/** Mirrors roleIn() in firestore.rules. */
export function roleFor(moduleId, ctx) {
  if (ctx.isPlatformAdmin) return "admin";
  const explicit = ctx.member && ctx.member.roles && ctx.member.roles[moduleId];
  if (explicit) return explicit;
  const mod = ctx.modules && ctx.modules[moduleId];
  return (mod && mod.defaultRole) || "none";
}

// ---------------------------------------------------------------- seed data
// Written once, by an owner, the first time the platform is opened on a fresh project.
export const DEFAULT_MODULES = {
  orgchart: {
    name: "Org Chart", icon: "🗂️", path: "orgchart/", status: "live", order: 10, defaultRole: "viewer",
    description: "Positions, reporting lines, people and departments across Kenwood.",
  },
  mentoring: {
    name: "Mentee Software", icon: "🤝", path: null, status: "planned", order: 20, defaultRole: "none",
    description: "Mentor and mentee tools. Coming next.",
  },
  tracker: {
    name: "Milestones & Projects", icon: "📈", path: null, status: "planned", order: 30, defaultRole: "none",
    description: "Org milestones → division projects → tasks → subtasks, with progress roll-up.",
  },
};
// Kenwood's business functions, as organized in Notion. Shared by every module.
export const DEFAULT_DIVISIONS = [
  ["mentorship", "Mentorship"], ["accounting", "Accounting"], ["project-management", "Project Management"],
  ["real-estate", "Real Estate"], ["marketing", "Marketing"], ["experiential-learning", "Experiential Learning"],
  ["operations", "Operations"], ["outreach-crm", "Outreach (CRM)"], ["human-resources", "Human Resources"],
  ["kpi", "KPI"], ["grants", "Grants"],
];

async function seedIfEmpty(ctx) {
  if (!ctx.isPlatformAdmin || Object.keys(ctx.modules).length) return;
  const batch = fs.writeBatch(db);
  const now = Date.now();
  for (const [id, m] of Object.entries(DEFAULT_MODULES)) batch.set(fs.doc(db, "modules", id), { ...m, createdAt: now });
  DEFAULT_DIVISIONS.forEach(([id, name], i) => batch.set(fs.doc(db, "divisions", id), { name, order: (i + 1) * 10, createdAt: now }));
  await batch.commit();
  ctx.modules = await loadModules();
}

export async function loadModules() {
  const snap = await fs.getDocs(fs.collection(db, "modules"));
  const out = {};
  snap.forEach((d) => { out[d.id] = { id: d.id, ...d.data() }; });
  return out;
}

// ---------------------------------------------------------------- gate UI
const GOOGLE_G = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

function gate(html) {
  let el = document.getElementById("k-gate");
  if (!el) { el = document.createElement("div"); el.id = "k-gate"; el.className = "k-gate"; document.body.appendChild(el); }
  el.innerHTML = '<div class="k-card">' + html + "</div>";
  return el;
}
function removeGate() { const el = document.getElementById("k-gate"); if (el) el.remove(); }
function showLoading(msg) { gate('<div class="k-spin"></div><p style="margin:14px 0 0;">' + esc(msg || "Loading…") + "</p>"); }

function showSignIn(errorMsg) {
  return new Promise((resolveOnce) => {
    // Resolve on the button's popup result OR any other sign-in (another tab, test hook).
    let done = false, off = null;
    const resolve = (u) => { if (done || !u) return; done = true; if (off) off(); resolveOnce(u); };
    off = fbAuth.onAuthStateChanged(auth, resolve);
    const el = gate(
      '<div class="k-logo">K</div><h1>Kenwood internal platform</h1>' +
      "<p>Sign in with your Kenwood Google account (@" + ALLOWED_DOMAIN + ").</p>" +
      '<button class="k-google" id="k-signin">' + GOOGLE_G + "Sign in with Google</button>" +
      '<div class="k-err" id="k-err">' + esc(errorMsg || "") + "</div>" +
      '<div class="k-fine">Only @' + ALLOWED_DOMAIN + " accounts can open this site.</div>");
    el.querySelector("#k-signin").addEventListener("click", async () => {
      const err = el.querySelector("#k-err"); err.textContent = "";
      try {
        const provider = new fbAuth.GoogleAuthProvider();
        provider.setCustomParameters({ hd: ALLOWED_DOMAIN, prompt: "select_account" });
        const res = await fbAuth.signInWithPopup(auth, provider);
        resolve(res.user);
      } catch (e) {
        if (e && e.code === "auth/popup-blocked") err.textContent = "Your browser blocked the sign-in window. Allow pop-ups for this site and try again.";
        else if (e && (e.code === "auth/popup-closed-by-user" || e.code === "auth/cancelled-popup-request")) err.textContent = "";
        else if (e && e.code === "auth/unauthorized-domain") err.textContent = "This web address isn't authorized for sign-in yet. An admin needs to add it under Firebase → Authentication → Settings → Authorized domains.";
        else err.textContent = "Sign-in failed: " + ((e && e.message) || e);
      }
    });
  });
}

function showBlocked(title, msg, { home = true } = {}) {
  const el = gate('<div class="k-logo">K</div><h1>' + esc(title) + "</h1><p>" + msg + "</p>" +
    '<div style="display:flex;gap:8px;justify-content:center;">' +
    (home ? '<a class="k-link-btn" href="' + siteRoot.href + '">Home</a>' : "") +
    '<button class="k-link-btn" id="k-out">Sign out</button></div>');
  el.querySelector("#k-out").addEventListener("click", () => fbAuth.signOut(auth).then(() => location.reload()));
}

function firstAuthState() {
  return new Promise((resolve) => { const off = fbAuth.onAuthStateChanged(auth, (u) => { off(); resolve(u); }); });
}

// ---------------------------------------------------------------- top bar
export function mountBar({ title, role, ctx }) {
  const u = ctx.user;
  const bar = document.createElement("div");
  bar.className = "k-bar";
  const avatar = u.photoURL
    ? '<img src="' + esc(u.photoURL) + '" alt="" referrerpolicy="no-referrer">'
    : '<span class="k-initial">' + esc((u.displayName || u.email || "?")[0].toUpperCase()) + "</span>";
  bar.innerHTML =
    '<a class="k-home" href="' + siteRoot.href + '"><span class="k-logo">K</span><span>Kenwood</span></a>' +
    (title ? '<span class="k-crumb"><span class="k-sep">/ </span><b>' + esc(title) + "</b></span>" : "") +
    '<span class="k-spacer"></span>' +
    (role ? '<span class="k-role" title="Your access to this tool">' + esc(ROLE_LABELS[role] || role) + "</span>" : "") +
    (ctx.isPlatformAdmin ? '<a class="k-link-btn" href="' + siteRoot.href + 'admin/">Admin</a>' : "") +
    '<span class="k-user">' + avatar + '<span class="k-email">' + esc(u.email) + "</span></span>" +
    '<button class="k-link-btn" id="k-signout">Sign out</button>';
  document.body.insertBefore(bar, document.body.firstChild);
  bar.querySelector("#k-signout").addEventListener("click", () => fbAuth.signOut(auth).then(() => { location.href = siteRoot.href; }));
  return bar;
}

// ---------------------------------------------------------------- entry point
/**
 * @param {{moduleId?: string, title?: string, minRole?: string, adminOnly?: boolean}} opts
 * @returns {Promise<{user, email, member, modules, isPlatformAdmin, role}>}
 */
export async function startPage(opts = {}) {
  showLoading("Checking your sign-in…");
  let user = await firstAuthState();
  let err = "";
  for (;;) {
    if (!user) user = await showSignIn(err);
    if (user && user.emailVerified && isKenwoodEmail(user.email)) break;
    err = "“" + (user && user.email) + "” isn't a Kenwood account. Please choose your @" + ALLOWED_DOMAIN + " account.";
    await fbAuth.signOut(auth);
    user = null;
  }
  showLoading("Loading your access…");
  const email = normEmail(user.email);
  const ctx = { user, email, member: null, modules: {}, isPlatformAdmin: false, role: null };

  // Refresh own profile (rules only allow these fields), then read own member doc.
  const meRef = fs.doc(db, "members", email);
  try {
    await fs.setDoc(meRef, { email, displayName: user.displayName || null, photoURL: user.photoURL || null, lastSignInAt: Date.now() }, { merge: true });
  } catch (e) { /* a disabled member can't write; handled below */ }
  try {
    const snap = await fs.getDoc(meRef);
    ctx.member = snap.exists() ? snap.data() : null;
  } catch (e) { ctx.member = null; }

  if (ctx.member && ctx.member.disabled) {
    showBlocked("Access turned off", "Your access to the Kenwood platform has been turned off. If you think this is a mistake, contact a platform admin.", { home: false });
    throw new Error("disabled");
  }
  ctx.isPlatformAdmin = OWNERS.includes(email) || !!(ctx.member && ctx.member.platformAdmin);

  try { ctx.modules = await loadModules(); } catch (e) { ctx.modules = {}; }
  await seedIfEmpty(ctx);

  if (opts.adminOnly && !ctx.isPlatformAdmin) {
    showBlocked("Admins only", "This page is for platform admins.");
    throw new Error("not-admin");
  }
  if (opts.moduleId) {
    ctx.role = roleFor(opts.moduleId, ctx);
    if (rank(ctx.role) < rank(opts.minRole || "viewer")) {
      const name = (ctx.modules[opts.moduleId] && ctx.modules[opts.moduleId].name) || opts.title || "this tool";
      showBlocked("No access yet", "You're signed in as <b>" + esc(email) + "</b>, but you don't have access to " + esc(name) + ". Ask a Kenwood platform admin to give you access.");
      throw new Error("no-access");
    }
  }
  mountBar({ title: opts.title, role: opts.moduleId ? ctx.role : null, ctx });
  removeGate();
  return ctx;
}
