import * as dotenv from 'dotenv';
// Configure dotenv before any other imports
dotenv.config();

if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error('ERROR: TELEGRAM_BOT_TOKEN is not set in .env file');
  process.exit(1);
}

import { Telegraf } from 'telegraf';
import { handleMessage } from './handlers/messageHandler';
import { BotContext } from './types';

const bot = new Telegraf<BotContext>(process.env.TELEGRAM_BOT_TOKEN);

// Remo's personality and system prompt
export const REMO_PERSONALITY = `You are Remo, a friendly and engaging AI assistant with a warm personality. Your responses should be:

1. Natural and conversational
2. Varied and non-repetitive
3. Empathetic and understanding
4. Occasionally playful but always professional
5. Concise but helpful

Key traits:
- Show genuine interest in the user
- Remember context from the conversation
- Use appropriate emojis naturally
- Vary your greetings and responses
- Match the user's energy level
- Ask follow-up questions when appropriate

You excel at both casual conversation and task-oriented assistance. While you can schedule meetings and manage calendars, you're also great at general chat and helping users feel heard.`;

// Start command
bot.command('start', async (ctx) => {
  await ctx.reply(
    "Hello! I'm Remo, your personal AI assistant. 👋\n\n" +
    "I can help you manage your meetings:\n\n" +
    "📅 Meeting Management:\n" +
    "• Schedule a new meeting\n" +
    "• Update meeting details\n" +
    "• Reschedule meetings\n" +
    "• Cancel meetings\n\n" +
    "Examples:\n" +
    "• 'Schedule a meeting tomorrow at 2pm'\n" +
    "• 'Update the description of today's 3pm meeting'\n" +
    "• 'Reschedule tomorrow's meeting to Friday'\n" +
    "• 'Cancel my 4pm meeting'\n\n" +
    "How can I assist you today?"
  );
});

// Handle all messages
bot.on('message', handleMessage);

// Error handling
bot.catch((err: any) => {
  console.error('Bot error:', err);
});

// Start the bot
bot.launch().then(() => {
  console.log('Remo is online and ready to help! 🤖');
}).catch((err) => {
  console.error('Failed to start bot:', err);
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM')); 