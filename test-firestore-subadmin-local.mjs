/* Tests ciblés pour le sous-administrateur local (subadminLocal).
   Exécution : firebase emulators:exec --only firestore "node test-firestore-subadmin-local.mjs"
   Nécessite Java (Firebase Emulator) : indisponible dans ce sandbox cloud.
   Ce fichier est préparé pour être exécuté dans un environnement avec Java.

   Couverture :
   - isolation entre deux structures
   - accès provincial et général
   - nomination et révocation
   - validation et double validation d'adhésion
   - compteur SM et concurrence
   - protection contre l'auto-attribution de droits
*/

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

const PROJECT_ID = 'ugtm-subadmin-local-test';
const ADMIN_EMAIL = 'abaray66@gmail.com';
const ADMIN_TOKEN = { email: ADMIN_EMAIL, email_verified: true };
const userToken = (uid) => ({ email: `${uid}@example.com`, email_verified: true });

const STRUCT_A = 'struct-a';
const STRUCT_B = 'struct-b';
const PROV_AGADIR = 'agadir';
const PROV_TIZNIT = 'tiznit';

const env = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: {
    rules: readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8')
  }
});

after(async () => {
  await env.cleanup();
});

/* ============================================================
   HELPERS
   ============================================================ */

/* Crée deux structures locales (admin général, règles désactivées). */
async function setupStructures() {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'localStructures', STRUCT_A), {
      name: 'Structure A',
      etab: 'Etab A',
      province: PROV_AGADIR,
      structureId: STRUCT_A,
      createdBy: 'admin-uid',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      archived: false
    });
    await setDoc(doc(context.firestore(), 'localStructures', STRUCT_B), {
      name: 'Structure B',
      etab: 'Etab B',
      province: PROV_TIZNIT,
      structureId: STRUCT_B,
      createdBy: 'admin-uid',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      archived: false
    });
    // Initialise le compteur global
    await setDoc(doc(context.firestore(), 'counters', 'memberNumbers'), {
      next: 2,
      lastMemberNo: 'SM-0001',
      memberUid: 'seed-uid',
      updatedAt: serverTimestamp()
    });
  });
}

/* Crée un membre actif rattaché à une structure (règles désactivées). */
async function createMember(uid, role, adminStructure, adminProvince = PROV_AGADIR, status = 'active') {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'members', uid), {
      name: `Membre ${uid}`,
      email: `${uid}@example.com`,
      photo: '',
      etab: 'Etab test',
      prov: adminProvince,
      phone: '0600000000',
      status,
      memberNo: role === 'member' ? 'SM-0001' : '',
      activatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      role,
      adminStructure: adminStructure || '',
      adminProvince: adminProvince || ''
    });
  });
}

/* Crée une demande d'adhésion acceptée pour un membre (règles désactivées). */
async function createAcceptedAdhesion(uid, structureId, validated = false) {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'adhesionRequests', uid), {
      uid,
      email: `${uid}@example.com`,
      province: PROV_AGADIR,
      structureId,
      signature: 'sig-adherent',
      status: 'accepted',
      adminNote: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      application: {
        nom: 'Test', prenom: 'Membre', cin: 'X123', dob: '1990-01-01',
        phone: '0600000000', address: 'Adr', establishment: 'Etab',
        service: 'Svc', function: 'Fct', specialty: 'Sp', ppr: 'PPR',
        type: 'first', reason: '', commitment: true, date: '2026-01-01'
      },
      ...(validated ? {
        adminSignature: 'sig-admin',
        signedBy: 'admin-uid',
        signedAt: serverTimestamp()
      } : {
        validatedBy: 'subadmin-local-uid',
        validatedAt: serverTimestamp(),
        validatedByRole: 'subadminLocal'
      })
    });
  });
}

/* ============================================================
   TESTS
   ============================================================ */

test('isolation : sous-admin local de Structure A ne voit pas les membres de Structure B', async () => {
  await setupStructures();
  await createMember('member-a-1', 'member', STRUCT_A);
  await createMember('member-b-1', 'member', STRUCT_B);

  // Sous-admin local de Structure A
  await createMember('local-a', 'subadminLocal', STRUCT_A, PROV_AGADIR);
  const dbA = env.authenticatedContext('local-a', userToken('local-a')).firestore();
  await assertFails(getDoc(doc(dbA, 'members', 'member-b-1'))); // lecture interdite
});

