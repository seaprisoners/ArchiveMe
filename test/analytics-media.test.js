import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase, syncGuild, syncChannel, archiveMessage, updateArchivedMessage,
  redactMessage, purgeChannel, pruneMessages, dailyStats, listMedia, listMessages } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createDiscordService } from '../src/discord.js';
import { hash } from '../src/auth.js';

const G = '123456789012345678', C = '223456789012345678', H = '323456789012345678';
const now = () => new Date().toISOString();
function setup() {
  const db = openDatabase();
  syncGuild(db, { id: G, name: 'Guild' });
  syncChannel(db, { id: C, guildId: G, name: 'visible' });
  syncChannel(db, { id: H, guildId: G, name: 'restricted' });
  return db;
}
function add(db, id, content, media = [], channelId = C, createdAt = now()) {
  return archiveMessage(db, { id, guildId: G, channelId, authorId: G, authorName: 'Writer',
    content, media, createdAt });
}
const attachment = (id, contentType = 'image/png', url = 'https://cdn.discordapp.com/attachments/12/34/x.png') =>
  ({ kind: 'attachment', id, name: 'x.png', contentType, size: 12, url });
const sticker = id => ({ kind: 'sticker', id, name: 'smile', url: 'https://cdn.discordapp.com/stickers/12.png' });

