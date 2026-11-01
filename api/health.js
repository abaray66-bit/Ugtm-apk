// Diagnostic du backend push : GET /api/health
// Répond 200 si la configuration Vercel est complète et exploitable, 503 sinon.
// Ne renvoie aucun secret : uniquement des booléens, des codes et des compteurs.
//
// GET /api/health?deep=1 ajoute deux contrôles qui descendent plus bas que la
// configuration :
//   - recipients : combien de membres actifs, combien de jetons FCM stockés,
//     combien de membres réellement joignables ;
//   - fcm        : envoi de la charge utile réelle vers un jeton inexistant.
//     Aucun appareil ne peut recevoir cette sonde ; la réponse de FCM dit si le
//     message lui-même est acceptable (« accepted »/« token ») ou rejeté
//     (« payload », « credentials », « permissions », « quota »).
const push = require('./send-push.js');

function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise(function (resolve) {
      setTimeout(function () { resolve(fallback); }, ms);
    })
  ]);
}

async function countRecipients() {
  const db = push.getDb();
  const membersSnap = await db.collection('members').where('status', '==', 'active').get();
  const tokensSnap = await db.collection('fcmTokens').get();
  const validTokens = tokensSnap.docs.filter(function (d) {
    const token = d.data() && d.data().token;
    return typeof token === 'string' && token.length >= 40 && token.length <= 512;
  });
  const idsWithToken = {};
  validTokens.forEach(function (d) { idsWithToken[d.id] = true; });
  const reachable = membersSnap.docs.filter(function (m) { return idsWithToken[m.id]; }).length;
  return {
    activeMembers: membersSnap.docs.length,
    storedTokenDocs: tokensSnap.docs.length,
    usableTokens: validTokens.length,
    reachableMembers: reachable
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const query = String(req.url || '');
  const deep = /[?&]deep=1(&|$)/.test(query);

  const checks = {
    serviceAccount: false, // FCM_SERVICE_ACCOUNT présent, JSON et complet
    projectId: false,      // FCM_PROJECT_ID présent
    adminSdk: false,       // Firebase Admin s'initialise (clé privée lisible)
    oauthToken: false      // échange JWT → access token Google accepté
  };
  const errors = {};

  try {
    push.getServiceAccount();
    checks.serviceAccount = true;
  } catch (e) {
    errors.serviceAccount = 'missing_or_invalid';
  }

  try {
    push.getProjectId();
    checks.projectId = true;
  } catch (e) {
    errors.projectId = 'missing';
  }

  if (checks.serviceAccount) {
    try {
      push.getFirebaseApp();
      checks.adminSdk = true;
    } catch (e) {
      errors.adminSdk = 'init_failed';
    }
  }

  if (checks.adminSdk && checks.projectId) {
    try {
      await push.getAccessToken(push.getServiceAccount());
      checks.oauthToken = true;
    } catch (e) {
      errors.oauthToken = 'token_exchange_failed';
    }
  }

  const body = {
    ok: checks.serviceAccount && checks.projectId && checks.adminSdk && checks.oauthToken,
    checks: checks,
    errors: errors,
    timestamp: new Date().toISOString()
  };

  if (deep) {
    const deepReport = {};

    // 1) Chaîne d'inscription : y a-t-il des jetons exploitables ?
    if (checks.adminSdk) {
      try {
        deepReport.recipients = await withTimeout(countRecipients(), 6000, { error: 'timeout' });
      } catch (e) {
        deepReport.recipients = { error: 'firestore_unavailable' };
      }
    } else {
      deepReport.recipients = { error: 'admin_sdk_unavailable' };
    }

    // 2) Chaîne d'envoi : FCM accepte-t-il la charge utile réelle ?
    if (checks.adminSdk && checks.projectId && checks.oauthToken) {
      try {
        deepReport.fcm = await withTimeout(
          (async function () {
            const token = await push.getAccessToken(push.getServiceAccount());
            return await push.probeFcmSend(push.getProjectId(), token);
          })(),
          8000,
          { error: 'timeout' }
        );
      } catch (e) {
        errors.fcmProbe = 'probe_failed';
        deepReport.fcm = { error: 'probe_failed' };
      }

      // 3) Les jetons stockés sont-ils encore exploitables ? validate_only
      //    contrôle le destinataire sans rien livrer.
      try {
        deepReport.registrations = await withTimeout(
          (async function () {
            const token = await push.getAccessToken(push.getServiceAccount());
            return await push.probeStoredTokens(push.getProjectId(), token, 10);
          })(),
          9000,
          { error: 'timeout' }
        );
      } catch (e) {
        deepReport.registrations = { error: 'probe_failed' };
      }
    } else {
      deepReport.fcm = { error: 'config_incomplete' };
      deepReport.registrations = { error: 'config_incomplete' };
    }

    // 4) Lecture des sondes : que faut-il conclure ?
    const fcm = deepReport.fcm || {};
    const recipients = deepReport.recipients || {};
    const regs = deepReport.registrations || {};
    if (fcm.classification === 'accepted' || fcm.classification === 'token') {
      if (!recipients.reachableMembers) {
        deepReport.verdict = 'envoi_ok_aucun_destinataire';
      } else if (typeof regs.checked === 'number' && regs.checked === 0) {
        deepReport.verdict = 'envoi_ok_aucun_jeton_enregistre';
      } else if (typeof regs.valid === 'number' && regs.valid === 0) {
        deepReport.verdict = 'envoi_ok_jetons_stockes_invalides';
      } else if (typeof regs.checked === 'number' && regs.valid < regs.checked) {
        // Au moins un jeton mort : les appareils concernes ne recoivent plus rien.
        deepReport.verdict = 'envoi_ok_jetons_partiellement_invalides';
      } else {
        deepReport.verdict = 'envoi_ok_jetons_valides';
      }
    } else if (fcm.classification === 'payload') {
      deepReport.verdict = 'charge_utile_rejetee';
    } else if (fcm.classification === 'credentials' || fcm.classification === 'permissions') {
      deepReport.verdict = 'autorisation_fcm_refusee';
    } else if (fcm.classification === 'quota') {
      deepReport.verdict = 'quota_fcm_atteint';
    } else {
      deepReport.verdict = 'indetermine';
    }

    body.deep = deepReport;
  }

  return res.status(body.ok ? 200 : 503).json(body);
};
