/**
 * WhatsApp module — infrastructure layer.
 *
 * ERPNext client adapters, repositories, external service clients.
 * Other modules must never import from here directly — only through
 * `../interfaces`.
 */
export { sendTextMessage, sendImageMessage, WhatsAppApiError } from './whatsapp-client.js';
export {
  getOrCreateSession,
  updateSession,
  appendConversationLog,
  getRecentConversation,
  logNotification,
} from './sessions.js';
