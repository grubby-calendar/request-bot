import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiRouter } from './api/ApiRouter.ts';
import { DiscordBot } from './bot/DiscordBot.ts';
import { WebSocketServer } from 'ws';

const app = express();
const PORT = process.env.PORT || 3111;

// Get the directory name of the current module file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Start the Discord bot
const discordBot = new DiscordBot;
discordBot.start();

// Wire up the API routes
app.use(express.json());
const apiRouter = new ApiRouter(discordBot);
app.use('/api', apiRouter.getRouter());

// Start the HTTP server
const server = app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

// Start the WebSocket server
const wss = new WebSocketServer({ server });
wss.on('connection', ws => {
  console.log('Client connected');
});

// Connect WS with the bot for broadcasting
discordBot.setWebSocketServer(wss);
