import twilio from "twilio";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs"; // important for server-side libs

// ---------- helpers ----------
function xmlEscape(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

type TwilioInbound = {
  From?: string;
  To?: string;
  Body?: string;
  MessageSid?: string;
  ProfileName?: string;
};

async function translateIfNeeded(text: string, guestLanguage: string | null | undefined) {
  const lang = normalizeLang(guestLanguage);
  if (!text?.trim()) return text;
  if (!lang || lang === "en") return text;

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
              `You translate short hospitality guest-support messages. Translate into language code "${lang}". ` +
              `Rules: keep meaning exactly; keep emojis; keep times/dates/numbers unchanged; do not add extra explanation. ` +
              `Return ONLY the translated text.`,
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

function normalizeLang(lang?: string | null): string | null {
  if (!lang) return null;
  const l = lang.trim().toLowerCase();
  if (!l) return null;

  if (l === "en" || l.startsWith("en")) return "en";
  if (l === "it" || l.startsWith("it")) return "it";
  if (l === "es" || l.startsWith("es")) return "es";
  if (l === "fr" || l.startsWith("fr")) return "fr";
  if (l === "de" || l.startsWith("de")) return "de";
  if (l === "pt" || l.startsWith("pt")) return "pt";

  // if you ever stored full names like "italian"
  if (l.includes("ital")) return "it";
  if (l.includes("engl")) return "en";
  if (l.includes("span")) return "es";
  if (l.includes("fren")) return "fr";
  if (l.includes("germ") || l.includes("deut")) return "de";
  if (l.includes("port")) return "pt";

  return null;
}

async function detectGuestLanguage(text: string): Promise<string> {
  const t = (text || "").toLowerCase();

  // very lightweight heuristic first
  if (/[àèéìòù]/.test(t) || t.includes("ciao") || t.includes("grazie")) return "it";
  if (t.includes("hola") || t.includes("gracias")) return "es";
  if (t.includes("bonjour") || t.includes("merci")) return "fr";

  return "en"; // default
}

async function parseTwilioRequest(req: Request): Promise<{ rawBody: string; payload: TwilioInbound; paramsObj: Record<string, string> }> {
  // Read raw body ONCE (Twilio signature validation needs the exact body)
  const rawBody = await req.text();
  const contentType = req.headers.get("content-type") || "";

  // Twilio sends application/x-www-form-urlencoded
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(rawBody);
    const payload: TwilioInbound = {
      From: params.get("From") ?? undefined,
      To: params.get("To") ?? undefined,
      Body: params.get("Body") ?? undefined,
      MessageSid: params.get("MessageSid") ?? undefined,
      ProfileName: params.get("ProfileName") ?? undefined,
    };

    // Twilio validateRequest expects a plain object of params
    const paramsObj: Record<string, string> = {};
    params.forEach((v, k) => (paramsObj[k] = v));

    return { rawBody, payload, paramsObj };
  }

  // Fallback: allow JSON for local testing
  try {
    const json = JSON.parse(rawBody || "{}") as TwilioInbound;
    return { rawBody, payload: json, paramsObj: {} };
  } catch {
    return { rawBody, payload: {}, paramsObj: {} };
  }
}

// VERY simple topic detection for now (you can evolve this)
type TopicKey = "checkin" | "checkout" | "wifi" | "parking" | "pricing" | "general";

function detectTopic(body: string): TopicKey {
  const t = (body || "").toLowerCase();

  if (t.includes("check in") || t.includes("check-in") || t.includes("arrival")) return "checkin";
  if (t.includes("check out") || t.includes("check-out") || t.includes("departure")) return "checkout";
  if (t.includes("wifi") || t.includes("wi-fi") || t.includes("internet")) return "wifi";
  if (t.includes("park") || t.includes("parking")) return "parking";
  if (t.includes("price") || t.includes("cost") || t.includes("rate")) return "pricing";

  return "general";
}

function inferRoleChoice(body: string): "guest" | "host" | null {
  const t = (body || "").trim().toLowerCase();
  if (t === "1" || t.includes("guest")) return "guest";
  if (t === "2" || t.includes("host") || t.includes("owner")) return "host";
  return null;
}

const TOPIC_REPLIES: Record<TopicKey, string> = {
  checkin: "Check-in is from 3:00 PM. If you need early check-in, tell me your ETA and I’ll confirm availability.",
  checkout: "Check-out is by 11:00 AM. If you’d like a late check-out, share your preferred time and I’ll check availability.",
  wifi: "Wi-Fi details: Network = <YOUR_WIFI_NAME>, Password = <YOUR_WIFI_PASSWORD>. If it doesn’t work, tell me your room/unit number.",
  parking: "Parking: <ADD_PARKING_DETAILS>. If you’re arriving by car, share your vehicle number (optional).",
  pricing: "Pricing depends on dates and occupancy. Please share your check-in date + nights + number of guests, and I’ll confirm.",
  general: "Got it ✅ Tell me what you need help with (check-in, Wi-Fi, parking, pricing, directions, etc.).",

};

// ---------- handler ----------
export async function POST(req: Request) {
  // 0) Validate Twilio signature (skip only in dev/local curl)
  const twilioSig = req.headers.get("x-twilio-signature") || "";
  const authToken = process.env.TWILIO_AUTH_TOKEN || "";
  const publicBaseUrl = process.env.PUBLIC_BASE_URL || ""; // e.g. https://whatsapp-receptionist.vercel.app

  const { payload, paramsObj } = await parseTwilioRequest(req);

  // In production we require signature
  if (process.env.NODE_ENV === "production") {
    if (!twilioSig) return new Response("Missing Twilio signature", { status: 403 });
    if (!authToken || !publicBaseUrl) return new Response("Server misconfigured (TWILIO_AUTH_TOKEN/PUBLIC_BASE_URL)", { status: 500 });

    const url = new URL(req.url);
    const fullPublicUrl = `${publicBaseUrl}${url.pathname}`; // Twilio signs the full URL

    const isValid = twilio.validateRequest(authToken, twilioSig, fullPublicUrl, paramsObj);
    if (!isValid) return new Response("Invalid Twilio signature", { status: 403 });
  } else {
    // In dev: allow curl without signature
    // (Twilio requests still include signature when they hit your localhost via ngrok)
  }

  try {
    const from = payload.From ?? "";
    const to = payload.To ?? "";
    const body = payload.Body ?? "";
    const messageSid = payload.MessageSid ?? "";
    const profileName = payload.ProfileName ?? "";

    const propertyId = process.env.DEFAULT_PROPERTY_ID;
    if (!propertyId) return new Response("Missing DEFAULT_PROPERTY_ID in env", { status: 500 });

    if (!from || !messageSid) return new Response("Missing From or MessageSid", { status: 400 });

    // Optional: if you have a known host phone, we can treat that inbound as host
    const hostPhone = process.env.HOST_PHONE_E164 || ""; // e.g. "whatsapp:+91XXXXXXXXXX"
    const isHostInitiated = hostPhone && from === hostPhone;

    // For now, we assume the guest is the inbound sender.
    // (Host-initiated flow can be expanded later with a proper hosts table.)
    const guestPhone = from;

    // 1) Find conversation (property + guest phone)
    let { data: existingConv, error: convFindErr } = await supabaseAdmin
      .from("conversations")
      .select("id, stage, role")
      .eq("property_id", propertyId)
      .eq("guest_phone_e164", guestPhone)
      .maybeSingle();

    if (convFindErr) {
      return new Response(`Error finding conversation: ${convFindErr.message}`, { status: 500 });
    }

    // 2) Create conversation if missing
    if (!existingConv) {
      const guestNameFallback = profileName?.trim() || "Guest";

      const { data: newConv, error: convCreateErr } = await supabaseAdmin
        .from("conversations")
        .insert({
          property_id: propertyId,
          guest_phone_e164: guestPhone,
          guest_name: guestNameFallback,
          status: "open",
          stage: "new",
          role: null,
          last_inbound_at: new Date().toISOString(),
        })
        .select("id, stage, role")
        .single();

      if (convCreateErr) {
        return new Response(`Error creating conversation: ${convCreateErr.message}`, { status: 500 });
      }

      existingConv = newConv;
    } else {
      // Update last_inbound_at
      await supabaseAdmin
        .from("conversations")
        .update({ last_inbound_at: new Date().toISOString() })
        .eq("id", existingConv.id);
    }

    const conversationId = existingConv.id as string;
    const stage = (existingConv.stage as string) || "new";
    const role = (existingConv.role as string) || null;
    
    // 3) Detect topic and store inbound message
    const topic = detectTopic(body);

    // Store guest language once per conversation
let guestLanguage = (existingConv as any)?.guest_language as string | null; 

if (!guestLanguage) {
  guestLanguage = await detectGuestLanguage(body);
  await supabaseAdmin
    .from("conversations")
    .update({ guest_language: guestLanguage })
    .eq("id", conversationId);
}

let hostLanguage = (existingConv as any)?.host_language as string | null;
if (!hostLanguage) {
  // If the host has a preferred language, store it once.
  // For MVP: infer from the first HOST message we see.
  const looksLikeHostMessage = role === "host"; // simple for now
  if (looksLikeHostMessage) {
    hostLanguage = await detectGuestLanguage(body); // reuse your detector
    await supabaseAdmin
      .from("conversations")
      .update({ host_language: hostLanguage })
      .eq("id", conversationId);
  }
}


    const { error: inboundErr } = await supabaseAdmin.from("messages").insert({
      conversation_id: conversationId,
      direction: "inbound",
      body,
      topic,
      provider: "twilio",
      provider_message_id: messageSid,
    });

    if (inboundErr) {
      return new Response(`Error saving inbound message: ${inboundErr.message}`, { status: 500 });
    }

    // 4) Decide reply (ASK ROLE ONLY ONCE PER CONVERSATION)
    let replyText = "";
    let shouldTranslateToGuest = false; // translate ONLY real guest-help answers (not onboarding)
    let nextStage = stage;
    let nextRole: "guest" | "host" | null =
  role === "guest" || role === "host" ? role : null;

    // If host initiated (optional shortcut): do not ask guest/host
    // But we still keep role = "host" in the conversation if you want.
    if (isHostInitiated && !role) {
      nextRole = "host";
      nextStage = "active";
      replyText =
        "Hi Host 👋\nRight now this MVP is optimized for guest inbound messages.\nNext step: we’ll add a host dashboard + host-initiated flows.\nFor now, please test by messaging from the guest number into the sandbox.";
    } else if (!role) {
      // No role set yet → we ask only once, then store role
      if (stage === "new") {
        nextStage = "awaiting_role";
        replyText =
          "Welcome! 👋\n\nAre you:\n1) a *Guest*\n2) the *Host / Owner*\n\nReply with 1 or 2.";
      } else if (stage === "awaiting_role") {
        const chosen = inferRoleChoice(body);

        if (!chosen) {
          replyText = "Please reply with:\n1) Guest\n2) Host / Owner";
        } else {
          nextRole = chosen;
          nextStage = "active";

          if (chosen === "guest") {
            replyText =
              "Great 😊\nYou can ask me things like:\n• check-in time\n• Wi-Fi\n• parking\n• directions\n\nWhat do you need help with?";
          } else {
            replyText =
              "Thanks! ✅\nRight now auto-replies are enabled.\nNext we’ll add host controls + approvals.\nWhat would you like to test next?";
          }
        }
      } else {
        // Any unknown stage but role still null → force role question once
        nextStage = "awaiting_role";
        replyText =
          "Quick check 😊 Are you:\n1) Guest\n2) Host / Owner\n\nReply with 1 or 2.";
      }
    } else {
      // Role already known → NEVER ask again
      nextStage = "active";
      replyText = TOPIC_REPLIES[topic] || TOPIC_REPLIES.general;
      shouldTranslateToGuest = true;
    }

    // 5) Persist conversation updates (role/stage)
    const convUpdate: Record<string, any> = {};
    if (nextStage !== stage) convUpdate.stage = nextStage;
    if (nextRole !== role) convUpdate.role = nextRole;

    if (Object.keys(convUpdate).length > 0) {
      const { error: convUpdateErr } = await supabaseAdmin
        .from("conversations")
        .update(convUpdate)
        .eq("id", conversationId);

      if (convUpdateErr) {
        return new Response(`Error updating conversation: ${convUpdateErr.message}`, { status: 500 });
      }
    }

    // 6) Store outbound message (so your Messages table shows both directions)
    const outboundProviderMsgId = `local-reply-${messageSid}`;

    const { error: outboundErr } = await supabaseAdmin.from("messages").insert({
      conversation_id: conversationId,
      direction: "outbound",
      body: replyText,
      topic,
      provider: "twilio",
      provider_message_id: outboundProviderMsgId,
    });

    if (outboundErr) {
      return new Response(`Error saving outbound message: ${outboundErr.message}`, { status: 500 });
    }

    // 7) Reply with TwiML

// Step 4A: Translate only guest-help answers, and only when role is guest
const effectiveRole = (nextRole ?? role) as string | null; // nextRole may be set in this request
const isGuestConversation = effectiveRole === "guest";

let finalReplyText = replyText;

// Translate outgoing reply depending on who we are replying to
// If role is guest, we are replying to guest -> use guestLanguage
// If role is host, we are replying to host -> use hostLanguage
const targetLang = role === "host" ? hostLanguage : guestLanguage;

if (targetLang && targetLang !== "en") {
  finalReplyText = await translateIfNeeded(replyText, targetLang);
}


const twiml =
  `<?xml version="1.0" encoding="UTF-8"?>` +
  `<Response>` +
  `<Message>${xmlEscape(finalReplyText)}</Message>` +
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
