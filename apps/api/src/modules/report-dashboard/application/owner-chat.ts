/**
 * Owner chat analytics orchestration (spec §1.3 FR-6, §6 "POST /ai/query").
 * Same two-turn shape as the WhatsApp persona (`whatsapp/application/
 * conversation.ts`): turn A can request real data via a structured
 * action; if it does, this layer runs the real query and calls the model
 * again with the result as "system_data" so the answer is grounded. No
 * session/history here — each HTTP request is a single, stateless Q&A
 * (FR-6 doesn't call for conversation memory the way WhatsApp's
 * multi-turn ordering flow does).
 */
import { runAiQuery } from '../../ai-gateway/interfaces/index.js';
import { getDashboardSummary, getSalesReport } from './queries.js';
import { OWNER_CHAT_SYSTEM_PROMPT } from './owner-persona.js';

type OwnerChatAction =
  { type: 'get_dashboard_summary' } | { type: 'get_sales_report'; from: string; to: string };

interface ParsedOwnerTurn {
  reply: string;
  action: OwnerChatAction | null;
}

function isOwnerChatAction(value: unknown): value is OwnerChatAction {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }
  const type = (value as { type: unknown }).type;
  return type === 'get_dashboard_summary' || type === 'get_sales_report';
}

/**
 * Same small-model robustness handling as parseModelJson in
 * whatsapp/application/persona.ts (strips a markdown fence, falls back
 * to raw text as the reply on parse failure) — duplicated rather than
 * imported cross-module, since it's small and each module's persona
 * stays self-contained.
 */
function parseOwnerModelJson(text: string): ParsedOwnerTurn {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();

  try {
    const parsed = JSON.parse(stripped) as { reply?: unknown; action?: unknown };
    const reply = typeof parsed.reply === 'string' ? parsed.reply : stripped;
    const action = isOwnerChatAction(parsed.action) ? parsed.action : null;
    return { reply, action };
  } catch {
    return { reply: stripped, action: null };
  }
}

function buildPrompt(question: string, systemData: unknown): string {
  const parts = [`Pertanyaan owner: ${question}`];
  if (systemData !== undefined) {
    parts.push(
      `system_data (hasil query nyata, gunakan ini sebagai fakta, jangan mengarang angka lain):\n${JSON.stringify(systemData)}`,
    );
    parts.push(
      'Sekarang jawab owner dengan JSON final. Isi "action": null karena data yang dibutuhkan sudah ada di system_data.',
    );
  }
  return parts.join('\n\n');
}

async function runOwnerTurn(question: string, systemData: unknown): Promise<ParsedOwnerTurn> {
  const response = await runAiQuery(buildPrompt(question, systemData), OWNER_CHAT_SYSTEM_PROMPT);
  return parseOwnerModelJson(response.text);
}

async function executeOwnerChatAction(action: OwnerChatAction): Promise<unknown> {
  switch (action.type) {
    case 'get_dashboard_summary':
      return getDashboardSummary();
    case 'get_sales_report':
      return getSalesReport(action.from, action.to);
    default: {
      const exhaustive: never = action;
      return { error: 'unsupported_action', type: String((exhaustive as OwnerChatAction).type) };
    }
  }
}

export async function answerOwnerQuestion(question: string): Promise<{ reply: string }> {
  const turnA = await runOwnerTurn(question, undefined);

  if (!turnA.action) {
    return { reply: turnA.reply };
  }

  const systemData = await executeOwnerChatAction(turnA.action);
  const turnB = await runOwnerTurn(question, systemData);
  return { reply: turnB.reply };
}
