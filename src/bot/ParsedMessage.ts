import { Message } from 'discord.js';
import moment from 'moment';

export const DoneReaction = "✅";

export class ParsedMessage {
  id: string = "";
  user: string = "";
  shortDescription: string = "";
  requestDate: Date|null = null;
  isDone: boolean = false;
  extra: string = "";

  constructor(message: Message) {
    this.id = message.id;

    const content = this.parseContent(message.content);

    this.user = this.parseUser(content) ?? "";
    this.shortDescription = this.parseShortDescription(content) ?? "";
    this.requestDate = this.parseDate(content);
    this.isDone = this.parseDone(message);
    this.extra = this.parseExtra(content) ?? "";
  }

  isValid() {
    return this.user !== "" && this.shortDescription !== "";
  }

  override(message: Message) {
    const content = this.parseContent(message.content);

    const user = this.parseUser(content);
    if (user) this.user = user;

    const shortDescription = this.parseShortDescription(content);
    if (shortDescription) this.shortDescription = shortDescription;

    const requestDate = this.parseDate(content);
    if (requestDate) this.requestDate = requestDate;

    const extra = this.parseExtra(content);
    if (extra) this.extra = extra;
  }

  parseContent(content: string) {
    return content.replace(/^\`\`\`/, "").replace(/\`\`\`$/, "").trim();
  }

  parseUser(content: string): string|null {
    return content.match(/(^|\n)User: @?(.*)/)?.[2] ?? null;
  }

  parseShortDescription(content: string): string|null {
    return content.match(/(^|\n)Request: (.*)/)?.[2] ?? null;
  }

  parseDate(content: string): Date|null {
    const requestDate = content.match(/(^|\n)Date: (.*)/)?.[2];
    return requestDate ? new Date(requestDate) : null;
  }

  parseDone(message: Message): boolean {
    return message.reactions.cache.some(reaction => reaction.emoji.name === DoneReaction);
  }

  // Everything following a double newline is considered extra content
  parseExtra(content: string): string|null {
    return content.match(/\n\n([\s\S]*)/)?.[1] ?? null;
  }

  shortDate(): string {
    return this.requestDate ? moment(this.requestDate).format('DD-MMM-YY') : "Unknown";
  }
}
