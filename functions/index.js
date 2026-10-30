const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const functions = require('firebase-functions');

initializeApp();

exports.sendNotificationOnCreate = functions.firestore
  .document('notifications/{uid}/items/{id}')
  .onCreate(async (snap, context) => {
    const uid = context.params.uid;
    const data = snap.data() ? snap.data() : {};
    const tokenSnap = await getFirestore().doc('fcmTokens/' + uid).get();
    if (!tokenSnap.exists) return;
    const token = tokenSnap.data().token;
    if (!token) return;
    try {
      await getMessaging().send({
        token: token,
        notification: {
          title: String(data.title || 'UGTM'),
          body: String(data.body || '')
        }
      });
    } catch (err) {
      const code = err && (err.code || (err.errorInfo && err.errorInfo.code));
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token'
      ) {
        try {
          await getFirestore().doc('fcmTokens/' + uid).delete();
        } catch (_e) {}
        return;
      }
      // Ne pas supprimer le token pour d'autres erreurs (réseau, quota, invalid-argument générique, etc.)
      return;
    }
  });
