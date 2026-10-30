// Vercel serverless function: envoie des push FCM via l'API REST.
// Variables d'environnement requises :
//   FCM_SERVER_KEY  (Firebase Console → Project Settings → Cloud Messaging → Server key)
//   FCM_PROJECT_ID  (ugtm-fns-souss-massa)

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const serverKey = process.env.FCM_SERVER_KEY;
  if (!serverKey) {
    return res.status(500).json({ error: 'FCM_SERVER_KEY not configured' });
  }

  const { title, body, tokens } = req.body || {};
  if (!title || !Array.isArray(tokens) || tokens.length === 0) {
    return res.status(400).json({ error: 'title and tokens[] required' });
  }

  const results = [];
  for (const token of tokens) {
    try {
      const r = await fetch('https://fcm.googleapis.com/fcm/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'key=' + serverKey
        },
        body: JSON.stringify({
          to: token,
          notification: { title: String(title).slice(0, 120), body: String(body || '').slice(0, 500) },
          priority: 'high'
        })
      });
      const data = await r.json();
      results.push({ token: token.slice(0, 12) + '...', success: data.success === 1, error: data.results && data.results[0] && data.results[0].error });
    } catch (e) {
      results.push({ token: token.slice(0, 12) + '...', success: false, error: String(e) });
    }
  }

  return res.status(200).json({ sent: results.filter(r => r.success).length, total: tokens.length, results });
};
