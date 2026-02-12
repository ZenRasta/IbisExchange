import { Context, SessionFlavor } from 'grammy';
import { ConversationFlavor } from '@grammyjs/conversations';

/**
 * Session data persisted in Redis
 */
export interface SessionData {
  /** Selected payment methods during sell flow */
  selectedPaymentMethods?: string[];
}

/**
 * Base context with session flavor (before conversation flavor)
 */
type BaseContext = Context & SessionFlavor<SessionData>;

/**
 * Custom bot context type with session and conversation flavors
 */
export type BotContext = ConversationFlavor<BaseContext>;
