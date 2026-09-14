import { describe, expect, it } from 'vitest';
import { isValidIsoDate, maintenanceDateError, serialQuantityError } from './equipment-validation';

describe('equipment validation', () => {
  it('accepts real calendar dates and rejects impossible dates', () => {
    expect(isValidIsoDate('2026-02-28')).toBe(true);
    expect(isValidIsoDate('2026-02-29')).toBe(false);
    expect(isValidIsoDate('2026-2-2')).toBe(false);
  });

  it('keeps maintenance dates in chronological order', () => {
    expect(maintenanceDateError('2026-03-10', '2026-03-09')).toBe(
      'تاريخ الإعادة من الصيانة لا يمكن أن يسبق تاريخ الإرسال',
    );
    expect(maintenanceDateError('2026-03-10', '2026-03-10')).toBeNull();
  });

  it('limits serialised equipment to one unit', () => {
    expect(serialQuantityError('SN-1', 2)).toBe(
      'التجهيز ذو الرقم التسلسلي يجب أن تكون كميته 1 فقط',
    );
    expect(serialQuantityError('SN-1', 1)).toBeNull();
  });
});