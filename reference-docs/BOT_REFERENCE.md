# BOT_REFERENCE.md — Telegram Bot Technical Reference

## Stack

- **Framework:** grammY v1.39.x
- **Conversations:** @grammyjs/conversations v2.1.x
- **Session storage:** @grammyjs/storage-redis
- **Rate limiting:** @grammyjs/auto-retry (Telegram API), @grammyjs/ratelimiter (user)

## grammY Quick Reference

```typescript
import { Bot, Context, session, InlineKeyboard, webhookCallback } from 'grammy';
import { conversations, createConversation } from '@grammyjs/conversations';

const bot = new Bot('TOKEN');

// Command handler
bot.command('start', (ctx) => ctx.reply('Hello!'));

// Callback query (inline button press)
bot.callbackQuery(/^action:(.+)$/, (ctx) => {
    const param = ctx.match[1];
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('Updated!');
});

// Inline keyboard
const kb = new InlineKeyboard()
    .text('Button', 'callback_data')
    .row()
    .webApp('Open App', 'https://your-mini-app.com');

// Send with keyboard
await ctx.reply('Choose:', { reply_markup: kb });

// Webhook mode
import express from 'express';
const app = express();
app.use(express.json());
app.use(`/webhook/${bot.token}`, webhookCallback(bot, 'express'));
app.listen(8000, () => bot.api.setWebhook(`https://domain/webhook/${bot.token}`));
```

## Conversations (Multi-Step Flows)

```typescript
import { type Conversation, type ConversationFlavor } from '@grammyjs/conversations';

type MyConversation = Conversation<MyContext>;

async function sellFlow(conversation: MyConversation, ctx: MyContext) {
    await ctx.reply('How much USDT?');
    const amountCtx = await conversation.waitFor('message:text');
    const amount = Number(amountCtx.message.text);
    
    // Wait for specific callback
    const confirmCtx = await conversation.waitForCallbackQuery(/^confirm/);
    await confirmCtx.answerCallbackQuery();
    
    // External calls must be wrapped
    const result = await conversation.external(() => db.orders.create({...}));
}

bot.use(conversations());
bot.use(createConversation(sellFlow));
bot.command('sell', (ctx) => ctx.conversation.enter('sellFlow'));
```

## Telegram Bot API Rate Limits

- 30 messages/second to different chats
- ~1 message/second to same chat
- 20 messages/minute to same group
- autoRetry plugin handles 429 responses automatically

## Mini App Web App Button

```typescript
const kb = new InlineKeyboard().webApp('📊 Open Exchange', MINI_APP_URL);
// OR with specific path:
const kb = new InlineKeyboard().webApp('🔒 Lock Escrow', `${MINI_APP_URL}/trade/${tradeId}`);
```

## Message Formatting

Use MarkdownV2 or HTML:
```typescript
await ctx.reply('<b>Bold</b> and <code>code</code>', { parse_mode: 'HTML' });
// Characters to escape in MarkdownV2: _ * [ ] ( ) ~ ` > # + - = | { } . !
```

## Useful grammY Plugins

- `@grammyjs/auto-retry` — handles Telegram 429 rate limits
- `@grammyjs/ratelimiter` — limit user requests (anti-spam)
- `@grammyjs/storage-redis` — persistent sessions
- `@grammyjs/runner` — concurrent update processing (advanced)
