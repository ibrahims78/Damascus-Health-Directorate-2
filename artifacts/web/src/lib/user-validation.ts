const USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{2,31}$/;

export function validateUsername(value: string): string | null {
  const username = value.trim();
  if (!username) return 'اسم المستخدم مطلوب';
  if (!USERNAME_PATTERN.test(username)) {
    return 'اسم المستخدم يجب أن يبدأ بحرف لاتيني ويحتوي 3 إلى 32 رمزًا من الحروف والأرقام و . _ -';
  }
  return null;
}