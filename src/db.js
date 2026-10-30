import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DISCORD_EPOCH = 1420070400000n;
const snowflakeAt = date => ((BigInt(date) - DISCORD_EPOCH) << 22n).toString();
// Never expose arbitrary URLs supplied by message authors or third-party hosts.
export function safeMediaUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      ['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname) ? url.href : null;
  } catch { return null; }
}
const cleanString = (value, length = 255) => typeof value === 'string' ? value.slice(0, length) : null;
const snowflake = value => /^\d{16,22}$/.test(String(value));
const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
const customEmoji = /<(?<animated>a?):(?<name>[A-Za-z0-9_]{2,32}):(?<id>\d{16,22})>/g;
const emojiGlyph = /[\p{Extended_Pictographic}\p{Emoji_Presentation}]/u;
const flagPair = /^\p{Regional_Indicator}{2}$/u;
const keycap = /^[#*0-9]\uFE0F?\u20E3$/u;
export function customEmojiUrl(id, animated = false) {
  return snowflake(id) ? `https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'png'}` : null;
}
export function stickerPreview(id, format) {
  // Discord StickerFormatType: PNG=1, APNG=2, Lottie=3, GIF=4.
  if (!snowflake(id)) return { url: null, contentType: null };
  if (format === 1 || format === 2) return { url: `https://cdn.discordapp.com/stickers/${id}.png`, contentType: 'image/png' };
  if (format === 4) return { url: `https://cdn.discordapp.com/stickers/${id}.gif`, contentType: 'image/gif' };
  // JSON animation is fetched and rendered by the authorized browser, never by <img>.
  if (format === 3) return { url: `https://cdn.discordapp.com/stickers/${id}.json`, contentType: 'application/json' };
  return { url: null, contentType: null };
}
function stickerFromMime(id, contentType, legacyUrl = null) {
  if (contentType === 'image/gif') return stickerPreview(id, 4);
  if (contentType === 'image/png') return stickerPreview(id, 1);
  if (contentType === 'application/json') return stickerPreview(id, 3);
  // Old archives kept only a URL or no format at all. JSON URLs identify Lottie;
  // do not guess unknown formats or trust third-party hosts and query strings.
  if (legacyUrl === `https://cdn.discordapp.com/stickers/${id}.gif`) return stickerPreview(id, 4);
  if (legacyUrl === `https://cdn.discordapp.com/stickers/${id}.png`) return stickerPreview(id, 1);
  if (legacyUrl === `https://cdn.discordapp.com/stickers/${id}.json`) return stickerPreview(id, 3);
  // A missing URL on old records is ambiguous: do not guess from the ID.
  return stickerPreview(id, null);
}
export function parseEmojis(content) {
  if (typeof content !== 'string') return [];
  const entries = new Map();
  const record = (id, name, contentType = null) => {
    const existing = entries.get(id);
    if (existing) { existing.count++; return; }
    entries.set(id, { id, name, contentType, count: 1 });
  };
  const unicode = text => {
    for (const { segment } of segmenter.segment(text)) {
      if (keycap.test(segment) || flagPair.test(segment) ||
        (!/^\p{Regional_Indicator}+$/u.test(segment) && emojiGlyph.test(segment))) {
        record(segment, segment);
      }
    }
  };
  let offset = 0;
  for (const match of content.matchAll(customEmoji)) {
    unicode(content.slice(offset, match.index));
    record(match.groups.id, match.groups.name, match.groups.animated ? 'image/gif' : 'image/png');
    offset = match.index + match[0].length;
  }
  unicode(content.slice(offset));
  return [...entries.values()];
}
function cleanMedia(media) {
  if (!Array.isArray(media)) return [];
  return media.slice(0, 50).flatMap(item => {
    if (!item || !['attachment', 'sticker'].includes(item.kind) || !snowflake(item.id)) return [];
    const sticker = stickerPreview(item.id, item.format);
    return [{ kind: item.kind, id: String(item.id), name: cleanString(item.name),
      contentType: item.kind === 'sticker' ? sticker.contentType : cleanString(item.contentType),
      size: item.kind === 'sticker' ? null : Number.isSafeInteger(item.size) && item.size >= 0 ? item.size : null,
      url: item.kind === 'sticker' ? sticker.url : safeMediaUrl(item.url) }];
  });
}
// Exclusive precedence: video > image > link > text > other (including untyped files/stickers).
// A sticker alone is 'other'; attachments without a recognized image/video MIME type are 'other'.
export function classifyMessage(message, media = cleanMedia(message.media)) {
  if (media.some(item => item.kind === 'attachment' && item.contentType?.toLowerCase().startsWith('video/'))) return 'videos';
  if (media.some(item => item.kind === 'attachment' && item.contentType?.toLowerCase().startsWith('image/'))) return 'images';
  if (/https?:\/\/[^\s<>]+/i.test(message.content ?? '')) return 'links';
  if ((message.content ?? '').trim()) return 'text';
  return 'other';
}
function replaceMedia(db, id, media) {
  db.prepare('DELETE FROM message_media WHERE message_id=?').run(id);
  const insert = db.prepare(`INSERT INTO message_media(message_id,kind,id,name,content_type,size,url)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(message_id,kind,id) DO NOTHING`);
  for (const item of media) insert.run(id, item.kind, item.id, item.name, item.contentType, item.size, item.url);
}
function replaceEmojis(db, id, content) {
  db.prepare('DELETE FROM message_emojis WHERE message_id=?').run(id);
  const insert = db.prepare(`INSERT INTO message_emojis(message_id,id,name,content_type,count)
    VALUES(?,?,?,?,?)`);
  for (const emoji of parseEmojis(content)) insert.run(id, emoji.id, emoji.name, emoji.contentType, emoji.count);
}
function publicMedia(item) {
  if (item.kind !== 'sticker') return { ...item, url: safeMediaUrl(item.url) };
  const preview = stickerFromMime(item.id, item.contentType, item.url);
  return { ...item, ...preview };
}
function publicEmoji(item) {
  return { ...item, kind: 'emoji', size: null,
    url: item.contentType === 'image/png' || item.contentType === 'image/gif'
      ? customEmojiUrl(item.id, item.contentType === 'image/gif') : null };
}
function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = work(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function openDatabase(filename = ':memory:') {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS guilds (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT
    );
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY, guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
      name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS channels_guild ON channels(guild_id);
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
      channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      author_id TEXT NOT NULL, author_name TEXT NOT NULL, avatar_url TEXT,
      content TEXT NOT NULL, created_at TEXT NOT NULL, edited_at TEXT, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS messages_channel_id ON messages(channel_id,id DESC);
    CREATE INDEX IF NOT EXISTS messages_numeric_order ON messages(channel_id,length(id) DESC,id DESC);
    CREATE INDEX IF NOT EXISTS messages_channel_time ON messages(channel_id,created_at);
    CREATE TABLE IF NOT EXISTS message_media (
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('attachment','sticker')),
      id TEXT NOT NULL, name TEXT, content_type TEXT, size INTEGER, url TEXT,
      PRIMARY KEY(message_id,kind,id)
    );
    CREATE INDEX IF NOT EXISTS message_media_message ON message_media(message_id);
    CREATE TABLE IF NOT EXISTS message_emojis (
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      id TEXT NOT NULL, name TEXT NOT NULL, content_type TEXT, count INTEGER NOT NULL CHECK(count>0),
      PRIMARY KEY(message_id,id)
    );
    CREATE INDEX IF NOT EXISTS message_emojis_message ON message_emojis(message_id);
    CREATE TABLE IF NOT EXISTS redacted_messages (
      id TEXT PRIMARY KEY, channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS archive_policy (
      id INTEGER PRIMARY KEY CHECK(id=1), retention_before TEXT
    );
    INSERT INTO archive_policy(id,retention_before) VALUES(1,NULL) ON CONFLICT(id) DO NOTHING;
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, username TEXT NOT NULL,
      avatar TEXT, csrf_hash TEXT NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS oauth_states (
      state_hash TEXT PRIMARY KEY, verifier TEXT NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, actor_id TEXT NOT NULL,
      action TEXT NOT NULL, target_id TEXT, at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  // Legacy archives did not record media. NULL explicitly means category unknown,
  // rather than silently reporting old messages as text-only.
  const columns = new Set(db.prepare('PRAGMA table_info(messages)').all().map(column => column.name));
  if (!columns.has('category')) db.exec('ALTER TABLE messages ADD COLUMN category TEXT');
  const channelColumns = new Set(db.prepare('PRAGMA table_info(channels)').all().map(column => column.name));
  if (!channelColumns.has('purged_before_id')) db.exec('ALTER TABLE channels ADD COLUMN purged_before_id TEXT');
  return db;
}

export function syncGuild(db, guild) {
  db.prepare(`INSERT INTO guilds(id,name,icon) VALUES(?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, icon=excluded.icon`).run(guild.id, guild.name, guild.icon ?? null);
}
export function syncChannel(db, channel) {
  db.prepare(`INSERT INTO channels(id,guild_id,name) VALUES(?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name`).run(channel.id, channel.guildId, channel.name);
}
export function setChannelEnabled(db, guildId, channelId, enabled, actorId) {
  const result = db.prepare('UPDATE channels SET enabled=?,updated_at=CURRENT_TIMESTAMP WHERE guild_id=? AND id=?')
    .run(enabled ? 1 : 0, guildId, channelId);
  if (result.changes) db.prepare('INSERT INTO audit_events(guild_id,actor_id,action,target_id) VALUES(?,?,?,?)')
    .run(guildId, actorId, enabled ? 'channel.enable' : 'channel.disable', channelId);
  return !!result.changes;
}
export function archiveMessage(db, message) {
  return transaction(db, () => {
    const channel = db.prepare('SELECT enabled,purged_before_id AS purgedBeforeId FROM channels WHERE id=? AND guild_id=?')
      .get(message.channelId, message.guildId);
    if (!channel?.enabled || (channel.purgedBeforeId && BigInt(message.id) <= BigInt(channel.purgedBeforeId)) ||
      db.prepare('SELECT 1 FROM redacted_messages WHERE id=? AND channel_id=?').get(message.id, message.channelId)) return false;
    const policy = db.prepare('SELECT retention_before AS retentionBefore FROM archive_policy WHERE id=1').get();
    if (policy.retentionBefore && message.createdAt < policy.retentionBefore) return false;
    const media = cleanMedia(message.media);
    const inserted = db.prepare(`INSERT INTO messages(id,guild_id,channel_id,author_id,author_name,avatar_url,content,created_at,edited_at,deleted_at,category)
      VALUES(?,?,?,?,?,?,?,?,?,NULL,?) ON CONFLICT(id) DO NOTHING`)
      .run(message.id, message.guildId, message.channelId, message.authorId, message.authorName,
        message.avatarUrl ?? null, message.content, message.createdAt, message.editedAt ?? null,
        classifyMessage(message, media));
    if (inserted.changes) {
      replaceMedia(db, message.id, media);
      replaceEmojis(db, message.id, message.content);
    }
    return !!inserted.changes;
  });
}
export function updateArchivedMessage(db, message) {
  return transaction(db, () => {
    const media = message.media === undefined
      ? db.prepare('SELECT kind,id,name,content_type AS contentType,size,url FROM message_media WHERE message_id=?').all(message.id)
      : cleanMedia(message.media);
    const knownCategory = db.prepare('SELECT category FROM messages WHERE id=? AND channel_id=?')
      .get(message.id, message.channelId)?.category;
    const category = message.media === undefined && knownCategory === null ? null : classifyMessage(message, media);
    const result = db.prepare(`UPDATE messages SET content=?,edited_at=?,category=? WHERE id=? AND guild_id=? AND channel_id=?
      AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM channels WHERE id=? AND enabled=1)`)
      .run(message.content, message.editedAt, category,
        message.id, message.guildId, message.channelId, message.channelId);
    if (result.changes) {
      if (message.media !== undefined) replaceMedia(db, message.id, media);
      replaceEmojis(db, message.id, message.content);
    }
    return !!result.changes;
  });
}
export function redactMessage(db, messageId, channelId) {
  transaction(db, () => {
    db.prepare('DELETE FROM messages WHERE id=? AND channel_id=?').run(messageId, channelId);
    if (db.prepare('SELECT 1 FROM channels WHERE id=?').get(channelId))
      db.prepare('INSERT INTO redacted_messages(id,channel_id) VALUES(?,?) ON CONFLICT(id) DO NOTHING')
        .run(messageId, channelId);
  });
}
export function purgeChannel(db, guildId, channelId, actorId) {
  return transaction(db, () => {
    // A high-water mark rejects delayed duplicate create events after a purge.
    const channel = db.prepare('SELECT purged_before_id AS mark FROM channels WHERE guild_id=? AND id=?').get(guildId, channelId);
    if (!channel) return 0;
    const mark = snowflakeAt(Date.now());
    db.prepare('UPDATE channels SET purged_before_id=? WHERE guild_id=? AND id=?')
      .run(channel.mark && BigInt(channel.mark) > BigInt(mark) ? channel.mark : mark, guildId, channelId);
    const result = db.prepare('DELETE FROM messages WHERE guild_id=? AND channel_id=?').run(guildId, channelId);
    db.prepare('DELETE FROM redacted_messages WHERE channel_id=?').run(channelId);
    db.prepare('INSERT INTO audit_events(guild_id,actor_id,action,target_id) VALUES(?,?,?,?)')
      .run(guildId, actorId, 'channel.purge', channelId);
    return result.changes;
  });
}
export function listMessages(db, channelId, before, limit = 50) {
  const rows = db.prepare(`SELECT id,author_id AS authorId,author_name AS authorName,avatar_url AS avatarUrl,
    content,created_at AS createdAt,edited_at AS editedAt,deleted_at AS deletedAt FROM messages
    WHERE channel_id=? AND (? IS NULL OR length(id) < length(?) OR (length(id)=length(?) AND id < ?))
    ORDER BY length(id) DESC, id DESC LIMIT ?`)
    .all(channelId, before, before, before, before, limit + 1);
  const hasMore = rows.length > limit;
  const messages = rows.slice(0, limit).map(row => ({ ...row, media: [] }));
  if (messages.length) {
    // Only look up metadata for messages on this authorized, paginated channel page.
    // Two batched queries avoid one query per message and keep the cursor unchanged.
    const byId = new Map(messages.map(message => [message.id, message.media]));
    const placeholders = messages.map(() => '?').join(',');
    const media = db.prepare(`SELECT message_id AS messageId,kind,id,name,content_type AS contentType,size,url
      FROM message_media WHERE message_id IN (${placeholders}) ORDER BY message_id,kind,id`).all(...byId.keys());
    const emojis = db.prepare(`SELECT message_id AS messageId,id,name,content_type AS contentType,count
      FROM message_emojis WHERE message_id IN (${placeholders}) ORDER BY message_id,id`).all(...byId.keys());
    for (const { messageId, ...item } of media) byId.get(messageId).push(publicMedia(item));
    for (const { messageId, ...item } of emojis) byId.get(messageId).push(publicEmoji(item));
  }
  return { messages, nextBefore: hasMore ? messages.at(-1).id : null };
}
export function dailyStats(db, channelId, days = 30) {
  const today = new Date().toISOString().slice(0, 10);
  const first = new Date(Date.parse(`${today}T00:00:00.000Z`) - (days - 1) * 86400000).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.parse(`${today}T00:00:00.000Z`) + 86400000).toISOString().slice(0, 10);
  const rows = db.prepare(`SELECT substr(created_at,1,10) AS date, substr(created_at,12,2) AS hour,
    category, count(*) AS count FROM messages WHERE channel_id=? AND deleted_at IS NULL
    AND created_at >= ? AND created_at < ? GROUP BY date,hour,category`).all(channelId, first, tomorrow);
  const counts = new Map(), hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
  const categories = { text: 0, images: 0, videos: 0, links: 0, other: 0, unknown: 0 };
  for (const row of rows) {
    counts.set(row.date, (counts.get(row.date) ?? 0) + row.count);
    if (/^(0\d|1\d|2[0-3])$/.test(row.hour)) hourly[Number(row.hour)].count += row.count;
    categories[Object.hasOwn(categories, row.category) ? row.category : 'unknown'] += row.count;
  }
  const daily = Array.from({ length: days }, (_, index) => {
    const date = new Date(Date.parse(`${first}T00:00:00.000Z`) + index * 86400000).toISOString().slice(0, 10);
    return { date, count: counts.get(date) ?? 0 };
  });
  const topEmojis = db.prepare(`SELECT me.id, me.name, me.content_type AS contentType, sum(me.count) AS count
    FROM message_emojis me JOIN messages m ON m.id=me.message_id
    WHERE m.channel_id=? AND m.deleted_at IS NULL AND m.created_at>=? AND m.created_at<?
    GROUP BY me.id ORDER BY count DESC, me.id LIMIT 20`).all(channelId, first, tomorrow)
    .map(publicEmoji).map(({ kind, size, ...item }) => item);
  const topStickers = db.prepare(`SELECT mm.id, mm.name, mm.content_type AS contentType, mm.url,
    count(*) AS count FROM message_media mm JOIN messages m ON m.id=mm.message_id
    WHERE mm.kind='sticker' AND m.channel_id=? AND m.deleted_at IS NULL AND m.created_at>=? AND m.created_at<?
    GROUP BY mm.id ORDER BY count DESC, mm.id LIMIT 20`).all(channelId, first, tomorrow)
    .map(row => ({ ...stickerFromMime(row.id, row.contentType, row.url),
      id: row.id, name: row.name, count: row.count }))
    .map(({ kind, ...item }) => item);
  return { daily, total: daily.reduce((sum, row) => sum + row.count, 0), hourly, categories,
    topEmojis, topStickers, timezone: 'UTC',
    categorySemantics: 'Exclusive: videos > images > links > text > other; legacy messages without media metadata are unknown. Sticker-only and untyped attachment-only messages are other.' };
}
export function listMedia(db, channelId, before, limit = 50) {
  const messages = db.prepare(`SELECT m.id,m.author_name AS authorName,m.created_at AS createdAt FROM messages m
    WHERE m.channel_id=? AND m.deleted_at IS NULL
    AND (? IS NULL OR length(m.id) < length(?) OR (length(m.id)=length(?) AND m.id < ?))
    AND (EXISTS (SELECT 1 FROM message_media mm WHERE mm.message_id=m.id)
      OR EXISTS (SELECT 1 FROM message_emojis me WHERE me.message_id=m.id))
    ORDER BY length(m.id) DESC,m.id DESC LIMIT ?`).all(channelId, before, before, before, before, limit + 1);
  const hasMore = messages.length > limit;
  const page = messages.slice(0, limit);
  const select = db.prepare(`SELECT kind,id,name,content_type AS contentType,size,url
    FROM message_media WHERE message_id=? ORDER BY kind,id`);
  const selectEmojis = db.prepare(`SELECT id,name,content_type AS contentType,count
    FROM message_emojis WHERE message_id=? ORDER BY id`);
  return { media: page.flatMap(message => [
    ...select.all(message.id).map(publicMedia), ...selectEmojis.all(message.id).map(publicEmoji)
  ].map(item => ({ messageId: message.id, ...item,
    createdAt: message.createdAt, authorName: message.authorName
  }))), nextBefore: hasMore ? page.at(-1).id : null };
}
export function pruneMessages(db, days) {
  return transaction(db, () => {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const previous = db.prepare('SELECT retention_before AS cutoff FROM archive_policy WHERE id=1').get().cutoff;
    db.prepare('UPDATE archive_policy SET retention_before=? WHERE id=1').run(previous && previous > cutoff ? previous : cutoff);
    // Discord snowflakes encode creation time; after the retention cutoff their
    // tombstones are redundant because the ingestion guard already rejects them.
    const beforeId = snowflakeAt(Date.parse(cutoff));
    db.prepare(`DELETE FROM redacted_messages WHERE length(id)<length(?)
      OR (length(id)=length(?) AND id<?)`).run(beforeId, beforeId, beforeId);
    return db.prepare('DELETE FROM messages WHERE created_at < ?').run(cutoff).changes;
  });
}
