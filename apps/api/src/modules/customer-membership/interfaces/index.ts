export { registerCustomerMembershipRoutes } from './customer-membership.routes.js';

// Callable exports for other modules (whatsapp's conversation actions, §7).
export {
  getCustomerProfile,
  createCustomer,
  findCustomerByMobile,
  getPurchaseHistory,
} from '../application/customers.js';

// Background job lifecycle (piutang reminders, §7) — a separate concern
// from HTTP routes, but still only reachable through this module boundary;
// the app bootstrap never imports customer-membership/infrastructure
// directly (§2.1, §3.3).
import {
  closePiutangReminderQueue,
  scheduleRepeatingPiutangCheck,
  startPiutangReminderWorker,
} from '../infrastructure/index.js';

export async function startCustomerMembershipBackgroundJobs(): Promise<void> {
  startPiutangReminderWorker();
  await scheduleRepeatingPiutangCheck();
}

export async function stopCustomerMembershipBackgroundJobs(): Promise<void> {
  await closePiutangReminderQueue();
}
