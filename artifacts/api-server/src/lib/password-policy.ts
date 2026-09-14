const PASSWORD_POLICY_ERROR =
  "كلمة المرور يجب أن تكون 12 حرفاً على الأقل وتحتوي حرفاً كبيراً وصغيراً ورقماً ورمزاً";

export function getPasswordPolicyError(password: unknown): string | null {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    !/[A-Z]/.test(password) ||
    !/[a-z]/.test(password) ||
    !/[0-9]/.test(password) ||
    !/[^A-Za-z0-9]/.test(password)
  ) {
    return PASSWORD_POLICY_ERROR;
  }
  return null;
}