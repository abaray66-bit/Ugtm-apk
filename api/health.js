// Diagnostic du backend push : GET /api/health
// Répond 200 si la configuration Vercel est complète et exploitable, 503 sinon.
// Ne renvoie aucun secret : uniquement des booléens et des codes d'erreur.
const push = require('./send-push.js');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

  const ok = checks.serviceAccount && checks.projectId && checks.adminSdk && checks.oauthToken;
  return res.status(ok ? 200 : 503).json({
    ok: ok,
    checks: checks,
    errors: errors,
    timestamp: new Date().toISOString()
  });
};
