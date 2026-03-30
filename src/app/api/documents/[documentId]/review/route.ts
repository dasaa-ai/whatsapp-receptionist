import { NextResponse } from "next/server";
import twilio from "twilio";
import OpenAI from "openai";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type RouteContext = {
  params: Promise<{
    documentId: string;
  }>;
};

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

function buildReviewMessage(params: {
  status: "approved" | "rejected";
  documentKind?: string | null;
  reason?: string;
  isReversal?: boolean;
}) {
  const { status, documentKind, reason, isReversal } = params;

  const label =
    documentKind === "id_document"
      ? "ID document"
      : documentKind === "passport"
      ? "passport"
      : "document";

  const cleanReason = reason?.trim();

  if (status === "approved") {
    if (isReversal && cleanReason) {
      return `Good news ✅ After review, your uploaded ${label} has been approved. Reason: ${cleanReason}`;
    }

    return `Good news ✅ Your uploaded ${label} has been approved. If any more documents are needed, please continue sending them here on WhatsApp.`;
  }

  if (isReversal && cleanReason) {
    return `Update needed ❌ After review, your uploaded ${label} could not be accepted. Reason: ${cleanReason}. Please resend a clear photo or PDF here on WhatsApp.`;
  }

  return `Update needed ❌ Your uploaded ${label} could not be accepted. Please resend a clear photo or PDF here on WhatsApp.`;
}

async function translateForGuestLanguage(params: {
  text: string;
  guestLanguage?: string | null;
  hostLanguage?: string | null;
}) {
  const { text, guestLanguage, hostLanguage } = params;

  const targetLanguage = (guestLanguage || "").trim().toLowerCase();
  const sourceLanguage = (hostLanguage || "en").trim().toLowerCase();

  if (!targetLanguage || targetLanguage === "en" || targetLanguage === sourceLanguage) {
    return text;
  }

  if (!openai) {
    return text;
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You are a translation engine for WhatsApp guest communication. Translate the message faithfully into the requested target language. Preserve emoji, tone, and operational meaning. Return only the translated message text.",
        },
        {
          role: "user",
          content: `Translate this WhatsApp message into language code "${targetLanguage}". Source language code: "${sourceLanguage}". Message:\n\n${text}`,
        },
      ],
    });

    const translated = response.choices[0]?.message?.content?.trim();
    return translated || text;
  } catch (error) {
    console.error("[DOC_REVIEW_TRANSLATION_ERROR]", error);
    return text;
  }
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const { documentId } = await context.params;
    const body = await req.json();

    const status = body?.status as "approved" | "rejected";
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";

    if (!["approved", "rejected"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const docRes = await supabaseAdmin
      .from("guest_documents")
      .select("id, conversation_id, document_kind, review_status")
      .eq("id", documentId)
      .maybeSingle();

    if (docRes.error) {
      return NextResponse.json({ error: docRes.error.message }, { status: 500 });
    }

    if (!docRes.data) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const currentStatus = docRes.data.review_status;
    const isReversal =
      currentStatus === "approved" || currentStatus === "rejected";

    if (currentStatus === status) {
      return NextResponse.json(
        { error: `Document is already marked as ${status}. No action taken.` },
        { status: 400 }
      );
    }

    if (isReversal && !reason) {
      return NextResponse.json(
        { error: "A reason is required when reversing a document decision." },
        { status: 400 }
      );
    }

    const updateRes = await supabaseAdmin
      .from("guest_documents")
      .update({ review_status: status })
      .eq("id", documentId);

    if (updateRes.error) {
      return NextResponse.json({ error: updateRes.error.message }, { status: 500 });
    }

    const convoRes = await supabaseAdmin
      .from("conversations")
      .select("id, guest_phone_e164, guest_language, host_language")
      .eq("id", docRes.data.conversation_id)
      .maybeSingle();

    if (convoRes.error) {
      return NextResponse.json({ error: convoRes.error.message }, { status: 500 });
    }

    if (!convoRes.data?.guest_phone_e164) {
      return NextResponse.json({
        ok: true,
        warning: "Review status updated, but guest phone was missing so no WhatsApp was sent.",
      });
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromWhatsApp = process.env.TWILIO_WHATSAPP_FROM;

    if (!accountSid || !authToken || !fromWhatsApp) {
      return NextResponse.json(
        {
          ok: true,
          warning:
            "Review status updated, but Twilio env vars are missing so no WhatsApp was sent.",
        },
        { status: 200 }
      );
    }

    const hostVisibleMessage = buildReviewMessage({
      status,
      documentKind: docRes.data.document_kind,
      reason,
      isReversal,
    });

    const guestVisibleMessage = await translateForGuestLanguage({
      text: hostVisibleMessage,
      guestLanguage: convoRes.data.guest_language,
      hostLanguage: convoRes.data.host_language,
    });

    const client = twilio(accountSid, authToken);

    const sent = await client.messages.create({
      from: fromWhatsApp,
      to: convoRes.data.guest_phone_e164,
      body: guestVisibleMessage,
    });

    const saveMessageRes = await supabaseAdmin.from("messages").insert({
      conversation_id: convoRes.data.id,
      direction: "outbound",
      body: hostVisibleMessage,
      translated_body: guestVisibleMessage,
      topic: "document_review",
      provider: "twilio",
      provider_message_id: sent.sid,
      to_e164: convoRes.data.guest_phone_e164,
    });

    if (saveMessageRes.error) {
      return NextResponse.json({
        ok: true,
        warning: `Review status updated and WhatsApp sent, but failed to save outbound message: ${saveMessageRes.error.message}`,
      });
    }

    return NextResponse.json({
      ok: true,
      whatsapp_sent: true,
      status,
      isReversal,
      guest_language: convoRes.data.guest_language || "en",
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