test('isolation : sous-admin local de Structure A ne peut pas activer un membre de Structure B', async () => {
  await setupStructures();
  await createMember('member-b-pend', 'member', STRUCT_B, PROV_TIZNIT, 'pending');
  await createAcceptedAdhesion('member-b-pend', STRUCT_B, true);
  await createMember('local-a', 'subadminLocal', STRUCT_A, PROV_AGADIR);

  const dbA = env.authenticatedContext('local-a', userToken('local-a')).firestore();
  await assertFails(updateDoc(doc(dbA, 'members', 'member-b-pend'), {
    status: 'active', memberNo: 'SM-0002', activatedAt: serverTimestamp()
  }));
});

test('accès : admin général peut lire tous les membres', async () => {
  await setupStructures();
  await createMember('member-x', 'member', STRUCT_A);
  await createMember('member-y', 'member', STRUCT_B);

  const db = env.authenticatedContext('admin-uid', ADMIN_TOKEN).firestore();
  await assertSucceeds(getDoc(doc(db, 'members', 'member-x')));
  await assertSucceeds(getDoc(doc(db, 'members', 'member-y')));
});

test('accès : sous-admin provincial peut lire les membres de sa province', async () => {
  await setupStructures();
  await createMember('prov-admin', 'subadmin', STRUCT_A, PROV_AGADIR);
  await createMember('member-agadir', 'member', STRUCT_A, PROV_AGADIR);
  await createMember('member-tiznit', 'member', STRUCT_B, PROV_TIZNIT);

  const db = env.authenticatedContext('prov-admin', userToken('prov-admin')).firestore();
  await assertSucceeds(getDoc(doc(db, 'members', 'member-agadir')));
  await assertFails(getDoc(doc(db, 'members', 'member-tiznit')));
});

test('nomination : admin général peut nommer un subadmin local sur une structure active non archivée', async () => {
  await setupStructures();
  await createMember('candidat-local', 'member', STRUCT_A, PROV_AGADIR);
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'members', 'candidat-local'), {
      name: 'Candidat Local', email: 'candidat@example.com', photo: '',
      etab: 'Etab', prov: PROV_AGADIR, phone: '0600000000',
      status: 'active', memberNo: 'SM-0010',
      activatedAt: serverTimestamp(), createdAt: serverTimestamp(),
      role: 'member', adminStructure: STRUCT_A, adminProvince: PROV_AGADIR
    });
  });

  const db = env.authenticatedContext('admin-uid', ADMIN_TOKEN).firestore();
  await assertSucceeds(updateDoc(doc(db, 'members', 'candidat-local'), {
    role: 'subadminLocal', adminStructure: STRUCT_A
  }));

  const snap = await getDoc(doc(db, 'members', 'candidat-local'));
  const data = snap.data();
  if (data.role !== 'subadminLocal' || data.adminStructure !== STRUCT_A) {
    throw new Error('Nomination subadmin local échouée');
  }
});

test('nomination : admin général ne peut pas nommer sur une structure archivée', async () => {
  await setupStructures();
  await createMember('candidat-arch', 'member', STRUCT_A, PROV_AGADIR);
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'members', 'candidat-arch'), {
      name: 'Candidat Arch', email: 'candidat-arch@example.com', photo: '',
      etab: 'Etab', prov: PROV_AGADIR, phone: '0600000000',
      status: 'active', memberNo: 'SM-0011',
      activatedAt: serverTimestamp(), createdAt: serverTimestamp(),
      role: 'member', adminStructure: STRUCT_A, adminProvince: PROV_AGADIR
    });
    await updateDoc(doc(context.firestore(), 'localStructures', STRUCT_A), {
      archived: true, archivedAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
  });

  const db = env.authenticatedContext('admin-uid', ADMIN_TOKEN).firestore();
  await assertFails(updateDoc(doc(db, 'members', 'candidat-arch'), {
    role: 'subadminLocal', adminStructure: STRUCT_A
  }));
});

