// Vercel serverless function : envoie des push FCM via l'API HTTP v1.
// Authentification : Firebase ID token (header Authorization: Bearer <token>).
// Autorisation : vérification du rôle admin côté serveur (email dans adminEmails).
// Destinataires : déterminés depuis Firestore (fcmTokens + members).
// Secrets : uniquement dans les variables d'environnement Vercel.
//
// Variables d'environnement requises :
//   FCM_SERVICE_ACCOUNT  — JSON du compte de service Firebase (clé privée).
//   FCM_PROJECT_ID       — "ugtm-fns-souss-massa"
//   ADMIN_EMAILS         — e-mails des administrateurs (séparés par des virgules)

const crypto = require('crypto');
const admin = require('firebase-admin');

const MAX_RECIPIENTS = 1000;
const RATE_LIMIT_WINDOW_MS = 3600000; // 1 heure
const RATE_LIMIT_MAX_PER_ADMIN = 5; // 5 envois/heure par admin
const RATE_LIMIT_MAX_PER_IP = 10; // 10 req/min par IP (géré par Vercel)

// Initialiser Firebase Admin SDK (une seule fois).
let firebaseApp = null;
function getFirebaseApp() {
  if (firebaseApp) return firebaseApp;
  const serviceAccount = JSON.parse(process.env.FCM_SERVICE_ACCOUNT);
  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  return firebaseApp;
}

function getDb() {
  return getFirebaseApp().firestore();
}

function getMessaging() {
  getFirebaseApp();
  return admin.messaging();
}

function isValidFcmToken(t) {
  return typeof t === 'string' && t.length >= 40 && t.length <= 512 && /^[A-Za-z0-9_:.-]+$/.test(t);
}

async function getAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  })).toString('base64url');
  const signInput = header + '.' + payload;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signInput);
  const signature = sign.sign(serviceAccount.private_key).toString('base64url');
  const assertion = signInput + '.' + signature;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: assertion
    })
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error('OAuth token exchange failed');
  }
  return tokenData.access_token;
}

