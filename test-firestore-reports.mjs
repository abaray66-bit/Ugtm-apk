/* Tests des règles de gestion des signalements (firestore.rules)
   ------------------------------------------------------------
   Lancement :
     firebase emulators:exec --only firestore "node test-firestore-reports.mjs"
*/

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
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
  addDoc,
  collection,
  query,
  where,
  getDocs,
  writeBatch,
  serverTimestamp,
  deleteDoc
} from 'firebase/firestore';

const PROJECT_ID = 'ugtm-reports-test';
const ADMIN_EMAIL = 'abaray66@gmail.com';
const ADMIN_TOKEN = { email: ADMIN_EMAIL, email_verified: true };
const userToken = (uid) => ({ email: `${uid}@example.com`, email_verified: true });

const PROV_AGADIR = 'Agadir Ida-Outanane';
const PROV_TIZNIT = 'Tiznit';
const STRUCT_A = 'struct-a';
const STRUCT_B = 'struct-b';

const env = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: {
    rules: readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8')
  }
});

after(async () => await env.cleanup());

// ---------- Fixtures ----------

async function setupFixtures() {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    // Structures
    await setDoc(doc(db, 'localStructures', STRUCT_A), {
      name: 'Structure A', province: 'agadir', structureId: STRUCT_A,
      archived: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    await setDoc(doc(db, 'localStructures', STRUCT_B), {
      name: 'Structure B', province: 'tiznit', structureId: STRUCT_B,
      archived: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });

    // Members
    await setDoc(doc(db, 'members', 'admin-uid'), {
      name: 'Admin', email: ADMIN_EMAIL, status: 'active', role: 'admin',
      prov: 'agadir', adminProvince: 'agadir'
    });
    await setDoc(doc(db, 'members', 'subprov-agadir'), {
      name: 'SubProv Agadir', email: 'subprov-agadir@example.com', status: 'active',
      role: 'subadmin', prov: 'agadir', adminProvince: 'agadir'
    });
    await setDoc(doc(db, 'members', 'subprov-tiznit'), {
      name: 'SubProv Tiznit', email: 'subprov-tiznit@example.com', status: 'active',
      role: 'subadmin', prov: 'tiznit', adminProvince: 'tiznit'
    });
    await setDoc(doc(db, 'members', 'sublocal-a'), {
      name: 'SubLocal A', email: 'sublocal-a@example.com', status: 'active',
      role: 'subadminLocal', prov: 'agadir', adminProvince: 'agadir',
      adminStructure: STRUCT_A, etab: 'Etab A'
    });
    await setDoc(doc(db, 'members', 'sublocal-b'), {
      name: 'SubLocal B', email: 'sublocal-b@example.com', status: 'active',
      role: 'subadminLocal', prov: 'tiznit', adminProvince: 'tiznit',
      adminStructure: STRUCT_B, etab: 'Etab B'
    });
    await setDoc(doc(db, 'members', 'member-alice'), {
      name: 'Alice', email: 'member-alice@example.com', status: 'active',
      role: 'member', prov: 'agadir', adminProvince: 'agadir'
    });
    await setDoc(doc(db, 'members', 'member-bob'), {
      name: 'Bob', email: 'member-bob@example.com', status: 'active',
      role: 'member', prov: 'tiznit', adminProvince: 'tiznit'
    });

    // Reports
    // Report 1: Alice's report, structure A, Agadir
    await setDoc(doc(db, 'reports', 'report-alice'), {
      ownerUid: 'member-alice', anonymous: false, name: 'Alice', etab: 'Etab A',
      structureId: STRUCT_A, age: '12345', da: 'Math', category: 'Grief',
      description: 'Problème avec la direction de l établissement test',
      date: '2026-01-01', province: PROV_AGADIR,
      attachmentName: '', attachmentType: '', attachmentCount: 0, attachmentData: '',
      status: 'new', response: '', interventionLevel: 'local',
      assignedTo: '', assignedStructure: '', assignedProvince: '',
      memberResponsePending: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });

    // Report 2: Bob's report, structure B, Tiznit
    await setDoc(doc(db, 'reports', 'report-bob'), {
      ownerUid: 'member-bob', anonymous: false, name: 'Bob', etab: 'Etab B',
      structureId: STRUCT_B, age: '67890', da: 'Physique', category: 'Salaire',
      description: 'Retard de paiement des indemnités depuis 3 mois',
      date: '2026-02-02', province: PROV_TIZNIT,
      attachmentName: '', attachmentType: '', attachmentCount: 0, attachmentData: '',
      status: 'new', response: '', interventionLevel: 'local',
      assignedTo: '', assignedStructure: '', assignedProvince: '',
      memberResponsePending: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });

    // Report 3: Anonymous report, no owner
    await setDoc(doc(db, 'reports', 'report-anon'), {
      ownerUid: '', anonymous: true, name: '', etab: 'Etab A',
      structureId: STRUCT_A, age: '', da: '', category: 'Autre',
      description: 'Signalement anonyme concernant des dysfonctionnements',
      date: '2026-03-03', province: PROV_AGADIR,
      attachmentName: '', attachmentType: '', attachmentCount: 0, attachmentData: '',
      status: 'new', response: '', interventionLevel: 'local',
      assignedTo: '', assignedStructure: '', assignedProvince: '',
      memberResponsePending: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });

    // Report 4: Legacy report (no structureId, has response)
    await setDoc(doc(db, 'reports', 'report-legacy'), {
      ownerUid: 'member-alice', anonymous: false, name: 'Alice', etab: 'Etab A',
      age: '12345', da: 'Math', category: 'Grief',
      description: 'Ancien signalement sans structureId ni interventionLevel',
      date: '2026-01-01', province: PROV_AGADIR,
      attachmentName: 'old.pdf', attachmentType: 'application/pdf', attachmentCount: 1,
      attachmentData: 'base64data',
      status: 'in_progress', response: 'Ancienne réponse', createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    // Attachment for report-alice
    await setDoc(doc(db, 'reportAttachments', 'report-alice_0'), {
      data: 'base64imagedata', name: 'photo.jpg', type: 'image/jpeg',
      ownerUid: 'member-alice', anonymous: false, province: PROV_AGADIR,
      structureId: STRUCT_A, reportId: 'report-alice', interventionSeq: -1,
      createdAt: serverTimestamp()
    });
  });
}

before(async () => await setupFixtures());

// ---------- Helpers ----------

function ctx(uid, token) {
  return env.authenticatedContext(uid, token || userToken(uid));
}
function adminCtx() {
  return env.authenticatedContext('admin-uid', ADMIN_TOKEN);
}

// ---------- Tests : Lecture ----------

test('T1: subadmin local lit report de sa structure', async () => {
  const db = ctx('sublocal-a').firestore();
  await assertSucceeds(getDoc(doc(db, 'reports', 'report-alice')));
});

test('T2: subadmin local ne lit pas report d\'une autre structure', async () => {
  const db = ctx('sublocal-a').firestore();
  await assertFails(getDoc(doc(db, 'reports', 'report-bob')));
});

test('T9: subadmin provincial lit report de sa province', async () => {
  const db = ctx('subprov-agadir').firestore();
  await assertSucceeds(getDoc(doc(db, 'reports', 'report-alice')));
});

test('T10: subadmin provincial ne lit pas report d\'une autre province', async () => {
  const db = ctx('subprov-agadir').firestore();
  await assertFails(getDoc(doc(db, 'reports', 'report-bob')));
});

test('T14: admin lit tout', async () => {
  const db = adminCtx().firestore();
  await assertSucceeds(getDoc(doc(db, 'reports', 'report-alice')));
  await assertSucceeds(getDoc(doc(db, 'reports', 'report-bob')));
  await assertSucceeds(getDoc(doc(db, 'reports', 'report-anon')));
});

test('T20: membre lit son report', async () => {
  const db = ctx('member-alice').firestore();
  await assertSucceeds(getDoc(doc(db, 'reports', 'report-alice')));
});

test('T21: membre ne lit pas report d\'un autre', async () => {
  const db = ctx('member-alice').firestore();
  await assertFails(getDoc(doc(db, 'reports', 'report-bob')));
});

test('T22: membre ne lit pas report anonyme', async () => {
  const db = ctx('member-alice').firestore();
  await assertFails(getDoc(doc(db, 'reports', 'report-anon')));
});

// ---------- Tests : Création ----------

test('T-create-1: membre crée un report', async () => {
  const db = ctx('member-alice').firestore();
  await assertSucceeds(addDoc(collection(db, 'reports'), {
    ownerUid: 'member-alice', anonymous: false, name: 'Alice', etab: 'Etab A',
    structureId: STRUCT_A, age: '12345', da: 'Math', category: 'Grief',
    description: 'Nouveau signalement de test pour vérification',
    date: '2026-04-04', province: PROV_AGADIR,
    attachmentName: '', attachmentType: '', attachmentCount: 0, attachmentData: '',
    status: 'new', response: '', interventionLevel: 'local',
    assignedTo: '', assignedStructure: '', assignedProvince: '',
    memberResponsePending: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  }));
});

test('T-create-2: création anonyme', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertSucceeds(addDoc(collection(db, 'reports'), {
    ownerUid: '', anonymous: true, name: '', etab: 'Etab A',
    structureId: '', age: '', da: '', category: 'Autre',
    description: 'Signalement anonyme de test pour vérification',
    date: '2026-04-04', province: PROV_AGADIR,
    attachmentName: '', attachmentType: '', attachmentCount: 0, attachmentData: '',
    status: 'new', response: '', interventionLevel: 'local',
    assignedTo: '', assignedStructure: '', assignedProvince: '',
    memberResponsePending: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  }));
});

test('T-create-3: création sans structureId par membre connecté → autorisé', async () => {
  const db = ctx('member-alice').firestore();
  await assertSucceeds(addDoc(collection(db, 'reports'), {
    ownerUid: 'member-alice', anonymous: false, name: 'Alice', etab: 'Etab A',
    structureId: '', age: '12345', da: 'Math', category: 'Grief',
    description: 'Signalement sans structureId pour test',
    date: '2026-04-04', province: PROV_AGADIR,
    attachmentName: '', attachmentType: '', attachmentCount: 0, attachmentData: '',
    status: 'new', response: '', interventionLevel: 'local',
    assignedTo: '', assignedStructure: '', assignedProvince: '',
    memberResponsePending: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  }));
});

// ---------- Tests : Mise à jour par responsable ----------

test('T3: subadmin local met à jour report de sa structure', async () => {
  const db = ctx('sublocal-a').firestore();
  await assertSucceeds(updateDoc(doc(db, 'reports', 'report-alice'), {
    status: 'in_progress', response: 'En cours', updatedAt: serverTimestamp(),
    lastInterventionBy: 'sublocal-a', lastInterventionAt: serverTimestamp(),
    lastInterventionLevel: 'local'
  }));
});

test('T4: subadmin local ne met pas à jour report d\'une autre structure', async () => {
  const db = ctx('sublocal-a').firestore();
  await assertFails(updateDoc(doc(db, 'reports', 'report-bob'), {
    status: 'in_progress', updatedAt: serverTimestamp()
  }));
});

test('T18: admin ne modifie pas ownerUid', async () => {
  const db = adminCtx().firestore();
  await assertFails(updateDoc(doc(db, 'reports', 'report-alice'), {
    ownerUid: 'uid-attaquant', updatedAt: serverTimestamp()
  }));
});

test('T19: admin ne modifie pas province', async () => {
  const db = adminCtx().firestore();
  await assertFails(updateDoc(doc(db, 'reports', 'report-alice'), {
    province: PROV_TIZNIT, updatedAt: serverTimestamp()
  }));
});

// ---------- Tests : Transfert ----------

test('T36: transfert même province avec motif', async () => {
  const db = ctx('subprov-agadir').firestore();
  await assertSucceeds(updateDoc(doc(db, 'reports', 'report-alice'), {
    assignedTo: 'sublocal-a', transferredFrom: '', transferredTo: 'sublocal-a',
    transferredAt: serverTimestamp(), transferredReason: 'Transfert pour expertise',
    lastInterventionBy: 'subprov-agadir', lastInterventionAt: serverTimestamp(),
    lastInterventionLevel: 'provincial', updatedAt: serverTimestamp()
  }));
});

test('T38: transfert sans motif → refus', async () => {
  // Utiliser un report frais avec assignedTo différent
  const adminDb = adminCtx().firestore();
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'reports', 'report-t38'), {
      ownerUid: 'member-alice', anonymous: false, name: 'Alice', etab: 'Etab A',
      structureId: STRUCT_A, age: '12345', da: 'Math', category: 'Grief',
      description: 'Report pour test T38 transfert sans motif',
      date: '2026-05-05', province: PROV_AGADIR,
      attachmentName: '', attachmentType: '', attachmentCount: 0, attachmentData: '',
      status: 'new', response: '', interventionLevel: 'local',
      assignedTo: 'other-uid', assignedStructure: '', assignedProvince: '',
      memberResponsePending: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
  });
  const db = ctx('subprov-agadir').firestore();
  await assertFails(updateDoc(doc(db, 'reports', 'report-t38'), {
    assignedTo: 'sublocal-a', transferredFrom: 'other-uid', transferredTo: 'sublocal-a',
    transferredAt: serverTimestamp(), transferredReason: '',
    lastInterventionBy: 'subprov-agadir', lastInterventionAt: serverTimestamp(),
    lastInterventionLevel: 'provincial', updatedAt: serverTimestamp()
  }));
});

