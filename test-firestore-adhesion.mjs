/* ============================================================
   Tests des règles d'adhésion numérique (firestore.rules)
   ------------------------------------------------------------
   Lancement :
     firebase emulators:exec --only firestore "node test-firestore-adhesion.mjs"
   ou : npm run test:firestore

   Le payload testé reproduit ce que www/cloud.js envoie via
   submitAdhesion() : le dossier signé par l'adhérent uniquement
   (adhesionRequests/{uid}). L'adhérent ne génère plus de PDF :
   celui-ci est produit puis enregistré par un responsable habilité
   (adhesionDocuments/{uid}) après signature et validation.
   ============================================================ */

import test, { after, before } from 'node:test';
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
  serverTimestamp
} from 'firebase/firestore';

const PROJECT_ID = 'ugtm-adhesion-test';

// Comptes de test
const ALICE = 'alice-uid';     // adhérente d'Agadir
const BOB = 'bob-uid';         // adhérent d'une autre province (isolé)
const DAVE = 'dave-uid';       // adhérent de Tata
const SARA = 'sara-uid';         // adhérente de Tiznit
const SUB_AGADIR = 'sub-agadir-uid'; // sous-admin d'Agadir
const SUB_TIZNIT = 'sub-tiznit-uid'; // sous-admin de Tiznit
const PEND_AG1 = 'pend-ag1-uid';     // membre en attente (numérotation)
const PEND_AG2 = 'pend-ag2-uid';     // membre en attente (numérotation)
const PEND_AG3 = 'pend-ag3-uid';     // membre en attente (numérotation)
const PEND_ADM = 'pend-adm-uid';     // membre en attente (activation admin)

const ADMIN_TOKEN = { email: 'abaray66@gmail.com', email_verified: true };
const USER_TOKEN = (uid) => ({ email: uid + '@example.com', email_verified: true });

const env = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: {
    rules: readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8')
  }
});

after(async () => {
  await env.cleanup();
});

// ---------- payloads (miroir de submitAdhesion) ----------

function applicationPayload(province, over = {}) {
  return {
    nom: 'El Amrani',
    prenom: 'Fatima',
    cin: 'BE123456',
    dob: '1990-01-01',
    phone: '0600000000',
    address: 'Hay Mohammadi, Agadir',
    province,
    establishment: 'Lycée Al Wahda',
    service: 'Direction',
    function: 'Directeur',
    specialty: '',
    ppr: '12345',
    type: 'first',
    reason: '',
    commitment: true,
    date: '2026-10-11',
    ...over
  };
}

function requestPayload(uid, province, over = {}) {
  return {
    uid,
    email: uid + '@example.com',
    province,
    application: applicationPayload(province, over.application || {}),
    signature: 'data:image/png;base64,U0dPUFJJUw==',
    status: 'pending',
    adminNote: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== 'application'))
  };
}

function pdfPayload(uid, province) {
  return {
    uid,
    province,
    fileName: 'demande-adhesion-' + uid + '.pdf',
    mimeType: 'application/pdf',
    data: 'JVBERi0xLjQK', // en-tête d'un vrai PDF
    createdAt: serverTimestamp()
  };
}

// ---------- fixtures partagées ----------

before(async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    // Dave dépose déjà une demande pour Tata (sans PDF).
    await setDoc(doc(db, 'adhesionRequests', DAVE), requestPayload(DAVE, 'tata'));
    // Sara dépose une demande pour Tiznit.
    await setDoc(doc(db, 'adhesionRequests', SARA), requestPayload(SARA, 'tiznit'));
    // Profils des sous-admins.
    await setDoc(doc(db, 'members', SUB_AGADIR), {
      status: 'active',
      role: 'subadmin',
      adminProvince: 'agadir'
    });
    await setDoc(doc(db, 'members', SUB_TIZNIT), {
      status: 'active',
      role: 'subadmin',
      adminProvince: 'tiznit'
    });
    // Membres en attente d'activation (scénarios de numérotation).
    for (const uid of [PEND_AG1, PEND_AG2, PEND_AG3, PEND_ADM]) {
      await setDoc(doc(db, 'members', uid), {
        status: 'pending',
        prov: 'agadir',
        name: 'Membre ' + uid,
        email: uid + '@example.com',
        createdAt: Date.now()
      });
    }
  });
});

