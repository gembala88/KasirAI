import { describe, expect, it } from 'vitest';
import { buildTurnPrompt, parseModelJson } from '../src/modules/whatsapp/application/persona.js';

describe('parseModelJson', () => {
  it('parses a clean JSON envelope with no action', () => {
    const result = parseModelJson('{"reply": "halo kak!", "action": null}');
    expect(result).toEqual({ reply: 'halo kak!', action: null });
  });

  it('parses a JSON envelope with a valid action', () => {
    const result = parseModelJson(
      '{"reply": "sebentar ya", "action": {"type": "check_stock", "itemQuery": "minyak goreng"}}',
    );
    expect(result.reply).toBe('sebentar ya');
    expect(result.action).toEqual({ type: 'check_stock', itemQuery: 'minyak goreng' });
  });

  it('strips a markdown code fence small models often add despite instructions', () => {
    const raw = '```json\n{"reply": "oke kak", "action": null}\n```';
    const result = parseModelJson(raw);
    expect(result).toEqual({ reply: 'oke kak', action: null });
  });

  it('drops an action with an unrecognised type rather than dispatching it blindly', () => {
    const result = parseModelJson('{"reply": "hmm", "action": {"type": "delete_everything"}}');
    expect(result.action).toBeNull();
  });

  it('falls back to treating the raw text as the reply when JSON parsing fails entirely', () => {
    const result = parseModelJson('maaf kak, boleh diulang?');
    expect(result).toEqual({ reply: 'maaf kak, boleh diulang?', action: null });
  });
});

describe('buildTurnPrompt', () => {
  it('includes the instruction to use system_data as fact when present', () => {
    const prompt = buildTurnPrompt([], 'ada stok?', { matches: [{ itemCode: 'ITEM-1', stockQty: 5 }] });
    expect(prompt).toContain('system_data');
    expect(prompt).toContain('ITEM-1');
  });

  it('omits system_data instructions on the first turn', () => {
    const prompt = buildTurnPrompt([], 'halo', undefined);
    expect(prompt).not.toContain('system_data');
  });
});
