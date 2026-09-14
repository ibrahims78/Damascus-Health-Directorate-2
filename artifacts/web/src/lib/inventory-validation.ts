export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateExceptionMovement({
  quantity,
  date,
  reason,
  available,
  serialised,
}: {
  quantity: number;
  date: string;
  reason: string;
  available: number | null;
  serialised?: boolean;
}): string | null {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    return 'يجب أن تكون الكمية عددًا صحيحًا أكبر من الصفر';
  }
  if (serialised && quantity !== 1) {
    return 'التجهيز ذو الرقم التسلسلي يمثل وحدة واحدة فقط';
  }
  if (available !== null && quantity > available) {
    return `الكمية المطلوبة تتجاوز المتاح (${available})`;
  }
  if (!isValidIsoDate(date)) {
    return 'التاريخ غير صالح';
  }
  if (reason.trim().length < 5) {
    return 'رقم المحضر مطلوب ويجب أن يكون واضحًا (5 أحرف على الأقل)';
  }
  return null;
}