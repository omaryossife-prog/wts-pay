// إخفاء رقم الطرف التاني في العملية للمستخدم العادي.
// +201220994778  ->  012***4778
// الأدمن بيشوف الرقم كامل زي ما هو (endpoints الأدمن ما بتستخدمش الدالة دي).
export function maskPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");

  // مصر: +20 ثم 10 أرقام -> نحولها لشكل محلي بصفر في الأول (11 رقم)
  let local = digits;
  if (digits.length === 12 && digits.startsWith("20")) {
    local = "0" + digits.slice(2);
  }

  if (local.length < 7) return "***";
  const first = local.slice(0, 3);
  const last = local.slice(-4);
  return `${first}***${last}`;
}