test('révocation : admin général peut révoquer un subadmin local', async () => {
  await setupStructures();
  await createMember('revoke-local', 'subadminLocal', STRUCT_A, PROV_AGADIR);

  const db = env.authenticatedContext('admin-uid', ADMIN_TOKEN).firestore();
  await assertSucceeds(updateDoc(doc(db, 'members', 'revoke-local'), {
    role: 'member', adminStructure: ''
  }));

  const snap = await getDoc(doc(db, 'members', 'revoke-local'));
  const data = snap.data();
  if (data.role !== 'member' || data.adminStructure !== '') {
    throw new Error('Révoquation subadmin local échouée');
  }
});

test('protection : subadmin local ne peut pas s\'auto-attribuer le rôle subadminLocal', async () => {
  await setupStructures();
  await createMember('self-promote', 'member', STRUCT_A, PROV_AGADIR);

  const db = env.authenticatedContext('self-promote', userToken('self-promote')).firestore();
  await assertFails(updateDoc(doc(db, 'members', 'self-promote'), {
    role: 'subadminLocal', adminStructure: STRUCT_A
  }));
});

test('protection : subadmin local ne peut pas modifier sa propre structure', async () => {
  await setupStructures();
  await createMember('self-struct', 'subadminLocal', STRUCT_A, PROV_AGADIR);

  const db = env.authenticatedContext('self-struct', userToken('self-struct')).firestore();
  await assertFails(updateDoc(doc(db, 'members', 'self-struct'), {
    adminStructure: STRUCT_B
  }));
});

test('protection : sous-admin provincial ne peut pas nommer un subadmin local', async () => {
  await setupStructures();
  await createMember('prov-user', 'subadmin', STRUCT_A, PROV_AGADIR);
  await createMember('candidat-p', 'member', STRUCT_A, PROV_AGADIR);

  const db = env.authenticatedContext('prov-user', userToken('prov-user')).firestore();
  await assertFails(updateDoc(doc(db, 'members', 'candidat-p'), {
    role: 'subadminLocal', adminStructure: STRUCT_A
  }));
});

test('validation : subadmin local peut valider une adhésion de sa structure', async () => {
  await setupStructures();
  await createMember('adh-pend', 'member', STRUCT_A, PROV_AGADIR, 'pending');
  await createAcceptedAdhesion('adh-pend', STRUCT_A, false);
  await createMember('local-a', 'subadminLocal', STRUCT_A, PROV_AGADIR);

  const db = env.authenticatedContext('local-a', userToken('local-a')).firestore();
  await assertSucceeds(updateDoc(doc(db, 'adhesionRequests', 'adh-pend'), {
    status: 'accepted',
    validatedBy: 'local-a',
    validatedAt: serverTimestamp(),
    validatedByRole: 'subadminLocal',
    adminNote: 'Validé localement',
    updatedAt: serverTimestamp()
  }));
});

test('validation : subadmin local ne peut pas valider une adhésion d\'une autre structure', async () => {
  await setupStructures();
  await createMember('adh-b-pend', 'member', STRUCT_B, PROV_TIZNIT, 'pending');
  await createAcceptedAdhesion('adh-b-pend', STRUCT_B, false);
  await createMember('local-a', 'subadminLocal', STRUCT_A, PROV_AGADIR);

  const db = env.authenticatedContext('local-a', userToken('local-a')).firestore();
  await assertFails(updateDoc(doc(db, 'adhesionRequests', 'adh-b-pend'), {
    status: 'accepted',
    validatedBy: 'local-a',
    validatedAt: serverTimestamp(),
    validatedByRole: 'subadminLocal',
    adminNote: 'Tentative cross-structure',
    updatedAt: serverTimestamp()
  }));
});

test('double validation : une demande déjà acceptée avec validé par local ne peut pas être re-signée par admin provincial', async () => {
  await setupStructures();
  await createMember('adh-double', 'member', STRUCT_A, PROV_AGADIR, 'pending');
  await createAcceptedAdhesion('adh-double', STRUCT_A, false);
  await createMember('local-a', 'subadminLocal', STRUCT_A, PROV_AGADIR);
  await createMember('prov-admin', 'subadmin', STRUCT_A, PROV_AGADIR);

  // Le subadmin local valide déjà
  const dbLocal = env.authenticatedContext('local-a', userToken('local-a')).firestore();
  await assertSucceeds(updateDoc(doc(dbLocal, 'adhesionRequests', 'adh-double'), {
    status: 'accepted',
    validatedBy: 'local-a',
    validatedAt: serverTimestamp(),
    validatedByRole: 'subadminLocal',
    adminNote: 'Validé local',
    updatedAt: serverTimestamp()
  }));

  // Le sous-admin provincial tente de signer (adminSignature) sur une demande déjà validée
  const dbProv = env.authenticatedContext('prov-admin', userToken('prov-admin')).firestore();
  await assertFails(updateDoc(doc(dbProv, 'adhesionRequests', 'adh-double'), {
    status: 'accepted',
    adminSignature: 'sig-prov',
    signedBy: 'prov-admin',
    signedAt: serverTimestamp(),
    adminNote: 'Double validation',
    updatedAt: serverTimestamp()
  }));
});

