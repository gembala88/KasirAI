/**
 * Sales/POS module — domain layer (spec §1.3 FR-1).
 */

export type CustomerTier = 'Retail' | 'Grosir' | 'Member';

export const CUSTOMER_TIERS: CustomerTier[] = ['Retail', 'Grosir', 'Member'];

export interface ProductSearchResult {
  itemCode: string;
  itemName: string;
  stockUom: string;
  priceList: string;
  price: number | null;
}

export interface ProductPrice {
  itemCode: string;
  priceList: string;
  price: number | null;
}

export interface CartLineInput {
  itemCode: string;
  qty: number;
  /** Explicit rate override; resolved automatically from the tier's Price List when omitted. */
  rate?: number | undefined;
  warehouse?: string | undefined;
}

export interface PaymentInput {
  modeOfPayment: string;
  amount: number;
}

export interface PosTransaction {
  name: string;
  status: string;
  customer: string;
  grandTotal: number;
  paidAmount: number;
  outstandingAmount: number;
  /** Source Sales Order name, set only for invoices created via the WhatsApp payment flow (§10 Phase 6). */
  poNo?: string;
  /** Customer's phone number, for the dashboard's payment-confirmation UI (§10 Phase 7) to notify without a second lookup. */
  contactMobile?: string;
}
