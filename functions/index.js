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

exports.sharePage = functions.https.onRequest(async (req, res) => {
  const type = req.params.type;
  const id = req.params.id;

  if (!type || !id || (type !== 'news' && type !== 'event')) {
    res.status(400).send('Paramètres invalides');
    return;
  }

  try {
    const col = type === 'news' ? 'news' : 'events';
    const doc = await getFirestore().collection(col).doc(id).get();
    if (!doc.exists) {
      res.status(404).send('Non trouvé');
      return;
    }

    const data = doc.data() || {};
    const title = data.t || data.title || 'UGTM Souss-Massa';
    const body = data.b || data.body || data.description || '';
    const lieu = data.lieu || data.place || data.p || '';

    let imageUrl = '';
    if (data.images && data.images.length > 0) imageUrl = data.images[0];
    else if (data.image) imageUrl = data.image;
    else if (data.photo) imageUrl = data.photo;

    const ogImage = imageUrl || 'https://ugtm-fns-souss-massa.web.app/icons/ugtm-logo.svg';
    const ogUrl = 'https://ugtm-fns-souss-massa.web.app/share/' + type + '/' + id;

    const html = '<!DOCTYPE html>' +
      '<html>' +
      '<head>' +
      '<meta charset="utf-8">' +
      '<meta property="og:title" content="' + escapeHtml(title) + '">' +
      '<meta property="og:description" content="' + escapeHtml(body || 'Publication UGTM Souss-Massa') + '">' +
      '<meta property="og:image" content="' + escapeHtml(ogImage) + '">' +
      '<meta property="og:image:width" content="1200">' +
      '<meta property="og:image:height" content="630">' +
      '<meta property="og:url" content="' + escapeHtml(ogUrl) + '">' +
      '<meta property="og:type" content="article">' +
      '<meta property="og:site_name" content="UGTM FNS Souss-Massa">' +
      '<meta name="twitter:card" content="summary_large_image">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>' + escapeHtml(title) + ' - UGTM Souss-Massa</title>' +
      '</head>' +
      '<body>' +
      '<p>Redirection vers l\'application...</p>' +
      '<script>window.location.href = \'https://ugtm-fns-souss-massa.web.app/app.html#/' + type + 's/' + id + '\';</script>' +
      '</body>' +
      '</html>';

    res.set('Cache-Control', 'public, max-age=300');
    res.send(html);
  } catch (e) {
    console.error(e);
    res.status(500).send('Erreur');
  }
});

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}