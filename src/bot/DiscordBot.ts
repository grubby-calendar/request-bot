import { ChannelType, Client, GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import type { GuildTextBasedChannel, Message } from 'discord.js';
import type { WebSocketServer } from 'ws';
import { ParsedMessage, DoneReaction } from './ParsedMessage.ts';
import { IndexedArray } from '../util/IndexedArray.ts';

const TOKEN = process.env.DISCORD_TOKEN; // Your bot token from the .env file
const CHANNEL_ID = process.env.CHANNEL_ID; // The ID of the channel to poll
const MESSAGE_COUNT = 50; // Number of messages to fetch

enum MessageType {
  AddMessage = 'add-message',
  UpdateMessage = 'update-message',
  DeleteMessage = 'delete-message',
}

export class DiscordBot {
  client: Client;
  channel: GuildTextBasedChannel | null = null;
  wss: WebSocketServer | null;

  messages: IndexedArray<ParsedMessage>;

  constructor() {
    // Initialize the bot client with the necessary intents
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
      ]
    });
    this.messages = new IndexedArray<ParsedMessage>(message => message.id);
  }

  start() {
    if (!TOKEN) throw new Error('Missing DISCORD_TOKEN, please provide it in the .env file.');

    this.client.once('ready', async () => {
      if (!this.client.user) throw new Error('Failed to log in with the provided token.');
      console.log(`Logged in as: ${this.client.user.tag}`);

      // Connect to the channel, checking permissions etc
      await this.connectToChannel();
      if (!this.channel) throw new Error('Failed to connect to the channel.');
      console.log(`Connected to channel: [${this.channel.guild.name}] #${this.channel.name}`);
    });

    // Listen for new threads being created on messages we already track
    this.client.on('messageCreate', async m => {
      if (m.system || m.author.bot) return;
      if (m.channel.type === ChannelType.PublicThread) {
        const starter = await m.channel.fetchStarterMessage();
        if (!starter) return;
        const existing = this.messages.find(starter.id);
        if (!existing) return;
        existing.override(starter);
        (await m.channel.messages.fetch())
          ?.sort(this.sortMessages)
          .forEach(tm => existing.override(tm));
        this.broadcast({ type: 'update-message', message: existing });
        console.log(`Updated message (thread-msg): ${existing.user}`);
        return;
      }
      if (m.channel.type === ChannelType.GuildText) {
        if (m.channel.id !== this.channel?.id) return;
        const message = new ParsedMessage(m);
        if (!message.isValid()) return;
        this.messages.push(message);
        this.broadcast({ type: 'add-message', message });
        console.log(`Updated message (msg-create): ${message.user}`);
        return;
      }
    });

    // Listen for messages being edited
    this.client.on('messageUpdate', async (_, m) => {
      if (m.system || m.author?.bot) return;
      if (m.partial) m = await m.fetch();
      if (m.channel.type === ChannelType.PublicThread) {
        const starter = await m.channel.fetchStarterMessage();
        if (!starter) return;
        const existing = this.messages.find(starter.id);
        if (!existing) return;
        existing.override(m);
        (await m.channel.messages.fetch())
          ?.sort(this.sortMessages)
          .forEach(tm => existing.override(tm));
        this.broadcast({ type: 'update-message', message: existing });
        console.log(`Updated message (thread-msg-upd): ${existing.user}`);
        return;
      }
      if (m.channel.type === ChannelType.GuildText) {
        if (m.channel.id !== this.channel?.id) return;
        const existing = this.messages.find(m.id);
        if (!existing) return;
        existing.override(m);
        (await m.channel.messages.fetch())
          ?.sort(this.sortMessages)
          .forEach(tm => existing.override(tm));
        this.broadcast({ type: 'update-message', message: existing });
        console.log(`Updated message (msg-edit): ${existing.user}`);
        return;
      }
    });

    // Listen for reactions being added to messages
    this.client.on('messageReactionAdd', (reaction, user) => {
      if (reaction.emoji.name !== DoneReaction) return;
      const message = this.messages.find(reaction.message.id);
      if (!message) return;
      message.isDone = true;
      this.broadcast({ type: 'update-message', message });
      console.log(`Updated message (reaction-add): ${message.user}`);
    });

    // Listen for reactions being removed from messages
    this.client.on('messageReactionRemove', (reaction, user) => {
      if (reaction.emoji.name !== DoneReaction) return;
      if (reaction.partial || reaction.count > 0) return;
      const message = this.messages.find(reaction.message.id);
      if (!message) return;
      message.isDone = false;
      this.broadcast({ type: 'update-message', message });
      console.log(`Updated message (reaction-rem): ${message.user}`);
    });

    // When a moderator clears all reactions from a message
    this.client.on('messageReactionRemoveAll', m => {
      const message = this.messages.find(m.id);
      if (!message) return;
      message.isDone = false;
      this.broadcast({ type: 'update-message', message });
      console.log(`Updated message (reaction-rem-all): ${message.user}`);
    });

    // Listen for messages being deleted
    this.client.on('messageDelete', async m => {
      const message = this.messages.find(m.id);
      // If the message is one we're tracking, just remove it
      if (message) {
        this.messages.delete(message.id);
        this.broadcast({ type: 'delete-message', id: message.id });
        console.log(`Deleted message: ${message.user}`);
        return;
      }
      // If the message was inside of a thread on a message we're tracking,
      // update the message with any overrides in the thread
      if (m.channel.type !== ChannelType.PublicThread) return;
      const starter = await m.channel.fetchStarterMessage();
      if (!starter) return;
      const existing = this.messages.find(starter.id);
      if (!existing) return;
      existing.override(starter);
      (await m.channel.messages.fetch())
        ?.sort(this.sortMessages)
        .forEach(tm => existing.override(tm));
      this.broadcast({ type: 'update-message', message: existing });
      console.log(`Updated message (thread-msg-del): ${existing.user}`);
      return;
    });

    // Log in the bot with the provided token
    this.client.login(TOKEN);
  }

  async stop() {
    await this.client.destroy();
    console.log("DiscordBot stopped");
  }

  async connectToChannel() {
    if (!this.client.user) throw new Error('Failed to log in with the provided token.');
    if (!CHANNEL_ID) throw new Error('Missing CHANNEL_ID, please provide it in the .env file.');

    // Fetch the channel by its ID
    const channel = await this.client.channels.fetch(CHANNEL_ID);

    // Ensure that the fetched channel is a text-based, non-DM channel
    if (!channel || !channel.isTextBased() || channel.isDMBased()) {
      throw new Error('Invalid channel or non-text channel.');
    }

    // Ensure that the bot has the necessary permissions
    const botPermissions = channel.permissionsFor(this.client.user);
    if (!botPermissions) throw new Error('Failed to fetch bot permissions.');
    if (!botPermissions.has(PermissionFlagsBits.ViewChannel)) throw new Error('Missing permissions: VIEW_CHANNEL');
    if (!botPermissions.has(PermissionFlagsBits.ReadMessageHistory)) throw new Error('Missing permissions: READ_MESSAGE_HISTORY');

    // Store the channel for later use
    this.channel = channel;

    // Fetch the existing messages
    this.fetchAllMessages();
  }

  async fetchAllMessages() {
    if (!this.client.user) throw new Error('Failed to log in with the provided token.');
    if (!this.channel) throw new Error('Channel not connected.');
    try {
      // Fetch the last N messages from the channel
      const messages = await this.channel.messages.fetch({ limit: MESSAGE_COUNT });

      // Parse the messages
      const parsedMessages = await Promise.all(
        messages
          .filter(m => !m.system) // Ignore system messages
          .map(async (m) => {
            // Parse the message
            const message = new ParsedMessage(m);
            // If the message has a thread, use them as overrides
            (await m.thread?.messages.fetch())
              ?.sort(this.sortMessages)
              .forEach(tm => message.override(tm));
            return message;
          })
        );

      // Store them
      this.messages.massUpdate(parsedMessages.filter(m => m.isValid()));

      // Log the messages for debugging
      this.messages.all()
        .sort((a, b) => +(a.requestDate || 0) - +(b.requestDate || 0))
        .forEach(message => {
          console.debug(`User: ${message.user} | Request: ${message.shortDescription} | Date: ${message.shortDate()} | Done: ${message.isDone ? 'Yes' : 'No'}`);
        });
    } catch (error) {
      console.error('Error fetching messages:', error);
    }
  };

  sortMessages(a: Message, b: Message) {
    return +(a.createdTimestamp || 0) - +(b.createdTimestamp || 0);
  }

  setWebSocketServer(wss: WebSocketServer) {
    this.wss = wss;
  }

  broadcast(message: object) {
    if (!this.wss) return;
    this.wss.clients.forEach(client => {
      if (client.readyState !== 1) return;
      client.send(JSON.stringify(message));
    });
  }
}
