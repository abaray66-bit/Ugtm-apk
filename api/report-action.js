const admin = require('firebase-admin');

let firebaseApp = null;
let cachedServiceAccount = null;

function parseServiceAccount() {
  if (cachedServiceAccount) return cachedServiceAccount;
  const raw = process.env.FCM_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FCM_SERVICE_ACCOUNT missing');
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { throw new Error('FCM_SERVICE_ACCOUNT is not valid JSON'); }
  if (!parsed.client_email || !parsed.private_key) throw new Error('FCM_SERVICE_ACCOUNT incomplete');
  cachedServiceAccount = parsed;
  return parsed;
}

function getFirebaseApp() {
  if (firebaseApp) return firebaseApp;
  firebaseApp = admin.initializeApp({ credential: admin.credential.cert(parseServiceAccount()) });
  return firebaseApp;
}

function getDb() { return getFirebaseApp().firestore(); }

function isValidUid(uid) { return typeof uid === 'string' && uid.length > 0 && uid.length <= 128; }
function isValidText(v, min, max) { return typeof v === 'string' && v.length >= min && v.length <= max; }

const VALID_STATUSES = ['new', 'in_progress', 'pending_response', 'closed', 'reopened'];
const VALID_LEVELS = ['local', 'provincial', 'regional', 'national', 'institutional'];
const VALID_INTERVENTION_TYPES = ['admin_note', 'member_reply', 'status_change', 'transfer', 'closure', 'reopen', 'attachment_added', 'system', 'external_transmission', 'external_response'];
const STATUS_TRANSITIONS = {
  'new': ['in_progress', 'closed'],
  'in_progress': ['pending_response', 'closed'],
  'pending_response': ['in_progress', 'closed'],
  'closed': ['reopened'],
  'reopened': ['in_progress']
};

function isValidTransition(from, to) {
  if (from === to) return true;
  return (STATUS_TRANSITIONS[from] || []).includes(to);
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

async function getAccessToken(serviceAccount) {
  const crypto = require('crypto');
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
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: assertion })
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('OAuth token exchange failed');
  return tokenData.access_token;
}

async function sendFcmPush(db, toUid, title, body, reportId) {
  try {
    const tokenSnap = await db.collection('fcmTokens').doc(toUid).get();
    if (!tokenSnap.exists) return;
    const data = tokenSnap.data() || {};
    const tokens = Array.isArray(data.tokens) ? data.tokens : (data.token ? [data.token] : []);
    const serviceAccount = JSON.parse(process.env.FCM_SERVICE_ACCOUNT);
    const projectId = process.env.FCM_PROJECT_ID;
    if (!projectId || tokens.length === 0) return;
    const accessToken = await getAccessToken(serviceAccount);
    for (const token of tokens) {
      if (typeof token !== 'string' || token.length < 40) continue;
      try {
        const r = await fetch('https://fcm.googleapis.com/v1/projects/' + projectId + '/messages:send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + accessToken },
          body: JSON.stringify({
            message: {
              token: token,
              notification: { title: title, body: body },
              data: { targetUrl: 'https://ugtm-fns-souss-massa.web.app/app.html?notificationType=report&notificationId=' + reportId },
              webpush: { fcm_options: { link: 'https://ugtm-fns-souss-massa.web.app/app.html?notificationType=report&notificationId=' + reportId }, notification: { icon: '/icons/ugtm-mark.svg', tag: 'report-' + reportId, renotify: false } },
              android: { priority: 'high', notification: { tag: 'report-' + reportId } }
            }
          })
        });
        const result = await r.json();
        if (!result.name) {
          console.warn('FCM send failed:', result);
          if (result.error && result.error.message && /not registered|unregistered/i.test(result.error.message)) {
            await db.collection('fcmTokens').doc(toUid).update({ tokens: admin.firestore.FieldValue.arrayRemove(token) }).catch(() => {});
          }
        }
      } catch (e) { console.warn('FCM send error:', e); }
    }
  } catch (e) { console.warn('FCM notification error:', e); }
}

