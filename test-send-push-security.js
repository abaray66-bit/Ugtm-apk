const originalFetch = globalThis.fetch;
// Appels FCM réellement émis, pour compter les messages d'un envoi.
const mockFcmCalls = [];
globalThis.fetch = async function(url, opts) {
  if (url.includes('oauth2.googleapis.com/token')) {
    return { json: async () => ({ access_token: 'mock-access-token' }) };
  }
  mockFcmCalls.push({ url: String(url), body: opts && opts.body });
  // Jeton de sonde : FCM repond « jeton inconnu », ce qui prouve que la charge
  // utile a ete acceptee puis que le destinataire a ete refuse.
  if (opts && String(opts.body || '').indexOf('probe-token') !== -1) {
    return {
      status: 400,
      json: async () => ({
        error: {
          code: 400,
          status: 'INVALID_ARGUMENT',
          message: 'The registration token is not a valid FCM registration token',
          details: [{ errorCode: 'INVALID_ARGUMENT' }]
        }
      })
    };
  }
  const rawBody = opts && String(opts.body || '');
  if (rawBody.indexOf('validate_only') !== -1) {
    // Validation de jeton : aucun envoi, FCM repond 200 (corps vide) ou refuse.
    if (rawBody.indexOf('jeton-mort') !== -1) {
      return {
        status: 404,
        json: async () => ({ error: { code: 404, status: 'NOT_FOUND', message: 'Requested entity was not found.' } })
      };
    }
    return { status: 200, json: async () => ({}) };
  }
  return { status: 200, json: async () => ({ name: 'mock-message-id' }) };
};

const originalEnv = { ...process.env };
function setEnv(obj) {
  Object.assign(process.env, obj);
}

const mockVerifyIdToken = async function(token) {
  if (token === 'valid-admin-token') {
    return { uid: 'admin-uid', email: 'abaray66@gmail.com', email_verified: true };
  }
  if (token === 'valid-user-token') {
    return { uid: 'user-uid', email: 'user@test.com', email_verified: true };
  }
  if (token === 'unverified-token') {
    return { uid: 'unverified-uid', email: 'unverified@test.com', email_verified: false };
  }
  throw new Error('Invalid token');
};

// Contenu Firestore simulé, modifiable par les tests qui en ont besoin.
let mockDbState = { activeMembers: [], tokens: [] };

const mockFirestore = {
  collection: function(name) {
    return {
      where: function() {
        return {
          get: async () => ({
            docs: name === 'members'
              ? mockDbState.activeMembers.map(id => ({ id: id, data: () => ({ status: 'active' }) }))
              : []
          })
        };
      },
      get: async () => ({
        docs: (name === 'fcmTokens' ? mockDbState.tokens : [])
          .map(t => ({ id: t.id, data: () => ({ token: t.token }) }))
      }),
      doc: function(id) {
        const stored = name === 'fcmTokens' ? mockDbState.tokens.filter(t => t.id === id)[0] : null;
        return {
          get: async () => ({ exists: !!stored, data: () => (stored ? { token: stored.token } : null) }),
          set: async () => {},
          update: async () => {}
        };
      }
    };
  }
};

const proxyquire = require('proxyquire');
const handler = proxyquire('./api/send-push.js', {
  'firebase-admin': {
    initializeApp: function() { return { auth: () => ({ verifyIdToken: mockVerifyIdToken }), firestore: () => mockFirestore }; },
    credential: { cert: function() { return {}; } },
    firestore: { Timestamp: { now: () => ({ toMillis: () => Date.now() }) }, FieldValue: { increment: (n) => n } }
  }
});

function makeRes() {
  const res = {};
  res._status = null;
  res._body = null;
  res.status = function(c){ this._status = c; return this; };
  res.json = function(d){ this._body = d; return this; };
  res.setHeader = function(){ return this; };
  return res;
}

function assertEqual(actual, expected, context) {
  if (actual !== expected) {
    throw new Error('Expected ' + expected + ' but got ' + actual + (context ? ' — ' + context : ''));
  }
}

