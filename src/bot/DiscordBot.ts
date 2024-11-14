import { ChannelType, Client, Events, GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import type { GuildTextBasedChannel, Message } from 'discord.js';
import type { WebSocketServer } from 'ws';
import { RequestMessage, DoneReaction } from './RequestMessage.ts';
import { IndexedArray } from '../util/IndexedArray.ts';

const TOKEN = process.env.DISCORD_TOKEN; // Your bot token from the .env file
const CHANNEL_ID = process.env.CHANNEL_ID; // The ID of the channel to poll
const MESSAGE_COUNT = 50; // Number of messages to fetch

enum BroadcastType {
  AddMessage = 'add-message',
  UpdateMessage = 'update-message',
  DeleteMessage = 'delete-message',
}

export class DiscordBot {
  client: Client;
  channel: GuildTextBasedChannel | null = null;
  wss: WebSocketServer | null;

  requests: IndexedArray<RequestMessage>;

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
    this.requests = new IndexedArray<RequestMessage>(message => message.id);
  }

  setWebSocketServer(wss: WebSocketServer) {
    this.wss = wss;
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
    this.client.on(Events.MessageCreate, async m => {
      if (m.system || m.author.bot) return;

      // If the message is in a thread, find its parent message.
      // If we're tracking this message, use thread messages as overrides.
      if (m.channel.type === ChannelType.PublicThread) {
        const starter = await m.channel.fetchStarterMessage();
        if (!starter) return;
        const request = this.requests.find(starter.id);
        if (!request) return;
        request.override(starter);
        (await m.channel.messages.fetch())
          ?.sort(this.sortMessages)
          .forEach(tm => request.override(tm));
        this.broadcast({ type: BroadcastType.UpdateMessage, request });
        console.log(`Updated message (thread-msg): ${request.user} ${request.id}`);
        return;
      }

      // If the message is in the channel we're tracking, parse it
      // and add it to the list of tracked requests
      if (m.channel.type === ChannelType.GuildText) {
        if (m.channel.id !== this.channel?.id) return;
        const request = new RequestMessage(m);
        if (!request.isValid()) return;
        this.requests.push(request);
        this.broadcast({ type: BroadcastType.AddMessage, request });
        console.log(`Updated message (msg-create): ${request.user} ${request.id}`);
        return;
      }
    });

    // Listen for messages being edited
    this.client.on(Events.MessageUpdate, async (_, m) => {
      if (m.system || m.author?.bot) return;
      if (m.partial) m = await m.fetch();

      // If the updated message is in a thread, find its parent message.
      // If we're tracking this message, use thread messages as overrides.
      if (m.channel.type === ChannelType.PublicThread) {
        const starter = await m.channel.fetchStarterMessage();
        if (!starter) return;
        const request = this.requests.find(starter.id);
        if (!request) return;
        request.override(m);
        (await m.channel.messages.fetch())
          ?.sort(this.sortMessages)
          .forEach(tm => request.override(tm));
        this.broadcast({ type: BroadcastType.UpdateMessage, request });
        console.log(`Updated message (thread-msg-upd): ${request.user} ${request.id}`);
        return;
      }

      // If the updated message is in the channel we're tracking, parse it
      // and update the tracked request with the new information (including thread overrides)
      if (m.channel.type === ChannelType.GuildText) {
        if (m.channel.id !== this.channel?.id) return;
        const request = this.requests.find(m.id);
        if (!request) return;
        request.override(m);
        this.broadcast({ type: BroadcastType.UpdateMessage, request });
        console.log(`Updated message (msg-edit): ${request.user} ${request.id}`);
        return;
      }
    });

    // Listen for reactions being added to messages
    this.client.on(Events.MessageReactionAdd, (reaction, user) => {
      if (reaction.emoji.name !== DoneReaction) return;
      const request = this.requests.find(reaction.message.id);
      if (!request) return;
      request.isDone = true;
      this.broadcast({ type: BroadcastType.UpdateMessage, request });
      console.log(`Updated message (reaction-add ${reaction.emoji.name}): ${request.user} ${request.id}`);
    });

    // Listen for reactions being removed from messages
    this.client.on(Events.MessageReactionRemove, (reaction, user) => {
      if (reaction.emoji.name !== DoneReaction) return;
      if (reaction.partial || reaction.count > 0) return;
      const request = this.requests.find(reaction.message.id);
      if (!request) return;
      request.isDone = false;
      this.broadcast({ type: BroadcastType.UpdateMessage, request });
      console.log(`Updated message (reaction-rem ${reaction.emoji.name}): ${request.user} ${request.id}`);
    });

    // When a moderator removes a specific emoji from a message
    this.client.on(Events.MessageReactionRemoveEmoji, m => {
      if (m.emoji.name !== DoneReaction) return;
      const request = this.requests.find(m.message.id);
      if (!request) return;
      request.isDone = false;
      this.broadcast({ type: BroadcastType.UpdateMessage, request });
      console.log(`Updated message (reaction-rem-all ${m.emoji.name}): ${request.user} ${request.id}`);
    });

    // When a moderator clears all reactions from a message
    this.client.on(Events.MessageReactionRemoveAll, m => {
      const request = this.requests.find(m.id);
      if (!request) return;
      request.isDone = false;
      this.broadcast({ type: BroadcastType.UpdateMessage, request });
      console.log(`Updated message (reaction-rem-all): ${request.user} ${request.id}`);
    });

    // Listen for messages being deleted
    this.client.on(Events.MessageDelete, async m => {
      const message = this.requests.find(m.id);
      // If the message is one we're tracking, just remove it
      if (message) {
        this.requests.delete(message.id);
        this.broadcast({ type: BroadcastType.DeleteMessage, id: message.id });
        console.log(`Deleted message: ${message.user}`);
        return;
      }
      // If the message was inside of a thread on a message we're tracking,
      // update the message with any overrides in the thread
      if (m.channel.type !== ChannelType.PublicThread) return;
      const starter = await m.channel.fetchStarterMessage();
      if (!starter) return;
      const request = this.requests.find(starter.id);
      if (!request) return;
      request.override(starter);
      (await m.channel.messages.fetch())
        ?.sort(this.sortMessages)
        .forEach(tm => request.override(tm));
      this.broadcast({ type: BroadcastType.UpdateMessage, request });
      console.log(`Updated message (thread-msg-del): ${request.user} ${request.id}`);
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
            const message = new RequestMessage(m);
            // If the message has a thread, use them as overrides
            (await m.thread?.messages.fetch())
              ?.sort(this.sortMessages)
              .forEach(tm => message.override(tm));
            return message;
          })
        );

      // Store only valid ones (ignore unformatted messages)
      this.requests.massUpdate(parsedMessages.filter(m => m.isValid()));

      // Log the messages for debugging
      this.requests.all()
        .slice(0)
        .sort(RequestMessage.prototype.sort)
        .forEach(message => {
          console.debug(`ID: ${message.id} | User: ${message.user} | Request: ${message.shortDescription} | Date: ${message.shortDate()} | ${message.isDone ? DoneReaction : ''}`);
        });
    } catch (error) {
      console.error('Error fetching messages:', error);
    }
  };

  async setDone(request: RequestMessage) {
    const message = await this.channel?.messages.fetch(request.id);
    await message?.react(DoneReaction);
    console.log(`Marked done (${DoneReaction}): ${request.user} ${request.id}`);
  }

  sortMessages(a: Message, b: Message) {
    return +(a.createdTimestamp || 0) - +(b.createdTimestamp || 0);
  }

  broadcast(message: object) {
    if (!this.wss) return;
    this.wss.clients.forEach(client => {
      if (client.readyState !== 1) return;
      client.send(JSON.stringify(message));
    });
  }
}
