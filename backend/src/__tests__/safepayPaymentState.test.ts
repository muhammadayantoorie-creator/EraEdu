import { paymentStatusFromTrackerState } from '../services/safepayPaymentState';

describe('Safepay tracker payment state', () => {
  it.each([
    ['TRACKER_ENDED', 'paid'],
    ['TRACKER_CANCELLED', 'cancelled'],
    ['TRACKER_EXPIRED', 'failed'],
    ['TRACKER_REVERSED', 'failed'],
    ['TRACKER_VOIDED', 'failed'],
    ['TRACKER_STARTED', 'pending'],
    ['TRACKER_AUTHORIZED', 'pending'],
    ['TRACKER_ENROLLED', 'pending'],
    [undefined, 'pending'],
  ] as const)('maps %s to %s without trusting a browser callback', (state, expected) => {
    expect(paymentStatusFromTrackerState(state)).toBe(expected);
  });
});