// ---------- scénarios ----------

test('un adhérent peut créer sa demande (dossier signé seul)', async () => {
  const db = env.authenticatedContext(ALICE, USER_TOKEN(ALICE)).firestore();
  // Exactement ce qu'envoie submitAdhesion() : le dossier et la
  // signature de l'adhérent, sans aucun PDF.
  await assertSucceeds(setDoc(doc(db, 'adhesionRequests', ALICE), requestPayload(ALICE, 'agadir')));
});

test('un adhérent ne peut pas recréer sa demande', async () => {
  const db = env.authenticatedContext(ALICE, USER_TOKEN(ALICE)).firestore();
  // Nouvelle tentative avec une signature différente : la réécriture
  // du dossier signé (ou du statut) doit rester refusée.
  await assertFails(
    setDoc(doc(db, 'adhesionRequests', ALICE), {
      ...requestPayload(ALICE, 'agadir'),
      signature: 'data:image/png;base64,QXV0cmU=?'
    })
  );
});

test('un adhérent ne peut pas lire le dossier d’un autre', async () => {
  const db = env.authenticatedContext(BOB, USER_TOKEN(BOB)).firestore();
  await assertFails(getDoc(doc(db, 'adhesionRequests', ALICE)));
});

test('administrateur général peut lire une demande', async () => {
  const db = env.authenticatedContext('admin-uid', ADMIN_TOKEN).firestore();
  await assertSucceeds(getDoc(doc(db, 'adhesionRequests', ALICE)));
});

test('administrateur provincial peut lire sa province', async () => {
  const db = env.authenticatedContext(SUB_AGADIR, USER_TOKEN(SUB_AGADIR)).firestore();
  await assertSucceeds(getDoc(doc(db, 'adhesionRequests', ALICE)));
});

test('administrateur provincial ne peut pas lire une autre province', async () => {
  const db = env.authenticatedContext(SUB_TIZNIT, USER_TOKEN(SUB_TIZNIT)).firestore();
  // Sara (Tiznit) est visible par son sous-admin…
  await assertSucceeds(getDoc(doc(db, 'adhesionRequests', SARA)));
  // …mais Dave (Tata) ne l'est pas.
  await assertFails(getDoc(doc(db, 'adhesionRequests', DAVE)));
});

test('adhérent ne peut pas modifier le statut ni le dossier signé', async () => {
  const db = env.authenticatedContext(ALICE, USER_TOKEN(ALICE)).firestore();
  await assertFails(updateDoc(doc(db, 'adhesionRequests', ALICE), {
    status: 'accepted',
    updatedAt: serverTimestamp()
  }));
  await assertFails(updateDoc(doc(db, 'adhesionRequests', ALICE), {
    signature: 'data:image/png;base64,Q2FyaWNPbg==',
    updatedAt: serverTimestamp()
  }));
});

test('administrateur provincial peut modifier le statut sans modifier le dossier signé', async () => {
  const db = env.authenticatedContext(SUB_AGADIR, USER_TOKEN(SUB_AGADIR)).firestore();
  await assertSucceeds(updateDoc(doc(db, 'adhesionRequests', ALICE), {
    status: 'accepted',
    adminNote: 'Dossier complet.',
    updatedAt: serverTimestamp()
  }));
});

test('un PDF isolé est refusé et un PDF de mauvaise province est refusé', async () => {
  // 1. Bob n'a aucune demande : son PDF isolé doit être refusé.
  const bobDb = env.authenticatedContext(BOB, USER_TOKEN(BOB)).firestore();
  await assertFails(setDoc(doc(bobDb, 'adhesionDocuments', BOB), pdfPayload(BOB, 'agadir')));
  // 2. Dave a une demande pour Tata : un PDF annonçant Tiznit est refusé.
  const daveDb = env.authenticatedContext(DAVE, USER_TOKEN(DAVE)).firestore();
  await assertFails(setDoc(doc(daveDb, 'adhesionDocuments', DAVE), pdfPayload(DAVE, 'tiznit')));
});

test('un adhérent ne peut pas lire le PDF d’un autre', async () => {
  const db = env.authenticatedContext(BOB, USER_TOKEN(BOB)).firestore();
  await assertFails(getDoc(doc(db, 'adhesionDocuments', ALICE)));
});

/* ==========================================================
   RENVOI APRÈS DEMANDE DE COMPLÉMENT (needs_completion)
   ========================================================== */

