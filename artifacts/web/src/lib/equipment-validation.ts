export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function maintenanceDateError(
  sentAt?: string | null,
  returnedAt?: string | null,
): string | null {
  if (sentAt && !isValidIsoDate(sentAt)) return 'تاريخ الإرسال للصيانة غير صالح';
  if (returnedAt && !isValidIsoDate(returnedAt)) return 'تاريخ الإعادة من الصيانة غير صالح';
  if (sentAt && returnedAt && returnedAt < sentAt) {
    return 'تاريخ الإعادة من الصيانة لا يمكن أن يسبق تاريخ الإرسال';
  }
  return null;
}

export function serialQuantityError(serialNumber?: string | null, quantity?: number | null): string | null {
  if (serialNumber?.trim() && quantity !== 1) {
    return 'التجهيز ذو الرقم التسلسلي يجب أن تكون كميته 1 فقط';
  }
  return null;
}