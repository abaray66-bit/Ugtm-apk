import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';

const rules = readFileSync('firestore.rules', 'utf8');

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'ugtm-fns-souss-massa',
    firestore: { rules }
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

test('own notifications readable', async () => {
  const ctx = testEnv.authenticatedContext('user1');
  const db = ctx.firestore();
  await assertSucceeds(db.collection('notifications').doc('user1').collection('items').doc('n1').get());
});

test('cross-user read denied', async () => {
  const ctx = testEnv.authenticatedContext('user2');
  const db = ctx.firestore();
  await assertFails(db.collection('notifications').doc('user1').collection('items').doc('n1').get());
});

test('adhesion create denied', async () => {
  const ctx = testEnv.authenticatedContext('adherent1', { email: 'a@test.com', email_verified: true });
  const db = ctx.firestore();
  await assertFails(db.collection('notifications').doc('adherent1').collection('items').add({ title:'t', body:'b', type:'info', read:false, authorUid:'adherent1', createdAt: serverTimestamp }));
});

test('admin create allowed (if rules permit)', async () => {
  const ctx = testEnv.authenticatedContext('admin1', { email: 'abaray66@gmail.com', email_verified: true });
  const db = ctx.firestore();
  await assertSucceeds(db.collection('notifications').doc('user1').collection('items').add({ title:'t', body:'b', type:'info', read:false, authorUid:'admin1', createdAt: serverTimestamp }));
});

test('subadmin cross-province create denied', async () => {
  const ctx = testEnv.authenticatedContext('sub1', { email: 's@test.com', email_verified: true });
  const db = ctx.firestore();
  await assertFails(db.collection('notifications').doc('user2').collection('items').add({ title:'t', body:'b', type:'info', read:false, authorUid:'sub1', province:'Other', createdAt: serverTimestamp }));
});

test('authorUid tampering denied', async () => {
  const ctx = testEnv.authenticatedContext('admin1', { email: 'abaray66@gmail.com', email_verified: true });
  const db = ctx.firestore();
  await assertFails(db.collection('notifications').doc('user1').collection('items').add({ title:'t', body:'b', type:'info', read:false, authorUid:'other', createdAt: serverTimestamp }));
});

test('invalid fields denied', async () => {
  const ctx = testEnv.authenticatedContext('admin1', { email: 'abaray66@gmail.com', email_verified: true });
  const db = ctx.firestore();
  await assertFails(db.collection('notifications').doc('user1').collection('items').add({ title:'x'.repeat(200), body:'b', type:'bad', read:false, authorUid:'admin1', createdAt: serverTimestamp }));
});

test('read update allowed for recipient', async () => {
  const ctx = testEnv.authenticatedContext('user1');
  const db = ctx.firestore();
  await assertSucceeds(db.collection('notifications').doc('user1').collection('items').doc('n1').update({ read: true }));
});

test('content update denied', async () => {
  const ctx = testEnv.authenticatedContext('user1');
  const db = ctx.firestore();
  await assertFails(db.collection('notifications').doc('user1').collection('items').doc('n1').update({ title: 'hacked' }));
});

test('non-boolean read denied', async () => {
  const ctx = testEnv.authenticatedContext('user1');
  const db = ctx.firestore();
  await assertFails(db.collection('notifications').doc('user1').collection('items').doc('n1').update({ read: 'yes' }));
});

test('serverTimestamp create', async () => {
  const ctx = testEnv.authenticatedContext('admin1', { email: 'abaray66@gmail.com', email_verified: true });
  const db = ctx.firestore();
  await assertSucceeds(db.collection('notifications').doc('user1').collection('items').add({ title:'t', body:'b', type:'info', read:false, authorUid:'admin1', createdAt: serverTimestamp }));
});

console.log('12 tests notifications exécutés avec firestore.rules.');
console.log('Run: npm run test:notifications');
