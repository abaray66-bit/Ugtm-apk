/* Tests ciblés contre l'escalade de privilèges dans members/{uid}.
   Exécution : firebase emulators:exec --only firestore "node test-firestore-member-privileges.mjs"
   ou : npm run test:firestore:privileges */

import test, { after } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails
} from '@firebase/rules-unit-testing';
import {
  doc,
  setDoc,
  updateDoc,
  writeBatch,
  deleteDoc,
  serverTimestamp
} from 'firebase/firestore';

const PROJECT_ID = 'ugtm-member-privileges-test';
const SUBADMIN = 'subadmin-agadir';
const MEMBER = 'member-agadir';
const ADMIN_TOKEN = { email: 'abaray66@gmail.com', email_verified: true };
const userToken = (uid) => ({ email: `${uid}@example.com`, email_verified: true });

const env = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: {
    rules: readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8')
  }
});

after(async () => env.cleanup());

await env.withSecurityRulesDisabled(async (context) => {
  await setDoc(doc(context.firestore(), 'members', SUBADMIN), {
    status: 'active',
    role: 'subadmin',
    adminProvince: 'agadir',
    prov: 'agadir'
  });
  await setDoc(doc(context.firestore(), 'members', MEMBER), {
    name: `Membre ${MEMBER}`,
    email: `${MEMBER}@example.com`,
    photo: '',
    etab: 'Établissement test',
    prov: 'agadir',
    phone: '0600000000',
    status: 'active',
    memberNo: 'SM-0001',
    activatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    role: 'member',
    adminProvince: 'agadir'
  });
});

async function resetCounterAndMember(uid) {
  await env.withSecurityRulesDisabled(async (context) => {
    try { await deleteDoc(doc(context.firestore(), 'counters', 'memberNumbers')); } catch (e) {}
    try { await deleteDoc(doc(context.firestore(), 'members', uid)); } catch (e) {}
  });
}

function activeMember(uid, role = 'member', adminProvince = 'agadir') {
  return {
    name: `Membre ${uid}`,
    email: `${uid}@example.com`,
    photo: '',
    etab: 'Établissement test',
    prov: 'agadir',
    phone: '0600000000',
    status: 'active',
    memberNo: 'SM-0001',
    activatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    role,
    adminProvince
  };
}

async function createActiveMemberAsSubAdmin(uid, role, adminProvince = 'agadir') {
  await resetCounterAndMember(uid);
  const db = env.authenticatedContext(SUBADMIN, userToken(SUBADMIN)).firestore();
  const batch = writeBatch(db);
  const memberNo = 'SM-0001';
  batch.set(doc(db, 'counters', 'memberNumbers'), {
    next: 2,
    lastMemberNo: memberNo,
    memberUid: uid,
    updatedAt: serverTimestamp()
  });
  batch.set(doc(db, 'members', uid), activeMember(uid, role, adminProvince));
  return batch.commit();
}

test('un sous-admin peut créer un adhérent actif avec le rôle member', async () => {
  await assertSucceeds(createActiveMemberAsSubAdmin('member-ok-1234', 'member', 'agadir'));
});

for (const role of ['admin', 'subadmin', 'owner', 'superadmin']) {
  test(`un sous-admin ne peut pas créer un membre avec le rôle privilégié ${role}`, async () => {
    await assertFails(createActiveMemberAsSubAdmin(`blocked-${role}-1234`, role, 'agadir'));
  });
}

test('un sous-admin ne peut pas attribuer adminProvince à une autre province', async () => {
  await assertFails(createActiveMemberAsSubAdmin('member-other-prov-1234', 'member', 'tiznit'));
});

test('un adhérent ne peut pas modifier son propre rôle', async () => {
  const db = env.authenticatedContext(MEMBER, userToken(MEMBER)).firestore();
  await assertFails(updateDoc(doc(db, 'members', MEMBER), { role: 'admin' }));
  await assertFails(updateDoc(doc(db, 'members', MEMBER), { role: 'subadmin' }));
});

test('un adhérent ne peut pas modifier son statut ou sa province administrative', async () => {
  const db = env.authenticatedContext(MEMBER, userToken(MEMBER)).firestore();
  await assertFails(updateDoc(doc(db, 'members', MEMBER), { status: 'pending' }));
  await assertFails(updateDoc(doc(db, 'members', MEMBER), { adminProvince: 'tiznit' }));
});

test('un administrateur général conserve l’activation de migration', async () => {
  const uid = 'admin-created-member';
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'members', uid), {
      status: 'pending', prov: 'agadir', name: 'Membre migration',
      email: `${uid}@example.com`, createdAt: Date.now()
    });
  });
  const db = env.authenticatedContext('main-admin', ADMIN_TOKEN).firestore();
  await assertSucceeds(updateDoc(doc(db, 'members', uid), {
    status: 'active', memberNo: 'SM-0099', activatedAt: serverTimestamp()
  }));
});
