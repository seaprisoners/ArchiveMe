import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { openDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';

const GUILD = '123456789012345678';
const UID = '623456789012345678';
const ROLE = '723456789012345678';
const token = 'a'.repeat(43);

function fixture() {
  const db = openDatabase(); // In-memory: never read a live archive or membership database.
  db.prepare('INSERT INTO sessions(token_hash,user_id,username,csrf_hash,expires_at) VALUES(?,?,?,?,?)')
    .run(createHash('sha256').update(token).digest('hex'), UID, 'Admin', '', Date.now() + 100_000);
  let admin = false, botPresent = true, searchCalls = 0, fetchCalls = 0;
  const member = { id: UID, displayName: 'Display name', user: { username: 'discord-name', email: 'private@example.org' },
    joinedAt: new Date('2023-01-02T03:04:05Z'), roles: { cache: new Map([
      [GUILD, { id: GUILD, name: '@everyone' }], [ROLE, { id: ROLE, name: 'Moderator' }]
    ]) } };
  const guild = { id: GUILD, members: {
    search: async options => { searchCalls++; assert.equal(options.cache, false); return new Map([[UID, member]]); },
    fetch: async options => { fetchCalls++; assert.deepEqual(options, { user: UID, force: true, cache: false }); return member; }
  } };
  const discord = { client: { isReady: () => true }, isAdmin: async () => admin,
    getGuild: async () => botPresent ? guild : null };
  const app = createApp({ db, discord, webDir: '/nonexistent' });
  return { db, app, guild, setAdmin: value => { admin = value; }, setBotPresent: value => { botPresent = value; },
    calls: () => ({ searchCalls, fetchCalls }) };
}
async function serve(f, fn) {
  const server = f.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const request = (path, authenticated = true) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    headers: authenticated ? { Cookie: `archiveme_session=${token}` } : {}
  });
  try { await fn(request); } finally { server.close(); f.db.close(); }
}

const path = `/api/guilds/${GUILD}/members`;
test('member lookup requires session, live Manage Server authorization, and bot guild membership', async () => {
  const f = fixture();
  await serve(f, async request => {
    assert.equal((await request(`${path}?query=Display`, false)).status, 401);
    assert.equal((await request(`${path}?query=Display`)).status, 403);
    f.setAdmin(true);
    f.setBotPresent(false);
    assert.equal((await request(`${path}?query=Display`)).status, 404);
    assert.deepEqual(f.calls(), { searchCalls: 0, fetchCalls: 0 });
  });
});
test('query is required and bounded; name search is capped, non-cached, and returns only allowed fields', async () => {
  const f = fixture(); f.setAdmin(true);
  await serve(f, async request => {
    for (const query of ['', '?query=', '?query=ab', '?query=abcd&limit=26', '?query=abcd&limit=0',
      '?query=abcd&limit=1.5', '?query=abcd&limit[]=2', `?query=${'x'.repeat(101)}`]) {
      assert.equal((await request(`${path}${query}`)).status, 400);
    }
    assert.deepEqual(f.calls(), { searchCalls: 0, fetchCalls: 0 });
    const response = await request(`${path}?query=Dis&limit=2`);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result, { members: [{ uid: UID, displayName: 'Display name', username: 'discord-name',
      roles: [{ id: ROLE, name: 'Moderator' }], joinedAt: '2023-01-02T03:04:05.000Z',
      accountCreatedAt: new Date(Number((BigInt(UID) >> 22n) + 1_420_070_400_000n)).toISOString() }] });
    assert.doesNotMatch(JSON.stringify(result), /email|private@example/);
    assert.deepEqual(f.calls(), { searchCalls: 1, fetchCalls: 0 });
  });
});
test('exact UID takes a single REST fetch, with no full member enumeration', async () => {
  const f = fixture(); f.setAdmin(true);
  await serve(f, async request => {
    const result = await (await request(`${path}?query=${UID}`)).json();
    assert.equal(result.members[0].uid, UID);
    assert.deepEqual(f.calls(), { searchCalls: 0, fetchCalls: 1 });
    f.guild.members.fetch = async () => { const error = new Error('not found'); error.code = 10007; throw error; };
    assert.deepEqual(await (await request(`${path}?query=${UID}`)).json(), { members: [] });
  });
});
test('Discord missing access and upstream throttling fail closed without leaking details', async () => {
  const f = fixture(); f.setAdmin(true);
  await serve(f, async request => {
    f.guild.members.search = async () => { const error = new Error('sensitive upstream error'); error.status = 403; throw error; };
    const denied = await request(`${path}?query=example`);
    assert.equal(denied.status, 503);
    assert.doesNotMatch(await denied.text(), /sensitive upstream error/);
    f.guild.members.search = async () => { const error = new Error('sensitive upstream error'); error.status = 429; throw error; };
    const throttled = await request(`${path}?query=example`);
    assert.equal(throttled.status, 429);
    assert.equal(throttled.headers.get('retry-after'), '60');
  });
});