test('T39: transfert vers soi-même → refus', async () => {
  const db = ctx('subprov-agadir').firestore();
  await assertFails(updateDoc(doc(db, 'reports', 'report-alice'), {
    assignedTo: 'subprov-agadir', transferredFrom: '', transferredTo: 'subprov-agadir',
    transferredAt: serverTimestamp(), transferredReason: 'Transfert',
    lastInterventionBy: 'subprov-agadir', lastInterventionAt: serverTimestamp(),
    lastInterventionLevel: 'provincial', updatedAt: serverTimestamp()
  }));
});

test('T42: clôture avec closedAt et closedBy', async () => {
  const db = ctx('subprov-agadir').firestore();
  await assertSucceeds(updateDoc(doc(db, 'reports', 'report-alice'), {
    status: 'closed', closedAt: serverTimestamp(), closedBy: 'subprov-agadir',
    lastInterventionBy: 'subprov-agadir', lastInterventionAt: serverTimestamp(),
    lastInterventionLevel: 'provincial', updatedAt: serverTimestamp()
  }));
});

test('T43: clôture sans closedAt → refus', async () => {
  // Réouvrir d'abord
  const db = ctx('subprov-agadir').firestore();
  await updateDoc(doc(db, 'reports', 'report-alice'), {
    status: 'reopened', reopenedAt: serverTimestamp(), reopenedBy: 'subprov-agadir',
    reopenReason: 'Test', lastInterventionBy: 'subprov-agadir',
    lastInterventionAt: serverTimestamp(), lastInterventionLevel: 'provincial',
    updatedAt: serverTimestamp()
  }).catch(() => {});
  await assertFails(updateDoc(doc(db, 'reports', 'report-alice'), {
    status: 'closed', updatedAt: serverTimestamp()
  }));
});

