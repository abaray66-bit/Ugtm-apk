// Vercel serverless function : entretien du registre de jetons FCM.
// POST /api/cleanup-tokens   (Authorization: Bearer <Firebase ID token>)
//
// Retire de Firestore les appareils que FCM ne reconnaît plus
// (« NotRegistered » / jeton invalide). Un appareil désinstallé garde sinon son
// jeton pour toujours : la diffusion croit avoir envoyé, et l'appareil ne
// reçoit plus rien, sans aucune trace visible.
//
// Aucune notification n'est livrée : chaque jeton est contrôlé avec
// `validate_only`, que FCM refuse d'envoyer mais accepte d'évaluer.
// Accès réservé aux administrateurs (ADMIN_EMAILS), même règle que l'envoi.

const push = require('./send-push.js');

function getAdminEmails() {
  const envEmails = process.env.ADMIN_EMAILS || '';
  if (envEmails) {
    return envEmails.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  }
  return ['abaray66@gmail.com'];
}

module.exports = async function handler(req, res) {
  push.setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'] || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let app;
  try {
    app = push.getFirebaseApp();
  } catch (e) {
    console.log(JSON.stringify({
      level: 'error',
      event: 'config_error',
      reason: 'firebase_init_failed',
      detail: String((e && e.message) || e).slice(0, 200),
      timestamp: new Date().toISOString()
    }));
    return res.status(500).json({ error: 'Server misconfigured', code: 'firebase_init_failed' });
  }

  let decoded;
  try {
    decoded = await app.auth().verifyIdToken(idToken);
  } catch (e) {
    return res.status(401).json({ error: 'Unauthorized', code: String((e && e.code) || 'invalid_token') });
  }

  const isAdmin = getAdminEmails().includes(String(decoded.email || '').toLowerCase());
  if (!decoded.email_verified || !isAdmin) {
    console.log(JSON.stringify({
      level: 'warn',
      event: 'forbidden_attempt',
      route: 'cleanup-tokens',
      uid: decoded.uid,
      timestamp: new Date().toISOString()
    }));
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const accessToken = await push.getAccessToken(push.getServiceAccount());
    const summary = await push.sweepStoredTokens(push.getProjectId(), accessToken);
    console.log(JSON.stringify(Object.assign({
      level: 'info',
      event: 'tokens_swept',
      adminUid: decoded.uid,
      timestamp: new Date().toISOString()
    }, summary)));
    return res.status(200).json(summary);
  } catch (e) {
    console.log(JSON.stringify({
      level: 'error',
      event: 'sweep_error',
      error: String((e && e.message) || e).slice(0, 200),
      timestamp: new Date().toISOString()
    }));
    return res.status(500).json({ error: 'Internal error', code: 'sweep_failed' });
  }
};