test('compteur : admin général peut initialiser le compteur memberNumbers', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    try { await deleteDoc(doc(context.firestore(), 'counters', 'memberNumbers')); } catch (e) {}
  });
  const db = env.authenticatedContext('admin-uid', ADMIN_TOKEN).firestore();
  await assertSucceeds(setDoc(doc(db, 'counters', 'memberNumbers'), {
    next: 2,
    lastMemberNo: 'SM-0001',
    memberUid: 'init-uid',
    updatedAt: serverTimestamp()
  }));
});

test('compteur : sous-admin local ne peut pas créer le compteur s\'il est absent', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    try { await deleteDoc(doc(context.firestore(), 'counters', 'memberNumbers')); } catch (e) {}
  });
  await createMember('local-no-counter', 'subadminLocal', STRUCT_A, PROV_AGADIR);
  const db = env.authenticatedContext('local-no-counter', userToken('local-no-counter')).firestore();
  await assertFails(setDoc(doc(db, 'counters', 'memberNumbers'), {
    next: 2,
    lastMemberNo: 'SM-0001',
    memberUid: 'x',
    updatedAt: serverTimestamp()
  }));
});

test('compteur : deux activations séquentielles produisent des numéros distincts', async () => {
  await setupStructures();
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'counters', 'memberNumbers'), {
      next: 3,
      lastMemberNo: 'SM-0002',
      memberUid: 'seed2',
      updatedAt: serverTimestamp()
    });
  });
  await createMember('conc-1', 'member', STRUCT_A, PROV_AGADIR, 'pending');
  await createMember('conc-2', 'member', STRUCT_A, PROV_AGADIR, 'pending');
  await createAcceptedAdhesion('conc-1', STRUCT_A, true);
  await createAcceptedAdhesion('conc-2', STRUCT_A, true);
  await createMember('admin-conc', 'subadmin', STRUCT_A, PROV_AGADIR);

  const db = env.authenticatedContext('admin-conc', userToken('admin-conc')).firestore();

  // Activation séquentielle de conc-1 avec SM-0003 (membre + compteur dans un batch)
  const batch1 = writeBatch(db);
  batch1.update(doc(db, 'members', 'conc-1'), {
    status: 'active', memberNo: 'SM-0003', activatedAt: serverTimestamp()
  });
  batch1.update(doc(db, 'counters', 'memberNumbers'), {
    next: 4, lastMemberNo: 'SM-0003', memberUid: 'conc-1', updatedAt: serverTimestamp()
  });
  await batch1.commit();

  // Activation séquentielle de conc-2 avec SM-0004 (membre + compteur dans un batch)
  const batch2 = writeBatch(db);
  batch2.update(doc(db, 'members', 'conc-2'), {
    status: 'active', memberNo: 'SM-0004', activatedAt: serverTimestamp()
  });
  batch2.update(doc(db, 'counters', 'memberNumbers'), {
    next: 5, lastMemberNo: 'SM-0004', memberUid: 'conc-2', updatedAt: serverTimestamp()
  });
  await batch2.commit();

  // Vérifier que les numéros sont distincts
  const s1 = await getDoc(doc(db, 'members', 'conc-1'));
  const s2 = await getDoc(doc(db, 'members', 'conc-2'));
  if (s1.data().memberNo === s2.data().memberNo) {
    throw new Error('Doublon de numéro détecté');
  }
  if (s1.data().memberNo !== 'SM-0003' || s2.data().memberNo !== 'SM-0004') {
    throw new Error('Numéros inattendus: ' + s1.data().memberNo + ' / ' + s2.data().memberNo);
  }
});
