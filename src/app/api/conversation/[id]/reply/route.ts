import { NextResponse } from "next/server";
import twilio from "twilio";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function normalizeLang(lang?: string | null): string | null {
  if (!lang) return null;

  const raw = String(lang).trim().toLowerCase();
  if (!raw) return null;

  const aliasMap: Record<string, string> = {
    english: "en",
    italian: "it",
    italiano: "it",
    spanish: "es",
    espanol: "es",
    español: "es",
    french: "fr",
    francais: "fr",
    français: "fr",
    german: "de",
    deutsch: "de",
    portuguese: "pt",
    portugues: "pt",
    português: "pt",
    hindi: "hi",
    punjabi: "pa",
    odia: "or",
    oriya: "or",
    russian: "ru",
  };

  if (aliasMap[raw]) return aliasMap[raw];

  const base = raw.split(/[-_]/)[0];

  if (/^[a-z]{2,3}$/.test(base)) return base;

  if (raw.includes("ital")) return "it";
  if (raw.includes("engl")) return "en";
  if (raw.includes("span")) return "es";
  if (raw.includes("fren")) return "fr";
  if (raw.includes("germ") || raw.includes("deut")) return "de";
  if (raw.includes("port")) return "pt";
  if (raw.includes("hind")) return "hi";
  if (raw.includes("punj")) return "pa";
  if (raw.includes("odia") || raw.includes("oriya")) return "or";
  if (raw.includes("russ")) return "ru";

  return null;
}

async function translateBetweenLanguages(params: {
  text: string;
  targetLanguage: string | null | undefined;
  sourceLanguage?: string | null | undefined;
}) {
  const text = params.text?.trim() || "";
  const target = normalizeLang(params.targetLanguage);
  const source = normalizeLang(params.sourceLanguage) || "auto";

  if (!text) return text;
  if (!target) return text;
  if (target === "en" && source === "en") return text;
  if (source !== "auto" && target === source) return text;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return text;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              `You translate short hospitality guest-support messages. Translate into language code "${target}". ` +
              `Source language is "${source}". ` +
              `Rules: keep meaning exactly; keep emojis; keep times/dates/numbers unchanged; preserve the natural script for that language; do not add explanation; return ONLY translated text.`,
          },
          { role: "user", content: text },
        ],
      }),
    });

    if (!res.ok) return text;

    const data: any = await res.json();
    const translated = data?.choices?.[0]?.message?.content?.trim();
    return translated || text;
  } catch {
    return text;
  }
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await req.json();
    const replyText = String(body?.reply || "").trim();

    if (!replyText) {
      return NextResponse.json({ error: "Reply is required" }, { status: 400 });
    }

    const convoRes = await supabaseAdmin
      .from("conversations")
      .select("id, guest_phone_e164, guest_language, host_language")
      .eq("id", id)
      .maybeSingle();

    if (convoRes.error) {
      return NextResponse.json({ error: convoRes.error.message }, { status: 500 });
    }

    if (!convoRes.data) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const guestLanguage = normalizeLang(convoRes.data.guest_language) || "en";
    const hostLanguage = normalizeLang(convoRes.data.host_language) || "en";

    const guestVisibleReply =
      guestLanguage && guestLanguage !== hostLanguage
        ? await translateBetweenLanguages({
            text: replyText,
            targetLanguage: guestLanguage,
            sourceLanguage: hostLanguage,
          })
        : replyText;

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromWhatsApp = process.env.TWILIO_WHATSAPP_FROM;

    if (!accountSid || !authToken || !fromWhatsApp) {
      return NextResponse.json(
        {
          error:
            "Missing Twilio env vars: TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_FROM",
        },
        { status: 500 }
      );
    }

    const client = twilio(accountSid, authToken);

    const sent = await client.messages.create({
      from: fromWhatsApp,
      to: convoRes.data.guest_phone_e164,
      body: guestVisibleReply,
    });

    const saveRes = await supabaseAdmin.from("messages").insert({
      conversation_id: id,
      direction: "outbound",
      body: replyText,
      translated_body: guestVisibleReply,
      topic: "general",
      provider: "twilio",
      provider_message_id: sent.sid,
      to_e164: convoRes.data.guest_phone_e164,
    });

    if (saveRes.error) {
      return NextResponse.json({ error: saveRes.error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      sid: sent.sid,
      host_visible_text: replyText,
      guest_visible_text: guestVisibleReply,
      guest_language: guestLanguage,
      host_language: hostLanguage,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Unknown server error" },
      { status: 500 }
    );
  }
}