module.exports = async function handler(req, res) {
  const startTime = Date.now();
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'] || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) return res.status(401).json({ error: 'Unauthorized' });

  let firebaseAppRef;
  try { firebaseAppRef = getFirebaseApp(); }
  catch (e) { return res.status(500).json({ error: 'Server misconfigured', code: 'firebase_init_failed' }); }

  let decodedToken;
  try { decodedToken = await firebaseAppRef.auth().verifyIdToken(idToken); }
  catch (e) { return res.status(401).json({ error: 'Unauthorized', code: String((e && e.code) || 'invalid_token') }); }

  if (!decodedToken.email_verified) return res.status(403).json({ error: 'Forbidden' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  const { action, reportId } = body;
  if (!action || !reportId) return res.status(400).json({ error: 'Missing action or reportId' });

  const db = getDb();
  const uid = decodedToken.uid;

  // Récupérer le membre (source fiable)
  const memberSnap = await db.collection('members').doc(uid).get();
  if (!memberSnap.exists) return res.status(403).json({ error: 'Forbidden', code: 'no_member' });
  const member = memberSnap.data();
  if (member.status !== 'active') return res.status(403).json({ error: 'Forbidden', code: 'inactive' });

  // Vérifier si l'utilisateur est admin par email (comme le client)
  let isAdminByEmail = false;
  try {
    const adminConfigSnap = await db.collection('config').doc('admins').get();
    if (adminConfigSnap.exists) {
      const emails = adminConfigSnap.data().emails || [];
      const bootstrapEmails = ['abaray66@gmail.com'];
      const allEmails = [...bootstrapEmails, ...emails].map(e => String(e).trim().toLowerCase());
      isAdminByEmail = allEmails.includes((decodedToken.email || '').toLowerCase());
    } else {
      isAdminByEmail = (decodedToken.email || '').toLowerCase() === 'abaray66@gmail.com';
    }
  } catch (e) {
    isAdminByEmail = (decodedToken.email || '').toLowerCase() === 'abaray66@gmail.com';
  }

  const isAdmin = isAdminByEmail || member.role === 'admin';
  const isSubAdmin = member.role === 'subadmin';
  const isSubAdminLocal = member.role === 'subadminLocal';
  const isMember = member.role === 'member';

  if (!isAdmin && !isSubAdmin && !isSubAdminLocal && !isMember) {
    return res.status(403).json({ error: 'Forbidden', code: 'not_authorized' });
  }

  // Récupérer le report
  const reportRef = db.collection('reports').doc(reportId);
  const reportSnap = await reportRef.get();
  if (!reportSnap.exists) return res.status(404).json({ error: 'Report not found' });
  const report = reportSnap.data();

  // Vérifier le périmètre
  if (!isAdmin) {
    if (isSubAdmin && report.province !== (member.adminProvince || member.prov)) {
      return res.status(403).json({ error: 'Forbidden', code: 'province_mismatch' });
    }
    if (isSubAdminLocal && report.structureId !== member.adminStructure) {
      return res.status(403).json({ error: 'Forbidden', code: 'structure_mismatch' });
    }
    if (isMember && report.ownerUid !== uid) {
      return res.status(403).json({ error: 'Forbidden', code: 'not_owner' });
    }
  }

  try {
    switch (action) {
      case 'transfer': {
        const { toUid, reason } = body;
        if (!toUid || !reason) return res.status(400).json({ error: 'Missing toUid or reason' });
        if (toUid === uid) return res.status(400).json({ error: 'Cannot transfer to self' });
        if (reason.length < 3 || reason.length > 500) return res.status(400).json({ error: 'Invalid reason' });
        if (!isAdmin && !isSubAdmin && !isSubAdminLocal) return res.status(403).json({ error: 'Forbidden' });

        const destSnap = await db.collection('members').doc(toUid).get();
        if (!destSnap.exists) return res.status(400).json({ error: 'Recipient not found' });
        const dest = destSnap.data();
        if (dest.status !== 'active') return res.status(400).json({ error: 'Recipient inactive' });
        if (!['admin', 'subadmin', 'subadminLocal'].includes(dest.role)) return res.status(400).json({ error: 'Recipient role invalid' });
        if (dest.isNationalSecretary === true) return res.status(403).json({ error: 'Forbidden', code: 'recipient_excluded' });

        if (!isAdmin) {
          if (isSubAdmin && dest.adminProvince !== (member.adminProvince || member.prov)) return res.status(403).json({ error: 'Forbidden' });
          if (isSubAdminLocal && dest.adminStructure !== member.adminStructure) return res.status(403).json({ error: 'Forbidden' });
        }

        await db.runTransaction(async (t) => {
          const freshMemberSnap = await t.get(db.collection('members').doc(uid));
          const freshDestSnap = await t.get(db.collection('members').doc(toUid));
          const freshReportSnap = await t.get(reportRef);
          if (!freshMemberSnap.exists || !freshDestSnap.exists || !freshReportSnap.exists) throw new Error('Not found');
          const freshMember = freshMemberSnap.data();
          const freshDest = freshDestSnap.data();
          const freshReport = freshReportSnap.data();
          if (freshMember.status !== 'active' || freshDest.status !== 'active') throw new Error('Inactive');
          if (!isAdmin) {
            if (isSubAdmin && freshReport.province !== (freshMember.adminProvince || freshMember.prov)) throw new Error('Forbidden');
            if (isSubAdminLocal && freshReport.structureId !== freshMember.adminStructure) throw new Error('Forbidden');
          }
          if (!['admin', 'subadmin', 'subadminLocal'].includes(freshDest.role)) throw new Error('Invalid recipient');
          if (freshDest.isNationalSecretary === true) throw new Error('Recipient excluded');

          const fromUid = freshReport.assignedTo || '';
          t.update(reportRef, {
            status: freshReport.status,
            assignedTo: toUid,
            transferredFrom: fromUid,
            transferredTo: toUid,
            transferredAt: admin.firestore.FieldValue.serverTimestamp(),
            transferredReason: reason,
            lastInterventionBy: uid,
            lastInterventionAt: admin.firestore.FieldValue.serverTimestamp(),
            lastInterventionLevel: 'local',
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });

          const interventionRef = db.collection('reportInterventions').doc();
          t.set(interventionRef, {
            reportId: reportId,
            seq: Date.now(),
            authorUid: uid,
            authorRole: isAdmin ? 'admin' : (isSubAdmin ? 'subadmin' : 'subadminLocal'),
            authorName: freshMember.name || '',
            authorStructure: freshMember.adminStructure || freshMember.etab || '',
            authorProvince: freshMember.adminProvince || freshMember.prov || '',
            type: 'transfer',
            level: 'local',
            content: 'Transfert à ' + (freshDest.name || freshDest.email) + ' — ' + reason,
            attachmentIds: [],
            statusBefore: freshReport.status,
            statusAfter: freshReport.status,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            isSystem: false
          });

          const notifRef = db.collection('notifications').doc(toUid).collection('items').doc();
          t.set(notifRef, {
            title: 'Signalement transféré',
            body: 'Un signalement vous a été transféré : ' + reason.slice(0, 100),
            type: 'report',
            read: false,
            authorUid: uid,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            targetScreen: 'admin',
            targetId: reportId,
            province: freshReport.province || ''
          });
        });

        await sendFcmPush(db, toUid, 'Signalement transféré', 'Un signalement vous a été transféré : ' + reason.slice(0, 100), reportId);

        return res.status(200).json({ success: true, action: 'transfer', reportId });
      }

      case 'close': {
        const { response } = body;
        if (!response || response.length < 1 || response.length > 3000) return res.status(400).json({ error: 'Invalid response' });
        if (!['new', 'in_progress', 'pending_response'].includes(report.status)) {
          return res.status(400).json({ error: 'Invalid status transition' });
        }
        if (!isAdmin && !isSubAdmin && !isSubAdminLocal) {
          return res.status(403).json({ error: 'Forbidden', code: 'not_manager' });
        }

        await db.runTransaction(async (t) => {
          const freshMemberSnap = await t.get(db.collection('members').doc(uid));
          const freshReportSnap = await t.get(reportRef);
          if (!freshMemberSnap.exists || !freshReportSnap.exists) throw new Error('Not found');
          const freshMember = freshMemberSnap.data();
          const freshReport = freshReportSnap.data();
          if (freshMember.status !== 'active') throw new Error('Inactive');
          if (!isAdmin) {
            if (isSubAdmin && freshReport.province !== (freshMember.adminProvince || freshMember.prov)) throw new Error('Forbidden');
            if (isSubAdminLocal && freshReport.structureId !== freshMember.adminStructure) throw new Error('Forbidden');
          }
          if (!['new', 'in_progress', 'pending_response'].includes(freshReport.status)) throw new Error('Invalid transition');

          t.update(reportRef, {
            status: 'closed',
            response: response,
            closedAt: admin.firestore.FieldValue.serverTimestamp(),
            closedBy: uid,
            lastInterventionBy: uid,
            lastInterventionAt: admin.firestore.FieldValue.serverTimestamp(),
            lastInterventionLevel: 'local',
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });

          const interventionRef = db.collection('reportInterventions').doc();
          t.set(interventionRef, {
            reportId: reportId,
            seq: Date.now(),
            authorUid: uid,
            authorRole: isAdmin ? 'admin' : (isSubAdmin ? 'subadmin' : 'subadminLocal'),
            authorName: freshMember.name || '',
            authorStructure: freshMember.adminStructure || freshMember.etab || '',
            authorProvince: freshMember.adminProvince || freshMember.prov || '',
            type: 'closure',
            level: 'local',
            content: response,
            attachmentIds: [],
            statusBefore: freshReport.status,
            statusAfter: 'closed',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            isSystem: false
          });
        });

        return res.status(200).json({ success: true, action: 'close', reportId });
      }

      case 'reopen': {
        const { reason } = body;
        if (!isValidText(reason, 3, 500)) return res.status(400).json({ error: 'Invalid reason' });
        if (report.status !== 'closed') return res.status(400).json({ error: 'Invalid status transition' });

        if (isMember && report.ownerUid !== uid) return res.status(403).json({ error: 'Forbidden' });
        if (!isAdmin && !isSubAdmin && !isSubAdminLocal && !isMember) return res.status(403).json({ error: 'Forbidden' });

        await db.runTransaction(async (t) => {
          const freshMemberSnap = await t.get(db.collection('members').doc(uid));
          const freshReportSnap = await t.get(reportRef);
          if (!freshMemberSnap.exists || !freshReportSnap.exists) throw new Error('Not found');
          const freshMember = freshMemberSnap.data();
          const freshReport = freshReportSnap.data();
          if (freshMember.status !== 'active') throw new Error('Inactive');
          if (!isAdmin && !isSubAdmin && !isSubAdminLocal) {
            if (freshReport.ownerUid !== uid) throw new Error('Forbidden');
          }
          if (freshReport.status !== 'closed') throw new Error('Invalid transition');

          t.update(reportRef, {
            status: 'reopened',
            reopenReason: reason,
            reopenedAt: admin.firestore.FieldValue.serverTimestamp(),
            reopenedBy: uid,
            lastInterventionBy: uid,
            lastInterventionAt: admin.firestore.FieldValue.serverTimestamp(),
            lastInterventionLevel: 'local',
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });

          const interventionRef = db.collection('reportInterventions').doc();
          t.set(interventionRef, {
            reportId: reportId,
            seq: Date.now(),
            authorUid: uid,
            authorRole: isAdmin ? 'admin' : (isSubAdmin ? 'subadmin' : (isSubAdminLocal ? 'subadminLocal' : 'member')),
            authorName: freshMember.name || '',
            authorStructure: freshMember.adminStructure || freshMember.etab || '',
            authorProvince: freshMember.adminProvince || freshMember.prov || '',
            type: 'reopen',
            level: 'local',
            content: reason,
            attachmentIds: [],
            statusBefore: 'closed',
            statusAfter: 'reopened',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            isSystem: false
          });
        });

        return res.status(200).json({ success: true, action: 'reopen', reportId });
      }

      case 'respond': {
        const { content } = body;
        if (!isValidText(content, 1, 4000)) return res.status(400).json({ error: 'Invalid content' });
        if (report.status !== 'pending_response') return res.status(400).json({ error: 'Invalid status transition' });
        if (report.ownerUid !== uid) return res.status(403).json({ error: 'Forbidden' });
        if (!isMember) return res.status(403).json({ error: 'Forbidden' });

        await db.runTransaction(async (t) => {
          const freshMemberSnap = await t.get(db.collection('members').doc(uid));
          const freshReportSnap = await t.get(reportRef);
          if (!freshMemberSnap.exists || !freshReportSnap.exists) throw new Error('Not found');
          const freshMember = freshMemberSnap.data();
          const freshReport = freshReportSnap.data();
          if (freshMember.status !== 'active') throw new Error('Inactive');
          if (freshReport.ownerUid !== uid) throw new Error('Forbidden');
          if (freshReport.status !== 'pending_response') throw new Error('Invalid transition');

          t.update(reportRef, {
            status: 'in_progress',
            memberResponsePending: false,
            lastInterventionBy: uid,
            lastInterventionAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });

          const interventionRef = db.collection('reportInterventions').doc();
          t.set(interventionRef, {
            reportId: reportId,
            seq: Date.now(),
            authorUid: uid,
            authorRole: 'member',
            authorName: freshMember.name || '',
            authorStructure: freshMember.adminStructure || freshMember.etab || '',
            authorProvince: freshMember.adminProvince || freshMember.prov || '',
            type: 'member_reply',
            level: 'local',
            content: content,
            attachmentIds: [],
            statusBefore: 'pending_response',
            statusAfter: 'in_progress',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            isSystem: false
          });
        });

        return res.status(200).json({ success: true, action: 'respond', reportId });
      }

      case 'addIntervention': {
        const { type, level, content, attachmentIds } = body;
        if (!VALID_INTERVENTION_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid type' });
        if (!VALID_LEVELS.includes(level)) return res.status(400).json({ error: 'Invalid level' });
        if (!isValidText(content, 1, 4000)) return res.status(400).json({ error: 'Invalid content' });

        const isAdmin = member.role === 'admin';
        const isSubAdmin = member.role === 'subadmin';
        const isSubAdminLocal = member.role === 'subadminLocal';
        const isMember = member.role === 'member';

        const allowedTypes = {
          admin: ['admin_note', 'status_change', 'transfer', 'closure', 'system', 'attachment_added'],
          subadmin: ['admin_note', 'status_change', 'transfer', 'closure', 'attachment_added'],
          subadminLocal: ['admin_note', 'status_change', 'transfer', 'closure', 'attachment_added'],
          member: ['member_reply', 'reopen', 'attachment_added']
        };

        const effectiveRole = isAdmin ? 'admin' : (isSubAdmin ? 'subadmin' : (isSubAdminLocal ? 'subadminLocal' : 'member'));
        if (!allowedTypes[effectiveRole]?.includes(type)) {
          return res.status(403).json({ error: 'Forbidden', code: 'invalid_type' });
        }

        const isSystem = type === 'system' && isAdmin;

        const authorRole = isAdmin ? 'admin' : (isSubAdmin ? 'subadmin' : (isSubAdminLocal ? 'subadminLocal' : 'member'));

        if (!isAdmin) {
          if (isSubAdmin && report.province !== (member.adminProvince || member.prov)) {
            return res.status(403).json({ error: 'Forbidden', code: 'province_mismatch' });
          }
          if (isSubAdminLocal && report.structureId !== member.adminStructure) {
            return res.status(403).json({ error: 'Forbidden', code: 'structure_mismatch' });
          }
          if (isMember && report.ownerUid !== uid) {
            return res.status(403).json({ error: 'Forbidden', code: 'not_owner' });
          }
        }

        if (attachmentIds && attachmentIds.length > 0) {
          for (const attId of attachmentIds) {
            const attSnap = await db.collection('reportAttachments').doc(attId).get();
            if (!attSnap.exists || attSnap.data().reportId !== reportId) {
              return res.status(400).json({ error: 'Invalid attachment' });
            }
          }
        }

        await db.runTransaction(async (t) => {
          const freshMemberSnap = await t.get(db.collection('members').doc(uid));
          const freshReportSnap = await t.get(reportRef);
          if (!freshMemberSnap.exists || !freshReportSnap.exists) throw new Error('Not found');
          const freshMember = freshMemberSnap.data();
          const freshReport = freshReportSnap.data();
          if (freshMember.status !== 'active') throw new Error('Inactive');

          const interventionRef = db.collection('reportInterventions').doc();
          t.set(interventionRef, {
            reportId: reportId,
            seq: Date.now(),
            authorUid: uid,
            authorRole: authorRole,
            authorName: freshMember.name || '',
            authorStructure: freshMember.adminStructure || freshMember.etab || '',
            authorProvince: freshMember.adminProvince || freshMember.prov || '',
            type: type,
            level: level,
            content: content,
            attachmentIds: Array.isArray(attachmentIds) ? attachmentIds : [],
            statusBefore: freshReport.status,
            statusAfter: freshReport.status,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            isSystem: isSystem
          });
        });

        return res.status(200).json({ success: true, action: 'addIntervention', reportId });
      }

      case 'externalTransmission': {
        const { name, func, establishment, contact, reason } = body;
        if (!isValidText(name, 1, 120)) return res.status(400).json({ error: 'Invalid name' });
        if (!isValidText(func, 1, 80)) return res.status(400).json({ error: 'Invalid function' });
        if (!isValidText(establishment, 1, 160)) return res.status(400).json({ error: 'Invalid establishment' });
        if (!isValidText(reason, 3, 500)) return res.status(400).json({ error: 'Invalid reason' });

        if (!isAdmin && !isSubAdmin && !isSubAdminLocal) {
          return res.status(403).json({ error: 'Forbidden', code: 'not_manager' });
        }

        await db.runTransaction(async (t) => {
          const freshMemberSnap = await t.get(db.collection('members').doc(uid));
          const freshReportSnap = await t.get(reportRef);
          if (!freshMemberSnap.exists || !freshReportSnap.exists) throw new Error('Not found');
          const freshMember = freshMemberSnap.data();
          const freshReport = freshReportSnap.data();
          if (freshMember.status !== 'active') throw new Error('Inactive');
          if (!isAdmin) {
            if (isSubAdmin && freshReport.province !== (freshMember.adminProvince || freshMember.prov)) throw new Error('Forbidden');
            if (isSubAdminLocal && freshReport.structureId !== freshMember.adminStructure) throw new Error('Forbidden');
          }

          const interventionRef = db.collection('reportInterventions').doc();
          t.set(interventionRef, {
            reportId: reportId,
            seq: Date.now(),
            authorUid: uid,
            authorRole: isAdmin ? 'admin' : (isSubAdmin ? 'subadmin' : 'subadminLocal'),
            authorName: freshMember.name || '',
            authorStructure: freshMember.adminStructure || freshMember.etab || '',
            authorProvince: freshMember.adminProvince || freshMember.prov || '',
            type: 'external_transmission',
            level: 'institutional',
            content: 'Transmission à ' + name + ' (' + func + ') — ' + establishment + '. Motif: ' + reason + (contact ? ' Contact: ' + contact : ''),
            attachmentIds: [],
            statusBefore: freshReport.status,
            statusAfter: freshReport.status,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            isSystem: false,
            externalAuthorName: name,
            externalAuthorFunction: func,
            externalAuthorEstablishment: establishment,
            externalAuthorContact: contact || ''
          });
        });

        return res.status(200).json({ success: true, action: 'externalTransmission', reportId });
      }

      case 'externalResponse': {
        const { authorName, authorFunction, authorEstablishment, content, receivedAt, attachmentId } = body;
        if (!isValidText(authorName, 1, 120)) return res.status(400).json({ error: 'Invalid authorName' });
        if (!isValidText(authorFunction, 1, 80)) return res.status(400).json({ error: 'Invalid authorFunction' });
        if (!isValidText(authorEstablishment, 1, 160)) return res.status(400).json({ error: 'Invalid authorEstablishment' });
        if (!isValidText(content, 1, 4000)) return res.status(400).json({ error: 'Invalid content' });

        if (!isAdmin && !isSubAdmin && !isSubAdminLocal) {
          return res.status(403).json({ error: 'Forbidden', code: 'not_manager' });
        }

        await db.runTransaction(async (t) => {
          const freshMemberSnap = await t.get(db.collection('members').doc(uid));
          const freshReportSnap = await t.get(reportRef);
          if (!freshMemberSnap.exists || !freshReportSnap.exists) throw new Error('Not found');
          const freshMember = freshMemberSnap.data();
          const freshReport = freshReportSnap.data();
          if (freshMember.status !== 'active') throw new Error('Inactive');
          if (!isAdmin) {
            if (isSubAdmin && freshReport.province !== (freshMember.adminProvince || freshMember.prov)) throw new Error('Forbidden');
            if (isSubAdminLocal && freshReport.structureId !== freshMember.adminStructure) throw new Error('Forbidden');
          }

          const interventionRef = db.collection('reportInterventions').doc();
          t.set(interventionRef, {
            reportId: reportId,
            seq: Date.now(),
            authorUid: uid,
            authorRole: isAdmin ? 'admin' : (isSubAdmin ? 'subadmin' : 'subadminLocal'),
            authorName: freshMember.name || '',
            authorStructure: freshMember.adminStructure || freshMember.etab || '',
            authorProvince: freshMember.adminProvince || freshMember.prov || '',
            type: 'external_response',
            level: 'institutional',
            content: content,
            attachmentIds: attachmentId ? [attachmentId] : [],
            statusBefore: freshReport.status,
            statusAfter: freshReport.status,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            isSystem: false,
            externalAuthorName: authorName,
            externalAuthorFunction: authorFunction,
            externalAuthorEstablishment: authorEstablishment,
            receivedAt: receivedAt ? new Date(receivedAt) : admin.firestore.FieldValue.serverTimestamp()
          });
        });

        return res.status(200).json({ success: true, action: 'externalResponse', reportId });
      }

      default:
        return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (e) {
    console.error('report-action error:', e);
    return res.status(500).json({ error: 'Internal error', code: 'internal_error' });
  }
};
