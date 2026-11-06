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
const RATE_LIMIT_MAX_PER_ADMIN = 1000; // 5 envois/heure par admin
const RATE_LIMIT_MAX_PER_IP = 10; // 10 req/min par IP (géré par Vercel)

// Initialiser Firebase Admin SDK (une seule fois).
let firebaseApp = null;
let cachedServiceAccount = null;

function parseServiceAccount() {
  if (cachedServiceAccount) return cachedServiceAccount;
  const raw = process.env.FCM_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FCM_SERVICE_ACCOUNT missing');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error('FCM_SERVICE_ACCOUNT is not valid JSON');
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('FCM_SERVICE_ACCOUNT incomplete (client_email/private_key)');
  }
  cachedServiceAccount = parsed;
  return parsed;
}

function getFirebaseApp() {
  if (firebaseApp) return firebaseApp;
  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(parseServiceAccount())
  });
  return firebaseApp;
}

function getServiceAccount() {
  return parseServiceAccount();
}

function getProjectId() {
  const projectId = process.env.FCM_PROJECT_ID;
  if (!projectId) throw new Error('FCM_PROJECT_ID missing');
  return projectId;
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
  if ((type === 'news' || type === 'event' || type === 'adhesion') && /^[A-Za-z0-9_-]{1,150}$/.test(id)) {
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

async function getAdminEmails() {
  const envEmails = process.env.ADMIN_EMAILS || '';
  const list = envEmails
    ? envEmails.split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
    : ['abaray66@gmail.com'];

  // La liste vivante (config/admins) se gère depuis l'application : un
  // administrateur ajouté là doit aussi pouvoir envoyer des notifications.
  // En cas d'échec de lecture, la configuration Vercel reste la référence.
  try {
    const snap = await getDb().doc('config/admins').get();
    const stored = snap.exists && Array.isArray(snap.data().emails) ? snap.data().emails : [];
    for (const raw of stored) {
      const email = String(raw || '').trim().toLowerCase();
      if (email && !list.includes(email)) list.push(email);
    }
  } catch (e) { /* liste absente ou illisible */ }

  return list;
}

/* Compte les destinataires potentiels quand la liste de jetons est vide.
   N'expose que des nombres : aucun e-mail, aucun jeton, aucun secret.
   Objectif : lire dans les logs Vercel la difference entre « personne
   d'inscrit », « inscrits sans notification activee » et « jeton manquant ». */
async function describeMissingRecipients(type) {
  const db = getDb();
  const info = { type: type };
  if (type === 'news' || type === 'event') {
    const membersSnap = await db.collection('members').where('status', '==', 'active').get();
    const tokensSnap = await db.collection('fcmTokens').get();
    const withToken = tokensSnap.docs.filter(function (t) { return t.data() && t.data().token; });
    const idsWithToken = new Set(withToken.map(function (t) { return t.id; }));
    const activeWithToken = membersSnap.docs.filter(function (m) { return idsWithToken.has(m.id); }).length;
    info.activeMembers = membersSnap.docs.length;
    info.storedTokens = withToken.length;
    info.activeMembersWithToken = activeWithToken;
    if (membersSnap.docs.length === 0) info.hint = 'aucun membre avec status=active';
    else if (withToken.length === 0) info.hint = 'aucun appareil abonne (fcmTokens vide)';
    else if (activeWithToken === 0) info.hint = 'appareils abonnes mais aucun membre actif parmi eux';
  } else if (type === 'adhesion') {
    info.hint = 'le membre cible n\'a pas de jeton FCM enregistre';
  } else if (type === 'adhesion_request') {
    const subs = await db.collection('members').where('role', '==', 'subadmin').get();
    info.subadmins = subs.docs.length;
    info.hint = subs.docs.length === 0
      ? 'aucun sous-administrateur enregistre'
      : 'sous-administrateurs sans jeton ou hors de cette province';
  }
  return info;
}

/* Retourne des couples { uid, token } : le proprietaire du jeton est
   indispensable pour purger un appareil qui n'existe plus. */
async function getActiveMemberEntries() {
  const db = getDb();
  const membersSnap = await db.collection('members').where('status', '==', 'active').get();
  const entries = [];
  for (const doc of membersSnap.docs) {
    const tokenSnap = await db.collection('fcmTokens').doc(doc.id).get();
    if (!tokenSnap.exists) continue;
    const data = tokenSnap.data() || {};
    const tokenList = Array.isArray(data.tokens) ? data.tokens : (data.token ? [data.token] : []);
    for (const token of tokenList) {
      if (isValidFcmToken(token)) entries.push({ uid: doc.id, token: token });
    }
  }
  return entries;
}

async function notifyAdhesionManagers(requestUid, province, title, messageBody) {
  const db = getDb();
  const managerUids = new Set();
  const auth = getFirebaseApp().auth();

  // Administrateurs principaux configurés dans Vercel.
  for (const email of await getAdminEmails()) {
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
  const entries = [];
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
      if (isValidFcmToken(token)) entries.push({ uid: uid, token: token });
    }
  }
  if (managerUids.size) await batch.commit();
  return entries;
}

async function getMemberTokens(uid) {
  const db = getDb();
  const tokenSnap = await db.collection('fcmTokens').doc(uid).get();
  if (tokenSnap.exists) {
    const data = tokenSnap.data() || {};
    const list = Array.isArray(data.tokens) ? data.tokens : (data.token ? [data.token] : []);
    return list.filter(isValidFcmToken);
  }
  return [];
}

/* Construit le message FCM v1. Extrait de la boucle d'envoi pour que le
   diagnostic puisse eprouver exactement la meme charge utile que celle
   reellement utilisee : un message de sonde qui divergerait ne prouverait rien. */
function buildFcmMessage(token, title, msgBody, pushData, pushTarget, tag) {
  return {
    message: {
      token: token,
      notification: {
        title: String(title).slice(0, 120),
        body: String(msgBody || '').slice(0, 500)
      },
      data: pushData,
      webpush: {
        fcm_options: { link: String(pushTarget) },
        notification: {
          icon: '/icons/ugtm-mark.svg',
          tag: String(tag),
          renotify: false
        }
      },
      android: {
        priority: 'high',
        notification: { tag: String(tag) }
      }
    }
  };
}

/* Traduit la reponse FCM en cause exploitable. La distinction qui compte :
   « token » signifie que FCM a accepte et valide notre charge utile puis
   refuse le destinataire ; « payload » signifie que le message lui-meme est
   rejete, auquel cas aucun envoi ne peut aboutir, quel que soit l'appareil. */
function classifyFcmError(payload) {
  if (!payload) return 'unknown';
  if (payload.name) return 'accepted';
  const err = payload.error || {};
  const status = String(err.status || '');
  const code = (err.details && err.details[0] && err.details[0].errorCode)
    ? String(err.details[0].errorCode)
    : status;
  const message = String(err.message || '');
  // FCM v1 repond « NotRegistered » (sans espace) pour un appareil desinstalle.
  // Sans le motif `not\s*registered`, cette reponse tombait dans « unknown » :
  // l'appareil mort n'etait jamais identifie, donc jamais retire du registre.
  if (/registration token|not a valid fcm|requested entity was not found|unregistered|not\s*registered/i.test(message) || code === 'UNREGISTERED' || code === 'SENDER_ID_MISMATCH') {
    return 'token';
  }
  if (status === 'RESOURCE_EXHAUSTED' || err.code === 429) return 'quota';
  if (status === 'UNAUTHENTICATED' || err.code === 401) return 'credentials';
  if (status === 'PERMISSION_DENIED' || err.code === 403) return 'permissions';
  if (/invalid json payload|invalid argument|field|malformed/i.test(message) || code === 'INVALID_ARGUMENT') {
    return 'payload';
  }
  return 'unknown';
}

/* Sonde sans destinataire : envoie la vraie charge utile a un jeton
   volontairement inexistant. Aucun appareil ne peut la recevoir ; la reponse
   de FCM dit si le message est acceptable. */
const PROBE_TOKEN = 'probe-token-000000000000000000000000000000000000000000';
let lastProbeAt = 0;

async function probeFcmSend(projectId, accessToken) {
  const now = Date.now();
  if (now - lastProbeAt < 60000) {
    return { skipped: 'throttled' };
  }
  lastProbeAt = now;
  const target = buildNotificationTarget('news', 'probe');
  const pushData = { targetUrl: target.toString() };
  const res = await fetch(
    'https://fcm.googleapis.com/v1/projects/' + projectId + '/messages:send',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + accessToken
      },
      body: JSON.stringify(buildFcmMessage(PROBE_TOKEN, 'Test UGTM', 'Verification du circuit d envoi', pushData, target.toString(), 'probe-probe'))
    }
  );
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  const err = (body && body.error) || {};
  return {
    httpStatus: res.status,
    classification: classifyFcmError(body),
    fcmCode: err.status ? String(err.status) : null,
    fcmMessage: err.message ? String(err.message).slice(0, 160) : null
  };
}

