import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase, syncGuild, syncChannel, archiveMessage, updateArchivedMessage,
  redactMessage, purgeChannel, pruneMessages, dailyStats, listMedia, classifyMessage,
  parseEmojis, stickerPreview, customEmojiUrl } from '../src/db.js';
import { createDiscordService } from '../src/discord.js';

const G = '123456789012345678', C = '223456789012345678';
const M = '423456789012345681', N = '423456789012345682', E = '523456789012345681';
const S = '623456789012345681';
const today = () => new Date().toISOString();
function fixture() {
  const db = openDatabase();
  syncGuild(db, { id: G, name: 'Guild' });
  syncChannel(db, { id: C, guildId: G, name: 'public' });
  db.prepare('UPDATE channels SET enabled=1 WHERE id=?').run(C);
  return db;
}
function add(db, id, content, media = [], createdAt = today()) {
  return archiveMessage(db, { id, guildId: G, channelId: C,
    authorId: G, authorName: 'Writer', content, media, createdAt });
}
const sticker = (id, format, url = 'https://evil.example/steal.gif') =>
  ({ kind: 'sticker', id, format, name: 'Wave', url });

test('Unicode grapheme segmentation and exact custom emoji syntax preserve occurrences', () => {
  const result = parseEmojis(`1 5 # * 🇦 🇦🇹 👩🏽‍🚀 👩🏽‍🚀 ❤️ 1️⃣ <:happy:${E}> <:happy:${E}> <a:dance:${S}>`);
  const byId = Object.fromEntries(result.map(item => [item.id, item]));
  assert.equal(byId['👩🏽‍🚀'].count, 2);
  assert.equal(byId['🇦🇹'].count, 1);
  assert.equal(byId['❤️'].count, 1);
  assert.equal(byId['1️⃣'].count, 1);
  assert.equal(byId['1'], undefined);
  assert.equal(byId['🇦'], undefined);
  assert.deepEqual(byId[E], { id: E, name: 'happy', contentType: 'image/png', count: 2 });
  assert.deepEqual(byId[S], { id: S, name: 'dance', contentType: 'image/gif', count: 1 });
  assert.deepEqual(parseEmojis('<:x:123456789012345678> <:name:abc>'), []);
  assert.deepEqual(parseEmojis(null), []);
  assert.equal(customEmojiUrl('../bad'), null);
  assert.equal(customEmojiUrl(E, true), `https://cdn.discordapp.com/emojis/${E}.gif`);
});

test('classification remains exclusive while emoji-only messages get media entries and ranked occurrences', () => {
  const db = fixture();
  try {
    assert.equal(classifyMessage({ content: '👩‍👩‍👧' }), 'text');
    assert.equal(classifyMessage({ content: '', media: [sticker(S, 1)] }), 'other');
    add(db, M, `😀 😀 <:yay:${E}> <:yay:${E}>`, [sticker(S, 4)]);
    add(db, N, `😀 <a:yay:${E}>`, [sticker(S, 4)]);
    const media = listMedia(db, C, null).media;
    assert.deepEqual(media.map(item => item.kind), ['sticker', 'emoji', 'emoji', 'sticker', 'emoji', 'emoji']);
    assert.deepEqual(media.find(item => item.messageId === M && item.id === '😀'), {
      messageId: M, id: '😀', name: '😀', contentType: null, count: 2,
      kind: 'emoji', size: null, url: null,
      createdAt: media.find(item => item.messageId === M).createdAt, authorName: 'Writer'
    });
    assert.equal(media.find(item => item.messageId === N && item.id === E).url,
      `https://cdn.discordapp.com/emojis/${E}.gif`);
    const stats = dailyStats(db, C, 1);
    assert.equal(stats.total, 2);
    assert.equal(stats.categories.text, 2);
    assert.equal(stats.topEmojis.length, 2);
    assert.equal(stats.topEmojis.find(row => row.id === '😀').count, 3);
    assert.equal(stats.topEmojis.find(row => row.id === E).count, 3);
    assert.deepEqual(stats.topStickers, [{ id: S, name: 'Wave', contentType: 'image/gif',
      url: `https://cdn.discordapp.com/stickers/${S}.gif`, count: 2 }]);
    assert.equal(listMedia(db, C, null, 1).media.length, 3);
    assert.equal(listMedia(db, C, null, 1).nextBefore, N);
    assert.equal(listMedia(db, C, N, 1).media.length, 3);
    assert.deepEqual(dailyStats(db, C, 1).topEmojis.map(item => item.id), [E, '😀']);
  } finally { db.close(); }
});

test('sticker previews use only canonical supported formats and legacy rows never expose unsafe URL', () => {
  const db = fixture();
  try {
    const formats = [[1, 'image/png', 'png'], [2, 'image/png', 'png'],
      [3, null, null], [4, 'image/gif', 'gif'], [99, null, null]];
    for (const [format, mime, extension] of formats) {
      const id = String(BigInt(S) + BigInt(format));
      const preview = stickerPreview(id, format);
      assert.equal(preview.contentType, mime);
      assert.equal(preview.url, extension ? `https://cdn.discordapp.com/stickers/${id}.${extension}` : null);
      add(db, String(BigInt(M) + BigInt(format)), '', [sticker(id, format)]);
      const item = listMedia(db, C, null).media.find(row => row.id === id);
      assert.equal(item.url, preview.url);
      assert.equal(item.contentType, mime);
    }
    assert.equal(stickerPreview('invalid', 4).url, null);
    db.prepare('UPDATE message_media SET url=?,content_type=? WHERE id=?')
      .run(`https://cdn.discordapp.com/stickers/${String(BigInt(S) + 4n)}.json`, null, String(BigInt(S) + 4n));
    const row = listMedia(db, C, null).media.find(item => item.id === String(BigInt(S) + 4n));
    assert.equal(row.url, null);
    assert.equal(row.contentType, null);
    assert.equal(dailyStats(db, C, 1).topStickers.find(item => item.id === row.id).url, null);
    db.prepare('UPDATE message_media SET url=?,content_type=? WHERE id=?')
      .run(`https://cdn.discordapp.com/stickers/${String(BigInt(S) + 4n)}.gif`, null, String(BigInt(S) + 4n));
    assert.equal(listMedia(db, C, null).media.find(item => item.id === row.id).url,
      `https://cdn.discordapp.com/stickers/${row.id}.gif`);
  } finally { db.close(); }
});