test('T45: réouverture avec motif', async () => {
  const db = ctx('subprov-agadir').firestore();
  await assertSucceeds(updateDoc(doc(db, 'reports', 'report-alice'), {
    status: 'reopened', reopenedAt: serverTimestamp(), reopenedBy: 'subprov-agadir',
    reopenReason: 'Nouvel élément', lastInterventionBy: 'subprov-agadir',
    lastInterventionAt: serverTimestamp(), lastInterventionLevel: 'provincial',
    updatedAt: serverTimestamp()
  }));
});

test('T46: réouverture sans motif → refus', async () => {
  const db = ctx('subprov-agadir').firestore();
  await assertFails(updateDoc(doc(db, 'reports', 'report-alice'), {
    status: 'reopened', reopenedAt: serverTimestamp(), reopenedBy: 'subprov-agadir',
    reopenReason: '', lastInterventionBy: 'subprov-agadir',
    lastInterventionAt: serverTimestamp(), lastInterventionLevel: 'provincial',
    updatedAt: serverTimestamp()
  }));
});

// ---------- Tests : Membre ----------

test('T23: membre répond à pending_response', async () => {
  // Mettre en pending_response d'abord
  const adminDb = adminCtx().firestore();
  await updateDoc(doc(adminDb, 'reports', 'report-alice'), {
    status: 'pending_response', memberResponsePending: true,
    lastInterventionBy: 'admin-uid', lastInterventionAt: serverTimestamp(),
    lastInterventionLevel: 'national', updatedAt: serverTimestamp()
  }).catch(() => {});
  const db = ctx('member-alice').firestore();
  await assertSucceeds(updateDoc(doc(db, 'reports', 'report-alice'), {
    status: 'in_progress', memberResponsePending: false,
    lastInterventionBy: 'member-alice', lastInterventionAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }));
});

