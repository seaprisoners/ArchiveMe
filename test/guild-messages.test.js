import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { openDatabase, syncGuild, syncChannel, archiveMessage, listGuildMessages } from '../src/db.js';
import { createApp } from '../src/app.js';
import { hash } from '../src/auth.js';

const GUILD = '123456789012345678', OTHER_GUILD = '123456789012345679';
const PUBLIC = '223456789012345678', ALSO_PUBLIC = '223456789012345679';
const HIDDEN = '223456789012345680', DISABLED = '223456789012345681';
const USER = '323456789012345678', TOKEN = 'a'.repeat(43);
const path = `/api/guilds/${GUILD}/messages`;
const ids = {
  old: '423456789012345678', hidden: '423456789012345679', disabled: '423456789012345680',
  middle: '423456789012345681', long: '1423456789012345678', newest: '1423456789012345679',
  foreign: '1423456789012345680'
};
function fixture() {
  const db = openDatabase();
  syncGuild(db, { id: GUILD, name: 'Guild' });
  syncGuild(db, { id: OTHER_GUILD, name: 'Other guild' });
  for (const [id, name] of [[PUBLIC, 'main'], [ALSO_PUBLIC, 'second'], [HIDDEN, 'hidden'], [DISABLED, 'disabled']])
    syncChannel(db, { id, guildId: GUILD, name });
  syncChannel(db, { id: '223456789012345682', guildId: OTHER_GUILD, name: 'foreign' });
  db.prepare('UPDATE channels SET enabled=1').run();
  const add = (id, channelId, content, guildId = GUILD, media = []) =>
    archiveMessage(db, { id, guildId, channelId, authorId: USER, authorName: 'Writer',
      content, createdAt: '2025-01-01T00:00:00.000Z', media });
  add(ids.old, PUBLIC, 'old');
  add(ids.hidden, HIDDEN, 'HIDDEN secret', GUILD, [{ kind: 'attachment', id: '623456789012345679',
    url: 'https://cdn.discordapp.com/attachments/1/2/private.png' }]);
  add(ids.disabled, DISABLED, 'DISABLED secret');
  add(ids.middle, ALSO_PUBLIC, 'middle');
  add(ids.long, PUBLIC, 'image 😀 <:wave:623456789012345678>', GUILD, [
    { kind: 'attachment', id: '523456789012345678', name: 'x.png', contentType: 'image/png',
      size: 12, url: 'https://cdn.discordapp.com/attachments/1/2/x.png' },
    { kind: 'sticker', id: '523456789012345679', name: 'smile', format: 4 }
  ]);
  add(ids.newest, ALSO_PUBLIC, 'newest');
  add(ids.foreign, '223456789012345682', 'FOREIGN secret', OTHER_GUILD);
  db.prepare('UPDATE channels SET enabled=0 WHERE id=?').run(DISABLED);
  db.prepare('INSERT INTO sessions(token_hash,user_id,username,csrf_hash,expires_at) VALUES(?,?,?,?,?)')
    .run(hash(TOKEN), USER, 'Tester', hash('b'.repeat(43)), Date.now() + 100_000);
  let admin = false;
  const denied = new Set([HIDDEN]);
  const checked = [];
  const discord = {
    client: { isReady: () => true },
    isAdmin: async () => admin,
    canReadChannel: async (guildId, channelId, userId) => {
      checked.push([guildId, channelId, userId]);
      return admin && !denied.has(channelId);
    }
  };
  return { db, app: createApp({ db, discord, webDir: '/nonexistent' }),
    setAdmin: value => { admin = value; }, denied, checked };
}
async function serve(fixture, run) {
  const server = fixture.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const request = (url, authenticated = true) => fetch(`http://127.0.0.1:${server.address().port}${url}`, {
    headers: authenticated ? { Cookie: `archiveme_session=${TOKEN}` } : {}
  });
  try { await run(request); } finally { server.close(); fixture.db.close(); }
}

test('all-channel archive requires session and current Manage Server; empty authorized set reveals nothing', async () => {
  const f = fixture();
  await serve(f, async request => {
    assert.equal((await request(path, false)).status, 401);
    assert.equal((await request(path)).status, 403);
    assert.deepEqual(f.checked, []);
    f.setAdmin(true);
    f.denied.add(PUBLIC);
    f.denied.add(ALSO_PUBLIC);
    const response = await request(path);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { messages: [], nextBefore: null });
    assert.deepEqual(f.checked.map(([, id]) => id).sort(), [PUBLIC, ALSO_PUBLIC, HIDDEN].sort());
    assert.equal(f.checked.some(([, id]) => id === DISABLED), false);
  });
});