test('renvoi après complément : le dossier signé repasse en attente', async () => {
  // 1) Le responsable marque le dossier d'Alice en complément.
  const adminDb = env.authenticatedContext('admin-uid', ADMIN_TOKEN).firestore();
  await assertSucceeds(updateDoc(doc(adminDb, 'adhesionRequests', ALICE), {
    status: 'needs_completion',
    adminNote: 'Merci de renvoyer le justificatif.',
    updatedAt: serverTimestamp()
  }));

  const db = env.authenticatedContext(ALICE, USER_TOKEN(ALICE)).firestore();

  // 2) L'adhérent ne peut aucunement écrire le PDF officiel.
  await assertFails(setDoc(doc(db, 'adhesionDocuments', ALICE), pdfPayload(ALICE, 'agadir')));

  // 3) Le vrai renvoi — dossier seul, comme dans submitAdhesion — est accepté.
  await assertSucceeds(updateDoc(doc(db, 'adhesionRequests', ALICE), {
    application: applicationPayload('agadir', { phone: '0611111111' }),
    signature: 'data:image/png;base64,UmVzb21pbg==',
    status: 'pending',
    adminNote: '',
    updatedAt: serverTimestamp()
  }));
});

test('le renvoi est refusé tant que le dossier est en attente (pending)', async () => {
  const db = env.authenticatedContext(DAVE, USER_TOKEN(DAVE)).firestore();
  await assertFails(updateDoc(doc(db, 'adhesionRequests', DAVE), {
    application: applicationPayload('tata', { phone: '0622222222' }),
    signature: 'data:image/png;base64,RmFsc2U=',
    status: 'pending',
    adminNote: '',
    updatedAt: serverTimestamp()
  }));
});

test('l’adhérent ne peut jamais écrire le PDF officiel', async () => {
  const db = env.authenticatedContext(ALICE, USER_TOKEN(ALICE)).firestore();
  await assertFails(setDoc(doc(db, 'adhesionDocuments', ALICE), pdfPayload(ALICE, 'agadir')));
  await assertFails(updateDoc(doc(db, 'adhesionDocuments', ALICE), {
    fileName: 'demande-adhesion-' + ALICE + '.pdf',
    mimeType: 'application/pdf',
    data: 'JVBERi0xLjQKSGFja2Vk',
    updatedAt: serverTimestamp()
  }));
});

/* ==========================================================
   RENOUVELLEMENT APRÈS ACCEPTATION (accepted + type renewal)
   ========================================================== */

test('renouvellement après acceptation : dossier + PDF remis en attente', async () => {
  // 1) Le responsable accepte la demande d'Alice.
  const adminDb = env.authenticatedContext('admin-uid', ADMIN_TOKEN).firestore();
  await assertSucceeds(updateDoc(doc(adminDb, 'adhesionRequests', ALICE), {
    status: 'accepted',
    adminNote: 'Dossier complet.',
    updatedAt: serverTimestamp()
  }));

  const db = env.authenticatedContext(ALICE, USER_TOKEN(ALICE)).firestore();

  // 2) Un renouvellement sans motif est refusé (motif exigé).
  await assertFails(updateDoc(doc(db, 'adhesionRequests', ALICE), {
    application: applicationPayload('agadir', { type: 'renewal', reason: '' }),
    signature: 'data:image/png;base64,Um52ZWw=',
    status: 'pending',
    adminNote: '',
    updatedAt: serverTimestamp()
  }));

  // 3) Une « première adhésion » après acceptation est refusée :
  //    un adhérent déjà accepté ne peut que renouveler.
  await assertFails(updateDoc(doc(db, 'adhesionRequests', ALICE), {
    application: applicationPayload('agadir', { type: 'first', reason: '' }),
    signature: 'data:image/png;base64,Um52ZWw=',
    status: 'pending',
    adminNote: '',
    updatedAt: serverTimestamp()
  }));

  // 4) L'adhérent ne peut pas écrire le PDF officiel (statut accepted).
  await assertFails(setDoc(doc(db, 'adhesionDocuments', ALICE), pdfPayload(ALICE, 'agadir')));

  // 5) Le vrai renouvellement — dossier seul, comme dans submitAdhesion —
  //    est accepté : motif présent, type renewal, statut pending.
  await assertSucceeds(updateDoc(doc(db, 'adhesionRequests', ALICE), {
    application: applicationPayload('agadir', {
      type: 'renewal',
      reason: 'Renouvellement annuel 2026-2027',
      phone: '0633333333'
    }),
    signature: 'data:image/png;base64,Um52ZWw=',
    status: 'pending',
    adminNote: '',
    updatedAt: serverTimestamp()
  }));
});

