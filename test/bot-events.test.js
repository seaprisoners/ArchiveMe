import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createDiscordService } from '../src/discord.js';
import { openDatabase, syncGuild, syncChannel, listMessages, dailyStats, setChannelEnabled } from '../src/db.js';

const guildId = '120000000000000001', channelId = '120000000000000002';
const makeMessage = (id, content = 'new') => ({
  id, guildId, channelId, channel: { type: 0 }, author: {
    id: '120000000000000005', username: 'Example', bot: false,
    displayAvatarURL: () => 'https://cdn.discordapp.com/example.png'
  }, member: { displayName: 'Example' }, content, createdAt: new Date(), editedAt: null
});

function fixture() {
  const db = openDatabase();
  syncGuild(db, { id: guildId, name: 'Test' });
  syncChannel(db, { id: channelId, guildId, name: 'test' });
  const service = createDiscordService({ db });
  return { db, client: service.client, close: () => { service.client.destroy(); db.close(); } };
}

test('actual bot event handlers respect opt-in, edits and uncached partial deletion', async () => {
  const { db, client, close } = fixture();
  try {
    const id = '120000000000000100';
    client.emit('messageCreate', makeMessage(id, 'before enabling'));
    assert.equal(listMessages(db, channelId, null).messages.length, 0);
    setChannelEnabled(db, guildId, channelId, true, '120000000000000009');
    client.emit('messageUpdate', null, makeMessage(id, 'pre-enable edit'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(listMessages(db, channelId, null).messages.length, 0);
    client.emit('messageCreate', makeMessage(id, 'first archived message'));
    assert.equal(listMessages(db, channelId, null).messages.length, 1);
    const edited = makeMessage(id, 'edited');
    edited.editedAt = new Date();
    client.emit('messageUpdate', null, edited);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(listMessages(db, channelId, null).messages[0].content, 'edited');
    // A partial event only has IDs; it must still erase the database row.
    client.emit('messageDelete', { id, channelId, partial: true });
    assert.equal(listMessages(db, channelId, null).messages.length, 0);
    assert.equal(dailyStats(db, channelId, 1).total, 0);
  } finally { close(); }
});

test('bulk delete and disabled-channel edit cannot retain or reimport content', async () => {
  const { db, client, close } = fixture();
  try {
    setChannelEnabled(db, guildId, channelId, true, '120000000000000009');
    const first = '120000000000000101', second = '120000000000000102';
    client.emit('messageCreate', makeMessage(first, 'first'));
    client.emit('messageCreate', makeMessage(second, 'second'));
    client.emit('messageDeleteBulk', new Map([[first, { id: first, channelId }], [second, { id: second, channelId }]]));
    assert.equal(listMessages(db, channelId, null).messages.length, 0);
    setChannelEnabled(db, guildId, channelId, false, '120000000000000009');
    client.emit('messageCreate', makeMessage(first, 'while disabled'));
    assert.equal(listMessages(db, channelId, null).messages.length, 0);
  } finally { close(); }
});
