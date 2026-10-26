import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

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
  const channel = db.prepare('SELECT enabled FROM channels WHERE id=? AND guild_id=?').get(message.channelId, message.guildId);
  if (!channel?.enabled) return false;
  db.prepare(`INSERT INTO messages(id,guild_id,channel_id,author_id,author_name,avatar_url,content,created_at,edited_at,deleted_at)
    VALUES(?,?,?,?,?,?,?,?,?,NULL) ON CONFLICT(id) DO NOTHING`)
    .run(message.id, message.guildId, message.channelId, message.authorId, message.authorName,
      message.avatarUrl ?? null, message.content, message.createdAt, message.editedAt ?? null);
  return true;
}
export function updateArchivedMessage(db, message) {
  const result = db.prepare(`UPDATE messages SET content=?,edited_at=? WHERE id=? AND guild_id=? AND channel_id=?
    AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM channels WHERE id=? AND enabled=1)`)
    .run(message.content, message.editedAt, message.id, message.guildId, message.channelId, message.channelId);
  return !!result.changes;
}
export function redactMessage(db, messageId, channelId) {
  db.prepare('DELETE FROM messages WHERE id=? AND channel_id=?').run(messageId, channelId);
}
export function purgeChannel(db, guildId, channelId, actorId) {
  const result = db.prepare('DELETE FROM messages WHERE guild_id=? AND channel_id=?').run(guildId, channelId);
  db.prepare('INSERT INTO audit_events(guild_id,actor_id,action,target_id) VALUES(?,?,?,?)')
    .run(guildId, actorId, 'channel.purge', channelId);
  return result.changes;
}
export function listMessages(db, channelId, before, limit = 50) {
  const rows = db.prepare(`SELECT id,author_id AS authorId,author_name AS authorName,avatar_url AS avatarUrl,
    content,created_at AS createdAt,edited_at AS editedAt,deleted_at AS deletedAt FROM messages
    WHERE channel_id=? AND (? IS NULL OR length(id) < length(?) OR (length(id)=length(?) AND id < ?))
    ORDER BY length(id) DESC, id DESC LIMIT ?`)
    .all(channelId, before, before, before, before, limit + 1);
  const hasMore = rows.length > limit;
  return { messages: rows.slice(0, limit), nextBefore: hasMore ? rows[limit - 1].id : null };
}
export function dailyStats(db, channelId, days = 30) {
  const rows = db.prepare(`SELECT substr(created_at,1,10) AS date, count(*) AS count FROM messages
    WHERE channel_id=? AND deleted_at IS NULL AND created_at >= ? GROUP BY date ORDER BY date`)
    .all(channelId, new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10));
  const counts = new Map(rows.map(row => [row.date, row.count]));
  const daily = Array.from({ length: days }, (_, index) => {
    const date = new Date(Date.now() - (days - 1 - index) * 86400000).toISOString().slice(0, 10);
    return { date, count: counts.get(date) ?? 0 };
  });
  return { daily, total: daily.reduce((sum, row) => sum + row.count, 0) };
}
export function pruneMessages(db, days) {
  return db.prepare("DELETE FROM messages WHERE created_at < ?").run(new Date(Date.now() - days * 86400000).toISOString()).changes;
}