test('le renouvellement n’est pas possible depuis un dossier en attente (pending)', async () => {
  // Alice est repassée en pending ci-dessus : le renvoi doit échouer.
  const db = env.authenticatedContext(ALICE, USER_TOKEN(ALICE)).firestore();
  await assertFails(updateDoc(doc(db, 'adhesionRequests', ALICE), {
    application: applicationPayload('agadir', {
      type: 'renewal',
      reason: 'Tentative depuis pending'
    }),
    signature: 'data:image/png;base64,VGVzdA==',
    status: 'pending',
    adminNote: '',
    updatedAt: serverTimestamp()
  }));
});

test('statut hors vocabulaire refusé même à l’administrateur général', async () => {
  const db = env.authenticatedContext('admin-uid', ADMIN_TOKEN).firestore();
  await assertFails(updateDoc(doc(db, 'adhesionRequests', DAVE), {
    status: 'approved', // statut de l'ancienne branche, interdit ici
    adminNote: '',
    updatedAt: serverTimestamp()
  }));
});

/* ==========================================================
   SIGNATURE ÉLECTRONIQUE DU RESPONSABLE (validation)
   ========================================================== */

test('un responsable habilité signe et valide la demande', async () => {
  const db = env.authenticatedContext(SUB_AGADIR, USER_TOKEN(SUB_AGADIR)).firestore();
  await assertSucceeds(updateDoc(doc(db, 'adhesionRequests', ALICE), {
    status: 'accepted',
    adminSignature: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
    signedBy: SUB_AGADIR,
    signedAt: serverTimestamp(),
    adminNote: 'Dossier conforme.',
    updatedAt: serverTimestamp()
  }));
});

test('un utilisateur non habilité ne peut pas signer ni valider', async () => {
  const db = env.authenticatedContext(BOB, USER_TOKEN(BOB)).firestore();
  // Bob n'est ni administrateur général ni sous-admin d'Agadir.
  await assertFails(updateDoc(doc(db, 'adhesionRequests', ALICE), {
    status: 'accepted',
    adminSignature: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
    signedBy: BOB,
    signedAt: serverTimestamp(),
    adminNote: '',
    updatedAt: serverTimestamp()
  }));
});

test('une signature sans le statut « validée » est refusée', async () => {
  const db = env.authenticatedContext(SUB_AGADIR, USER_TOKEN(SUB_AGADIR)).firestore();
  await assertFails(updateDoc(doc(db, 'adhesionRequests', ALICE), {
    status: 'pending',
    adminSignature: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
    signedBy: SUB_AGADIR,
    signedAt: serverTimestamp(),
    adminNote: '',
    updatedAt: serverTimestamp()
  }));
});

test('une signature attribuée à un autre signataire est refusée', async () => {
  const db = env.authenticatedContext(SUB_AGADIR, USER_TOKEN(SUB_AGADIR)).firestore();
  await assertFails(updateDoc(doc(db, 'adhesionRequests', ALICE), {
    status: 'accepted',
    adminSignature: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
    signedBy: 'admin-uid', // n'est pas le responsable connecté
    signedAt: serverTimestamp(),
    adminNote: '',
    updatedAt: serverTimestamp()
  }));
});

/* ==========================================================
   PDF OFFICIEL — enregistrement par un responsable habilité
   ========================================================== */

test('le PDF officiel est enregistrable sur une demande signée et validée', async () => {
  const db = env.authenticatedContext(SUB_AGADIR, USER_TOKEN(SUB_AGADIR)).firestore();
  await assertSucceeds(setDoc(doc(db, 'adhesionDocuments', ALICE), {
    uid: ALICE,
    province: 'agadir',
    fileName: 'demande-adhesion-' + ALICE + '.pdf',
    mimeType: 'application/pdf',
    data: 'JVBERi0xLjQK',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }));
});

