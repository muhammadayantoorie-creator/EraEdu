export type SafepayPaymentStatus = 'pending' | 'paid' | 'failed' | 'cancelled';

/**
 * Converts Safepay's authoritative tracker state into the limited states we
 * persist. A browser return URL is deliberately not an input here.
 */
export const paymentStatusFromTrackerState = (state: unknown): SafepayPaymentStatus => {
  switch (state) {
    case 'TRACKER_ENDED':
      return 'paid';
    case 'TRACKER_CANCELLED':
      return 'cancelled';
    case 'TRACKER_EXPIRED':
    case 'TRACKER_REVERSED':
    case 'TRACKER_VOIDED':
      return 'failed';
    default:
      // TRACKER_STARTED, TRACKER_AUTHORIZED and TRACKER_ENROLLED can still
      // complete. Unknown new states are also safer as pending until Safepay
      // documents their terminal meaning.
      return 'pending';
  }
};