test('T24: membre ne répond pas hors pending_response', async () => {
  const db = ctx('member-alice').firestore();
  await assertFails(updateDoc(doc(db, 'reports', 'report-alice'), {
    status: 'in_progress', memberResponsePending: false,
    lastInterventionBy: 'member-alice', lastInterventionAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }));
});

test('T27: membre réouvre son dossier clôturé', async () => {
  const adminDb = adminCtx().firestore();
  await updateDoc(doc(adminDb, 'reports', 'report-alice'), {
    status: 'closed', closedAt: serverTimestamp(), closedBy: 'admin-uid',
    lastInterventionBy: 'admin-uid', lastInterventionAt: serverTimestamp(),
    lastInterventionLevel: 'national', updatedAt: serverTimestamp()
  }).catch(() => {});
  const db = ctx('member-alice').firestore();
  await assertSucceeds(updateDoc(doc(db, 'reports', 'report-alice'), {
    status: 'reopened', reopenedAt: serverTimestamp(), reopenedBy: 'member-alice',
    reopenReason: 'Nouveau fait', lastInterventionBy: 'member-alice',
    lastInterventionAt: serverTimestamp(), updatedAt: serverTimestamp()
  }));
});

test('T28: membre réouvre sans motif → refus', async () => {
  const db = ctx('member-alice').firestore();
  await assertFails(updateDoc(doc(db, 'reports', 'report-alice'), {
    status: 'reopened', reopenedAt: serverTimestamp(), reopenedBy: 'member-alice',
    reopenReason: '', lastInterventionBy: 'member-alice',
    lastInterventionAt: serverTimestamp(), updatedAt: serverTimestamp()
  }));
});

test('T29: membre ne modifie pas le status hors réponse/réouverture', async () => {
  const db = ctx('member-alice').firestore();
  await assertFails(updateDoc(doc(db, 'reports', 'report-alice'), {
    status: 'closed', updatedAt: serverTimestamp()
  }));
});

// ---------- Tests : Interventions ----------

test('T5: subadmin local crée intervention sur report de sa structure', async () => {
  const db = ctx('sublocal-a').firestore();
  await assertSucceeds(addDoc(collection(db, 'reportInterventions'), {
    reportId: 'report-alice', seq: 1, authorUid: 'sublocal-a',
    authorRole: 'subadminLocal', authorName: 'SubLocal A',
    authorStructure: STRUCT_A, authorProvince: 'agadir',
    type: 'admin_note', level: 'local', content: 'Note de test',
    attachmentIds: [], statusBefore: 'new', statusAfter: 'in_progress',
    createdAt: serverTimestamp(), isSystem: false
  }));
});

test('T6: subadmin local ne crée pas intervention sur report d\'une autre structure', async () => {
  const db = ctx('sublocal-a').firestore();
  await assertFails(addDoc(collection(db, 'reportInterventions'), {
    reportId: 'report-bob', seq: 1, authorUid: 'sublocal-a',
    authorRole: 'subadminLocal', authorName: 'SubLocal A',
    type: 'admin_note', level: 'local', content: 'Note de test',
    attachmentIds: [], statusBefore: 'new', statusAfter: 'in_progress',
    createdAt: serverTimestamp(), isSystem: false
  }));
});

