import type { ScanAction } from './types';

const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

const ENDPOINTS: Record<ScanAction['type'], string> = {
  'add-stock': '/api/v1/inventory/scan/add-stock',
  'reduce-stock': '/api/v1/inventory/scan/reduce-stock',
  transfer: '/api/v1/inventory/scan/transfer',
};

export async function submitScanAction(action: ScanAction): Promise<void> {
  const { type, ...payload } = action;
  const response = await fetch(`${API_BASE_URL}${ENDPOINTS[type]}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Scan action failed with status ${response.status}`);
  }
}