async function checkRateLimit(adminUid) {
  const db = getDb();
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const docRef = db.collection('rateLimits').doc(adminUid);
  const snap = await docRef.get();

  if (snap.exists) {
    const data = snap.data();
    const windowStartMs = data.windowStart ? data.windowStart.toMillis() : 0;
    if (windowStartMs > windowStart) {
      if (data.count >= RATE_LIMIT_MAX_PER_ADMIN) {
        return { allowed: false, remaining: 0, resetAt: windowStartMs + RATE_LIMIT_WINDOW_MS };
      }
      await docRef.update({ count: admin.firestore.FieldValue.increment(1) });
      return { allowed: true, remaining: RATE_LIMIT_MAX_PER_ADMIN - data.count - 1, resetAt: windowStartMs + RATE_LIMIT_WINDOW_MS };
    }
  }

  await docRef.set({ count: 1, windowStart: admin.firestore.Timestamp.now() });
  return { allowed: true, remaining: RATE_LIMIT_MAX_PER_ADMIN - 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
}

function getAdminEmails() {
  const envEmails = process.env.ADMIN_EMAILS || '';
  if (envEmails) {
    return envEmails.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  }
  return ['abaray66@gmail.com'];
}

async function getActiveMemberTokens() {
  const db = getDb();
  const membersSnap = await db.collection('members').where('status', '==', 'active').get();
  const activeUids = membersSnap.docs.map(d => d.id);
  const tokens = [];
  for (const uid of activeUids) {
    const tokenSnap = await db.collection('fcmTokens').doc(uid).get();
    if (tokenSnap.exists) {
      const token = tokenSnap.data().token;
      if (token && isValidFcmToken(token)) {
        tokens.push(token);
      }
    }
  }
  return tokens;
}

async function notifyAdhesionManagers(requestUid, province, title, messageBody) {
  const db = getDb();
  const managerUids = new Set();
  const auth = getFirebaseApp().auth();

  // Administrateurs principaux configurés dans Vercel.
  for (const email of getAdminEmails()) {
    try {
      const user = await auth.getUserByEmail(email);
      if (user.uid !== requestUid) managerUids.add(user.uid);
    } catch (e) {
      // Une adresse configurée mais sans compte Firebase n'a pas de destinataire.
    }
  }

  // Sous-administrateurs actifs de la province du dossier.
  const subadmins = await db.collection('members').where('role', '==', 'subadmin').get();
  for (const doc of subadmins.docs) {
    const member = doc.data() || {};
    const assignedProvince = String(member.adminProvince || member.prov || '');
    if (doc.id !== requestUid && member.status === 'active' && assignedProvince === String(province || '')) {
      managerUids.add(doc.id);
    }
  }

  const batch = db.batch();
  const tokens = [];
  for (const uid of managerUids) {
    const notificationRef = db.collection('notifications').doc(uid).collection('items').doc();
    batch.set(notificationRef, {
      title: String(title).slice(0, 120),
      body: String(messageBody || '').slice(0, 500),
      type: 'adhesion',
      read: false,
      authorUid: requestUid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      targetType: 'adhesion',
      targetId: requestUid,
      province: String(province || '')
    });

    const tokenSnap = await db.collection('fcmTokens').doc(uid).get();
    if (tokenSnap.exists) {
      const token = tokenSnap.data() && tokenSnap.data().token;
      if (isValidFcmToken(token)) tokens.push(token);
    }
  }
  if (managerUids.size) await batch.commit();
  return Array.from(new Set(tokens));
}

async function getMemberToken(uid) {
  const db = getDb();
  const tokenSnap = await db.collection('fcmTokens').doc(uid).get();
  if (tokenSnap.exists) {
    const token = tokenSnap.data().token;
    if (token && isValidFcmToken(token)) {
      return token;
    }
  }
  return null;
}

const ALLOWED_ORIGINS = new Set([
  'https://ugtm-fns-souss-massa.web.app',
  'https://ugtm-fns-souss-massa.firebaseapp.com',
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

module.exports = async function handler(req, res) {
  const startTime = Date.now();
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // Authentification : Firebase ID token
    const authHeader = req.headers['authorization'] || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!idToken) {
      console.log(JSON.stringify({ level: 'warn', event: 'unauthorized_attempt', reason: 'no_token', timestamp: new Date().toISOString() }));
      return res.status(401).json({ error: 'Unauthorized' });
    }

    let decodedToken;
    try {
      decodedToken = await getFirebaseApp().auth().verifyIdToken(idToken);
    } catch (e) {
      console.log(JSON.stringify({ level: 'warn', event: 'unauthorized_attempt', reason: 'invalid_token', timestamp: new Date().toISOString() }));
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!decodedToken.email_verified) {
      console.log(JSON.stringify({ level: 'warn', event: 'unauthorized_attempt', reason: 'email_not_verified', timestamp: new Date().toISOString() }));
      return res.status(403).json({ error: 'Forbidden' });
    }

    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { body = {}; }
    }
    body = body || {};

    const { type, title: requestedTitle, body: requestedBody, targetUid } = body;
    const validTypes = ['news', 'event', 'adhesion', 'adhesion_request'];
    if (!type || !validTypes.includes(type)) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    const adminEmails = getAdminEmails();
    const isAdmin = adminEmails.includes((decodedToken.email || '').toLowerCase());
    if (type === 'adhesion_request') {
      if (!targetUid || targetUid !== decodedToken.uid) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const requestRate = await checkRateLimit('adhesion:' + decodedToken.uid);
      if (!requestRate.allowed) {
        return res.status(429).json({ error: 'Too many requests' });
      }
    } else {
      if (!requestedTitle) {
        return res.status(400).json({ error: 'Invalid request' });
      }
      if (!isAdmin) {
        console.log(JSON.stringify({ level: 'warn', event: 'forbidden_attempt', uid: decodedToken.uid, timestamp: new Date().toISOString() }));
        return res.status(403).json({ error: 'Forbidden' });
      }

      // Rate limiting par administrateur
      const rateCheck = await checkRateLimit(decodedToken.uid);
      if (!rateCheck.allowed) {
        console.log(JSON.stringify({ level: 'warn', event: 'rate_limited', uid: decodedToken.uid, timestamp: new Date().toISOString() }));
        return res.status(429).json({ error: 'Too many requests' });
      }
    }

    let title = requestedTitle || '';
    let msgBody = requestedBody || '';

    // Déterminer les destinataires depuis Firestore
    let tokens = [];
    if (type === 'news' || type === 'event') {
      tokens = await getActiveMemberTokens();
    } else if (type === 'adhesion') {
      if (!targetUid) {
        return res.status(400).json({ error: 'Invalid request' });
      }
      const token = await getMemberToken(targetUid);
      if (token) tokens = [token];
    } else if (type === 'adhesion_request') {
      const db = getDb();
      const requestSnap = await db.collection('adhesionRequests').doc(decodedToken.uid).get();
      if (!requestSnap.exists) return res.status(403).json({ error: 'Forbidden' });
      const request = requestSnap.data() || {};
      if (request.status !== 'pending' || String(request.email || '').toLowerCase() !== String(decodedToken.email || '').toLowerCase()) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const application = request.application || {};
      const applicantName = (String(application.prenom || '').trim() + ' ' + String(application.nom || '').trim()).trim();
      if (!applicantName) return res.status(400).json({ error: 'Incomplete application' });
      const province = String(request.province || application.province || '');
      title = ('Nouvelle demande d’adhésion : ' + applicantName).slice(0, 120);
      msgBody = ('Province : ' + province).slice(0, 500);
      tokens = await notifyAdhesionManagers(decodedToken.uid, province, title, msgBody);
    }

    if (tokens.length === 0) {
      return res.status(200).json({ sent: 0, total: 0, message: 'No recipients' });
    }

    if (tokens.length > MAX_RECIPIENTS) {
      tokens = tokens.slice(0, MAX_RECIPIENTS);
    }

    // Envoyer le push
    const serviceAccount = JSON.parse(process.env.FCM_SERVICE_ACCOUNT);
    const projectId = process.env.FCM_PROJECT_ID;
    const accessToken = await getAccessToken(serviceAccount);

    const results = [];
    for (const token of tokens) {
      try {
        const r = await fetch(
          'https://fcm.googleapis.com/v1/projects/' + projectId + '/messages:send',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + accessToken
            },
            body: JSON.stringify({
              message: {
                token: token,
                notification: {
                  title: String(title).slice(0, 120),
                  body: String(msgBody || '').slice(0, 500)
                },
                data: { targetUrl: 'https://agile-marimba-ow7rjs2-abaray66-2380.vercel.app/www/' },
                webpush: {
                  fcm_options: { link: 'https://agile-marimba-ow7rjs2-abaray66-2380.vercel.app/www/' },
                  notification: { icon: '/www/icons/ugtm-mark.svg' }
                },
                android: { priority: 'high' }
              }
            })
          }
        );
        const data = await r.json();
        results.push({ success: !!data.name, error: data.error && data.error.code ? data.error.code : null });
      } catch (e) {
        results.push({ success: false, error: 'send_failed' });
      }
    }

    const sentCount = results.filter(r => r.success).length;
    console.log(JSON.stringify({
      level: 'info',
      event: 'push_sent',
      adminUid: decodedToken.uid,
      type: type,
      recipientCount: tokens.length,
      successCount: sentCount,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString()
    }));

    return res.status(200).json({ sent: sentCount, total: tokens.length });
  } catch (e) {
    console.log(JSON.stringify({
      level: 'error',
      event: 'push_error',
      error: String(e).slice(0, 200),
      timestamp: new Date().toISOString()
    }));
    return res.status(500).json({ error: 'Internal error' });
  }
};