test('T25: membre crée intervention member_reply', async () => {
  const db = ctx('member-alice').firestore();
  await assertSucceeds(addDoc(collection(db, 'reportInterventions'), {
    reportId: 'report-alice', seq: 2, authorUid: 'member-alice',
    authorRole: 'member', authorName: 'Alice',
    type: 'member_reply', level: 'local', content: 'Ma réponse',
    attachmentIds: [], statusBefore: 'pending_response', statusAfter: 'in_progress',
    createdAt: serverTimestamp(), isSystem: false
  }));
});

test('T26: membre ne crée pas intervention admin_note', async () => {
  const db = ctx('member-alice').firestore();
  await assertFails(addDoc(collection(db, 'reportInterventions'), {
    reportId: 'report-alice', seq: 3, authorUid: 'member-alice',
    authorRole: 'member', authorName: 'Alice',
    type: 'admin_note', level: 'local', content: 'Note falsifiée',
    attachmentIds: [], statusBefore: 'new', statusAfter: 'in_progress',
    createdAt: serverTimestamp(), isSystem: false
  }));
});

test('T31: intervention immuable (update refusé)', async () => {
  const db = adminCtx().firestore();
  const snap = await getDocs(query(collection(db, 'reportInterventions'), where('reportId', '==', 'report-alice')));
  if (snap.docs.length > 0) {
    await assertFails(updateDoc(snap.docs[0].ref, { content: 'Modifié' }));
  }
});

test('T32: intervention immuable (delete refusé)', async () => {
  const db = adminCtx().firestore();
  const snap = await getDocs(query(collection(db, 'reportInterventions'), where('reportId', '==', 'report-alice')));
  if (snap.docs.length > 0) {
    await assertFails(deleteDoc(snap.docs[0].ref));
  }
});

// ---------- Tests : Pièces jointes ----------

test('T49: subadmin lit pièces de sa province', async () => {
  const db = ctx('subprov-agadir').firestore();
  await assertSucceeds(getDoc(doc(db, 'reportAttachments', 'report-alice_0')));
});

test('T50: membre lit pièces de son dossier', async () => {
  const db = ctx('member-alice').firestore();
  await assertSucceeds(getDoc(doc(db, 'reportAttachments', 'report-alice_0')));
});

test('T51: membre ne lit pas pièces d\'un autre dossier', async () => {
  const db = ctx('member-bob').firestore();
  await assertFails(getDoc(doc(db, 'reportAttachments', 'report-alice_0')));
});

test('T52: attachment > 420000 → refus', async () => {
  const db = ctx('member-alice').firestore();
  await assertFails(addDoc(collection(db, 'reportAttachments'), {
    data: 'x'.repeat(420001), name: 'big.jpg', type: 'image/jpeg',
    ownerUid: 'member-alice', anonymous: false, province: PROV_AGADIR,
    structureId: STRUCT_A, reportId: 'report-alice', interventionSeq: -1,
    createdAt: serverTimestamp()
  }));
});

test('T53: attachment data vide → refus', async () => {
  const db = ctx('member-alice').firestore();
  await assertFails(addDoc(collection(db, 'reportAttachments'), {
    data: '', name: 'empty.jpg', type: 'image/jpeg',
    ownerUid: 'member-alice', anonymous: false, province: PROV_AGADIR,
    structureId: STRUCT_A, reportId: 'report-alice', interventionSeq: -1,
    createdAt: serverTimestamp()
  }));
});

test('T54: modification attachment → refus', async () => {
  const db = adminCtx().firestore();
  await assertFails(updateDoc(doc(db, 'reportAttachments', 'report-alice_0'), {
    name: 'renamed.jpg'
  }));
});

test('T55: suppression attachment par admin', async () => {
  // Créer un attachment temporaire
  const adminDb = env.withSecurityRulesDisabled ? adminCtx().firestore() : null;
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'reportAttachments', 'temp-attach'), {
      data: 'testdata', name: 'temp.jpg', type: 'image/jpeg',
      ownerUid: 'member-alice', anonymous: false, province: PROV_AGADIR,
      structureId: STRUCT_A, reportId: 'report-alice', interventionSeq: -1,
      createdAt: serverTimestamp()
    });
  });
  const db = adminCtx().firestore();
  await assertSucceeds(deleteDoc(doc(db, 'reportAttachments', 'temp-attach')));
});

test('T56: suppression attachment par non-admin → refus', async () => {
  const db = ctx('member-alice').firestore();
  await assertFails(deleteDoc(doc(db, 'reportAttachments', 'report-alice_0')));
});

// ---------- Tests : Compatibilité ----------

test('T57: ancien report sans interventionLevel lisible', async () => {
  const db = adminCtx().firestore();
  const snap = await getDoc(doc(db, 'reports', 'report-legacy'));
  assert.ok(snap.exists());
});

test('T58: ancien report avec attachmentData lisible', async () => {
  const db = adminCtx().firestore();
  const snap = await getDoc(doc(db, 'reports', 'report-legacy'));
  assert.ok(snap.exists());
  assert.equal(snap.data().attachmentData, 'base64data');
});

