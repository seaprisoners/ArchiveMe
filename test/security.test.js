import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { openDatabase, syncGuild, syncChannel, archiveMessage, updateArchivedMessage, redactMessage, listMessages, dailyStats } from '../src/db.js';
import { createApp } from '../src/app.js';
import { hash } from '../src/auth.js';

const GUILD = '123456789012345678', CHANNEL = '223456789012345678', OTHER = '323456789012345678';
function fixture() {
  const db = openDatabase();
  syncGuild(db, { id: GUILD, name: 'Test' });
  syncChannel(db, { id: CHANNEL, guildId: GUILD, name: 'public' });
  syncChannel(db, { id: OTHER, guildId: GUILD, name: 'private' });
  db.prepare('UPDATE channels SET enabled=1').run();
  archiveMessage(db, { id: '423456789012345678', guildId: GUILD, channelId: CHANNEL,
    authorId: '523456789012345678', authorName: 'Example', content: '<script>bad</script>', createdAt: new Date().toISOString() });
  archiveMessage(db, { id: '423456789012345679', guildId: GUILD, channelId: OTHER,
    authorId: '523456789012345678', authorName: 'Mod', content: 'secret 😀',
    media: [{ kind: 'attachment', id: '723456789012345678', name: 'secret.png',
      contentType: 'image/png', url: 'https://cdn.discordapp.com/attachments/1/2/secret.png' }],
    createdAt: new Date().toISOString() });
  const token = 'a'.repeat(43), csrf = 'b'.repeat(43);
  db.prepare('INSERT INTO sessions(token_hash,user_id,username,csrf_hash,expires_at) VALUES(?,?,?,?,?)')
    .run(hash(token), '623456789012345678', 'Tester', hash(csrf), Date.now() + 100000);
  let allowed = false, privateAllowed = true;
  const discord = { client: { isReady: () => true, guilds: { cache: new Map([[GUILD, { id: GUILD, name: 'Test' }]]) } },
    isAdmin: async () => allowed, canReadChannel: async (_guild, channel) => allowed && (channel !== OTHER || privateAllowed),
    getGuild: async () => ({ channels: { fetch: async () => ({ permissionsFor: () => ({ has: () => true }) }) },
      members: { fetchMe: async () => ({}) } }) };
  const app = createApp({ db, discord, baseUrl: 'http://localhost:3000', webDir: '/nonexistent' });
  return { db, app, token, csrf, allow: value => { allowed = value; }, allowPrivate: value => { privateAllowed = value; } };
}
async function serve(f, fn) {
  const server = f.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, options = {}) => fetch(`${base}${path}`, {
    ...options, headers: { Cookie: `archiveme_session=${f.token}`, Origin: 'http://localhost:3000', ...options.headers }
  });
  try { await fn(request); } finally { server.close(); f.db.close(); }
}
test('admin-only endpoints deny unauthenticated and non-admin access including statistics', async () => {
  const f = fixture();
  await serve(f, async request => {
    const path = `/api/guilds/${GUILD}/channels/${OTHER}`;
    assert.equal((await fetch(`${(await request('/health')).url.replace('/health', '')}${path}/messages`)).status, 401);
    for (const endpoint of [`/api/guilds/${GUILD}/channels`, `${path}/messages`, `${path}/stats`]) {
      const response = await request(endpoint);
      assert.equal(response.status, 403);
      assert.doesNotMatch(await response.text(), /secret/);
    }
    f.allow(true);
    const allowed = await (await request(`${path}/messages`)).json();
    assert.deepEqual(allowed.messages[0].media.map(item => item.kind), ['attachment', 'emoji']);
    f.allow(false);
    assert.equal((await request(`${path}/messages`)).status, 403);
  });
});
test('Manage Server alone cannot expose a channel denied by channel permissions', async () => {
  const f = fixture(); f.allow(true); f.allowPrivate(false);
  await serve(f, async request => {
    const listing = await (await request(`/api/guilds/${GUILD}/channels`)).json();
    assert.equal(listing.channels.length, 1);
    assert.equal(listing.channels[0].id, CHANNEL);
    const path = `/api/guilds/${GUILD}/channels/${OTHER}`;
    for (const suffix of ['/messages', '/stats', '']) {
      const response = await request(`${path}${suffix}`, suffix ? {} : { method: 'PATCH', headers: { 'X-CSRF-Token': f.csrf, 'Content-Type': 'application/json' }, body: '{"enabled":false}' });
      assert.equal(response.status, 403);
      const body = await response.text();
      assert.doesNotMatch(body, /secret/);
      assert.doesNotMatch(body, /cdn\.discordapp\.com\/attachments/);
    }
  });
});
test('CSRF and origin checks protect mutations; disabled archives cannot be read', async () => {
  const f = fixture(); f.allow(true);
  await serve(f, async request => {
    const path = `/api/guilds/${GUILD}/channels/${CHANNEL}`;
    const headers = { 'Content-Type': 'application/json' };
    assert.equal((await request(path, { method: 'PATCH', headers, body: '{"enabled":false}' })).status, 403);
    assert.equal((await request(path, { method: 'PATCH', headers: { ...headers, 'X-CSRF-Token': f.csrf, Origin: 'https://attacker.example' }, body: '{"enabled":false}' })).status, 403);
    assert.equal((await request(path, { method: 'PATCH', headers: { ...headers, 'X-CSRF-Token': f.csrf }, body: '{"enabled":false}' })).status, 200);
    assert.equal((await request(`${path}/messages`)).status, 403);
    assert.equal((await request(`${path}/stats`)).status, 403);
    const listing = await (await request(`/api/guilds/${GUILD}/channels`)).json();
    assert.equal(listing.channels.find(channel => channel.id === CHANNEL).messageCount, 0);
  });
});
test('CSRF token retrieval makes logout possible and invalidates its session', async () => {
  const f = fixture(); f.allow(true);
  await serve(f, async request => {
    const csrfResponse = await request('/api/csrf');
    assert.equal(csrfResponse.status, 200);
    const { token } = await csrfResponse.json();
    assert.equal((await request('/api/logout', { method: 'POST', headers: { 'X-CSRF-Token': token } })).status, 204);
    assert.equal((await request(`/api/guilds/${GUILD}/channels`)).status, 401);
  });
});
test('channel isolation, input bounds, and deletion redaction', async () => {
  const f = fixture(); f.allow(true);
  await serve(f, async request => {
    const path = `/api/guilds/${GUILD}/channels/${CHANNEL}`;
    const messages = await (await request(`${path}/messages`)).json();
    assert.equal(messages.messages.length, 1);
    assert.equal(messages.messages[0].content, '<script>bad</script>');
    assert.equal((await request(`${path}/messages?limit=1000`)).status, 400);
    assert.equal((await request(`${path}/stats?days=999`)).status, 400);
    assert.equal((await request(`/api/guilds/${OTHER}/channels/${CHANNEL}/messages`)).status, 404);
    redactMessage(f.db, '423456789012345678', CHANNEL);
    const result = listMessages(f.db, CHANNEL, null);
    assert.equal(result.messages.length, 0);
    assert.equal(dailyStats(f.db, CHANNEL, 1).total, 0);
  });
});
test('duplicate create events do not overwrite an edited archive message', () => {
  const db = openDatabase();
  syncGuild(db, { id: GUILD, name: 'Test' }); syncChannel(db, { id: CHANNEL, guildId: GUILD, name: 'test' });
  db.prepare('UPDATE channels SET enabled=1 WHERE id=?').run(CHANNEL);
  const record = { id: OTHER, guildId: GUILD, channelId: CHANNEL, authorId: OTHER,
    authorName: 'Test', content: 'original', createdAt: new Date().toISOString() };
  archiveMessage(db, record);
  updateArchivedMessage(db, { ...record, content: 'edited', editedAt: new Date().toISOString() });
  archiveMessage(db, record);
  assert.equal(listMessages(db, CHANNEL, null).messages[0].content, 'edited');
  db.close();
});
test('edits cannot resurrect purged or pre-enable messages', () => {
  const db = openDatabase();
  syncGuild(db, { id: GUILD, name: 'Test' });
  syncChannel(db, { id: CHANNEL, guildId: GUILD, name: 'test' });
  const edit = { id: OTHER, guildId: GUILD, channelId: CHANNEL, content: 'changed', editedAt: new Date().toISOString() };
  assert.equal(updateArchivedMessage(db, edit), false);
  db.prepare('UPDATE channels SET enabled=1 WHERE id=?').run(CHANNEL);
  assert.equal(updateArchivedMessage(db, edit), false);
  archiveMessage(db, { ...edit, authorId: OTHER, authorName: 'Test', createdAt: new Date().toISOString() });
  assert.equal(updateArchivedMessage(db, edit), true);
  redactMessage(db, OTHER, CHANNEL);
  assert.equal(updateArchivedMessage(db, edit), false);
  assert.equal(db.prepare('SELECT count(*) AS n FROM messages').get().n, 0);
  db.close();
});
test('archive is opt-in and cannot record disabled channels', () => {
  const db = openDatabase();
  syncGuild(db, { id: GUILD, name: 'Test' });
  syncChannel(db, { id: CHANNEL, guildId: GUILD, name: 'test' });
  assert.equal(archiveMessage(db, { id: OTHER, guildId: GUILD, channelId: CHANNEL,
    authorId: OTHER, authorName: 'Test', content: 'private', createdAt: new Date().toISOString() }), false);
  assert.equal(db.prepare('SELECT count(*) AS n FROM messages').get().n, 0);
  db.close();
});
