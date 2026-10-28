/* Tests des règles de notifications (firestore.rules)
   Exécution : firebase emulators:exec --only firestore "node test-notifications-rules.mjs"
   ou : npm run test:notifications */

import test, { before, after } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  setDoc,
  serverTimestamp
} from 'firebase/firestore';

const PROJECT_ID = 'ugtm-notifications-test';

const ADMIN_TOKEN = { email: 'abaray66@gmail.com', email_verified: true };

const env = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: {
    rules: readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8')
  }
});

after(async () => {
  await env.cleanup();
});

before(async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'members', 'sub1'), {
      status: 'active',
      role: 'subadmin',
      adminProvince: 'agadir',
      prov: 'agadir'
    });
    await setDoc(doc(db, 'notifications', 'user1', 'items', 'n1'), {
      title: 't',
      body: 'b',
      type: 'info',
      read: false,
      authorUid: 'admin1',
      createdAt: serverTimestamp()
    });
  });
});

test('own notifications readable', async () => {
  const db = env.authenticatedContext('user1').firestore();
  await assertSucceeds(getDoc(doc(db, 'notifications', 'user1', 'items', 'n1')));
});

test('cross-user read denied', async () => {
  const db = env.authenticatedContext('user2').firestore();
  await assertFails(getDoc(doc(db, 'notifications', 'user1', 'items', 'n1')));
});

test('adhesion create denied', async () => {
  const db = env.authenticatedContext('adherent1', { email: 'a@test.com', email_verified: true }).firestore();
  await assertFails(addDoc(collection(db, 'notifications', 'adherent1', 'items'), {
    title: 't',
    body: 'b',
    type: 'info',
    read: false,
    authorUid: 'adherent1',
    createdAt: serverTimestamp()
  }));
});

test('admin create allowed (full 9 keys)', async () => {
  const ctx = testEnv.authenticatedContext('admin1', { email: 'abaray66@gmail.com', email_verified: true });
  const db = ctx.firestore();
  await assertSucceeds(db.collection('notifications').doc('user1').collection('items').add({
    title:'t', body:'b', type:'info', read:false, authorUid:'admin1',
    createdAt: new Date(), targetScreen:'me', targetId:'user1', province:'agadir'
  }));
});

test('subadmin cross-province create denied', async () => {
  const db = env.authenticatedContext('sub1', { email: 's@test.com', email_verified: true }).firestore();
  await assertFails(addDoc(collection(db, 'notifications', 'user2', 'items'), {
    title: 't',
    body: 'b',
    type: 'info',
    read: false,
    authorUid: 'sub1',
    province: 'Other',
    createdAt: serverTimestamp()
  }));
});

test('authorUid tampering denied', async () => {
  const db = env.authenticatedContext('admin1', ADMIN_TOKEN).firestore();
  await assertFails(addDoc(collection(db, 'notifications', 'user1', 'items'), {
    title: 't',
    body: 'b',
    type: 'info',
    read: false,
    authorUid: 'other',
    createdAt: serverTimestamp()
  }));
});

test('invalid fields denied', async () => {
  const db = env.authenticatedContext('admin1', ADMIN_TOKEN).firestore();
  await assertFails(addDoc(collection(db, 'notifications', 'user1', 'items'), {
    title: 'x'.repeat(200),
    body: 'b',
    type: 'bad',
    read: false,
    authorUid: 'admin1',
    createdAt: serverTimestamp()
  }));
});

test('read update allowed for recipient', async () => {
  const db = env.authenticatedContext('user1').firestore();
  await assertSucceeds(updateDoc(doc(db, 'notifications', 'user1', 'items', 'n1'), { read: true }));
});

test('content update denied', async () => {
  const db = env.authenticatedContext('user1').firestore();
  await assertFails(updateDoc(doc(db, 'notifications', 'user1', 'items', 'n1'), { title: 'hacked' }));
});

test('non-boolean read denied', async () => {
  const db = env.authenticatedContext('user1').firestore();
  await assertFails(updateDoc(doc(db, 'notifications', 'user1', 'items', 'n1'), { read: 'yes' }));
});

test('serverTimestamp create (full 9 keys)', async () => {
  const ctx = testEnv.authenticatedContext('admin1', { email: 'abaray66@gmail.com', email_verified: true });
  const db = ctx.firestore();
  await assertSucceeds(db.collection('notifications').doc('user1').collection('items').add({
    title:'t', body:'b', type:'info', read:false, authorUid:'admin1',
    createdAt: (await import('firebase/firestore')).serverTimestamp(),
    targetScreen:'me', targetId:'user1', province:'agadir'
  }));
});

console.log('Tests notifications exécutés avec firestore.rules.');
