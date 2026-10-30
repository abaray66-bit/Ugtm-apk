/* Tests de sécurité pour api/send-push.js (Vercel serverless).
   Exécution : node test-send-push-security.mjs
   Aucun appel réseau réel : on mocke fetch() pour vérifier les validations.
*/

import test from 'node:test';
import assert from 'node:assert/strict';

const originalFetch = globalThis.fetch;
let lastCall = null;
let oauthCalled = false;
globalThis.fetch = async function(url, opts) {
  if (url.includes('oauth2.googleapis.com/token')) {
    oauthCalled = true;
    return { json: async () => ({ access_token: 'mock-access-token' }) };
  }
  lastCall = { url, opts };
  return { json: async () => ({ name: 'mock-message-id' }) };
};

const originalEnv = { ...process.env };
function setEnv(obj) {
  Object.assign(process.env, obj);
}

// Mock crypto.createSign to avoid needing a real RSA key.

const mod = await import('./api/send-push.js');
const handler = mod.default || mod;

test('refuse GET', async () => {
  setEnv({ FCM_SERVICE_ACCOUNT: '{}', FCM_PROJECT_ID: 'p', PUSH_SHARED_SECRET: 'k' });
  const req = { method: 'GET' };
  const res = { status: function(c){ this._status = c; return this; }, json: function(d){ this._body = d; return this; } };
  await handler(req, res);
  assert.equal(res._status, 405);
});

test('refuse POST sans clé partagée', async () => {
  setEnv({ FCM_SERVICE_ACCOUNT: '{}', FCM_PROJECT_ID: 'p', PUSH_SHARED_SECRET: 'k' });
  const req = { method: 'POST', headers: {}, body: JSON.stringify({ title: 't', body: 'b', tokens: ['x'] }) };
  const res = { status: function(c){ this._status = c; return this; }, json: function(d){ this._body = d; return this; } };
  await handler(req, res);
  assert.equal(res._status, 401);
});

test('refuse POST avec mauvaise clé', async () => {
  setEnv({ FCM_SERVICE_ACCOUNT: '{}', FCM_PROJECT_ID: 'p', PUSH_SHARED_SECRET: 'correct' });
  const req = { method: 'POST', headers: { 'x-push-key': 'wrong' }, body: JSON.stringify({ title: 't', body: 'b', tokens: ['x'] }) };
  const res = { status: function(c){ this._status = c; return this; }, json: function(d){ this._body = d; return this; } };
  await handler(req, res);
  assert.equal(res._status, 401);
});

test('refuse sans tokens', async () => {
  setEnv({ FCM_SERVICE_ACCOUNT: '{}', FCM_PROJECT_ID: 'p', PUSH_SHARED_SECRET: 'k' });
  const req = { method: 'POST', headers: { 'x-push-key': 'k' }, body: JSON.stringify({ title: 't', body: 'b', tokens: [] }) };
  const res = { status: function(c){ this._status = c; return this; }, json: function(d){ this._body = d; return this; } };
  await handler(req, res);
  assert.equal(res._status, 400);
});

test('refuse tokens invalides', async () => {
  setEnv({ FCM_SERVICE_ACCOUNT: '{}', FCM_PROJECT_ID: 'p', PUSH_SHARED_SECRET: 'k' });
  const req = { method: 'POST', headers: { 'x-push-key': 'k' }, body: JSON.stringify({ title: 't', body: 'b', tokens: ['short'] }) };
  const res = { status: function(c){ this._status = c; return this; }, json: function(d){ this._body = d; return this; } };
  await handler(req, res);
  assert.equal(res._status, 400);
});

test('refuse trop de tokens', async () => {
  setEnv({ FCM_SERVICE_ACCOUNT: '{}', FCM_PROJECT_ID: 'p', PUSH_SHARED_SECRET: 'k' });
  const tokens = Array(1001).fill('a'.repeat(50));
  const req = { method: 'POST', headers: { 'x-push-key': 'k' }, body: JSON.stringify({ title: 't', body: 'b', tokens }) };
  const res = { status: function(c){ this._status = c; return this; }, json: function(d){ this._body = d; return this; } };
  await handler(req, res);
  assert.equal(res._status, 400);
});

// Cleanup
globalThis.fetch = originalFetch;
Object.assign(process.env, originalEnv);
console.log('\nTous les tests de sécurité du push backend sont passés.');
