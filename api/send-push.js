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

function buildNotificationTarget(type, targetId) {
  const url = new URL('https://ugtm-fns-souss-massa.web.app/app.html');
  const id = String(targetId || '');
  if ((type === 'news' || type === 'event') && /^[A-Za-z0-9_-]{1,150}$/.test(id)) {
    url.searchParams.set('notificationType', type);
    url.searchParams.set('notificationId', id);
  }
  return url;
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

async function checkReportIpRateLimit(req) {
  const rawIp = String((req.headers && req.headers['x-forwarded-for']) || (req.socket && req.socket.remoteAddress) || '');
  const ip = rawIp.split(',')[0].trim() || 'unknown';
  const key = crypto.createHash('sha256').update(ip).digest('hex');
  const ref = getDb().collection('reportNotificationRateLimits').doc(key);
  const now = Date.now();
  return getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? (snap.data() || {}) : {};
    const start = data.windowStart && typeof data.windowStart.toMillis === 'function'
      ? data.windowStart.toMillis()
      : 0;
    if (start && now - start < 60000 && Number(data.count || 0) >= RATE_LIMIT_MAX_PER_IP) return false;
    if (start && now - start < 60000) {
      tx.update(ref, { count: Number(data.count || 0) + 1 });
    } else {
      tx.set(ref, { count: 1, windowStart: admin.firestore.Timestamp.fromMillis(now) });
    }
    return true;
  });
}

async function dispatchReportNotification(req, reportId) {
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(reportId)) {
    return { sent: 0, total: 0, error: 'Invalid report' };
  }
  if (!(await checkReportIpRateLimit(req))) return { sent: 0, total: 0, rateLimited: true };

  const db = getDb();
  const reportSnap = await db.collection('reports').doc(reportId).get();
  if (!reportSnap.exists) return { sent: 0, total: 0, error: 'Report not found' };
  const report = reportSnap.data() || {};
  const createdAt = report.createdAt && typeof report.createdAt.toMillis === 'function'
    ? report.createdAt.toMillis()
    : 0;
  const ageMs = Date.now() - createdAt;
  if (report.status !== 'new' || !createdAt || ageMs < -60000 || ageMs > 15 * 60 * 1000) {
    return { sent: 0, total: 0, error: 'Report is not eligible' };
  }

  const province = String(report.province || '').trim();
  const allowedProvinces = new Set([
    'Agadir Ida-Outanane', 'Inezgane-Aït Melloul', 'Chtouka-Aït Baha',
    'Taroudant', 'Tiznit', 'Tata'
  ]);
  if (!allowedProvinces.has(province)) {
    return { sent: 0, total: 0, error: 'Invalid province' };
  }

  const managerUids = new Set();
  const auth = getFirebaseApp().auth();
  for (const email of getAdminEmails()) {
    try {
      const user = await auth.getUserByEmail(email);
      managerUids.add(user.uid);
    } catch (e) {}
  }

  const subadmins = await db.collection('members').where('role', '==', 'subadmin').get();
  for (const memberDoc of subadmins.docs) {
    const member = memberDoc.data() || {};
    const assignedProvince = String(member.adminProvince || member.prov || member.province || '');
    if (member.status === 'active' && assignedProvince === province) managerUids.add(memberDoc.id);
  }

  const category = String(report.category || '').slice(0, 60).trim();
  const title = ('Nouveau signalement' + (category ? ' : ' + category : '')).slice(0, 120);
  const messageBody = 'Province : ' + province;
  const claimRef = db.collection('reportNotificationDispatches').doc(reportId);
  const dispatchClaimed = await db.runTransaction(async (tx) => {
    const existing = await tx.get(claimRef);
    if (existing.exists) return false;
    tx.create(claimRef, {
      reportId: reportId,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    for (const uid of managerUids) {
      const notificationRef = db.collection('notifications').doc(uid).collection('items').doc('report_' + reportId);
      tx.set(notificationRef, {
        title: title,
        body: messageBody,
        type: 'report',
        read: false,
        authorUid: String(report.ownerUid || ''),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        targetType: 'report',
        targetId: reportId,
        targetScreen: 'admin',
        province: province
      });
    }
    return true;
  });

  if (!dispatchClaimed) return { sent: 0, total: 0, duplicate: true };

  const tokens = [];
  for (const uid of managerUids) {
    const tokenSnap = await db.collection('fcmTokens').doc(uid).get();
    if (!tokenSnap.exists) continue;
    const token = tokenSnap.data() && tokenSnap.data().token;
    if (token && isValidFcmToken(token)) tokens.push(token);
  }
  const uniqueTokens = Array.from(new Set(tokens));
  if (!uniqueTokens.length) return { sent: 0, total: 0 };

  const serviceAccount = JSON.parse(process.env.FCM_SERVICE_ACCOUNT);
  const projectId = process.env.FCM_PROJECT_ID;
  const accessToken = await getAccessToken(serviceAccount);
  const targetUrl = buildNotificationTarget('report', reportId).toString();
  const tag = 'report-' + reportId;
  const results = [];
  for (const token of uniqueTokens) {
    try {
      const response = await fetch('https://fcm.googleapis.com/v1/projects/' + projectId + '/messages:send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + accessToken
        },
        body: JSON.stringify({
          message: {
            token: token,
            notification: { title: title, body: messageBody },
            data: { targetUrl: targetUrl, notificationType: 'report', notificationId: reportId },
            webpush: {
              fcm_options: { link: targetUrl },
              notification: { icon: '/www/icons/ugtm-mark.svg', tag: tag, renotify: false }
            },
            android: { priority: 'high', notification: { tag: tag } }
          }
        })
      });
      const result = await response.json();
      results.push({ success: !!result.name });
    } catch (e) {
      results.push({ success: false });
    }
  }
  return { sent: results.filter((result) => result.success).length, total: uniqueTokens.length };
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

    let earlyBody = req.body;
    if (typeof earlyBody === 'string') {
      try { earlyBody = JSON.parse(earlyBody); } catch (e) { earlyBody = {}; }
    }
    earlyBody = earlyBody || {};

    // Les signalements anonymes n'ont pas de jeton Firebase. On vérifie
    // l'origine, l'existence du dossier, son état et sa date de création.
    if (earlyBody.type === 'report') {
      const origin = String(req.headers.origin || '');
      if (!ALLOWED_ORIGINS.has(origin)) return res.status(403).json({ error: 'Forbidden' });
      const result = await dispatchReportNotification(req, String(earlyBody.targetId || ''));
      return res.status(result.rateLimited ? 429 : (result.error ? 400 : 200)).json(result);
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

    const { type, title: requestedTitle, body: requestedBody, targetUid, targetId } = body;
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

    const pushTarget = buildNotificationTarget(type, targetId);
    const pushData = { targetUrl: pushTarget.toString() };
    if ((type === 'news' || type === 'event') && /^[A-Za-z0-9_-]{1,150}$/.test(String(targetId || ''))) {
      pushData.notificationType = type;
      pushData.notificationId = String(targetId);
    }

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
                data: pushData,
                webpush: {
                  fcm_options: { link: pushTarget.toString() },
                  notification: {
                    icon: '/www/icons/ugtm-mark.svg',
                    tag: String(type) + '-' + String(targetId || type),
                    renotify: false
                  }
                },
                android: {
                  priority: 'high',
                  notification: {
                    tag: String(type) + '-' + String(targetId || type)
                  }
                }
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
