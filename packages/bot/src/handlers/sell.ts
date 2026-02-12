import type { BotContext } from '../types';

export async function sellHandler(ctx: BotContext): Promise<void> {
  try {
    await ctx.conversation.enter('sellFlow');
  } catch (err) {
    console.error('Failed to enter sell conversation:', err);
    await ctx.reply('Something went wrong. Please try again with /sell.');
  }
}
