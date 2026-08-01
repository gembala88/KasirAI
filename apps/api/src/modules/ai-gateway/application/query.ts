/**
 * Minimal AI query endpoint (spec §6 "POST /ai/query — owner analytics
 * chat") — this phase's concrete way to exercise the provider abstraction
 * and two-level failover for real, not just proving the propose/confirm
 * mechanism works. Full owner-analytics prompt engineering (live ERPNext
 * data grounding, §1.3 FR-6) is a later phase; this just proves the
 * gateway reaches a real provider and returns a real response.
 */
import { buildProviderPools, generateWithFailover } from '../infrastructure/index.js';
import type { AIResponse } from '../providers/index.js';

export async function runAiQuery(prompt: string): Promise<AIResponse> {
  const pools = buildProviderPools();
  return generateWithFailover(pools, { prompt });
}
