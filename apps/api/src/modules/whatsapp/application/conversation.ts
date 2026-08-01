/**
 * Conversation orchestration (spec §7 flows, §8 persona). One inbound
 * message can take one or two AI Gateway turns:
 *   Turn A — model sees history + the new message, replies with
 *            {reply, action}. If action is null, turn A's reply is final.
 *   Turn B — if action was set, this layer executes it (actions.ts)
 *            against the real modules/ERPNext, then calls the model again
 *            with the result as "system_data" so the final reply is
 *            grounded in real data (never fabricated, per ATURAN MUTLAK).
 */
import { env } from '../../../config/env.js';
import { logger } from '../../../shared/logger/index.js';
import { runAiQuery } from '../../ai-gateway/interfaces/index.js';
import { executeConversationAction } from './actions.js';
import { buildTurnPrompt, HERMES_SYSTEM_PROMPT, parseModelJson, type ParsedTurn } from './persona.js';
import {
  appendConversationLog,
  getOrCreateSession,
  getRecentConversation,
  logNotification,
} from '../infrastructure/sessions.js';
import { sendTextMessage } from '../infrastructure/whatsapp-client.js';

async function runPersonaTurn(
  history: Parameters<typeof buildTurnPrompt>[0],
  userMessage: string,
  systemData: unknown,
): Promise<ParsedTurn> {
  const prompt = buildTurnPrompt(history, userMessage, systemData);
  const response = await runAiQuery(prompt, HERMES_SYSTEM_PROMPT);
  return parseModelJson(response.text);
}

export async function handleInboundMessage(phoneNumber: string, text: string): Promise<void> {
  logNotification(phoneNumber, 'inbound', 'text', text, 'received');
  appendConversationLog(phoneNumber, 'user', text);

  const session = getOrCreateSession(phoneNumber);
  const history = getRecentConversation(phoneNumber, env.WHATSAPP_CONVERSATION_HISTORY_TURNS);

  let finalReply: string;
  try {
    const turnA = await runPersonaTurn(history, text, undefined);

    if (turnA.action) {
      logger.info({ phoneNumber, action: turnA.action.type }, 'whatsapp.conversation_action');
      const systemData = await executeConversationAction(phoneNumber, session, turnA.action);
      const turnB = await runPersonaTurn(history, text, systemData);
      finalReply = turnB.reply;
    } else {
      finalReply = turnA.reply;
    }
  } catch (error) {
    logger.error({ phoneNumber, error }, 'whatsapp.conversation_turn_failed');
    finalReply = 'Maaf kak, lagi ada gangguan sistem di sisi kami. Coba lagi sebentar ya 🙏';
  }

  appendConversationLog(phoneNumber, 'assistant', finalReply);

  try {
    await sendTextMessage(phoneNumber, finalReply);
    logNotification(phoneNumber, 'outbound', 'text', finalReply, 'sent');
  } catch (error) {
    // The inbound message was still received/logged/replied-to internally;
    // a failed *send* shouldn't fail the whole webhook delivery (Meta
    // would just retry redelivering the same inbound message).
    logger.error({ phoneNumber, error }, 'whatsapp.send_failed');
    logNotification(phoneNumber, 'outbound', 'text', finalReply, 'failed');
  }
}