/* Verifie que les jetons reellement stockes sont encore exploitables, sans
   rien livrer : FCM accepte validate_only, qui controle le message et le
   destinataire puis refuse d'envoyer. Aucune notification ne part, et seuls
   des compteurs ressortent — jamais un jeton. */
async function probeStoredTokens(projectId, accessToken, limit) {
  const db = getDb();
  const snap = await db.collection('fcmTokens').get();
  const items = snap.docs
    .map(function (d) { return d.data() && d.data().token; })
    .filter(isValidFcmToken)
    .slice(0, limit || 10);

  const summary = {
    checked: items.length,
    valid: 0,
    notRegistered: 0,
    invalidFormat: 0,
    rejected: 0,
    // Raisons distinctes des refus (jamais le jeton lui-meme) : sans elles,
    // « rejected » ne dit pas s'il faut corriger l'inscription ou l'envoi.
    reasons: []
  };

  for (const token of items) {
    try {
      const target = buildNotificationTarget('news', 'probe');
      const payload = buildFcmMessage(token, 'Test UGTM', 'Verification du circuit d envoi', { targetUrl: target.toString() }, target.toString(), 'probe-probe');
      payload.validate_only = true;
      const res = await fetch(
        'https://fcm.googleapis.com/v1/projects/' + projectId + '/messages:send',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + accessToken
          },
          body: JSON.stringify(payload)
        }
      );
      if (res.status === 200) {
        summary.valid++;
        continue;
      }
      let body = null;
      try { body = await res.json(); } catch (e) { body = null; }
      const message = String((body && body.error && body.error.message) || '');
      // FCM renvoie ici « NotRegistered » sans espace ni phrase : c'est le cas
      // d'un appareil desinstalle ou d'un jeton expire, a distinguer d'un
      // jeton malforme.
      if (/not\s*registered|requested entity was not found|unregistered/i.test(message)) {
        summary.notRegistered++;
      } else if (/not a valid fcm registration token|invalid registration token/i.test(message)) {
        summary.invalidFormat++;
      } else {
        summary.rejected++;
      }
      const reason = String((body && body.error && body.error.status) || 'ERROR') + ': ' + message.slice(0, 120);
      if (summary.reasons.indexOf(reason) === -1 && summary.reasons.length < 5) {
        summary.reasons.push(reason);
      }
    } catch (e) {
      summary.rejected++;
      const failure = 'REQUEST_FAILED: ' + String(e && e.message || e).slice(0, 100);
      if (summary.reasons.indexOf(failure) === -1 && summary.reasons.length < 5) {
        summary.reasons.push(failure);
      }
    }
  }

  return summary;
}

