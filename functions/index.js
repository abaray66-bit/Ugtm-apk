const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
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

    const pushKey = process.env.PUSH_SHARED_SECRET || (functions.config().push && functions.config().push.secret);
    if (!pushKey) {
      console.error('PUSH_SHARED_SECRET manquant pour l\'envoi via Vercel');
      return;
    }

    try {
      const res = await fetch('https://agile-marimba-ow7rjs2.vercel.app/api/send-push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-push-key': pushKey
        },
        body: JSON.stringify({
          title: String(data.title || 'UGTM'),
          body: String(data.body || ''),
          tokens: [token]
        })
      });
      const json = await res.json().catch(() => ({}));
      console.log('Vercel push response:', json);
    } catch (e) {
      console.error('Erreur envoi push via Vercel:', e);
    }
  });