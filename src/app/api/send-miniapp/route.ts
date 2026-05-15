import { bot } from "@/lib/bot";
import { NextResponse } from "next/server";

export async function GET() {
  await bot.sendMessage("@testapp1234333", "🚀 Test Mini App", {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "Open App",
            web_app: {
                url: "https://my-telegram-local.com"
                }
          },
        ],
      ],
    },
  });

  return NextResponse.json({ ok: true });
}