let failures = 0;

async function runTest(name, fn) {
  try {
    await fn();
    console.log('PASS: ' + name);
  } catch (e) {
    failures++;
    console.log('FAIL: ' + name + ' - ' + e.message);
  }
}

async function main() {
  // Cle RSA reelle partagee par tous les tests qui atteignent l'envoi FCM :
  // parseServiceAccount met le compte de service en cache au premier appel,
  // donc tous les tests doivent fournir cette meme cle valide.
  const { privateKey: testPrivateKey } = require('crypto').generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' }
  });
  const TEST_SERVICE_ACCOUNT = JSON.stringify({
    type: 'service_account',
    project_id: 'ugtm-fns-souss-massa',
    client_email: 'svc@ugtm-fns-souss-massa.iam.gserviceaccount.com',
    private_key: testPrivateKey
  });
  function setBaseEnv() {
    setEnv({ FCM_SERVICE_ACCOUNT: TEST_SERVICE_ACCOUNT, FCM_PROJECT_ID: 'p', ADMIN_EMAILS: 'abaray66@gmail.com' });
  }

  await runTest('config Firebase absente -> 500 explicite (jamais 401)', async () => {
    delete process.env.FCM_SERVICE_ACCOUNT;
    const req = { method: 'POST', headers: { 'authorization': 'Bearer valid-admin-token' }, body: JSON.stringify({ type: 'news', title: 't', body: 'b' }) };
    const res = makeRes();
    await handler(req, res);
    assertEqual(res._status, 500);
    assertEqual(res._body.code, 'firebase_init_failed');
  });

  await runTest('refuse GET', async () => {
    setBaseEnv();
    const req = { method: 'GET', headers: {} };
    const res = makeRes();
    await handler(req, res);
    assertEqual(res._status, 405);
  });

  await runTest('refuse sans token', async () => {
    setBaseEnv();
    const req = { method: 'POST', headers: {}, body: JSON.stringify({ type: 'news', title: 't', body: 'b' }) };
    const res = makeRes();
    await handler(req, res);
    assertEqual(res._status, 401);
  });

  await runTest('refuse token invalide', async () => {
    setBaseEnv();
    const req = { method: 'POST', headers: { 'authorization': 'Bearer invalid-token' }, body: JSON.stringify({ type: 'news', title: 't', body: 'b' }) };
    const res = makeRes();
    await handler(req, res);
    assertEqual(res._status, 401);
  });

  await runTest('refuse utilisateur non admin', async () => {
    setBaseEnv();
    const req = { method: 'POST', headers: { 'authorization': 'Bearer valid-user-token' }, body: JSON.stringify({ type: 'news', title: 't', body: 'b' }) };
    const res = makeRes();
    await handler(req, res);
    assertEqual(res._status, 403);
  });

  await runTest('refuse email non verifie', async () => {
    setBaseEnv();
    const req = { method: 'POST', headers: { 'authorization': 'Bearer unverified-token' }, body: JSON.stringify({ type: 'news', title: 't', body: 'b' }) };
    const res = makeRes();
    await handler(req, res);
    assertEqual(res._status, 403);
  });

  await runTest('refuse type invalide', async () => {
    setBaseEnv();
    const req = { method: 'POST', headers: { 'authorization': 'Bearer valid-admin-token' }, body: JSON.stringify({ type: 'invalid', title: 't', body: 'b' }) };
    const res = makeRes();
    await handler(req, res);
    assertEqual(res._status, 400);
  });

  await runTest('refuse sans title', async () => {
    setBaseEnv();
    const req = { method: 'POST', headers: { 'authorization': 'Bearer valid-admin-token' }, body: JSON.stringify({ type: 'news', body: 'b' }) };
    const res = makeRes();
    await handler(req, res);
    assertEqual(res._status, 400);
  });

  await runTest('refuse adhesion sans targetUid', async () => {
    setBaseEnv();
    const req = { method: 'POST', headers: { 'authorization': 'Bearer valid-admin-token' }, body: JSON.stringify({ type: 'adhesion', title: 't', body: 'b' }) };
    const res = makeRes();
    await handler(req, res);
    assertEqual(res._status, 400);
  });

  await runTest('aucun destinataire -> 200 no_recipients + log diagnostique', async () => {
    setBaseEnv();
    mockDbState = { activeMembers: ['m1', 'm2'], tokens: [] };
    const req = { method: 'POST', headers: { authorization: 'Bearer valid-admin-token' }, body: JSON.stringify({ type: 'news', title: 't', body: 'b' }) };
    const res = makeRes();
    const logs = [];
    const originalLog = console.log;
    console.log = function(line) { logs.push(String(line)); };
    try { await handler(req, res); } finally { console.log = originalLog; mockDbState = { activeMembers: [], tokens: [] }; }

    assertEqual(res._status, 200);
    assertEqual(res._body.code, 'no_recipients');
    const events = logs.map(function(l) { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
    if (!events.some(function(e) { return e.event === 'push_request'; })) {
      throw new Error('log push_request absent : impossible de voir que la requete a atteint le serveur');
    }
    const diag = events.filter(function(e) { return e.event === 'push_no_recipients'; })[0];
    if (!diag) throw new Error('log push_no_recipients absent');
    assertEqual(diag.activeMembers, 2);
    assertEqual(diag.storedTokens, 0);
    assertEqual(diag.activeMembersWithToken, 0);
    if (!diag.hint) throw new Error('diagnostic sans hint');
  });

  await runTest('diffusion : un appareil enregistre sous deux comptes ne recoit qu un message', async () => {
    setBaseEnv();
    // Le meme telephone, enregistre sous deux comptes differents :
    // deux documents fcmTokens portent exactement le meme jeton.
    const sharedToken = 'meme-appareil-token-0123456789abcdefghijklmnopqrstuvwxyz';
    mockDbState = {
      activeMembers: ['m1', 'm2'],
      tokens: [{ id: 'm1', token: sharedToken }, { id: 'm2', token: sharedToken }]
    };
    mockFcmCalls.length = 0;
    const req = { method: 'POST', headers: { authorization: 'Bearer valid-admin-token' }, body: JSON.stringify({ type: 'news', title: 't', body: 'b', targetId: 'news1' }) };
    const res = makeRes();
    const logs = [];
    const originalLog = console.log;
    console.log = function(line) { logs.push(String(line)); };
    try { await handler(req, res); } finally { console.log = originalLog; mockDbState = { activeMembers: [], tokens: [] }; }

    assertEqual(res._status, 200, logs.join(' | '));
    assertEqual(res._body.total, 1);
    assertEqual(mockFcmCalls.length, 1);
    mockFcmCalls.length = 0;
  });

  // Diagnostic approfondi : le sort de la reponse FCM doit etre traduit en cause.
  await runTest('sonde FCM : distingue jeton inconnu, charge utile rejetee et droits', async () => {
    const classify = handler.classifyFcmError;
    assertEqual(classify({ name: 'projects/p/messages/1' }), 'accepted');
    assertEqual(classify({
      error: {
        code: 400,
        status: 'INVALID_ARGUMENT',
        message: 'The registration token is not a valid FCM registration token',
        details: [{ errorCode: 'INVALID_ARGUMENT' }]
      }
    }), 'token');
    assertEqual(classify({
      error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Invalid JSON payload received. Unknown name "foo"' }
    }), 'payload');
    assertEqual(classify({ error: { code: 403, status: 'PERMISSION_DENIED' } }), 'permissions');
    assertEqual(classify({ error: { code: 401, status: 'UNAUTHENTICATED' } }), 'credentials');
    assertEqual(classify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }), 'quota');
  });

  await runTest('sonde FCM : la charge utile reelle est soumise a FCM sans destinataire', async () => {
    setBaseEnv();
    mockFcmCalls.length = 0;
    const probe = await handler.probeFcmSend('ugtm-fns-souss-massa', 'mock-access-token');

    assertEqual(mockFcmCalls.length, 1);
    const sent = JSON.parse(mockFcmCalls[0].body);
    // Le message sonde doit porter exactement la structure reelle.
    if (!sent.message || !sent.message.token) throw new Error('message.token absent');
    if (!sent.message.notification || !sent.message.notification.title) throw new Error('notification absente');
    if (!sent.message.data || !sent.message.data.targetUrl) throw new Error('data.targetUrl absent');
    if (!sent.message.webpush || !sent.message.webpush.notification || !sent.message.webpush.notification.tag) throw new Error('tag webpush absent');
    if (!sent.message.android || !sent.message.android.notification || !sent.message.android.notification.tag) throw new Error('tag android absent');

    assertEqual(probe.httpStatus, 400);
    assertEqual(probe.classification, 'token');
    mockFcmCalls.length = 0;
  });

  await runTest('jetons stockes : validate_only separe les valides des obsoletes', async () => {
    setBaseEnv();
    const liveToken = 'jeton-vivant-0123456789abcdefghijklmnopqrstuvwxyz';
    const deadToken = 'jeton-mort-0123456789abcdefghijklmnopqrstuvwxyz';
    mockDbState = {
      activeMembers: ['m1', 'm2'],
      tokens: [{ id: 'm1', token: liveToken }, { id: 'm2', token: deadToken }]
    };
    mockFcmCalls.length = 0;
    const summary = await handler.probeStoredTokens('ugtm-fns-souss-massa', 'mock-access-token', 10);
    mockDbState = { activeMembers: [], tokens: [] };

    assertEqual(summary.checked, 2);
    assertEqual(summary.valid, 1);
    assertEqual(summary.notRegistered, 1);
    assertEqual(summary.rejected, 0);
    // Aucune livraison : chaque appel porte validate_only.
    mockFcmCalls.forEach(function (call) {
      if (String(call.body).indexOf('validate_only') === -1) throw new Error('sonde sans validate_only : une notification serait partie');
    });
    mockFcmCalls.length = 0;
  });

  // Diagnostic /api/health : vérifie la configuration sans exposer de secret.
  const health = require('./api/health.js');

  await runTest('health: configuration absente -> 503', async () => {
    delete process.env.FCM_SERVICE_ACCOUNT;
    delete process.env.FCM_PROJECT_ID;
    const res = makeRes();
    await health({ method: 'GET', headers: {} }, res);
    assertEqual(res._status, 503);
    assertEqual(res._body.checks.serviceAccount, false);
    assertEqual(res._body.checks.oauthToken, false);
  });

  await runTest('health: compte de service valide -> 200 et OAuth accepte', async () => {
    // Vraie paire de cles RSA : signature JWT reelle, echange OAuth simule.
    const { privateKey } = require('crypto').generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' }
    });
    setEnv({
      FCM_SERVICE_ACCOUNT: JSON.stringify({
        type: 'service_account',
        project_id: 'ugtm-fns-souss-massa',
        client_email: 'svc@ugtm-fns-souss-massa.iam.gserviceaccount.com',
        private_key: privateKey
      }),
      FCM_PROJECT_ID: 'ugtm-fns-souss-massa'
    });
    const res = makeRes();
    await health({ method: 'GET', headers: {} }, res);
    assertEqual(res._status, 200);
    assertEqual(res._body.ok, true);
    assertEqual(res._body.checks.adminSdk, true);
    assertEqual(res._body.checks.oauthToken, true);
  });

  globalThis.fetch = originalFetch;
  Object.assign(process.env, originalEnv);
  if (failures > 0) {
    process.exitCode = 1;
    console.log('\n' + failures + ' test(s) en échec.');
    return;
  }
  console.log('\nTous les tests de sécurité du push backend sont passés.');
}

main().catch(e => console.error('Test error:', e));