test('opt-in, UTC histogram, exclusive category precedence and legacy unknown migration', () => {
  const root = mkdtempSync(join(tmpdir(), 'archiveme-analytics-'));
  const file = join(root, 'legacy.sqlite');
  // Reopen an actual v1 schema, not just a new schema containing a legacy row.
  const legacy = new DatabaseSync(file);
  legacy.exec(`CREATE TABLE guilds(id TEXT PRIMARY KEY,name TEXT NOT NULL,icon TEXT);
    CREATE TABLE channels(id TEXT PRIMARY KEY,guild_id TEXT NOT NULL REFERENCES guilds(id),name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE messages(id TEXT PRIMARY KEY,guild_id TEXT NOT NULL REFERENCES guilds(id),
      channel_id TEXT NOT NULL REFERENCES channels(id),author_id TEXT NOT NULL,author_name TEXT NOT NULL,
      avatar_url TEXT,content TEXT NOT NULL,created_at TEXT NOT NULL,edited_at TEXT,deleted_at TEXT);`);
  legacy.prepare('INSERT INTO guilds(id,name) VALUES(?,?)').run(G, 'Guild');
  legacy.prepare('INSERT INTO channels(id,guild_id,name) VALUES(?,?,?)').run(C, G, 'visible');
  legacy.prepare(`INSERT INTO messages(id,guild_id,channel_id,author_id,author_name,content,created_at)
    VALUES(?,?,?,?,?,?,?)`).run('423456789012345671', G, C, G, 'Legacy', 'old unknown media', now());
  legacy.close();
  let db = openDatabase(file);
  try {
    assert.equal(add(db, '423456789012345670', 'not opted in', [attachment('523456789012345670')]), false);
    assert.equal(db.prepare('SELECT count(*) AS count FROM message_media').get().count, 0);
    db.prepare('UPDATE channels SET enabled=1').run();
    updateArchivedMessage(db, { id: '423456789012345671', guildId: G, channelId: C,
      content: 'updated legacy content', editedAt: now() });
    assert.equal(db.prepare('SELECT category FROM messages WHERE id=?').get('423456789012345671').category, null);
    // Historical content is not retroactively inferred as metadata by migration.
    assert.deepEqual(listMessages(db, C, null).messages[0].media, []);
    add(db, '423456789012345672', 'hello');
    add(db, '423456789012345673', 'https://example.com');
    add(db, '423456789012345674', 'hello https://example.com', [attachment('523456789012345674')]);
    add(db, '423456789012345675', 'hello', [attachment('523456789012345675', 'video/mp4')]);
    add(db, '423456789012345676', '', [sticker('523456789012345676')]);
    const stats = dailyStats(db, C, 1);
    assert.equal(stats.timezone, 'UTC');
    assert.equal(stats.total, 6);
    assert.equal(stats.daily[0].count, 6);
    assert.equal(stats.hourly.reduce((sum, row) => sum + row.count, 0), 6);
    assert.equal(stats.hourly[new Date().getUTCHours()].count, 6);
    assert.deepEqual(stats.categories, { text: 1, images: 1, videos: 1, links: 1, other: 1, unknown: 1 });
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});

test('media metadata URL validation, edits, purge mark, redaction and retention cannot resurrect', () => {
  const db = setup();
  try {
    db.prepare('UPDATE channels SET enabled=1').run();
    const id = '423456789012345681';
    const media = [attachment('523456789012345681', 'image/png', 'javascript:alert(1)'),
      attachment('523456789012345682', 'video/mp4', 'https://cdn.discordapp.com.evil.example/x'),
      sticker('523456789012345683')];
    assert.equal(add(db, id, 'original', media), true);
    assert.equal(add(db, id, 'duplicate', [attachment('523456789012345684')]), false);
    let result = listMedia(db, C, null);
    assert.equal(result.media.length, 3);
    assert.deepEqual(result.media.filter(row => row.kind === 'attachment').map(row => row.url), [null, null]);
    assert.equal(result.media.find(row => row.kind === 'sticker').name, 'smile');
    assert.equal(updateArchivedMessage(db, { id, guildId: G, channelId: C, content: 'edited', media: [], editedAt: now() }), true);
    assert.equal(listMedia(db, C, null).media.length, 0);
    assert.equal(dailyStats(db, C, 1).categories.text, 1);
    assert.equal(add(db, '423456789012345682', '', [attachment('523456789012345684')]), true);
    redactMessage(db, '423456789012345682', C);
    assert.equal(add(db, '423456789012345682', '', [attachment('523456789012345684')]), false);
    assert.equal(purgeChannel(db, G, C, G), 1);
    assert.equal(add(db, id, 'delayed duplicate', media), false);
    assert.equal(listMedia(db, C, null).media.length, 0);
    assert.equal(dailyStats(db, C, 1).total, 0);
    const newSnowflake = ((BigInt(Date.now() + 10_000) - 1420070400000n) << 22n).toString();
    assert.equal(add(db, newSnowflake, 'new', [sticker('523456789012345690')]), true);
    assert.equal(pruneMessages(db, 1), 0);
    assert.equal(add(db, '423456789012345699', 'expired', [], H, '2020-01-01T00:00:00.000Z'), false);
  } finally { db.close(); }
});

test('retention cascades media deletion and rejects delayed expired creates', () => {
  const db = setup();
  try {
    db.prepare('UPDATE channels SET enabled=1').run();
    const id = '423456789012345685';
    assert.equal(add(db, id, '', [attachment('523456789012345685')], C,
      new Date(Date.now() - 5 * 86400000).toISOString()), true);
    assert.equal(pruneMessages(db, 1), 1);
    assert.equal(listMedia(db, C, null).media.length, 0);
    assert.equal(add(db, id, 'delayed expired create', [sticker('523456789012345685')], C,
      new Date(Date.now() - 5 * 86400000).toISOString()), false);
  } finally { db.close(); }
});

test('media pagination includes every item on the boundary message', () => {
  const db = setup();
  try {
    db.prepare('UPDATE channels SET enabled=1').run();
    for (const [id, n] of [['423456789012345681', '681'], ['423456789012345682', '682']])
      add(db, id, '', [attachment(`523456789012345${n}`), sticker(`623456789012345${n}`)]);
    const first = listMedia(db, C, null, 1);
    assert.equal(first.media.length, 2);
    assert.equal(first.nextBefore, '423456789012345682');
    const second = listMedia(db, C, first.nextBefore, 1);
    assert.equal(second.media.length, 2);
    assert.equal(second.nextBefore, null);
    assert.equal(second.media[0].messageId, '423456789012345681');
  } finally { db.close(); }
});

test('message pages associate only their own media and retain the message cursor', () => {
  const db = setup();
  try {
    db.prepare('UPDATE channels SET enabled=1').run();
    const older = '423456789012345681', newer = '423456789012345682';
    const otherChannel = '423456789012345683';
    const file = '523456789012345681', stickerId = '623456789012345681';
    add(db, older, 'legacy style plain message');
    add(db, newer, `😀 <:wave:${file}>`, [
      attachment(file, 'image/png', 'https://media.discordapp.net/attachments/12/34/x.png'),
      { kind: 'sticker', id: stickerId, name: 'wave', format: 4 }
    ]);
    add(db, otherChannel, 'private 😀', [attachment('523456789012345683')], H);
    const first = listMessages(db, C, null, 1);
    assert.equal(first.nextBefore, newer);
    assert.equal(first.messages.length, 1);
    assert.equal(first.messages[0].id, newer);
    assert.deepEqual(first.messages[0].media.map(item => item.kind), ['attachment', 'sticker', 'emoji', 'emoji']);
    assert.deepEqual(first.messages[0].media[0], { kind: 'attachment', id: file, name: 'x.png',
      contentType: 'image/png', size: 12, url: 'https://media.discordapp.net/attachments/12/34/x.png' });
    assert.equal(first.messages[0].media[1].url, `https://cdn.discordapp.com/stickers/${stickerId}.gif`);
    assert.equal(first.messages[0].media.find(item => item.kind === 'emoji' && item.id === file).url,
      `https://cdn.discordapp.com/emojis/${file}.png`);
    assert.equal(first.messages[0].media.find(item => item.id === '😀').url, null);
    assert.equal(first.messages[0].media.some(item => 'messageId' in item || 'authorName' in item), false);
    const second = listMessages(db, C, first.nextBefore, 1);
    assert.equal(second.nextBefore, null);
    assert.deepEqual(second.messages.map(message => [message.id, message.media]), [[older, []]]);
    db.prepare('UPDATE message_media SET url=? WHERE message_id=? AND kind=?')
      .run('https://cdn.discordapp.com.evil.example/steal.png', newer, 'attachment');
    assert.equal(listMessages(db, C, null, 1).messages[0].media[0].url, null);
    assert.equal(listMedia(db, C, null, 1).media[0].url, null);
    assert.equal(listMessages(db, H, null).messages[0].media.length, 2);
  } finally { db.close(); }
});

test('API checks live Manage Server plus channel access for stats and media', async () => {
  const db = setup();
  db.prepare('UPDATE channels SET enabled=1').run();
  add(db, '423456789012345681', 'public', [attachment('523456789012345681')]);
  add(db, '423456789012345682', 'secret', [sticker('523456789012345682')], H);
  const token = 'a'.repeat(43);
  db.prepare('INSERT INTO sessions(token_hash,user_id,username,csrf_hash,expires_at) VALUES(?,?,?,?,?)')
    .run(hash(token), G, 'Tester', hash('b'.repeat(43)), Date.now() + 60_000);
  let admin = false, canReadHidden = false;
  const discord = { client: { isReady: () => true }, isAdmin: async () => admin,
    canReadChannel: async (_g, id) => admin && (id !== H || canReadHidden) };
  const app = createApp({ db, discord, webDir: '/nonexistent' });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const request = (path, loggedIn = true) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      headers: loggedIn ? { Cookie: `archiveme_session=${token}` } : {}
    });
    const visible = `/api/guilds/${G}/channels/${C}`;
    const hidden = `/api/guilds/${G}/channels/${H}`;
    assert.equal((await request(`${visible}/media`, false)).status, 401);
    assert.equal((await request(`${visible}/media`)).status, 403);
    admin = true;
    for (const endpoint of ['/stats', '/media']) assert.equal((await request(`${hidden}${endpoint}`)).status, 403);
    const stats = await (await request(`${visible}/stats`)).json();
    assert.equal(stats.total, 1);
    const media = await (await request(`${visible}/media`)).json();
    assert.equal(media.media.length, 1);
    assert.equal(media.media[0].authorName, 'Writer');
    assert.equal((await request(`${visible}/media?limit=101`)).status, 400);
    canReadHidden = true;
    assert.equal((await request(`${hidden}/media`)).status, 200);
    canReadHidden = false;
    db.prepare('UPDATE channels SET enabled=0 WHERE id=?').run(C);
    assert.equal((await request(`${visible}/media`)).status, 403);
  } finally { server.close(); db.close(); }
});

test('bot ingests attachment and sticker metadata without fetching media', () => {
  const db = setup();
  const service = createDiscordService({ db });
  try {
    db.prepare('UPDATE channels SET enabled=1').run();
    const message = { id: '423456789012345681', guildId: G, channelId: C, channel: { type: 0 },
      author: { id: G, username: 'Writer', bot: false, displayAvatarURL: () => '' }, content: '',
      createdAt: new Date(), editedAt: null, attachments: new Map([['1', attachment('523456789012345681')]]),
      stickers: new Map([['2', sticker('523456789012345682')]]) };
    service.client.emit('messageCreate', message);
    assert.deepEqual(listMedia(db, C, null).media.map(item => item.kind), ['attachment', 'sticker']);
  } finally { service.client.destroy(); db.close(); }
});
