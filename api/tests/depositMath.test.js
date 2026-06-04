const { depositCentsFor, commissionCentsFor } = require('../src/services/stripe');

// These read DEPOSIT_PERCENT / DEPOSIT_MIN_CENTS / COMMISSION_BPS from the env
// at call time. Pin them here so the math is deterministic regardless of .env.
describe('deposit + commission math (unit)', () => {
  const ENV = process.env;
  beforeEach(() => {
    process.env = { ...ENV, DEPOSIT_PERCENT: '10', DEPOSIT_MIN_CENTS: '5000', COMMISSION_BPS: '800' };
  });
  afterEach(() => { process.env = ENV; });

  describe('depositCentsFor', () => {
    test('10% of the quote midpoint, in cents', () => {
      // midpoint of $4000–$6000 = $5000; 10% = $500 = 50000 cents
      expect(depositCentsFor(4000, 6000)).toBe(50000);
    });

    test('floors small jobs at the minimum', () => {
      // midpoint $200, 10% = $20 = 2000 cents, below the 5000 floor
      expect(depositCentsFor(100, 300)).toBe(5000);
    });

    test('handles a single-point quote (low == high)', () => {
      // $10000 midpoint, 10% = $1000 = 100000 cents
      expect(depositCentsFor(10000, 10000)).toBe(100000);
    });

    test('rounds to whole cents', () => {
      // midpoint $1234.5 → ... ensure integer output
      const cents = depositCentsFor(1000, 1469);
      expect(Number.isInteger(cents)).toBe(true);
    });

    test('respects a custom DEPOSIT_PERCENT', () => {
      process.env.DEPOSIT_PERCENT = '20';
      // midpoint $5000, 20% = $1000 = 100000 cents
      expect(depositCentsFor(4000, 6000)).toBe(100000);
    });
  });

  describe('commissionCentsFor', () => {
    test('8% of the deposit (fee on top)', () => {
      expect(commissionCentsFor(50000)).toBe(4000);
    });

    test('rounds to whole cents', () => {
      // 8% of 12345 = 987.6 → 988
      expect(commissionCentsFor(12345)).toBe(988);
    });

    test('respects a custom COMMISSION_BPS', () => {
      process.env.COMMISSION_BPS = '500'; // 5%
      expect(commissionCentsFor(50000)).toBe(2500);
    });

    test('the homeowner total is deposit + commission, contractor nets the deposit', () => {
      const deposit = depositCentsFor(4000, 6000); // 50000
      const commission = commissionCentsFor(deposit); // 4000
      const charged = deposit + commission; // what the homeowner pays
      expect(charged).toBe(54000);
      // application_fee_amount = commission; contractor receives charged - fee = deposit
      expect(charged - commission).toBe(deposit);
    });
  });
});
