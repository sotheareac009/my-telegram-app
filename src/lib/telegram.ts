/* eslint-disable @typescript-eslint/no-require-imports */

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH!;

export function createClient(sessionString: string = "") {
  // Use require to avoid bundler creating duplicate module instances
  // which breaks the instanceof check inside GramJS
  const { TelegramClient } = require("telegram");
  const { StringSession } = require("telegram/sessions");

  const session = new StringSession(sessionString);
  return new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
  }) as import("telegram").TelegramClient;
}
