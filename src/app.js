import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { authRoutes } from './auth.js';
import { dailyStats, listMessages, purgeChannel, setChannelEnabled } from './db.js';

const snowflake = value => typeof value === 'string' && /^\d{16,22}$/.test(value);
export function createApp({ db, discord, clientId = '', clientSecret = '', baseUrl = 'http://localhost:3000', oauthFetch, webDir = resolve('web/dist'), trustProxy = false }) {
  const app = express();
  if (trustProxy) app.set('trust proxy', trustProxy);
  const secure = new URL(baseUrl).protocol === 'https:';
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'https://cdn.discordapp.com', 'data:'],
    connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"]
  } } }));
  app.use(express.json({ limit: '16kb' }));
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('Content-Type')?.startsWith('text/plain'))
      return res.status(415).json({ error: 'Unsupported content type' });
    next();
  });
  // /auth has a tighter limiter; /api uses a separate budget for dashboards.
  app.use('/auth', rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false }));
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: 'draft-8', legacyHeaders: false }));
  app.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  authRoutes(app, { db, clientId, clientSecret, baseUrl, secure, oauthFetch });
  app.get('/health', (_req, res) => res.json({ ok: true, botReady: discord.client.isReady() }));
  app.get('/ready', (_req, res) => discord.client.isReady() && discord.isSynchronized?.()
    ? res.json({ ready: true }) : res.status(503).json({ ready: false }));
  app.get('/api/me', async (req, res) => {
    if (!req.session) return res.json({ authenticated: false });
    if (!discord.client.isReady() || (discord.isSynchronized && !discord.isSynchronized()))
      return res.status(503).json({ error: 'Discord connection unavailable' });
    const guilds = [];
    if (discord.client.isReady()) {
      for (const guild of discord.client.guilds.cache.values()) {
        if (await discord.isAdmin(guild.id, req.session.user_id))
          guilds.push({ id: guild.id, name: guild.name, icon: guild.icon });
      }
    }
    res.json({ authenticated: true, user: {
      id: req.session.user_id, username: req.session.username, avatar: req.session.avatar
    }, guilds });
  });
  async function requireAdmin(req, res, next) {
    if (!req.session) return res.status(401).json({ error: 'Sign in required' });
    const { guildId } = req.params;
    if (!snowflake(guildId)) return res.status(404).json({ error: 'Not found' });
    if (!await discord.isAdmin(guildId, req.session.user_id))
      return res.status(403).json({ error: 'Access denied: Manage Server permission required' });
    next();
  }
  async function requireChannel(req, res, next) {
    const { guildId, channelId } = req.params;
    if (!snowflake(channelId)) return res.status(404).json({ error: 'Not found' });
    const channel = db.prepare('SELECT * FROM channels WHERE id=? AND guild_id=?').get(channelId, guildId);
    if (!channel) return res.status(404).json({ error: 'Not found' });
    if (!await discord.canReadChannel(guildId, channelId, req.session.user_id))
      return res.status(403).json({ error: 'Channel access denied' });
    req.archiveChannel = channel;
    next();
  }
  // Admin-only by design. Each request re-checks live Discord membership and permission.
  app.get('/api/guilds/:guildId/channels', requireAdmin, async (req, res) => {
    const guild = db.prepare('SELECT id,name,icon FROM guilds WHERE id=?').get(req.params.guildId);
    if (!guild) return res.status(404).json({ error: 'Not found' });
    const candidates = db.prepare(`SELECT c.id,c.name,c.enabled,
      (SELECT count(*) FROM messages m WHERE m.channel_id=c.id AND m.deleted_at IS NULL) AS messageCount
      FROM channels c WHERE c.guild_id=? ORDER BY c.name`).all(guild.id);
    const channels = [];
    for (const channel of candidates) {
      if (await discord.canReadChannel(guild.id, channel.id, req.session.user_id))
        channels.push({ ...channel, enabled: !!channel.enabled, messageCount: channel.enabled ? channel.messageCount : 0 });
    }
    res.json({ guild, channels });
  });
  app.get('/api/guilds/:guildId/channels/:channelId/messages', requireAdmin, requireChannel, (req, res) => {
    if (!req.archiveChannel.enabled) return res.status(403).json({ error: 'Archiving is disabled' });
    const limit = Number(req.query.limit ?? 50);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (req.query.before && !snowflake(req.query.before)))
      return res.status(400).json({ error: 'Invalid pagination' });
    res.json(listMessages(db, req.params.channelId, req.query.before ?? null, limit));
  });
  app.get('/api/guilds/:guildId/channels/:channelId/stats', requireAdmin, requireChannel, (req, res) => {
    if (!req.archiveChannel.enabled) return res.status(403).json({ error: 'Archiving is disabled' });
    const days = Number(req.query.days ?? 30);
    if (!Number.isInteger(days) || days < 1 || days > 90) return res.status(400).json({ error: 'Days must be between 1 and 90' });
    res.json(dailyStats(db, req.params.channelId, days));
  });
  app.patch('/api/guilds/:guildId/channels/:channelId', requireAdmin, requireChannel, async (req, res) => {
    if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be boolean' });
    if (req.body.enabled) {
      const guild = await discord.getGuild(req.params.guildId);
      const liveChannel = await guild?.channels.fetch(req.params.channelId, { force: true, cache: false }).catch(() => null);
      const bot = await guild?.members.fetchMe().catch(() => null);
      if (!liveChannel || !bot || !liveChannel.permissionsFor(bot)?.has(['ViewChannel', 'ReadMessageHistory']))
        return res.status(403).json({ error: 'Bot needs access and Read Message History' });
    }
    setChannelEnabled(db, req.params.guildId, req.params.channelId, req.body.enabled, req.session.user_id);
    res.json({ enabled: req.body.enabled });
  });
  app.delete('/api/guilds/:guildId/channels/:channelId/messages', requireAdmin, requireChannel, (req, res) => {
    const deleted = purgeChannel(db, req.params.guildId, req.params.channelId, req.session.user_id);
    res.json({ deleted });
  });
  if (existsSync(webDir)) {
    app.use(express.static(webDir, { index: false, dotfiles: 'deny' }));
    app.get('/{*path}', (req, res) => res.sendFile(join(webDir, 'index.html')));
  } else {
    app.get('/', (_req, res) => res.status(503).send('Frontend not built. Run npm run build.'));
  }
  app.use((error, _req, res, _next) => {
    console.error('Request failed:', error);
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}
