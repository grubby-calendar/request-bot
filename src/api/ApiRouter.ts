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

    this.router.post('/done', (req, res) => {
      const { id } = req.body;
      const request = this.discordBot.requests.find(id);
      if (!request) {
        res.status(404).json({ error: 'Not found' });
        return;
      }

      this.discordBot.setDone(request);
      res.json({ status: 'ok' });
    });
  }

  getRouter() {
    return this.router;
  }
}