async function fcmValidate(projectId, accessToken, token) {
  const target = buildNotificationTarget('news', 'probe');
  const payload = buildFcmMessage(
    token,
    'Test UGTM',
    'Verification du circuit d envoi',
    { targetUrl: target.toString() },
    target.toString(),
    'probe-probe'
  );
  payload.validate_only = true;
  const res = await fetch(
    'https://fcm.googleapis.com/v1/projects/' + projectId + '/messages:send',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + accessToken
      },
      body: JSON.stringify(payload)
    }
  );
  if (res.status === 200) return { ok: true, reason: null };
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  const message = String((body && body.error && body.error.message) || '');
  return { ok: false, reason: message, status: res.status };
}

/* Retire du registre les appareils que FCM vient de refuser. La suppression
   n'a lieu que si le document porte encore le jeton teste : un appareil qui
   s'est reenregistre entre-temps garde son nouveau jeton. */
async function purgeDeadTokens(pairs) {
  if (!pairs || !pairs.length) return 0;
  const db = getDb();
  let deleted = 0;
  for (const pair of pairs) {
    if (!pair || !pair.uid) continue;
    try {
      const ref = db.collection('fcmTokens').doc(String(pair.uid));
      const snap = await ref.get();
      if (snap.exists && String((snap.data() && snap.data().token) || '') === pair.token) {
        await ref.delete();
        deleted++;
      }
    } catch (e) {
      // Une purge ratee ne doit jamais faire echouer l'envoi deja effectue.
    }
  }
  return deleted;
}

