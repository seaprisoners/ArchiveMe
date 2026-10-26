import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const hash = input => createHash('sha256').update(input).digest('hex');
const random = () => randomBytes(32).toString('base64url');
const COOKIE = 'archiveme_session';
const STATE_COOKIE = 'archiveme_oauth';
const HOST_PREFIX = '__Host-';
const DAY = 86400;

function cookies(req) {
  return Object.fromEntries((req.headers.cookie ?? '').split(';').map(part => {
    const index = part.indexOf('=');
    return index < 0 ? [] : [part.slice(0, index).trim(), part.slice(index + 1).trim()];
  }).filter(pair => pair.length === 2));
}
function cookieOptions(secure, maxAge) {
  return { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge };
}
export function authRoutes(app, { db, clientId, clientSecret, baseUrl, secure, oauthFetch = fetch }) {
  const redirectUri = `${baseUrl}/auth/callback`;
  const sessionName = secure ? HOST_PREFIX + COOKIE : COOKIE;
  const stateName = secure ? HOST_PREFIX + STATE_COOKIE : STATE_COOKIE;
  app.get('/auth/discord', (req, res) => {
    if (!clientId || !clientSecret) return res.status(503).send('Discord OAuth is not configured.');
    const state = random(), verifier = random();
    db.prepare('INSERT INTO oauth_states(state_hash,verifier,expires_at) VALUES(?,?,?)')
      .run(hash(state), verifier, Date.now() + 5 * 60_000);
    res.cookie(stateName, state, cookieOptions(secure, 5 * 60_000));
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const query = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri,
      response_type: 'code', scope: 'identify', state, code_challenge: challenge, code_challenge_method: 'S256' });
    res.redirect(`https://discord.com/oauth2/authorize?${query}`);
  });
  app.get('/auth/callback', async (req, res) => {
    const stateCookie = cookies(req)[stateName];
    res.clearCookie(stateName, cookieOptions(secure, 0));
    if (typeof req.query.state !== 'string' || !stateCookie || typeof req.query.code !== 'string' ||
      !timingSafeEqual(Buffer.from(hash(req.query.state)), Buffer.from(hash(stateCookie))))
      return res.status(400).send('Invalid login attempt. Please start again.');
    const saved = db.prepare('DELETE FROM oauth_states WHERE state_hash=? RETURNING verifier,expires_at').get(hash(stateCookie));
    if (!saved || saved.expires_at < Date.now()) return res.status(400).send('Login expired. Please start again.');
    try {
      const tokenResponse = await oauthFetch('https://discord.com/api/v10/oauth2/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code',
          code: req.query.code, redirect_uri: redirectUri, code_verifier: saved.verifier }), signal: AbortSignal.timeout(10_000)
      });
      if (!tokenResponse.ok) throw new Error('Discord rejected OAuth exchange');
      const tokens = await tokenResponse.json();
      const userResponse = await oauthFetch('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(10_000)
      });
      if (!userResponse.ok) throw new Error('Discord rejected identity lookup');
      const user = await userResponse.json();
      if (!/^\d{16,22}$/.test(user.id)) throw new Error('Invalid Discord identity');
      const token = random(), csrf = random();
      db.prepare('INSERT INTO sessions(token_hash,user_id,username,avatar,csrf_hash,expires_at) VALUES(?,?,?,?,?,?)')
        .run(hash(token), user.id, user.global_name || user.username, user.avatar ?? null, hash(csrf), Date.now() + 7 * DAY * 1000);
      const oldToken = cookies(req)[sessionName];
      if (oldToken && /^[A-Za-z0-9_-]{40,50}$/.test(oldToken))
        db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(oldToken));
      res.cookie(sessionName, token, cookieOptions(secure, 7 * DAY * 1000));
      res.redirect('/');
    } catch (error) {
      console.error('OAuth login failed:', error.message);
      res.status(502).send('Discord login failed. Please try again.');
    }
  });
  app.use('/api', (req, res, next) => {
    const token = cookies(req)[sessionName];
    req.session = token && /^[A-Za-z0-9_-]{40,50}$/.test(token)
      ? db.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?').get(hash(token), Date.now()) : null;
    req.sessionToken = token;
    next();
  });
  app.get('/api/csrf', (req, res) => {
    if (!req.session) return res.status(401).json({ error: 'Sign in required' });
    // Issue and rotate a per-session CSRF secret; two concurrent tabs should fetch a fresh token before mutations.
    const csrf = random();
    db.prepare('UPDATE sessions SET csrf_hash=? WHERE token_hash=?').run(hash(csrf), req.session.token_hash);
    res.set('Cache-Control', 'no-store').json({ token: csrf });
  });
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const source = req.get('Origin');
    if (source !== baseUrl) return res.status(403).json({ error: 'Invalid origin' });
    const submitted = req.get('X-CSRF-Token');
    if (!req.session || !submitted || !/^[A-Za-z0-9_-]{40,50}$/.test(submitted) ||
      !timingSafeEqual(Buffer.from(hash(submitted)), Buffer.from(req.session.csrf_hash)))
      return res.status(403).json({ error: 'Invalid CSRF token' });
    next();
  });
  app.post('/api/logout', (req, res) => {
    db.prepare('DELETE FROM sessions WHERE token_hash=?').run(req.session.token_hash);
    res.clearCookie(sessionName, cookieOptions(secure, 0)).status(204).end();
  });
}
export { hash };
