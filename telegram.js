/**
 * A minimal Telegram Bot API client (fetch only, no dependencies).
 * The bot token is a secret: it is used to build the request URL and must
 * never appear in an error message or a log line.
 */

class TelegramError extends Error {
  constructor(method, code, description) {
    super(`Telegram ${method} failed (${code}: ${description})`);
    this.name = "TelegramError";
    this.method = method;
    this.code = code;
    this.description = description;
  }
}

// The user blocked the bot or deleted the chat: there is nobody to notify any more.
function isChatGone(err) {
  return (
    err instanceof TelegramError &&
    (err.code === 403 || (err.code === 400 && /chat not found|user is deactivated/i.test(err.description)))
  );
}

const MAX_TEXT = 4000; // Telegram allows 4096 characters per message

function createTelegramClient({ token, fetchImpl = fetch, timeoutMs = 10000 }) {
  async function call(method, payload = {}) {
    let res;
    try {
      res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new TelegramError(method, 0, "network error"); // the original error can contain the URL
    }
    let body = null;
    try {
      body = await res.json();
    } catch {
      // handled below
    }
    if (!res.ok || !body || body.ok !== true) {
      throw new TelegramError(method, (body && body.error_code) || res.status, (body && body.description) || "request failed");
    }
    return body.result;
  }

  return {
    /** `buttons` is an array of rows; each button is { text, url } or { text, callback_data }. */
    sendMessage(chatId, text, { buttons } = {}) {
      const payload = { chat_id: chatId, text: String(text).slice(0, MAX_TEXT), disable_web_page_preview: true };
      if (buttons && buttons.length) payload.reply_markup = { inline_keyboard: buttons };
      return call("sendMessage", payload);
    },
    answerCallbackQuery(id, text) {
      return call("answerCallbackQuery", { callback_query_id: id, text });
    },
    setWebhook(url, secret) {
      return call("setWebhook", { url, secret_token: secret, allowed_updates: ["message", "callback_query"] });
    },
    getMe() {
      return call("getMe");
    },
  };
}

module.exports = { createTelegramClient, TelegramError, isChatGone };