test('T60: nouveau report avec interventionLevel', async () => {
  const db = adminCtx().firestore();
  const snap = await getDoc(doc(db, 'reports', 'report-alice'));
  assert.ok(snap.exists());
  assert.equal(snap.data().interventionLevel, 'local');
});

// ---------- Tests : Anomalies ----------

test('T-anomaly-1: contournement transfert via assignedTo sans transferredAt → refus', async () => {
  const db = ctx('subprov-agadir').firestore();
  await assertFails(updateDoc(doc(db, 'reports', 'report-alice'), {
    assignedTo: 'sublocal-a', updatedAt: serverTimestamp()
  }));
});

test('T-anomaly-2: falsification authorRole → refus', async () => {
  const db = ctx('member-alice').firestore();
  await assertFails(addDoc(collection(db, 'reportInterventions'), {
    reportId: 'report-alice', seq: 99, authorUid: 'member-alice',
    authorRole: 'admin', authorName: 'Admin falsifié',
    type: 'admin_note', level: 'local', content: 'Falsification',
    attachmentIds: [], statusBefore: 'new', statusAfter: 'in_progress',
    createdAt: serverTimestamp(), isSystem: false
  }));
});

test('T-anomaly-3: événement système falsifié → refus', async () => {
  const db = ctx('member-alice').firestore();
  await assertFails(addDoc(collection(db, 'reportInterventions'), {
    reportId: 'report-alice', seq: 100, authorUid: 'member-alice',
    authorRole: 'member', authorName: 'Alice',
    type: 'system', level: 'local', content: 'Faux système',
    attachmentIds: [], statusBefore: 'new', statusAfter: 'new',
    createdAt: serverTimestamp(), isSystem: true
  }));
});

test('T-anomaly-4: admin lit interventions', async () => {
  const db = adminCtx().firestore();
  await assertSucceeds(getDocs(query(collection(db, 'reportInterventions'), where('reportId', '==', 'report-alice'))));
});

test('T-anomaly-5: subadmin local lit interventions de sa structure', async () => {
  const db = ctx('sublocal-a').firestore();
  await assertSucceeds(getDocs(query(collection(db, 'reportInterventions'), where('reportId', '==', 'report-alice'))));
});

test('T-anomaly-6: subadmin local ne lit pas interventions d\'une autre structure', async () => {
  const db = ctx('sublocal-a').firestore();
  await assertFails(getDocs(query(collection(db, 'reportInterventions'), where('reportId', '==', 'report-bob'))));
});

// ---------- Tests manquants : T7, T8 ----------

test('T7: subadmin local lit interventions de sa structure', async () => {
  const db = ctx('sublocal-a').firestore();
  await assertSucceeds(getDocs(query(collection(db, 'reportInterventions'), where('reportId', '==', 'report-alice'))));
});

test('T8: subadmin local ne lit pas interventions d\'une autre structure', async () => {
  const db = ctx('sublocal-a').firestore();
  await assertFails(getDocs(query(collection(db, 'reportInterventions'), where('reportId', '==', 'report-bob'))));
});

// ---------- T11, T12, T13 ----------

test('T11: subadmin provincial ne transfère pas inter-provinces', async () => {
  const db = ctx('subprov-agadir').firestore();
  await assertFails(updateDoc(doc(db, 'reports', 'report-alice'), {
    assignedTo: 'subprov-tiznit', transferredFrom: 'subprov-agadir',
    transferredTo: 'subprov-tiznit', transferredAt: serverTimestamp(),
    transferredReason: 'Transfert inter-provinces',
    lastInterventionBy: 'subprov-agadir', lastInterventionAt: serverTimestamp(),
    lastInterventionLevel: 'provincial', updatedAt: serverTimestamp()
  }));
});

test('T12: subadmin provincial clôture un report', async () => {
  const db = ctx('subprov-tiznit').firestore();
  await env.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), 'reports', 'report-bob'), {
      status: 'in_progress', updatedAt: serverTimestamp()
    });
  });
  await assertSucceeds(updateDoc(doc(db, 'reports', 'report-bob'), {
    status: 'closed', closedAt: serverTimestamp(), closedBy: 'subprov-tiznit',
    lastInterventionBy: 'subprov-tiznit', lastInterventionAt: serverTimestamp(),
    lastInterventionLevel: 'provincial', updatedAt: serverTimestamp()
  }));
});

test('T13: subadmin provincial réouvre un report clôturé', async () => {
  const db = ctx('subprov-tiznit').firestore();
  await assertSucceeds(updateDoc(doc(db, 'reports', 'report-bob'), {
    status: 'reopened', reopenedAt: serverTimestamp(), reopenedBy: 'subprov-tiznit',
    reopenReason: 'Nouvel élément', lastInterventionBy: 'subprov-tiznit',
    lastInterventionAt: serverTimestamp(), lastInterventionLevel: 'provincial',
    updatedAt: serverTimestamp()
  }));
});

// ---------- T15, T16, T17 ----------

