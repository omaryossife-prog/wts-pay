function req(name: string, fallback = ""): string {
  const v = process.env[name];
  if (v === undefined || v === "") {
    if (fallback !== "") return fallback;
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
  jwtSecret: req("JWT_SECRET", "dev-only-secret-change-me"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  encryptionKey: req("ENCRYPTION_KEY", "0".repeat(64)),
  whatsapp: {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? "",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? "",
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? "wts-verify-token",
    apiVersion: process.env.WHATSAPP_API_VERSION ?? "v21.0",
  },
};
