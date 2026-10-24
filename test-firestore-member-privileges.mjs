/* Tests ciblés contre l'escalade de privilèges dans members/{uid}.
   Exécution : firebase emulators:exec --only firestore "node test-firestore-member-privileges.mjs" */

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

async function seedSubAdmin() {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'members', SUBADMIN), {
      status: 'active',
      role: 'subadmin',
      adminProvince: 'agadir',
      prov: 'agadir'
    });
  });
}

function activeMember(uid, role = 'member') {
  return {
    name: `Membre ${uid}`,
    email: `${uid}@example.com`,
    photo: '',
    etab: 'Établissement test',
    prov: 'agadir',
    phone: '0600000000',
    status: 'active',
    memberNo: `SM-${uid.slice(-4).padStart(4, '0')}`,
    activatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    role,
    adminProvince: 'agadir'
  };
}

async function createActiveMemberAsSubAdmin(uid, role) {
  const db = env.authenticatedContext(SUBADMIN, userToken(SUBADMIN)).firestore();
  const batch = writeBatch(db);
  const memberNo = `SM-${uid.slice(-4).padStart(4, '0')}`;
  batch.set(doc(db, 'counters', 'memberNumbers'), {
    next: 2,
    lastMemberNo: memberNo,
    memberUid: uid,
    updatedAt: serverTimestamp()
  });
  batch.set(doc(db, 'members', uid), activeMember(uid, role));
  return batch.commit();
}

await seedSubAdmin();

test('un sous-admin peut créer un adhérent actif avec le rôle member', async () => {
  await assertSucceeds(createActiveMemberAsSubAdmin('member-ok', 'member'));
});

for (const role of ['admin', 'subadmin', 'owner', 'superadmin']) {
  test(`un sous-admin ne peut pas créer un membre avec le rôle privilégié ${role}`, async () => {
    await assertFails(createActiveMemberAsSubAdmin(`blocked-${role}`, role));
  });
}

test('un adhérent ne peut pas modifier son propre rôle', async () => {
  const db = env.authenticatedContext(MEMBER, userToken(MEMBER)).firestore();
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'members', MEMBER), activeMember(MEMBER));
  });
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
