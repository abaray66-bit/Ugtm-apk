/* Tests de sécurité pour api/send-push.js (Vercel serverless).
   Exécution : node test-send-push-security.mjs
   Aucun appel réseau réel : on mocke fetch() pour vérifier les validations.
*/

import test from 'node:test';
import assert from 'node:assert/strict';

// Mock global fetch (Vercel appelle la vraie API, on remplace).
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

// Mock process.env
const originalEnv = { ...process.env };
function setEnv(obj) {
  Object.assign(process.env, obj);
}

// Import de la fonction (Vercel exporte une fonction async).
const mod = await import('./api/send-push.js');
const handler = mod.default || mod;

// ---------- Tests ----------

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

test('valide et envoie avec clé correcte', async () => {
  setEnv({ FCM_SERVICE_ACCOUNT: '{"client_email":"a@b.c","private_key":"-----BEGIN PRIVATE KEY-----\nMIIBVwIBADANBgkqhkiG9w0BAQEFAASCAUEwgUNBAQDCAXhnAoGBAOlS9\n-----END PRIVATE KEY-----\n"}', FCM_PROJECT_ID: 'p', PUSH_SHARED_SECRET: 'k' });
  lastCall = null;
  oauthCalled = false;
  const req = { method: 'POST', headers: { 'x-push-key': 'k' }, body: JSON.stringify({ title: 't', body: 'b', tokens: ['a'.repeat(50)] }) };
  const res = { status: function(c){ this._status = c; return this; }, json: function(d){ this._body = d; return this; } };
  await handler(req, res);
  assert.equal(res._status, 200);
  assert.ok(oauthCalled, 'OAuth token exchange was called');
  assert.ok(lastCall, 'fetch was called');
  assert.ok(lastCall.url.includes('fcm.googleapis.com/v1/projects/p/messages:send'));
  assert.equal(lastCall.opts.headers.Authorization, 'Bearer mock-access-token');
});

// Cleanup
globalThis.fetch = originalFetch;
Object.assign(process.env, originalEnv);
console.log('\nTous les tests de sécurité du push backend sont passés.');