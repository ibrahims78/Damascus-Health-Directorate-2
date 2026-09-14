const USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{2,31}$/;

export function getUsernamePolicyError(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return "اسم المستخدم مطلوب";
  }
  if (!USERNAME_PATTERN.test(value.trim())) {
    return "اسم المستخدم يجب أن يبدأ بحرف لاتيني ويحتوي 3 إلى 32 رمزًا من الحروف والأرقام و . _ -";
  }
  return null;
}