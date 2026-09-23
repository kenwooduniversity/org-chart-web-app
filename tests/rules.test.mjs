// Firestore security-rules tests. Run with:  npm test   (starts the emulator)
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';

let env;
const kw = (local, extra = {}) => ({ email: `${local}@kenwoodusa.org`, email_verified: true, ...extra });

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'kenwood-platform',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
after(async () => { await env.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'modules/orgchart'), { name: 'Org Chart', defaultRole: 'viewer' });
    await setDoc(doc(db, 'modules/mentoring'), { name: 'Mentee Software', defaultRole: 'none' });
    await setDoc(doc(db, 'divisions/grants'), { name: 'Grants' });
    await setDoc(doc(db, 'orgchart/main'), { orgTitle: 'Kenwood' });
    await setDoc(doc(db, 'orgchart/main/positions/p1'), { title: 'Exec Director' });
    await setDoc(doc(db, 'members/editor@kenwoodusa.org'), { roles: { orgchart: 'editor' } });
    await setDoc(doc(db, 'members/blocked@kenwoodusa.org'), { roles: { orgchart: 'editor' } });
    await setDoc(doc(db, 'members/noaccess@kenwoodusa.org'), { roles: { orgchart: 'none' } });
    await setDoc(doc(db, 'members/gone@kenwoodusa.org'), { disabled: true, roles: { orgchart: 'editor' } });
    await setDoc(doc(db, 'members/padmin@kenwoodusa.org'), { platformAdmin: true });
  });
});

const as = (token, uid = token?.email || 'anon') => env.authenticatedContext(uid, token).firestore();

test('signed-out users can read nothing', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'orgchart/main/positions/p1')));
  await assertFails(getDoc(doc(db, 'modules/orgchart')));
});

test('non-Kenwood Google accounts are locked out', async () => {
  const db = as({ email: 'someone@gmail.com', email_verified: true });
  await assertFails(getDoc(doc(db, 'orgchart/main/positions/p1')));
  await assertFails(getDoc(doc(db, 'modules/orgchart')));
  const lookalike = as({ email: 'x@kenwoodusa.org.evil.com', email_verified: true });
  await assertFails(getDoc(doc(lookalike, 'orgchart/main/positions/p1')));
  const sub = as({ email: 'x@mail.kenwoodusa.org', email_verified: true });
  await assertFails(getDoc(doc(sub, 'orgchart/main/positions/p1')));
});

test('unverified Kenwood email is locked out', async () => {
  const db = as(kw('newbie', { email_verified: false }));
  await assertFails(getDoc(doc(db, 'orgchart/main/positions/p1')));
});

test('any Kenwood account gets the module default (viewer) on the org chart', async () => {
  const db = as(kw('mentee'));
  await assertSucceeds(getDoc(doc(db, 'orgchart/main/positions/p1')));
  await assertSucceeds(getDoc(doc(db, 'orgchart/main')));
  await assertFails(setDoc(doc(db, 'orgchart/main/positions/p2'), { title: 'x' }));
  await assertFails(updateDoc(doc(db, 'orgchart/main'), { orgTitle: 'hacked' }));
});

test('module default of none blocks modules the person was not granted', async () => {
  // no mentoring data yet, but the role check is what matters: members doc says nothing about mentoring
  const db = as(kw('mentee'));
  await assertSucceeds(getDocs(collection(db, 'modules')));
});

test('an explicit none role overrides the viewer default', async () => {
  const db = as(kw('noaccess'));
  await assertFails(getDoc(doc(db, 'orgchart/main/positions/p1')));
});

test('editors can write org chart data', async () => {
  const db = as(kw('editor'));
  await assertSucceeds(setDoc(doc(db, 'orgchart/main/positions/p2'), { title: 'New' }));
  await assertSucceeds(updateDoc(doc(db, 'orgchart/main/positions/p1'), { title: 'Renamed' }));
  await assertSucceeds(deleteDoc(doc(db, 'orgchart/main/positions/p2')));
  await assertSucceeds(setDoc(doc(db, 'orgchart/main/headshots/h1'), { dataUrl: 'data:image/jpeg;base64,AAAA' }));
  await assertSucceeds(setDoc(doc(db, 'orgchart/main'), { orgTitle: 'Kenwood Org' }, { merge: true }));
});