test('T15: admin supprime un report', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'reports', 'report-to-delete'), {
      ownerUid: 'member-alice', anonymous: false, name: 'Alice', etab: 'Etab A',
      structureId: STRUCT_A, age: '12345', da: 'Math', category: 'Grief',
      description: 'Report à supprimer pour test', date: '2026-06-06',
      province: PROV_AGADIR, attachmentName: '', attachmentType: '',
      attachmentCount: 0, attachmentData: '', status: 'new', response: '',
      interventionLevel: 'local', assignedTo: '', assignedStructure: '',
      assignedProvince: '', memberResponsePending: false,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
  });
  const db = adminCtx().firestore();
  await assertSucceeds(deleteDoc(doc(db, 'reports', 'report-to-delete')));
});

test('T16: admin transfère inter-provinces', async () => {
  const db = adminCtx().firestore();
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'reports', 'report-transfer-admin'), {
      ownerUid: 'member-alice', anonymous: false, name: 'Alice', etab: 'Etab A',
      structureId: STRUCT_A, age: '12345', da: 'Math', category: 'Grief',
      description: 'Report pour transfert admin', date: '2026-07-07',
      province: PROV_AGADIR, attachmentName: '', attachmentType: '',
      attachmentCount: 0, attachmentData: '', status: 'new', response: '',
      interventionLevel: 'local', assignedTo: 'subprov-agadir', assignedStructure: '',
      assignedProvince: '', memberResponsePending: false,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
  });
  await assertSucceeds(updateDoc(doc(db, 'reports', 'report-transfer-admin'), {
    assignedTo: 'subprov-tiznit', transferredFrom: 'subprov-agadir',
    transferredTo: 'subprov-tiznit', transferredAt: serverTimestamp(),
    transferredReason: 'Transfert admin inter-provinces',
    lastInterventionBy: 'admin-uid', lastInterventionAt: serverTimestamp(),
    lastInterventionLevel: 'national', updatedAt: serverTimestamp()
  }));
});

test('T17: admin clôture et réouvre', async () => {
  const db = adminCtx().firestore();
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'reports', 'report-close-reopen'), {
      ownerUid: 'member-alice', anonymous: false, name: 'Alice', etab: 'Etab A',
      structureId: STRUCT_A, age: '12345', da: 'Math', category: 'Grief',
      description: 'Report pour clôture et réouverture', date: '2026-08-08',
      province: PROV_AGADIR, attachmentName: '', attachmentType: '',
      attachmentCount: 0, attachmentData: '', status: 'new', response: '',
      interventionLevel: 'local', assignedTo: '', assignedStructure: '',
      assignedProvince: '', memberResponsePending: false,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
  });
  await assertSucceeds(updateDoc(doc(db, 'reports', 'report-close-reopen'), {
    status: 'closed', closedAt: serverTimestamp(), closedBy: 'admin-uid',
    lastInterventionBy: 'admin-uid', lastInterventionAt: serverTimestamp(),
    lastInterventionLevel: 'national', updatedAt: serverTimestamp()
  }));
  await assertSucceeds(updateDoc(doc(db, 'reports', 'report-close-reopen'), {
    status: 'reopened', reopenedAt: serverTimestamp(), reopenedBy: 'admin-uid',
    reopenReason: 'Nouvel élément', lastInterventionBy: 'admin-uid',
    lastInterventionAt: serverTimestamp(), lastInterventionLevel: 'national',
    updatedAt: serverTimestamp()
  }));
});

// ---------- T30 ----------

test('T30: membre ajoute pièce jointe à son dossier', async () => {
  const db = ctx('member-alice').firestore();
  await assertSucceeds(addDoc(collection(db, 'reportAttachments'), {
    data: 'base64imagedata', name: 'photo.jpg', type: 'image/jpeg',
    ownerUid: 'member-alice', anonymous: false, province: PROV_AGADIR,
    structureId: STRUCT_A, reportId: 'report-alice', interventionSeq: -1,
    createdAt: serverTimestamp()
  }));
});

// ---------- T33, T34 ----------

test('T33: admin ne modifie pas intervention', async () => {
  const db = adminCtx().firestore();
  const snap = await getDocs(query(collection(db, 'reportInterventions'), where('reportId', '==', 'report-alice')));
  if (snap.docs.length > 0) {
    await assertFails(updateDoc(snap.docs[0].ref, { content: 'Modifié par admin' }));
  }
});

test('T34: admin ne supprime pas intervention', async () => {
  const db = adminCtx().firestore();
  const snap = await getDocs(query(collection(db, 'reportInterventions'), where('reportId', '==', 'report-alice')));
  if (snap.docs.length > 0) {
    await assertFails(deleteDoc(snap.docs[0].ref));
  }
});

// ---------- T37 ----------

test('T37: subadmin provincial ne transfère pas vers une autre province', async () => {
  const db = ctx('subprov-agadir').firestore();
  await assertFails(updateDoc(doc(db, 'reports', 'report-alice'), {
    assignedTo: 'subprov-tiznit', transferredFrom: 'subprov-agadir',
    transferredTo: 'subprov-tiznit', transferredAt: serverTimestamp(),
    transferredReason: 'Transfert vers Tiznit',
    lastInterventionBy: 'subprov-agadir', lastInterventionAt: serverTimestamp(),
    lastInterventionLevel: 'provincial', updatedAt: serverTimestamp()
  }));
});

// ---------- T41 ----------

