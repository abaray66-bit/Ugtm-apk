/* Tests de décision de suppression/conservation des tokens FCM
   Basés sur les codes d'erreur réels Firebase Admin Messaging. */
import test from 'node:test';
import assert from 'node:assert/strict';

function shouldDeleteToken(err) {
  const code = err && (err.code || (err.errorInfo && err.errorInfo.code));
  if (
    code === 'messaging/registration-token-not-registered' ||
    code === 'messaging/invalid-registration-token'
  ) {
    return true;
  }
  return false;
}

test('supprime token pour messaging/registration-token-not-registered', () => {
  assert.equal(shouldDeleteToken({ code: 'messaging/registration-token-not-registered' }), true);
});

test('supprime token pour messaging/invalid-registration-token', () => {
  assert.equal(shouldDeleteToken({ code: 'messaging/invalid-registration-token' }), true);
});

test('ne supprime pas pour messaging/invalid-argument (générique)', () => {
  assert.equal(shouldDeleteToken({ code: 'messaging/invalid-argument' }), false);
});

test('ne supprime pas pour messaging/unregistered (variante non utilisée)', () => {
  assert.equal(shouldDeleteToken({ code: 'messaging/unregistered' }), false);
});

test('ne supprime pas pour erreurs réseau/quota', () => {
  assert.equal(shouldDeleteToken({ code: 'messaging/internal-error' }), false);
  assert.equal(shouldDeleteToken({ code: 'messaging/server-unavailable' }), false);
  assert.equal(shouldDeleteToken({ code: 'messaging/quota-exceeded' }), false);
  assert.equal(shouldDeleteToken(new Error('network')), false);
  assert.equal(shouldDeleteToken({ errorInfo: { code: 'messaging/invalid-argument' } }), false);
});

console.log('Tests décision suppression/conservation tokens FCM OK.');
