import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { openDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';

const USER = '623456789012345678';
test('public installation link uses minimum permissions and never includes secrets', async () => {
  const db = openDatabase();
  const app = createApp({ db, discord: { client: { isReady: () => true }, isSynchronized: () => true },
    clientId: '123456789012345678', clientSecret: 'private-secret', webDir: '/nonexistent' });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/public-config`);
    assert.equal(response.status, 200);
    const raw = await response.text();
    assert.doesNotMatch(raw, /private-secret|token|client_secret/i);
    const url = new URL(JSON.parse(raw).installUrl);
    assert.equal(url.origin, 'https://discord.com');
    assert.equal(url.pathname, '/oauth2/authorize');
    assert.equal(url.searchParams.get('scope'), 'bot applications.commands');
    assert.equal(url.searchParams.get('permissions'), '66560');
    assert.equal(url.searchParams.get('integration_type'), '0');
    assert.equal(url.searchParams.get('client_id'), '123456789012345678');
  } finally { server.close(); db.close(); }
});
test('public installation link is absent when the bot is offline or not configured', async () => {
  const db = openDatabase();
  const app = createApp({ db, discord: { client: { isReady: () => false }, isSynchronized: () => false },
    clientId: '123456789012345678', webDir: '/nonexistent' });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/public-config`);
    assert.deepEqual(await response.json(), { installUrl: null });
  } finally { server.close(); db.close(); }
});
test('OAuth state is single-use and callback creates hashed session without exposing access token', async () => {
  const db = openDatabase();
  const calls = [];
  const oauthFetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/oauth2/token')) return { ok: true, json: async () => ({ access_token: 'fake-oauth-token' }) };
    return { ok: true, json: async () => ({ id: USER, username: 'Student', avatar: null }) };
  };
  const discord = { client: { isReady: () => true, guilds: { cache: new Map() } }, isAdmin: async () => false };
  const app = createApp({ db, discord, clientId: '123456789012345678', clientSecret: 'local-test-secret',
    oauthFetch, baseUrl: 'http://localhost:3000', webDir: '/nonexistent' });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const begin = await fetch(`${origin}/auth/discord`, { redirect: 'manual' });
    assert.equal(begin.status, 302);
    const cookie = begin.headers.get('set-cookie').split(';')[0];
    const url = new URL(begin.headers.get('location'));
    assert.equal(url.searchParams.get('scope'), 'identify');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    const state = url.searchParams.get('state');
    const callback = `${origin}/auth/callback?state=${encodeURIComponent(state)}&code=fake-code`;
    const missingCookie = await fetch(callback, { redirect: 'manual' });
    assert.equal(missingCookie.status, 400);
    const complete = await fetch(callback, { redirect: 'manual', headers: { Cookie: cookie } });
    assert.equal(complete.status, 302);
    assert.equal(calls.length, 2);
    assert.equal(new URLSearchParams(calls[0].options.body).get('code_verifier').length > 20, true);
    const sessionCookie = complete.headers.get('set-cookie').split('archiveme_session=')[1].split(';')[0];
    assert.equal(db.prepare('SELECT count(*) AS n FROM sessions').get().n, 1);
    assert.ok(!JSON.stringify(db.prepare('SELECT * FROM sessions').get()).includes(sessionCookie));
    const me = await (await fetch(`${origin}/api/me`, { headers: { Cookie: `archiveme_session=${sessionCookie}` } })).json();
    assert.equal(me.user.id, USER);
    const replay = await fetch(callback, { redirect: 'manual', headers: { Cookie: cookie } });
    assert.equal(replay.status, 400);
    assert.equal(calls.length, 2);
  } finally { server.close(); db.close(); }
});
