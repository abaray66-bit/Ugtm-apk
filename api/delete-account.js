// Suppression sécurisée du compte UGTM.
// Les archives syndicales explicitement conservées ne sont pas touchées.
const admin = require('firebase-admin');

let firebaseApp = null;

function getFirebaseApp() {
  if (firebaseApp) return firebaseApp;
  const raw = process.env.FCM_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FCM_SERVICE_ACCOUNT missing');
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(raw);
  } catch (e) {
    throw new Error('FCM_SERVICE_ACCOUNT is not valid JSON');
  }
  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error('FCM_SERVICE_ACCOUNT incomplete');
  }
  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  return firebaseApp;
}

const ALLOWED_ORIGINS = new Set([
  'https://ugtm-fns-souss-massa.web.app',
  'https://ugtm-fns-souss-massa.firebaseapp.com',
  'https://agile-marimba-ow7rjs2.vercel.app',
  'https://ugtm.ma',
  'https://www.ugtm.ma',
  'capacitor://localhost',
  'http://localhost',
  'https://localhost'
]);

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

async function deleteNotificationItems(db, uid) {
  const itemsRef = db.collection('notifications').doc(uid).collection('items');
  const snap = await itemsRef.get();
  for (let offset = 0; offset < snap.docs.length; offset += 400) {
    const batch = db.batch();
    snap.docs.slice(offset, offset + 400).forEach((item) => batch.delete(item.ref));
    await batch.commit();
  }
  await db.collection('notifications').doc(uid).delete();
}

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'Authentification requise.' });

    const app = getFirebaseApp();
    let decoded;
    try {
      decoded = await app.auth().verifyIdToken(idToken);
    } catch (e) {
      return res.status(401).json({ error: 'Session invalide. Reconnectez-vous.' });
    }

    if (decoded.email_verified !== true) {
      return res.status(403).json({ error: 'Une adresse Google vérifiée est requise.' });
    }

    // Exige une authentification récente ; le client réauthentifie Google juste avant l'appel.
    const now = Math.floor(Date.now() / 1000);
    const authTime = Number(decoded.auth_time || 0);
    if (!authTime || authTime > now + 60 || now - authTime > 5 * 60) {
      return res.status(401).json({ error: 'Reconnectez-vous avec Google pour confirmer la suppression.', code: 'recent_login_required' });
    }

    const uid = decoded.uid;
    const email = String(decoded.email || '').trim().toLowerCase();
    const db = app.firestore();
    const memberRef = db.collection('members').doc(uid);
    const memberSnap = await memberRef.get();
    const member = memberSnap.exists ? (memberSnap.data() || {}) : {};
    const adminEmails = String(process.env.ADMIN_EMAILS || '')
      .split(/[;,]/).map((value) => value.trim().toLowerCase()).filter(Boolean);

    // Les mandats d'administration doivent être transférés/révoqués par l'administrateur général.
    if (['admin', 'subadmin', 'subadminLocal'].includes(String(member.role || ''))
        || member.isAdmin === true
        || adminEmails.includes(email)) {
      return res.status(403).json({
        error: "Un compte responsable ne peut pas être supprimé par cette procédure. Contactez l'administrateur général.",
        code: 'administrator_account'
      });
    }

    // Données de compte supprimables. Les archives syndicales listées ci-dessous sont préservées.
    await deleteNotificationItems(db, uid);
    await db.collection('fcmTokens').doc(uid).delete();
    await db.collection('responsables').doc(uid).delete();
    if (memberSnap.exists) await memberRef.delete();

    // Dernière étape : supprimer le compte Firebase Authentication.
    // Si cette étape échoue, l'utilisateur peut se reconnecter et relancer la demande.
    await app.auth().deleteUser(uid);

    return res.status(200).json({
      ok: true,
      retainedCollections: [
        'adhesionRequests (dossiers initiaux et renouvellements)',
        'adhesionDocuments (justificatifs officiels)',
        'reports et reportAttachments (signalements et pièces jointes)'
      ]
    });
  } catch (error) {
    console.error('[account-deletion] failed:', String(error && error.message || error).slice(0, 180));
    return res.status(500).json({ error: 'La suppression n’a pas pu être terminée. Réessayez ou contactez l’administration.' });
  }
};
