/**
 * Validates the calendar date rather than relying on Date.parse(), which
 * accepts values such as 2026-02-31 in some browsers.
 */
export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  const responseError = (error as {
    response?: { data?: { error?: unknown } };
    message?: unknown;
  })?.response?.data?.error;

  if (typeof responseError === 'string' && responseError.trim()) return responseError;
  if (typeof (error as { message?: unknown })?.message === 'string') {
    const message = String((error as { message: string }).message).trim();
    if (message) return message;
  }
  return fallback;
}