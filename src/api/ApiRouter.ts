import express from 'express';
import type { DiscordBot } from '../bot/DiscordBot.ts';

export class ApiRouter {
  router: express.Router;
  discordBot: DiscordBot;

  constructor(discordBot: DiscordBot) {
    this.discordBot = discordBot;
    this.router = express.Router();
    this.setupRoutes();
  }

  setupRoutes() {
    this.router.get('/data', (req, res) => {
      res.json({
        timestamp: new Date().toISOString(),
        requests: this.discordBot.requests.all(),
      });
    });
  }

  getRouter() {
    return this.router;
  }
}
