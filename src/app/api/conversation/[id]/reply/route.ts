import { NextResponse } from "next/server";
import twilio from "twilio";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

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
      .select("id, guest_phone_e164")
      .eq("id", id)
      .maybeSingle();

    if (convoRes.error) {
      return NextResponse.json({ error: convoRes.error.message }, { status: 500 });
    }

    if (!convoRes.data) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromWhatsApp = process.env.TWILIO_WHATSAPP_FROM;

    if (!accountSid || !authToken || !fromWhatsApp) {
      return NextResponse.json(
        { error: "Missing Twilio env vars: TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_FROM" },
        { status: 500 }
      );
    }

    const client = twilio(accountSid, authToken);

    const sent = await client.messages.create({
      from: fromWhatsApp,
      to: convoRes.data.guest_phone_e164,
      body: replyText,
    });

    const saveRes = await supabaseAdmin.from("messages").insert({
      conversation_id: id,
      direction: "outbound",
      body: replyText,
      topic: "general",
      provider: "twilio",
      provider_message_id: sent.sid,
      to_e164: convoRes.data.guest_phone_e164,
    });

    if (saveRes.error) {
      return NextResponse.json({ error: saveRes.error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, sid: sent.sid });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Unknown server error" },
      { status: 500 }
    );
  }
}