test('edits, redaction, purge and retention remove emoji counts and cannot resurrect', () => {
  const db = fixture();
  try {
    add(db, M, `😀 <:yay:${E}>`, [sticker(S, 1)]);
    assert.equal(add(db, M, 'duplicate 😀 😀'), false);
    assert.equal(dailyStats(db, C, 1).topEmojis.find(row => row.id === '😀').count, 1);
    assert.equal(updateArchivedMessage(db, { id: M, channelId: C, guildId: G,
      content: '😀 😀', editedAt: today() }), true);
    assert.deepEqual(dailyStats(db, C, 1).topEmojis.map(item => [item.id, item.count]), [['😀', 2]]);
    assert.equal(dailyStats(db, C, 1).topStickers.length, 1);
    redactMessage(db, M, C);
    assert.deepEqual(dailyStats(db, C, 1).topEmojis, []);
    assert.equal(add(db, M, '😀'), false);
    add(db, N, '😀', [sticker(S, 2)]);
    assert.equal(purgeChannel(db, G, C, G), 1);
    assert.deepEqual(dailyStats(db, C, 1).topStickers, []);
    assert.equal(add(db, N, '😀'), false);
    const future = ((BigInt(Date.now() + 10000) - 1420070400000n) << 22n).toString();
    add(db, future, '😀');
    pruneMessages(db, 1);
    assert.equal(add(db, M, '😀', [], '2020-01-01T00:00:00.000Z'), false);
    assert.equal(dailyStats(db, C, 1).topEmojis[0].count, 1);
  } finally { db.close(); }
});

test('legacy schema adds emoji table without guessing historical content; selected days exclude older usage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'archiveme-emoji-migrate-'));
  const file = join(dir, 'legacy.sqlite');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE guilds(id TEXT PRIMARY KEY,name TEXT NOT NULL,icon TEXT);
    CREATE TABLE channels(id TEXT PRIMARY KEY,guild_id TEXT NOT NULL REFERENCES guilds(id),name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE messages(id TEXT PRIMARY KEY,guild_id TEXT NOT NULL REFERENCES guilds(id),
      channel_id TEXT NOT NULL REFERENCES channels(id),author_id TEXT NOT NULL,author_name TEXT NOT NULL,
      avatar_url TEXT,content TEXT NOT NULL,created_at TEXT NOT NULL,edited_at TEXT,deleted_at TEXT);`);
  old.prepare('INSERT INTO guilds(id,name) VALUES(?,?)').run(G, 'Guild');
  old.prepare('INSERT INTO channels(id,guild_id,name) VALUES(?,?,?)').run(C, G, 'Channel');
  old.prepare(`INSERT INTO messages(id,guild_id,channel_id,author_id,author_name,content,created_at)
    VALUES(?,?,?,?,?,?,?)`).run(M, G, C, G, 'Writer', '😀', today());
  old.close();
  const db = openDatabase(file);
  try {
    assert.deepEqual(dailyStats(db, C, 1).topEmojis, []);
    assert.equal(dailyStats(db, C, 1).categories.unknown, 1);
    add(db, N, '😀', [], new Date(Date.now() - 3 * 86400000).toISOString());
    assert.deepEqual(dailyStats(db, C, 1).topEmojis, []);
    assert.equal(updateArchivedMessage(db, { id: M, guildId: G, channelId: C,
      content: '😀 😀', editedAt: today() }), true);
    assert.equal(dailyStats(db, C, 1).categories.unknown, 1);
    assert.equal(dailyStats(db, C, 1).topEmojis[0].count, 2);
    assert.equal(dailyStats(db, C, 4).topEmojis[0].count, 3);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('Discord create/update extraction includes sticker format and re-parses emoji', async () => {
  const db = fixture();
  const service = createDiscordService({ db });
  try {
    const base = { id: M, guildId: G, channelId: C, channel: { type: 0 },
      author: { id: G, username: 'Writer', bot: false, displayAvatarURL: () => '' },
      createdAt: new Date(), editedAt: null, attachments: new Map(),
      stickers: new Map([['sticker', sticker(S, 4)]]) };
    service.client.emit('messageCreate', { ...base, content: '😀' });
    assert.equal(listMedia(db, C, null).media.find(item => item.kind === 'sticker').url,
      `https://cdn.discordapp.com/stickers/${S}.gif`);
    service.client.emit('messageUpdate', null, { ...base, content: '❤️', editedAt: new Date(),
      stickers: new Map([['sticker', sticker(S, 3)]]) });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(listMedia(db, C, null).media.find(item => item.kind === 'sticker').url, null);
    assert.deepEqual(dailyStats(db, C, 1).topEmojis.map(item => item.id), ['❤️']);
  } finally { service.client.destroy(); db.close(); }
});