test('le PDF officiel est refusé sur une demande non validée', async () => {
  // DAVE est encore en attente de validation (fixture).
  const db = env.authenticatedContext('admin-uid', ADMIN_TOKEN).firestore();
  await assertFails(setDoc(doc(db, 'adhesionDocuments', DAVE), {
    uid: DAVE,
    province: 'tata',
    fileName: 'demande-adhesion-' + DAVE + '.pdf',
    mimeType: 'application/pdf',
    data: 'JVBERi0xLjQK',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }));
});

test('le sous-admin d’une autre province ne peut pas enregistrer le PDF', async () => {
  const db = env.authenticatedContext(SUB_TIZNIT, USER_TOKEN(SUB_TIZNIT)).firestore();
  await assertFails(setDoc(doc(db, 'adhesionDocuments', ALICE), {
    uid: ALICE,
    province: 'agadir',
    fileName: 'demande-adhesion-' + ALICE + '.pdf',
    mimeType: 'application/pdf',
    data: 'JVBERi0xLjQK',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }));
});

/* ==========================================================
   NUMÉROTATION ATOMIQUE (counters/memberNumbers)
   ========================================================== */

test('sous-admin : activation avec numérotation atomique du compteur', async () => {
  const db = env.authenticatedContext(SUB_AGADIR, USER_TOKEN(SUB_AGADIR)).firestore();
  const batch = writeBatch(db);
  batch.set(doc(db, 'counters', 'memberNumbers'), {
    next: 2,
    lastMemberNo: 'SM-0001',
    memberUid: PEND_AG1,
    updatedAt: serverTimestamp()
  });
  batch.update(doc(db, 'members', PEND_AG1), {
    status: 'active',
    memberNo: 'SM-0001',
    activatedAt: serverTimestamp()
  });
  await assertSucceeds(batch.commit());
});

test('sous-admin : activation sans compteur refusée', async () => {
  const db = env.authenticatedContext(SUB_AGADIR, USER_TOKEN(SUB_AGADIR)).firestore();
  await assertFails(updateDoc(doc(db, 'members', PEND_AG2), {
    status: 'active',
    memberNo: 'SM-0002',
    activatedAt: serverTimestamp()
  }));
});

test('numéro incohérent avec le compteur refusé', async () => {
  const db = env.authenticatedContext(SUB_AGADIR, USER_TOKEN(SUB_AGADIR)).firestore();
  const batch = writeBatch(db);
  batch.set(doc(db, 'counters', 'memberNumbers'), {
    next: 3,
    lastMemberNo: 'SM-0042',
    memberUid: PEND_AG3,
    updatedAt: serverTimestamp()
  });
  batch.update(doc(db, 'members', PEND_AG3), {
    status: 'active',
    memberNo: 'SM-0007', // ne correspond pas à SM-0042
    activatedAt: serverTimestamp()
  });
  await assertFails(batch.commit());
});

test('sous-admin : numéro suivant = compteur incrémenté (next+1)', async () => {
  const db = env.authenticatedContext(SUB_AGADIR, USER_TOKEN(SUB_AGADIR)).firestore();
  const batch = writeBatch(db);
  // Le compteur est à next=2 / SM-0001 (activation réussie ci-dessus).
  batch.set(doc(db, 'counters', 'memberNumbers'), {
    next: 3,
    lastMemberNo: 'SM-0002',
    memberUid: PEND_AG2,
    updatedAt: serverTimestamp()
  });
  batch.update(doc(db, 'members', PEND_AG2), {
    status: 'active',
    memberNo: 'SM-0002',
    activatedAt: serverTimestamp()
  });
  await assertSucceeds(batch.commit());
});

test('un adhérent ne peut pas écrire dans les compteurs', async () => {
  const db = env.authenticatedContext(BOB, USER_TOKEN(BOB)).firestore();
  await assertFails(setDoc(doc(db, 'counters', 'memberNumbers'), {
    next: 99,
    lastMemberNo: 'SM-0098',
    memberUid: BOB,
    updatedAt: serverTimestamp()
  }));
});

test('administrateur général : activation sans compteur autorisée (migration)', async () => {
  const db = env.authenticatedContext('admin-uid', ADMIN_TOKEN).firestore();
  await assertSucceeds(updateDoc(doc(db, 'members', PEND_ADM), {
    status: 'active',
    memberNo: 'SM-0003',
    activatedAt: serverTimestamp()
  }));
});
