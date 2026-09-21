// The public Telegram bot that sends alerts. Override with VITE_TELEGRAM_BOT
// (see .env.example) if the bot is ever renamed.
export const TELEGRAM_BOT = String(import.meta.env?.VITE_TELEGRAM_BOT || "tokenlens_bot").replace(/^@/, "");
