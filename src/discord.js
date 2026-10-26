import { Client, GatewayIntentBits, Partials, ChannelType, PermissionFlagsBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { archiveMessage, updateArchivedMessage, redactMessage, setChannelEnabled, syncChannel, syncGuild } from './db.js';

export function createDiscordService({ db, token, clientId }) {
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent], partials: [Partials.Message, Partials.Channel] });
  const allowedType = channel => channel?.type === ChannelType.GuildText;
  function recordChannel(channel) {
    if (!channel?.guild || !allowedType(channel)) return;
    syncGuild(db, { id: channel.guild.id, name: channel.guild.name, icon: channel.guild.icon });
    syncChannel(db, { id: channel.id, guildId: channel.guild.id, name: channel.name });
  }
  let synchronized = false;
  client.on('ready', async () => {
    synchronized = false;
    console.log(`Bot connected as ${client.user.tag}`);
    let failed = false;
    for (const guild of client.guilds.cache.values()) {
      try {
        const live = await guild.channels.fetch();
        syncGuild(db, { id: guild.id, name: guild.name, icon: guild.icon });
        for (const channel of live.values()) recordChannel(channel);
        const ids = new Set([...live.values()].filter(allowedType).map(channel => channel.id));
        for (const saved of db.prepare('SELECT id FROM channels WHERE guild_id=?').all(guild.id)) {
          if (!ids.has(saved.id)) db.prepare('DELETE FROM channels WHERE id=?').run(saved.id);
        }
      } catch (error) { failed = true; console.error(`Could not synchronize guild ${guild.id}:`, error.message); }
    }
    if (!failed) {
      // A removed bot may miss guildDelete while offline. Only reconcile after a complete, successful READY snapshot.
      const active = new Set(client.guilds.cache.keys());
      for (const saved of db.prepare('SELECT id FROM guilds').all()) {
        if (!active.has(saved.id)) db.prepare('DELETE FROM guilds WHERE id=?').run(saved.id);
      }
      synchronized = true;
    }
  });
  client.on('guildCreate', guild => {
    syncGuild(db, { id: guild.id, name: guild.name, icon: guild.icon });
    guild.channels.fetch().then(() => {
      for (const channel of guild.channels.cache.values()) recordChannel(channel);
    }).catch(error => console.error('Channel sync failed:', error.message));
  });
  client.on('channelCreate', recordChannel);
  client.on('channelUpdate', (_, channel) => recordChannel(channel));
  client.on('channelDelete', channel => {
    db.prepare('DELETE FROM channels WHERE id=?').run(channel.id);
  });
  client.on('guildDelete', guild => {
    // Data is removed when the bot leaves. Backups have a separate retention policy.
    db.prepare('DELETE FROM guilds WHERE id=?').run(guild.id);
  });
  function save(message) {
    if (!message.guildId || !message.author || message.author.bot || !allowedType(message.channel)) return;
    archiveMessage(db, { id: message.id, guildId: message.guildId, channelId: message.channelId,
      authorId: message.author.id, authorName: message.member?.displayName || message.author.globalName || message.author.username,
      avatarUrl: message.author.displayAvatarURL(), content: message.content ?? '',
      createdAt: message.createdAt.toISOString(), editedAt: message.editedAt?.toISOString() ?? null });
  }
  client.on('messageCreate', save);
  client.on('messageUpdate', async (_, updated) => {
    try {
      if (!updated.guildId || !updated.channelId || !db.prepare('SELECT 1 FROM messages WHERE id=? AND channel_id=?').get(updated.id, updated.channelId)) return;
      const message = updated.partial ? await updated.fetch() : updated;
      updateArchivedMessage(db, { id: message.id, guildId: message.guildId, channelId: message.channelId,
        content: message.content ?? '', editedAt: message.editedAt?.toISOString() ?? new Date().toISOString() });
    } catch (error) { console.error('Could not process message edit:', error.message); }
  });
  client.on('messageDelete', message => redactMessage(db, message.id, message.channelId));
  client.on('messageDeleteBulk', messages => {
    for (const message of messages.values()) redactMessage(db, message.id, message.channelId);
  });
  client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'archive' || !interaction.inGuild()) return;
    try {
      if (!await isAdmin(interaction.guildId, interaction.user.id))
        return interaction.reply({ content: 'Manage Server permission is required.', ephemeral: true });
      const channel = interaction.options.getChannel('channel', true);
      if (!allowedType(channel) || channel.guildId !== interaction.guildId)
        return interaction.reply({ content: 'Choose a text channel in this server.', ephemeral: true });
      if (!await canReadChannel(interaction.guildId, channel.id, interaction.user.id))
        return interaction.reply({ content: 'You must be able to view and read history in that channel.', ephemeral: true });
      const action = interaction.options.getSubcommand();
      const enabled = action === 'enable';
      if (enabled) {
        const liveChannel = await interaction.guild.channels.fetch(channel.id, { force: true, cache: false });
        const botMember = await interaction.guild.members.fetchMe();
        const botPermissions = liveChannel.permissionsFor(botMember);
        if (!botPermissions?.has(PermissionFlagsBits.ViewChannel) || !botPermissions?.has(PermissionFlagsBits.ReadMessageHistory))
          return interaction.reply({ content: 'The bot needs View Channel and Read Message History in that channel.', ephemeral: true });
      }
      recordChannel(channel);
      setChannelEnabled(db, interaction.guildId, channel.id, enabled, interaction.user.id);
      return interaction.reply({ content: `${channel} archive ${enabled ? 'enabled' : 'disabled'}. Changes affect new events; disabling hides archived data until re-enabled.`, ephemeral: true });
    } catch (error) {
      console.error('Archive command failed:', error.message);
      if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: 'The archive command failed. Try again later.', ephemeral: true }).catch(() => {});
    }
  });
  const command = new SlashCommandBuilder().setName('archive').setDescription('Manage opt-in text channel archiving');
  for (const action of ['enable', 'disable']) command.addSubcommand(sub => sub.setName(action)
    .setDescription(`${action === 'enable' ? 'Start' : 'Stop'} archiving a channel`)
    .addChannelOption(option => option.setName('channel').setDescription('Text channel')
      .addChannelTypes(ChannelType.GuildText).setRequired(true)));
  async function start() {
    if (!token || !clientId) return console.log('Discord bot not configured; API running without live bot.');
    await new REST({ version: '10' }).setToken(token).put(Routes.applicationCommands(clientId), { body: [command.toJSON()] });
    await client.login(token);
  }
  async function getGuild(guildId) {
    if (!client.isReady() || !synchronized) return null;
    return client.guilds.cache.get(guildId) ?? null;
  }
  async function isAdmin(guildId, userId) {
    const guild = await getGuild(guildId);
    if (!guild) return false;
    try {
      const member = await guild.members.fetch({ user: userId, force: true });
      return member.permissions.has(PermissionFlagsBits.ManageGuild);
    } catch { return false; }
  }
  async function canReadChannel(guildId, channelId, userId) {
    const guild = await getGuild(guildId);
    if (!guild) return false;
    try {
      const member = await guild.members.fetch({ user: userId, force: true });
      if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) return false;
      // Force REST fetch avoids stale channel overwrites in the client's cache.
      const channel = await guild.channels.fetch(channelId, { force: true, cache: false });
      return allowedType(channel) && channel.permissionsFor(member)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]) === true;
    } catch { return false; }
  }
  return { client, start, getGuild, isAdmin, canReadChannel, recordChannel, isSynchronized: () => synchronized };
}
