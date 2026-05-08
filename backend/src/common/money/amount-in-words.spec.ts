import { amountInWords } from './amount-in-words';

// ---------------------------------------------------------------------------
// Contract for `amountInWords`. The frontend has a parallel copy at
// `frontend/lib/amount-in-words.ts` — both must produce identical output
// for every input below. If a behaviour change is intended, update both
// implementations AND extend these tests.
//
// Cases are grouped by what they're defending:
//   • Boundary values (0, 1, 100, 1000, 100000+) — explicitly requested
//   • Lakh/crore place values (Indian numbering)
//   • Decimal handling (paisa, rounding, float drift)
//   • Sign + sentinel inputs (NaN / Infinity)
//   • Range guard (above 99 crore falls back to numerals)
//   • Options (currency override, suffix override)
// ---------------------------------------------------------------------------

describe('amountInWords', () => {
  describe('boundary values', () => {
    it('formats 0 as "Rupees Zero Only"', () => {
      expect(amountInWords(0)).toBe('Rupees Zero Only');
    });

    it('formats 1 as "Rupees One Only"', () => {
      expect(amountInWords(1)).toBe('Rupees One Only');
    });

    it('formats 100 as "Rupees One Hundred Only"', () => {
      expect(amountInWords(100)).toBe('Rupees One Hundred Only');
    });

    it('formats 1000 as "Rupees One Thousand Only"', () => {
      expect(amountInWords(1000)).toBe('Rupees One Thousand Only');
    });

    it('formats 100000 as "Rupees One Lakh Only"', () => {
      expect(amountInWords(100_000)).toBe('Rupees One Lakh Only');
    });

    it('formats 1000000 as "Rupees Ten Lakh Only" (NOT "One Million")', () => {
      // The Indian-numbering choice is the whole point — guard it
      // explicitly so a future "let's go international" PR doesn't
      // silently break receipt formatting.
      expect(amountInWords(1_000_000)).toBe('Rupees Ten Lakh Only');
    });

    it('formats 10000000 as "Rupees One Crore Only"', () => {
      expect(amountInWords(10_000_000)).toBe('Rupees One Crore Only');
    });
  });

  describe('mixed place values', () => {
    it('handles three places combined', () => {
      // 1,23,456 → 1 lakh 23 thousand 456
      expect(amountInWords(123_456)).toBe(
        'Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six Only',
      );
    });

    it('handles all four place values combined', () => {
      // 1,23,45,678 → 1 crore 23 lakh 45 thousand 678
      expect(amountInWords(12_345_678)).toBe(
        'Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only',
      );
    });

    it('skips zero chunks cleanly', () => {
      // 1,00,001 → 1 lakh + 0 thousand + 0 hundred + 1
      // Must NOT print "Zero Thousand" or trailing spaces.
      expect(amountInWords(100_001)).toBe('Rupees One Lakh One Only');
    });

    it('skips the lakh chunk when it is zero', () => {
      // 1,00,01,000 = 1 crore + 0 lakh + 1 thousand
      expect(amountInWords(10_001_000)).toBe(
        'Rupees One Crore One Thousand Only',
      );
    });

    it('handles teens correctly inside larger numbers', () => {
      // 19 must read as "Nineteen", not "Ten Nine"
      expect(amountInWords(1_019)).toBe(
        'Rupees One Thousand Nineteen Only',
      );
    });
  });

  describe('decimals (2dp policy)', () => {
    it('renders paisa when present', () => {
      expect(amountInWords(100.5)).toBe(
        'Rupees One Hundred and Fifty Paisa Only',
      );
    });

    it('renders single-digit paisa with explicit zero', () => {
      // 100.05 → 5 paisa, but "Five Paisa" not "Zero Five"
      expect(amountInWords(100.05)).toBe(
        'Rupees One Hundred and Five Paisa Only',
      );
    });

    it('rounds to 2dp (no dangling thirds)', () => {
      // 100.999 → 101.00 (rounded), not "100 and 99.9 Paisa"
      expect(amountInWords(100.999)).toBe('Rupees One Hundred One Only');
    });

    it('survives float drift (0.1 + 0.2 territory)', () => {
      const drift = 0.1 + 0.2; // 0.30000000000000004
      // After rounding: 0.30 → "Thirty Paisa"
      expect(amountInWords(drift)).toBe('Rupees Zero and Thirty Paisa Only');
    });

    it('omits paisa block when fractional part rounds to 0', () => {
      // 100.004 → 100.00 → no "and 0 Paisa" tail
      expect(amountInWords(100.004)).toBe('Rupees One Hundred Only');
    });
  });

  describe('sign and sentinels', () => {
    it('prefixes negative amounts with "Negative"', () => {
      expect(amountInWords(-12)).toBe('Negative Rupees Twelve Only');
    });

    it('returns the dash sentinel for NaN', () => {
      expect(amountInWords(Number.NaN)).toBe('—');
    });

    it('returns the dash sentinel for Infinity', () => {
      expect(amountInWords(Number.POSITIVE_INFINITY)).toBe('—');
      expect(amountInWords(Number.NEGATIVE_INFINITY)).toBe('—');
    });
  });

  describe('range guard', () => {
    it('falls back to numerals above 99 crore', () => {
      // 1,00,00,00,00,000 (one trillion paisa? — far past the practical
      // range). The implementation gives up on words and prints the
      // numeric form instead, so the receipt never says something
      // unrecognisable.
      const result = amountInWords(100_000_000_000);
      expect(result).toMatch(/^Rupees [\d,]+(\.\d{2})? Only$/);
    });

    it('still uses words at the upper edge of the supported range', () => {
      // 99 crore exactly — the largest value that should produce words.
      expect(amountInWords(990_000_000)).toBe(
        'Rupees Ninety Nine Crore Only',
      );
    });
  });

  describe('options', () => {
    it('respects a custom currency name', () => {
      expect(amountInWords(50, { currency: 'Dollars' })).toBe(
        'Dollars Fifty Only',
      );
    });

    it('omits the currency word when currency is empty', () => {
      expect(amountInWords(50, { currency: '' })).toBe('Fifty Only');
    });

    it('respects a custom suffix', () => {
      expect(amountInWords(50, { suffix: 'Net' })).toBe('Rupees Fifty Net');
    });

    it('respects a custom subunit name', () => {
      expect(amountInWords(50.25, { subunit: 'Cents' })).toBe(
        'Rupees Fifty and Twenty Five Cents Only',
      );
    });
  });
});
