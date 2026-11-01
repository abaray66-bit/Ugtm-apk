const originalFetch = globalThis.fetch;
// Appels FCM réellement émis, pour compter les messages d'un envoi.
const mockFcmCalls = [];
globalThis.fetch = async function(url, opts) {
  if (url.includes('oauth2.googleapis.com/token')) {
    return { json: async () => ({ access_token: 'mock-access-token' }) };
  }
  mockFcmCalls.push({ url: String(url), body: opts && opts.body });
  return { json: async () => ({ name: 'mock-message-id' }) };
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