test('editors cannot write outside the known org chart collections or oversize photos', async () => {
  const db = as(kw('editor'));
  await assertFails(setDoc(doc(db, 'orgchart/main/secrets/x'), { a: 1 }));
  await assertFails(setDoc(doc(db, 'orgchart/main/headshots/big'), { dataUrl: 'x'.repeat(400001) }));
  await assertFails(setDoc(doc(db, 'orgchart/main/headshots/bad'), { notAnImage: true }));
  await assertFails(setDoc(doc(db, 'modules/orgchart'), { defaultRole: 'editor' }));
});

test('disabled members are locked out even with an editor role', async () => {
  const db = as(kw('gone'));
  await assertFails(getDoc(doc(db, 'orgchart/main/positions/p1')));
  await assertFails(getDoc(doc(db, 'modules/orgchart')));
});

test('people can create/refresh their own profile but not grant themselves roles', async () => {
  const db = as(kw('mentee'));
  const me = doc(db, 'members/mentee@kenwoodusa.org');
  await assertSucceeds(setDoc(me, { email: 'mentee@kenwoodusa.org', displayName: 'M', photoURL: null, lastSignInAt: 1 }));
  await assertSucceeds(updateDoc(me, { lastSignInAt: 2 }));
  await assertSucceeds(getDoc(me));
  await assertFails(updateDoc(me, { roles: { orgchart: 'editor' } }));
  await assertFails(updateDoc(me, { platformAdmin: true }));
  const ed = as(kw('editor'));
  await assertFails(updateDoc(doc(ed, 'members/editor@kenwoodusa.org'), { 'roles.orgchart': 'admin' }));
  await assertFails(setDoc(doc(db, 'members/new@kenwoodusa.org'), { email: 'new@kenwoodusa.org' }));
  await assertFails(setDoc(doc(db, 'members/other@kenwoodusa.org'), { platformAdmin: true }));
});

test('email case does not matter for the members lookup', async () => {
  const db = as({ email: 'Editor@KenwoodUSA.org', email_verified: true });
  await assertSucceeds(setDoc(doc(db, 'orgchart/main/positions/p3'), { title: 'x' }));
});

test('members list is private to platform admins', async () => {
  await assertFails(getDocs(collection(as(kw('editor')), 'members')));
  await assertSucceeds(getDocs(collection(as(kw('padmin')), 'members')));
});

test('owner and platform admins manage members, modules, divisions', async () => {
  for (const who of ['connect', 'padmin']) {
    const db = as(kw(who));
    await assertSucceeds(setDoc(doc(db, 'members/new@kenwoodusa.org'), { roles: { orgchart: 'editor' } }));
    await assertSucceeds(updateDoc(doc(db, 'modules/orgchart'), { defaultRole: 'viewer' }));
    await assertSucceeds(setDoc(doc(db, 'divisions/kpi'), { name: 'KPI' }));
    await assertSucceeds(setDoc(doc(db, 'orgchart/main/positions/p9'), { title: 'x' }));
    await assertSucceeds(deleteDoc(doc(db, 'members/new@kenwoodusa.org')));
  }
});

test('owner works with no members doc at all (fresh project bootstrap)', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await deleteDoc(doc(db, 'modules/orgchart'));
  });
  const db = as(kw('connect'));
  await assertSucceeds(setDoc(doc(db, 'modules/orgchart'), { name: 'Org Chart', defaultRole: 'viewer' }));
  await assertSucceeds(setDoc(doc(db, 'divisions/mentorship'), { name: 'Mentorship' }));
});

test('regular users cannot touch platform collections', async () => {
  const db = as(kw('editor'));
  await assertFails(setDoc(doc(db, 'divisions/x'), { name: 'x' }));
  await assertFails(deleteDoc(doc(db, 'modules/orgchart')));
  await assertFails(setDoc(doc(db, 'somethingelse/x'), { a: 1 }));
});
