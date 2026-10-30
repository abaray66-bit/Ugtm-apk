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
    await getMessaging().send({
      token: token,
      notification: {
        title: String(data.title || 'UGTM'),
        body: String(data.body || '')
      }
    });
  });