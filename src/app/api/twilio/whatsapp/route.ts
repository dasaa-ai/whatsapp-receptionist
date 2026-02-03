import twilio from "twilio";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs"; // required for twilio lib on Next.js

function xmlEscape(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function parseUrlEncodedToObject(rawBody: string): Record<string, string> {
  const params = new URLSearchParams(rawBody);
  const obj: Record<string, string> = {};
  for (const [k, v] of params.entries()) obj[k] = v;
  return obj;
}

type TwilioInbound = {
  From?: string;
  To?: string;
  Body?: string;
  MessageSid?: string;
  ProfileName?: string;
};

function parseTwilioInbound(rawBody: string, contentType: string): TwilioInbound {
  // Twilio WhatsApp webhooks are usually application/x-www-form-urlencoded
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(rawBody);
    return {
      From: params.get("From") ?? undefined,
      To: params.get("To") ?? undefined,
      Body: params.get("Body") ?? undefined,
      MessageSid: params.get("MessageSid") ?? undefined,
      ProfileName: params.get("ProfileName") ?? undefined,
    };
  }

  // fallback for local JSON tests
  try {
    const json = JSON.parse(rawBody || "{}") as TwilioInbound;
    return {
      From: json.From,
      To: json.To,
      Body: json.Body,
      MessageSid: json.MessageSid,
      ProfileName: json.ProfileName,
    };
  } catch {
    return {};
  }
}

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") || "";

    // Read body ONCE (super important)
    const rawBody = await req.text();

    // ---- Twilio signature validation (security) ----
    // In local curl testing, you won't have this header — we skip validation.
    const twilioSig = req.headers.get("x-twilio-signature") || "";
    if (twilioSig) {
      const authToken = process.env.TWILIO_AUTH_TOKEN || "";
      const publicBaseUrl = process.env.PUBLIC_BASE_URL || ""; // e.g. https://xxxx.ngrok-free.dev

      if (!authToken || !publicBaseUrl) {
        return new Response("Missing TWILIO_AUTH_TOKEN or PUBLIC_BASE_URL", { status: 500 });
      }

      const url = new URL(req.url);
      const fullPublicUrl = `${publicBaseUrl}${url.pathname}`; // must match exactly what Twilio calls

      const paramsObj = parseUrlEncodedToObject(rawBody);
      const isValid = twilio.validateRequest(authToken, twilioSig, fullPublicUrl, paramsObj);

      if (!isValid) {
        return new Response("Invalid Twilio signature", { status: 403 });
      }
    }
    // ---- end signature validation ----

    const payload = parseTwilioInbound(rawBody, contentType);

    const from = payload.From ?? "";
    const to = payload.To ?? "";
    const body = payload.Body ?? "";
    const messageSid = payload.MessageSid ?? "";
    const profileName = payload.ProfileName ?? "";

    const propertyId = process.env.DEFAULT_PROPERTY_ID;
    if (!propertyId) return new Response("Missing DEFAULT_PROPERTY_ID in .env.local", { status: 500 });

    if (!from || !messageSid) {
      return new Response("Missing From or MessageSid", { status: 400 });
    }

    const guestName = (profileName || "Guest").trim();

    // 1) Find conversation
    const { data: existingConv, error: findErr } = await supabaseAdmin
      .from("conversations")
      .select("id")
      .eq("property_id", propertyId)
      .eq("guest_phone_e164", from)
      .maybeSingle();

    if (findErr) {
      return new Response(`Error finding conversation: ${findErr.message}`, { status: 500 });
    }

    let conversationId = existingConv?.id as string | undefined;

    // 1b) Create conversation if needed
    if (!conversationId) {
      const { data: newConv, error: createErr } = await supabaseAdmin
        .from("conversations")
        .insert({
          property_id: propertyId,
          guest_phone_e164: from,
          guest_name: guestName, // IMPORTANT for your NOT NULL column
          status: "open",
        })
        .select("id")
        .single();

      if (createErr) {
        return new Response(`Error creating conversation: ${createErr.message}`, { status: 500 });
      }

      conversationId = newConv.id;
    }

    // 2) Store inbound message
    const { error: inboundErr } = await supabaseAdmin.from("messages").insert({
      conversation_id: conversationId,
      direction: "inbound",
      body,
      provider: "twilio",
      provider_message_id: messageSid,
    });

    if (inboundErr) {
      return new Response(`Error saving inbound message: ${inboundErr.message}`, { status: 500 });
    }

    // 3) Decide reply (simple for now)
    const replyText = "Radhe Radhe 🌸 Message saved ✅";

    // 4) Store outbound reply as a message too (optional but nice)
    const { error: outboundErr } = await supabaseAdmin.from("messages").insert({
      conversation_id: conversationId,
      direction: "outbound",
      body: replyText,
      provider: "twilio",
      provider_message_id: `local-reply-${messageSid}`,
    });

    if (outboundErr) {
      return new Response(`Error saving outbound message: ${outboundErr.message}`, { status: 500 });
    }

    // 5) Respond to Twilio with TwiML
    const twiml =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Response>` +
      `<Message>${xmlEscape(replyText)}</Message>` +
      `</Response>`;

    return new Response(twiml, {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  } catch (e: any) {
    return new Response(`Server error: ${e?.message ?? String(e)}`, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    note: "Twilio WhatsApp webhook endpoint. Use POST from Twilio.",
  });
}
