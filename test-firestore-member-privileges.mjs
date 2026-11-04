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
  getDoc,
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

/* ==========================================================
   LISTE DES ADMINISTRATEURS (config/admins)
   Document unique modifiable depuis l'espace administrateur.
   La liste de secours (bootstrapAdminEmails dans les règles)
   doit toujours y rester : impossible de se verrouiller.
   ========================================================== */

const BOOTSTRAP = 'abaray66@gmail.com';
const SECOND_ADMIN = { email: 'second.admin@example.com', email_verified: true };
const adminsPayload = (emails) => ({ emails, updatedAt: serverTimestamp() });

test('config/admins : un visiteur non connecté ne peut pas lire la liste', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'config', 'admins')));
});

test('config/admins : un compte connecté lit la liste (affichage)', async () => {
  const db = env.authenticatedContext(MEMBER, userToken(MEMBER)).firestore();
  await assertSucceeds(getDoc(doc(db, 'config', 'admins')));
});

test('config/admins : un adhérent ne peut pas écrire la liste', async () => {
  const db = env.authenticatedContext(MEMBER, userToken(MEMBER)).firestore();
  await assertFails(setDoc(doc(db, 'config', 'admins'), adminsPayload(['pirate@example.com'])));
});

test('config/admins : un e-mail admin non vérifié est refusé', async () => {
  const db = env.authenticatedContext('sneaky', { email: BOOTSTRAP, email_verified: false }).firestore();
  await assertFails(setDoc(doc(db, 'config', 'admins'), adminsPayload([BOOTSTRAP, 'x@example.com'])));
});

test('config/admins : l’admin crée la liste avec la liste de secours', async () => {
  const db = env.authenticatedContext('main-admin', ADMIN_TOKEN).firestore();
  await assertSucceeds(setDoc(doc(db, 'config', 'admins'), adminsPayload([BOOTSTRAP])));
});

test('config/admins : l’admin ajoute un second administrateur', async () => {
  const db = env.authenticatedContext('main-admin', ADMIN_TOKEN).firestore();
  await assertSucceeds(setDoc(doc(db, 'config', 'admins'),
    adminsPayload([BOOTSTRAP, 'second.admin@example.com']), { merge: true }));
});

test('config/admins : impossible de retirer la liste de secours', async () => {
  const db = env.authenticatedContext('main-admin', ADMIN_TOKEN).firestore();
  await assertFails(setDoc(doc(db, 'config', 'admins'),
    adminsPayload(['second.admin@example.com']), { merge: true }));
});

test('config/admins : liste vide refusée', async () => {
  const db = env.authenticatedContext('main-admin', ADMIN_TOKEN).firestore();
  await assertFails(setDoc(doc(db, 'config', 'admins'), adminsPayload([])));
});

test('config/admins : plus de 10 adresses refusé', async () => {
  const db = env.authenticatedContext('main-admin', ADMIN_TOKEN).firestore();
  const many = [BOOTSTRAP];
  for (let i = 0; i < 10; i++) many.push('admin' + i + '@example.com');
  await assertFails(setDoc(doc(db, 'config', 'admins'), adminsPayload(many)));
});

test('config/admins : un champ parasite est refusé', async () => {
  const db = env.authenticatedContext('main-admin', ADMIN_TOKEN).firestore();
  await assertFails(setDoc(doc(db, 'config', 'admins'), {
    emails: [BOOTSTRAP], role: 'superuser', updatedAt: serverTimestamp()
  }));
});

test('config/admins : la suppression du document est refusée', async () => {
  const db = env.authenticatedContext('main-admin', ADMIN_TOKEN).firestore();
  await assertFails(deleteDoc(doc(db, 'config', 'admins')));
});

test('config/admins : le second admin ajouté est reconnu', async () => {
  const db = env.authenticatedContext('second-uid', SECOND_ADMIN).firestore();
  await assertSucceeds(getDoc(doc(db, 'members', MEMBER)));
});