/* Balayage complet du registre, sans livrer de notification (validate_only).
   Sert a reparer un registre laisse avec des appareils disparus. */
async function sweepStoredTokens(projectId, accessToken) {
  const db = getDb();
  const snap = await db.collection('fcmTokens').get();
  const summary = { checked: 0, valid: 0, deleted: 0, kept: 0, errors: 0 };
  for (const doc of snap.docs) {
    const token = doc.data() && doc.data().token;
    if (!isValidFcmToken(token)) continue;
    summary.checked++;
    try {
      const verdict = await fcmValidate(projectId, accessToken, token);
      if (verdict.ok) {
        summary.valid++;
        summary.kept++;
        continue;
      }
      if (/not\s*registered|requested entity was not found|unregistered|not a valid fcm registration token/i.test(verdict.reason)) {
        await doc.ref.delete();
        summary.deleted++;
      } else {
        // Refus lie a la configuration ou au message : ne pas supprimer un
        // jeton valide pour une cause qui n'est pas l'appareil.
        summary.kept++;
        summary.errors++;
      }
    } catch (e) {
      summary.errors++;
    }
  }
  return summary;
}

const ALLOWED_ORIGINS = new Set([
  'https://ugtm-fns-souss-massa.web.app',
  'https://ugtm-fns-souss-massa.firebaseapp.com',
  // Domaine permanent du backend, qui sert aussi l'application (vercel.json).
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

    // Initialisation séparée de la vérification du jeton : une erreur de
    // configuration (secret absent ou invalide) est un 500 explicite, jamais
    // un 401 trompeur.
    let firebaseAppRef;
    try {
      firebaseAppRef = getFirebaseApp();
    } catch (e) {
      console.log(JSON.stringify({
        level: 'error',
        event: 'config_error',
        reason: 'firebase_init_failed',
        detail: String(e && e.message || e).slice(0, 200),
        timestamp: new Date().toISOString()
      }));
      return res.status(500).json({ error: 'Server misconfigured', code: 'firebase_init_failed' });
    }

    let decodedToken;
    try {
      decodedToken = await firebaseAppRef.auth().verifyIdToken(idToken);
    } catch (e) {
      const code = String((e && e.code) || 'invalid_token');
      console.log(JSON.stringify({ level: 'warn', event: 'unauthorized_attempt', reason: 'invalid_token', code: code, timestamp: new Date().toISOString() }));
      return res.status(401).json({ error: 'Unauthorized', code: code });
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

    // Trace d'arrivée : permet de distinguer « l'app n'a rien envoyé » de
    // « l'app a envoyé mais aucun destinataire » sans console navigateur.
    console.log(JSON.stringify({
      level: 'info',
      event: 'push_request',
      uid: decodedToken.uid,
      type: type,
      target: targetUid ? 'single' : 'broadcast',
      targetId: targetId ? String(targetId).slice(0, 40) : null,
      timestamp: new Date().toISOString()
    }));

    const adminEmails = await getAdminEmails();
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
    let entries = [];
    if (type === 'news' || type === 'event') {
      entries = await getActiveMemberEntries();
    } else if (type === 'adhesion') {
      if (!targetUid) {
        return res.status(400).json({ error: 'Invalid request' });
      }
      const toks = await getMemberTokens(targetUid);
      entries = toks.map(function (t) { return { uid: String(targetUid), token: t }; });
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
      entries = await notifyAdhesionManagers(decodedToken.uid, province, title, msgBody);
    }

    // Un même appareil peut être enregistré sous plusieurs comptes (le jeton
    // n'est pas effacé à la déconnexion) : sans dédoublonnage, la diffusion
    // envoyait plusieurs messages identiques au même téléphone. On garde le
    // premier uid associé à chaque jeton, pour pouvoir purger l'appareil mort.
    const uidByToken = new Map();
    for (const entry of entries) {
      if (!uidByToken.has(entry.token)) uidByToken.set(entry.token, entry.uid);
    }
    let tokens = Array.from(uidByToken.keys());

    if (tokens.length === 0) {
      // Diagnostic sans exposer de secret : pourquoi personne n'est joignable.
      let detail = {};
      try {
        detail = await describeMissingRecipients(type);
      } catch (e) {
        detail = { detail: String(e && e.message || e).slice(0, 160) };
      }
      console.log(JSON.stringify(Object.assign({
        level: 'warn',
        event: 'push_no_recipients',
        uid: decodedToken.uid,
        timestamp: new Date().toISOString()
      }, detail)));
      return res.status(200).json({ sent: 0, total: 0, message: 'No recipients', code: 'no_recipients' });
    }

    if (tokens.length > MAX_RECIPIENTS) {
      tokens = tokens.slice(0, MAX_RECIPIENTS);
    }

    // Envoyer le push
    let serviceAccount;
    let projectId;
    try {
      serviceAccount = getServiceAccount();
      projectId = getProjectId();
    } catch (e) {
      console.log(JSON.stringify({
        level: 'error',
        event: 'config_error',
        reason: 'fcm_config_incomplete',
        detail: String(e && e.message || e).slice(0, 200),
        timestamp: new Date().toISOString()
      }));
      return res.status(500).json({ error: 'Server misconfigured', code: 'fcm_config_incomplete' });
    }
    const accessToken = await getAccessToken(serviceAccount);

  const pushTarget = buildNotificationTarget(type, targetId);
  const pushData = { targetUrl: pushTarget.toString() };
  if ((type === 'news' || type === 'event' || type === 'adhesion') && /^[A-Za-z0-9_-]{1,150}$/.test(String(targetId || ''))) {
    pushData.notificationType = type;
    pushData.notificationId = String(targetId);
  }

    const pushTag = String(type) + '-' + String(targetId || type);
    const results = [];
    const deadTokens = [];
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
            body: JSON.stringify(buildFcmMessage(token, title, msgBody, pushData, pushTarget.toString(), pushTag))
          }
        );
        const data = await r.json();
        const success = !!data.name;
        const failure = success ? null : classifyFcmError(data);
        results.push({ success: success, error: failure });
        // « token » = FCM a accepte la charge utile puis refuse l'appareil :
        // ce jeton ne recevra plus jamais rien, il doit quitter le registre.
        if (failure === 'token') {
          deadTokens.push({ uid: uidByToken.get(token), token: token });
        }
      } catch (e) {
        results.push({ success: false, error: 'send_failed' });
      }
    }
    const cleaned = await purgeDeadTokens(deadTokens);

    const sentCount = results.filter(r => r.success).length;
    const failures = {};
    for (const r of results) {
      if (!r.success) failures[r.error || 'unknown'] = (failures[r.error || 'unknown'] || 0) + 1;
    }
    console.log(JSON.stringify({
      level: 'info',
      event: 'push_sent',
      adminUid: decodedToken.uid,
      type: type,
      recipientCount: tokens.length,
      successCount: sentCount,
      failures: failures,
      cleanedTokens: cleaned,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString()
    }));

    return res.status(200).json({ sent: sentCount, total: tokens.length, cleaned: cleaned });
  } catch (e) {
    console.log(JSON.stringify({
      level: 'error',
      event: 'push_error',
      error: String(e && e.message || e).slice(0, 200),
      timestamp: new Date().toISOString()
    }));
    return res.status(500).json({ error: 'Internal error', code: 'internal_error' });
  }
};

// Réutilisé par api/health.js pour vérifier le compte de service sans secret exposé.
module.exports.getFirebaseApp = getFirebaseApp;
module.exports.getAccessToken = getAccessToken;
module.exports.getServiceAccount = getServiceAccount;
module.exports.getProjectId = getProjectId;
module.exports.getDb = getDb;
module.exports.buildFcmMessage = buildFcmMessage;
module.exports.classifyFcmError = classifyFcmError;
module.exports.probeFcmSend = probeFcmSend;
module.exports.probeStoredTokens = probeStoredTokens;
module.exports.purgeDeadTokens = purgeDeadTokens;
module.exports.sweepStoredTokens = sweepStoredTokens;
module.exports.getActiveMemberEntries = getActiveMemberEntries;
module.exports.setCorsHeaders = setCorsHeaders;
