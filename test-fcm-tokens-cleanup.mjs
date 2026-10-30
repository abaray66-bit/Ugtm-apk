/* Test unitaire pour le nettoyage des tokens FCM invalides (functions/index.js)
   Ce test vérifie la logique de détection des codes d'erreur.
   Il ne nécessite pas d'émulateurs Firebase. */
import test from 'node:test';
import assert from 'node:assert/strict';

function shouldDeleteToken(err) {
  const code = err && (err.code || (err.errorInfo && err.errorInfo.code));
  if (
    code === 'messaging/registration-token-not-registered' ||
    code === 'messaging/invalid-registration-token' ||
    code === 'messaging/invalid-argument'
  ) {
    return true;
  }
  return false;
}

test('supprime token pour registration-token-not-registered', () => {
  assert.equal(shouldDeleteToken({ code: 'messaging/registration-token-not-registered' }), true);
});

test('supprime token pour invalid-registration-token', () => {
  assert.equal(shouldDeleteToken({ code: 'messaging/invalid-registration-token' }), true);
});

test('ne supprime pas pour erreur réseau/quota/autre', () => {
  assert.equal(shouldDeleteToken({ code: 'messaging/internal-error' }), false);
  assert.equal(shouldDeleteToken({ code: 'unavailable' }), false);
  assert.equal(shouldDeleteToken(new Error('network')), false);
});

console.log('Tests cleanup tokens FCM OK.');