test('all-channel pages interleave numeric snowflakes and include names, authors, attachments, stickers and emoji', async () => {
  const f = fixture(); f.setAdmin(true);
  await serve(f, async request => {
    const all = await (await request(path)).json();
    assert.deepEqual(all.messages.map(({ id }) => id), [ids.newest, ids.long, ids.middle, ids.old]);
    assert.equal(all.nextBefore, null);
    assert.deepEqual(all.messages.map(({ channelId, channelName }) => [channelId, channelName]),
      [[ALSO_PUBLIC, 'second'], [PUBLIC, 'main'], [ALSO_PUBLIC, 'second'], [PUBLIC, 'main']]);
    assert.ok(all.messages.every(message => message.authorId === USER));
    const image = all.messages[1];
    assert.deepEqual(image.media.map(item => item.kind), ['attachment', 'sticker', 'emoji', 'emoji']);
    assert.equal(image.media[0].url, 'https://cdn.discordapp.com/attachments/1/2/x.png');
    assert.equal(image.media[1].url, 'https://cdn.discordapp.com/stickers/523456789012345679.gif');
    assert.equal(image.media.find(item => item.id === '623456789012345678').url,
      'https://cdn.discordapp.com/emojis/623456789012345678.png');
    assert.equal(image.media.find(item => item.id === '😀').url, null);
    const first = await (await request(`${path}?limit=2`)).json();
    assert.deepEqual(first.messages.map(({ id }) => id), [ids.newest, ids.long]);
    assert.equal(first.nextBefore, ids.long);
    const second = await (await request(`${path}?limit=2&before=${first.nextBefore}`)).json();
    assert.deepEqual(second.messages.map(({ id }) => id), [ids.middle, ids.old]);
    assert.equal(second.nextBefore, null);
    const individually = await (await request(`/api/guilds/${GUILD}/channels/${PUBLIC}/messages`)).json();
    assert.deepEqual(individually.messages.map(({ id }) => id), [ids.long, ids.old]);
    assert.equal('channelName' in individually.messages[0], false);
  });
});

test('before guessing and permission changes never expose hidden, disabled or other-guild data', async () => {
  const f = fixture(); f.setAdmin(true);
  await serve(f, async request => {
    for (const cursor of [ids.hidden, ids.disabled, ids.foreign]) {
      const response = await request(`${path}?limit=1&before=${cursor}`);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.deepEqual(body.messages.map(({ id }) => id), cursor === ids.foreign ? [ids.newest] : [ids.old]);
      assert.doesNotMatch(JSON.stringify(body), /HIDDEN|DISABLED|FOREIGN|private\.png/);
    }
    f.denied.add(ALSO_PUBLIC);
    const newlyDenied = await (await request(`${path}?limit=100&before=${ids.foreign}`)).json();
    assert.deepEqual(newlyDenied.messages.map(({ id }) => id), [ids.long, ids.old]);
    f.denied.add(PUBLIC);
    assert.deepEqual(await (await request(`${path}?before=${ids.hidden}`)).json(),
      { messages: [], nextBefore: null });
  });
});

test('aggregate pagination is bounded and never includes disabled channels even when explicitly passed to DB helper', async () => {
  const f = fixture(); f.setAdmin(true);
  await serve(f, async request => {
    for (const query of ['?limit=0', '?limit=101', '?limit=1.5', '?limit=NaN', '?before=nope',
      '?before=', '?limit[]=2', '?before[]=423456789012345678'])
      assert.equal((await request(`${path}${query}`)).status, 400);
    assert.equal((await request(`${path}?limit=1`)).status, 200);
    assert.equal((await request(`${path}?limit=100`)).status, 200);
    assert.deepEqual(listGuildMessages(f.db, GUILD, [DISABLED], null), { messages: [], nextBefore: null });
    assert.deepEqual(listGuildMessages(f.db, GUILD, [], null), { messages: [], nextBefore: null });
    assert.deepEqual(listGuildMessages(f.db, GUILD, [PUBLIC, '223456789012345682'], null).messages.map(m => m.id),
      [ids.long, ids.old]);
  });
});
