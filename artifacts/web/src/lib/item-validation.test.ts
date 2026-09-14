import { describe, expect, it } from 'vitest';
import { getApiErrorMessage, isValidIsoDate } from './item-validation';

describe('item validation helpers', () => {
  it('accepts real ISO calendar dates', () => {
    expect(isValidIsoDate('2026-02-28')).toBe(true);
    expect(isValidIsoDate('2024-02-29')).toBe(true);
  });

  it('rejects malformed and impossible dates', () => {
    expect(isValidIsoDate('2026-02-31')).toBe(false);
    expect(isValidIsoDate('2025-02-29')).toBe(false);
    expect(isValidIsoDate('26-02-28')).toBe(false);
  });

  it('prefers a server validation message and otherwise uses the fallback', () => {
    expect(getApiErrorMessage({ response: { data: { error: 'رمز المادة مستخدم مسبقاً' } } }, 'خطأ')).toBe(
      'رمز المادة مستخدم مسبقاً',
    );
    expect(getApiErrorMessage({}, 'تعذر الحفظ')).toBe('تعذر الحفظ');
  });
});