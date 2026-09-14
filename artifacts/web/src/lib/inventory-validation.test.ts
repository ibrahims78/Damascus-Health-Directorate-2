import { describe, expect, it } from 'vitest';
import { isValidIsoDate, validateExceptionMovement } from './inventory-validation';

describe('exception movement validation', () => {
  it('rejects impossible dates', () => {
    expect(isValidIsoDate('2026-02-30')).toBe(false);
    expect(isValidIsoDate('2026-02-28')).toBe(true);
  });

  it('requires a positive integer, valid date, and meaningful reason', () => {
    expect(validateExceptionMovement({
      quantity: 0,
      date: '2026-09-05',
      reason: 'جرد فعلي',
      available: 5,
    })).toContain('عددًا صحيحًا');
    expect(validateExceptionMovement({
      quantity: 1,
      date: '2026-02-30',
      reason: 'جرد فعلي',
      available: 5,
    })).toBe('التاريخ غير صالح');
    expect(validateExceptionMovement({
      quantity: 1,
      date: '2026-09-05',
      reason: 'سبب',
      available: 5,
    })).toContain('5 أحرف');
  });

  it('prevents exceeding available or serialised stock', () => {
    expect(validateExceptionMovement({
      quantity: 6,
      date: '2026-09-05',
      reason: 'تلف مثبت',
      available: 5,
    })).toContain('المتاح');
    expect(validateExceptionMovement({
      quantity: 2,
      date: '2026-09-05',
      reason: 'تلف مثبت',
      available: 5,
      serialised: true,
    })).toContain('وحدة واحدة');
  });
});