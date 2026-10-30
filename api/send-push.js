// Vercel serverless function : envoie des push FCM via l'API HTTP v1.
// Sécurité :
//   - Authentification par clé partagée (X-Push-Key header).
//   - Les tokens FCM sont validés (format + longueur).
//   - Les destinataires sont limités (max 1000 par appel).
//   - Aucun secret Firebase dans le code client.
//
// Variables d'environnement Vercel requises :
//   FCM_SERVICE_ACCOUNT  — JSON du compte de service Firebase (clé privée).
//   FCM_PROJECT_ID       — "ugtm-fns-souss-massa"
//   PUSH_SHARED_SECRET   — clé partagée avec le client (à générer).

const MAX_TOKENS = 1000;
const crypto = require('crypto');

function isValidFcmToken(t) {
  return typeof t === 'string' && t.length >= 40 && t.length <= 512 && /^[A-Za-z0-9_:.-]+$/.test(t);
}

async function getAccessToken(serviceAccountJson) {
  const sa = JSON.parse(serviceAccountJson);
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  })).toString('base64url');
  const signInput = header + '.' + payload;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signInput);
  const signature = sign.sign(sa.private_key).toString('base64url');
  const assertion = signInput + '.' + signature;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: assertion
    })
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error('OAuth token exchange failed: ' + JSON.stringify(tokenData));
  }
  return tokenData.access_token;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const pushKey = process.env.PUSH_SHARED_SECRET;
    if (!pushKey || !req.headers || req.headers['x-push-key'] !== pushKey) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const serverKey = process.env.FCM_SERVICE_ACCOUNT;
    const projectId = process.env.FCM_PROJECT_ID;
    if (!serverKey || !projectId) {
      return res.status(500).json({ error: 'FCM credentials not configured' });
    }

    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { body = {}; }
    }
    body = body || {};

    const { title, body: msgBody, tokens } = body;
    if (!title || !Array.isArray(tokens) || tokens.length === 0) {
      return res.status(400).json({ error: 'title and tokens[] required' });
    }
    if (tokens.length > MAX_TOKENS) {
      return res.status(400).json({ error: 'Too many tokens. Max: ' + MAX_TOKENS });
    }

    const validTokens = tokens.filter(isValidFcmToken);
    if (validTokens.length === 0) {
      return res.status(400).json({ error: 'No valid FCM tokens' });
    }

    const accessToken = await getAccessToken(serverKey);
    const results = [];
    for (const token of validTokens) {
      try {
        const r = await fetch(
          'https://fcm.googleapis.com/v1/projects/' + projectId + '/messages:send',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + accessToken
            },
            body: JSON.stringify({
              message: {
                token: token,
                notification: {
                  title: String(title).slice(0, 120),
                  body: String(msgBody || '').slice(0, 500)
                },
                android: { priority: 'high' }
              }
            })
          }
        );
        const data = await r.json();
        results.push({ token: token.slice(0, 12) + '...', success: !!data.name, error: data.error || null });
      } catch (e) {
        results.push({ token: token.slice(0, 12) + '...', success: false, error: String(e) });
      }
    }
    return res.status(200).json({ sent: results.filter(r => r.success).length, total: validTokens.length, results });
  } catch (e) {
    return res.status(500).json({ error: 'Push send failed: ' + String(e) });
  }
};
