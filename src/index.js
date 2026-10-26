import { resolve } from 'node:path';
import { openDatabase, pruneMessages } from './db.js';
import { createDiscordService } from './discord.js';
import { createApp } from './app.js';

const baseUrl = process.env.BASE_URL ?? 'http://localhost:3000';
const port = Number(process.env.PORT ?? 3000);
const bindHost = process.env.HOST ?? '127.0.0.1';
const trustProxy = process.env.TRUST_PROXY === 'loopback' ? 'loopback' : false;
if (process.env.TRUST_PROXY && process.env.TRUST_PROXY !== 'loopback') throw new Error('TRUST_PROXY may only be loopback or unset');
const retentionDays = Number(process.env.RETENTION_DAYS ?? 90);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) throw new Error('Invalid RETENTION_DAYS');
if (process.env.NODE_ENV === 'production' && new URL(baseUrl).protocol !== 'https:')
  throw new Error('Production requires HTTPS BASE_URL');
if (process.env.NODE_ENV === 'production' && (!process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET))
  throw new Error('Production requires Discord bot and OAuth credentials');
const db = openDatabase(resolve(process.env.DATABASE_PATH ?? './data/archiveme.sqlite'));
const discord = createDiscordService({ db, token: process.env.DISCORD_BOT_TOKEN, clientId: process.env.DISCORD_CLIENT_ID });
const app = createApp({ db, discord, clientId: process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET, baseUrl, trustProxy });
pruneMessages(db, retentionDays);
const sweep = setInterval(() => {
  pruneMessages(db, retentionDays);
  db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());
  db.prepare('DELETE FROM oauth_states WHERE expires_at<?').run(Date.now());
}, 60 * 60 * 1000);
sweep.unref();
const server = app.listen(port, bindHost, () => console.log(`ArchiveMe listening at ${baseUrl} (bound to ${bindHost}:${port})`));
discord.start().catch(error => {
  console.error('Discord bot startup failed:', error);
  server.close();
  process.exitCode = 1;
});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  server.close(); discord.client.destroy(); db.close();
});
