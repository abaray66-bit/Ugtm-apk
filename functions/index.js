const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');

initializeApp();

exports.sendNotificationOnCreate = onDocumentCreated(
  'notifications/{uid}/items/{id}',
  async (event) => {
    const uid = event.params.uid;
    const data = event.data ? event.data.data() : {};
    const tokenSnap = await getFirestore().doc('fcmTokens/' + uid).get();
    if (!tokenSnap.exists) return;
    const token = tokenSnap.data().token;
    if (!token) return;
    await getMessaging().send({
      token: token,
      notification: {
        title: String(data.title || 'UGTM'),
        body: String(data.body || '')
      }
    });
  }
);
