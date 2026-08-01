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
  buildPaymentInstructionReply,
  containsUnverifiedPaymentDetails,
  isSuccessfulPaymentResult,
  SAFE_PAYMENT_FALLBACK_REPLY,
  shouldSendQrisImage,
} from './payment-reply.js';
import {
  appendConversationLog,
  getOrCreateSession,
  getRecentConversation,
  logNotification,
} from '../infrastructure/sessions.js';
import { sendImageMessage, sendTextMessage } from '../infrastructure/whatsapp-client.js';

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
  let sendAsQrisImage = false;

  try {
    const turnA = await runPersonaTurn(history, text, undefined);

    if (turnA.action) {
      logger.info({ phoneNumber, action: turnA.action.type }, 'whatsapp.conversation_action');
      const systemData = await executeConversationAction(phoneNumber, session, turnA.action);

      if (turnA.action.type === 'initiate_payment' && isSuccessfulPaymentResult(systemData)) {
        // Payment details are never taken from the model's own words —
        // always assembled from the real result, even if the model's
        // turn-B reply happens to also be correct. See payment-reply.ts.
        finalReply = buildPaymentInstructionReply(systemData);
        sendAsQrisImage = shouldSendQrisImage(systemData);
      } else {
        const turnB = await runPersonaTurn(history, text, systemData);
        if (containsUnverifiedPaymentDetails(turnB.reply)) {
          logger.warn(
            { phoneNumber, action: turnA.action.type, reply: turnB.reply },
            'whatsapp.blocked_unverified_payment_details',
          );
          finalReply = SAFE_PAYMENT_FALLBACK_REPLY;
        } else {
          finalReply = turnB.reply;
        }
      }
    } else if (containsUnverifiedPaymentDetails(turnA.reply)) {
      logger.warn({ phoneNumber, reply: turnA.reply }, 'whatsapp.blocked_unverified_payment_details');
      finalReply = SAFE_PAYMENT_FALLBACK_REPLY;
    } else {
      finalReply = turnA.reply;
    }
  } catch (error) {
    logger.error({ phoneNumber, error }, 'whatsapp.conversation_turn_failed');
    finalReply = 'Maaf kak, lagi ada gangguan sistem di sisi kami. Coba lagi sebentar ya 🙏';
  }

  appendConversationLog(phoneNumber, 'assistant', finalReply);

  try {
    if (sendAsQrisImage) {
      await sendImageMessage(phoneNumber, env.QRIS_STATIC_IMAGE_URL, finalReply);
    } else {
      await sendTextMessage(phoneNumber, finalReply);
    }
    logNotification(phoneNumber, 'outbound', 'text', finalReply, 'sent');
  } catch (error) {
    // The inbound message was still received/logged/replied-to internally;
    // a failed *send* shouldn't fail the whole webhook delivery (Meta
    // would just retry redelivering the same inbound message).
    logger.error({ phoneNumber, error }, 'whatsapp.send_failed');
    logNotification(phoneNumber, 'outbound', 'text', finalReply, 'failed');
  }
}