test('T41: admin transfère inter-provinces', async () => {
  const db = adminCtx().firestore();
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'reports', 'report-t41'), {
      ownerUid: 'member-alice', anonymous: false, name: 'Alice', etab: 'Etab A',
      structureId: STRUCT_A, age: '12345', da: 'Math', category: 'Grief',
      description: 'Report pour transfert admin T41', date: '2026-09-09',
      province: PROV_AGADIR, attachmentName: '', attachmentType: '',
      attachmentCount: 0, attachmentData: '', status: 'new', response: '',
      interventionLevel: 'local', assignedTo: 'subprov-agadir', assignedStructure: '',
      assignedProvince: '', memberResponsePending: false,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
  });
  await assertSucceeds(updateDoc(doc(db, 'reports', 'report-t41'), {
    assignedTo: 'subprov-tiznit', transferredFrom: 'subprov-agadir',
    transferredTo: 'subprov-tiznit', transferredAt: serverTimestamp(),
    transferredReason: 'Transfert admin',
    lastInterventionBy: 'admin-uid', lastInterventionAt: serverTimestamp(),
    lastInterventionLevel: 'national', updatedAt: serverTimestamp()
  }));
});

// ---------- T44 ----------

test('T44: clôture d\'un report déjà clôturé → refus', async () => {
  const db = adminCtx().firestore();
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'reports', 'report-t44'), {
      ownerUid: 'member-alice', anonymous: false, name: 'Alice', etab: 'Etab A',
      structureId: STRUCT_A, age: '12345', da: 'Math', category: 'Grief',
      description: 'Report déjà clôturé', date: '2026-10-10',
      province: PROV_AGADIR, attachmentName: '', attachmentType: '',
      attachmentCount: 0, attachmentData: '', status: 'closed', response: '',
      interventionLevel: 'local', assignedTo: '', assignedStructure: '',
      assignedProvince: '', memberResponsePending: false,
      closedAt: serverTimestamp(), closedBy: 'admin-uid',
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
  });
  await assertFails(updateDoc(doc(db, 'reports', 'report-t44'), {
    status: 'closed', closedAt: serverTimestamp(), closedBy: 'admin-uid',
    lastInterventionBy: 'admin-uid', lastInterventionAt: serverTimestamp(),
    lastInterventionLevel: 'national', updatedAt: serverTimestamp()
  }));
});

// ---------- T47, T48 ----------

test('T47: membre réouvre son dossier clôturé', async () => {
  const db = ctx('member-alice').firestore();
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'reports', 'report-t47'), {
      ownerUid: 'member-alice', anonymous: false, name: 'Alice', etab: 'Etab A',
      structureId: STRUCT_A, age: '12345', da: 'Math', category: 'Grief',
      description: 'Report pour réouverture membre', date: '2026-11-11',
      province: PROV_AGADIR, attachmentName: '', attachmentType: '',
      attachmentCount: 0, attachmentData: '', status: 'closed', response: '',
      interventionLevel: 'local', assignedTo: '', assignedStructure: '',
      assignedProvince: '', memberResponsePending: false,
      closedAt: serverTimestamp(), closedBy: 'admin-uid',
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
  });
  await assertSucceeds(updateDoc(doc(db, 'reports', 'report-t47'), {
    status: 'reopened', reopenedAt: serverTimestamp(), reopenedBy: 'member-alice',
    reopenReason: 'Nouveau fait important', lastInterventionBy: 'member-alice',
    lastInterventionAt: serverTimestamp(), updatedAt: serverTimestamp()
  }));
});

test('T48: membre ne réouvre pas le dossier d\'un autre', async () => {
  const db = ctx('member-bob').firestore();
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'reports', 'report-t48'), {
      ownerUid: 'member-alice', anonymous: false, name: 'Alice', etab: 'Etab A',
      structureId: STRUCT_A, age: '12345', da: 'Math', category: 'Grief',
      description: 'Report d\'Alice', date: '2026-12-12',
      province: PROV_AGADIR, attachmentName: '', attachmentType: '',
      attachmentCount: 0, attachmentData: '', status: 'closed', response: '',
      interventionLevel: 'local', assignedTo: '', assignedStructure: '',
      assignedProvince: '', memberResponsePending: false,
      closedAt: serverTimestamp(), closedBy: 'admin-uid',
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
  });
  await assertFails(updateDoc(doc(db, 'reports', 'report-t48'), {
    status: 'reopened', reopenedAt: serverTimestamp(), reopenedBy: 'member-bob',
    reopenReason: 'Tentative', lastInterventionBy: 'member-bob',
    lastInterventionAt: serverTimestamp(), updatedAt: serverTimestamp()
  }));
});

// ---------- T59 ----------

test('T59: ancien attachment format {id} lisible', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'reportAttachments', 'old-report-id'), {
      data: 'base64data', name: 'old.pdf', type: 'application/pdf',
      ownerUid: 'member-alice', anonymous: false, province: PROV_AGADIR,
      createdAt: serverTimestamp()
    });
  });
  const db = adminCtx().firestore();
  await assertSucceeds(getDoc(doc(db, 'reportAttachments', 'old-report-id')));
});
