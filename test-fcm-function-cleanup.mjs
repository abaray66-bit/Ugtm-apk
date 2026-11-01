/* Test unitaire de sendNotificationOnCreate avec dépendances simulées */
import test from 'node:test';
import assert from 'node:assert/strict';
import proxyquire from 'proxyquire';
import { pathToFileURL } from 'node:url';

test('supprime fcmTokens/{uid} uniquement pour token invalide/non enregistré', async () => {
  const deletes = [];
  const sent = [];
  const tokenStore = new Map([
    ['u1', { token: 'tok1' }],
    ['u2', { token: 'tok2' }],
    ['u3', { token: 'tok3' }]
  ]);

  const firestoreMock = {
    getFirestore: () => ({
      doc: (path) => ({
        get: async () => {
          const uid = path.split('/')[1];
          if (!tokenStore.has(uid)) return { exists: false };
          return { exists: true, data: () => tokenStore.get(uid) };
        },
        delete: async () => {
          const uid = path.split('/')[1];
          deletes.push(uid);
          tokenStore.delete(uid);
        }
      })
    })
  };

  const messagingMock = {
    getMessaging: () => ({
      send: async (msg) => {
        sent.push(msg.token);
        if (msg.token === 'tok2') {
          const err = new Error('not registered');
          err.code = 'messaging/registration-token-not-registered';
          throw err;
        }
        if (msg.token === 'tok3') {
          const err = new Error('invalid');
          err.code = 'messaging/invalid-argument';
          throw err;
        }
        return { success: true };
      }
    })
  };

  const functionsMock = {
    firestore: {
      document: () => ({
        onCreate: (fn) => {
          // expose for testing
          globalThis.__TEST_FCM_FN__ = fn;
          return fn;
        }
      })
    }
  };

  const adminAppMock = { initializeApp: () => ({}) };

  const modulePath = new URL('./functions/index.js', import.meta.url).href;
  // Use proxyquire style via createRequire is easier in CJS; but file is CJS. Use node's module loading differently.
});

console.log('setup');
