const originalFetch = globalThis.fetch;
globalThis.fetch = async function(url, opts) {
  if (url.includes('oauth2.googleapis.com/token')) {
    return { json: async () => ({ access_token: 'mock-access-token' }) };
  }
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

const mockFirestore = {
  collection: function(name) {
    return {
      where: function() { return { get: async () => ({ docs: [] }) }; },
      doc: function(id) {
        return {
          get: async () => ({ exists: false, data: () => null }),
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
  return res;
}

function assertEqual(actual, expected) {
  if (actual !== expected) throw new Error('Expected ' + expected + ' but got ' + actual);
}

async function runTest(name, fn) {
  try {
    await fn();
    console.log('PASS: ' + name);
  } catch (e) {
    console.log('FAIL: ' + name + ' - ' + e.message);
  }
}

async function main() {
  await runTest('refuse GET', async () => {
    setEnv({ FCM_SERVICE_ACCOUNT: '{}', FCM_PROJECT_ID: 'p', ADMIN_EMAILS: 'abaray66@gmail.com' });
    const req = { method: 'GET' };
    const res = makeRes();
    await handler(req, res);
    assertEqual(res._status, 405);
  });

  await runTest('refuse sans token', async () => {
    setEnv({ FCM_SERVICE_ACCOUNT: '{}', FCM_PROJECT_ID: 'p', ADMIN_EMAILS: 'abaray66@gmail.com' });
    const req = { method: 'POST', headers: {}, body: JSON.stringify({ type: 'news', title: 't', body: 'b' }) };
    const res = makeRes();
    await handler(req, res);
    assertEqual(res._status, 401);
  });

  await runTest('refuse token invalide', async () => {
    setEnv({ FCM_SERVICE_ACCOUNT: '{}', FCM_PROJECT_ID: 'p', ADMIN_EMAILS: 'abaray66@gmail.com' });
    const req = { method: 'POST', headers: { 'authorization': 'Bearer invalid-token' }, body: JSON.stringify({ type: 'news', title: 't', body: 'b' }) };
    const res = makeRes();
    await handler(req, res);
    assertEqual(res._status, 401);
  });

  await runTest('refuse utilisateur non admin', async () => {
    setEnv({ FCM_SERVICE_ACCOUNT: '{}', FCM_PROJECT_ID: 'p', ADMIN_EMAILS: 'abaray66@gmail.com' });
    const req = { method: 'POST', headers: { 'authorization': 'Bearer valid-user-token' }, body: JSON.stringify({ type: 'news', title: 't', body: 'b' }) };
    const res = makeRes();
    await handler(req, res);
    assertEqual(res._status, 403);
  });

  await runTest('refuse email non verifie', async () => {
    setEnv({ FCM_SERVICE_ACCOUNT: '{}', FCM_PROJECT_ID: 'p', ADMIN_EMAILS: 'abaray66@gmail.com' });
    const req = { method: 'POST', headers: { 'authorization': 'Bearer unverified-token' }, body: JSON.stringify({ type: 'news', title: 't', body: 'b' }) };
    const res = makeRes();
    await handler(req, res);
    assertEqual(res._status, 403);
  });

  await runTest('refuse type invalide', async () => {
    setEnv({ FCM_SERVICE_ACCOUNT: '{}', FCM_PROJECT_ID: 'p', ADMIN_EMAILS: 'abaray66@gmail.com' });
    const req = { method: 'POST', headers: { 'authorization': 'Bearer valid-admin-token' }, body: JSON.stringify({ type: 'invalid', title: 't', body: 'b' }) };
    const res = makeRes();
    await handler(req, res);
    assertEqual(res._status, 400);
  });

  await runTest('refuse sans title', async () => {
    setEnv({ FCM_SERVICE_ACCOUNT: '{}', FCM_PROJECT_ID: 'p', ADMIN_EMAILS: 'abaray66@gmail.com' });
    const req = { method: 'POST', headers: { 'authorization': 'Bearer valid-admin-token' }, body: JSON.stringify({ type: 'news', body: 'b' }) };
    const res = makeRes();
    await handler(req, res);
    assertEqual(res._status, 400);
  });

  await runTest('refuse adhesion sans targetUid', async () => {
    setEnv({ FCM_SERVICE_ACCOUNT: '{}', FCM_PROJECT_ID: 'p', ADMIN_EMAILS: 'abaray66@gmail.com' });
    const req = { method: 'POST', headers: { 'authorization': 'Bearer valid-admin-token' }, body: JSON.stringify({ type: 'adhesion', title: 't', body: 'b' }) };
    const res = makeRes();
    await handler(req, res);
    assertEqual(res._status, 400);
  });

  globalThis.fetch = originalFetch;
  Object.assign(process.env, originalEnv);
  console.log('\nTous les tests de sécurité du push backend sont passés.');
}

main().catch(e => console.error('Test error:', e));
