import { describe, expect, it } from 'vitest';
import { validateUsername } from './user-validation';

describe('username validation', () => {
  it('accepts the shared username format', () => {
    expect(validateUsername('warehouse.manager_1')).toBeNull();
  });

  it('rejects empty, short, and unsafe usernames', () => {
    expect(validateUsername('')).toContain('مطلوب');
    expect(validateUsername('ab')).toContain('3 إلى 32');
    expect(validateUsername('مدير-المستودع')).toContain('يبدأ بحرف لاتيني');
  });
});