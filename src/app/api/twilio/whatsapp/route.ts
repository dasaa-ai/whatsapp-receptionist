import twilio from "twilio";
import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { extractIncomingMedia } from "@/lib/extractIncomingMedia";
import { isAllowedDocumentType } from "@/lib/isAllowedDocumentType";
import { downloadTwilioMedia } from "@/lib/downloadTwilioMedia";
import { getExtensionFromMimeType } from "@/lib/getExtensionFromMimeType";
import { uploadGuestDocument } from "@/lib/uploadGuestDocument";

export const runtime = "nodejs";

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

async function translateIfNeeded(
  text: string,
  guestLanguage: string | null | undefined
) {
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

  if (/[àèéìòù]/.test(t) || t.includes("ciao") || t.includes("grazie")) {
    return "it";
  }
  if (t.includes("hola") || t.includes("gracias")) return "es";
  if (t.includes("bonjour") || t.includes("merci")) return "fr";

  return "en";
}

async function parseTwilioRequest(
  req: Request
): Promise<{
  rawBody: string;
  payload: TwilioInbound;
  paramsObj: Record<string, string>;
}> {
  const rawBody = await req.text();
  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(rawBody);

    const payload: TwilioInbound = {
      From: params.get("From") ?? undefined,
      To: params.get("To") ?? undefined,
      Body: params.get("Body") ?? undefined,
      MessageSid: params.get("MessageSid") ?? undefined,
      ProfileName: params.get("ProfileName") ?? undefined,
    };

    const paramsObj: Record<string, string> = {};
    params.forEach((v, k) => {
      paramsObj[k] = v;
    });

    return { rawBody, payload, paramsObj };
  }

  try {
    const json = JSON.parse(rawBody || "{}") as TwilioInbound;
    return { rawBody, payload: json, paramsObj: {} };
  } catch {
    return { rawBody, payload: {}, paramsObj: {} };
  }
}

type TopicKey =
  | "checkin"
  | "checkout"
  | "wifi"
  | "parking"
  | "pricing"
  | "general";

function detectTopic(body: string): TopicKey {
  const t = (body || "").toLowerCase();

  if (t.includes("check in") || t.includes("check-in") || t.includes("arrival")) {
    return "checkin";
  }
  if (t.includes("check out") || t.includes("check-out") || t.includes("departure")) {
    return "checkout";
  }
  if (t.includes("wifi") || t.includes("wi-fi") || t.includes("internet")) {
    return "wifi";
  }
  if (t.includes("park") || t.includes("parking")) return "parking";
  if (t.includes("price") || t.includes("cost") || t.includes("rate")) {
    return "pricing";
  }

  return "general";
}

function inferRoleChoice(body: string): "guest" | "host" | null {
  const t = (body || "").trim().toLowerCase();
  if (t === "1" || t.includes("guest")) return "guest";
  if (t === "2" || t.includes("host") || t.includes("owner")) return "host";
  return null;
}

const TOPIC_REPLIES: Record<TopicKey, string> = {
  checkin:
    "Check-in is from 3:00 PM. If you need early check-in, tell me your ETA and I’ll confirm availability.",
  checkout:
    "Check-out is by 11:00 AM. If you’d like a late check-out, share your preferred time and I’ll check availability.",
  wifi:
    "Wi-Fi details: Network = <YOUR_WIFI_NAME>, Password = <YOUR_WIFI_PASSWORD>. If it doesn’t work, tell me your room/unit number.",
  parking:
    "Parking: <ADD_PARKING_DETAILS>. If you’re arriving by car, share your vehicle number (optional).",
  pricing:
    "Pricing depends on dates and occupancy. Please share your check-in date + nights + number of guests, and I’ll confirm.",
  general:
    "Got it ✅ Tell me what you need help with (check-in, Wi-Fi, parking, pricing, directions, etc.).",
};

export async function POST(req: Request) {
  const twilioSig = req.headers.get("x-twilio-signature") || "";
  const authToken = process.env.TWILIO_AUTH_TOKEN || "";
  const publicBaseUrl = process.env.PUBLIC_BASE_URL || "";

  const { payload, paramsObj } = await parseTwilioRequest(req);

  if (process.env.NODE_ENV === "production") {
    if (!twilioSig) {
      return new Response("Missing Twilio signature", { status: 403 });
    }
    if (!authToken || !publicBaseUrl) {
      return new Response(
        "Server misconfigured (TWILIO_AUTH_TOKEN/PUBLIC_BASE_URL)",
        { status: 500 }
      );
    }

    const url = new URL(req.url);
    const fullPublicUrl = `${publicBaseUrl}${url.pathname}`;

    const isValid = twilio.validateRequest(
      authToken,
      twilioSig,
      fullPublicUrl,
      paramsObj
    );

    if (!isValid) {
      return new Response("Invalid Twilio signature", { status: 403 });
    }
  }

  try {
    const from = payload.From ?? "";
    const to = payload.To ?? "";
    const body = payload.Body ?? "";
    const messageSid = payload.MessageSid ?? "";
    const profileName = payload.ProfileName ?? "";

    const mediaItems = extractIncomingMedia(paramsObj);
    const hasMedia = mediaItems.length > 0;

    const propertyId = process.env.DEFAULT_PROPERTY_ID;
    if (!propertyId) {
      return new Response("Missing DEFAULT_PROPERTY_ID in env", { status: 500 });
    }

    if (!from || !messageSid) {
      return new Response("Missing From or MessageSid", { status: 400 });
    }

    const hostPhone = process.env.HOST_PHONE_E164 || "";
    const isHostInitiated = hostPhone && from === hostPhone;
    const guestPhone = from;

    let { data: existingConv, error: convFindErr } = await supabaseAdmin
      .from("conversations")
      .select("id, stage, role, guest_language, host_language, id_received")
      .eq("property_id", propertyId)
      .eq("guest_phone_e164", guestPhone)
      .maybeSingle();

    if (convFindErr) {
      return new Response(`Error finding conversation: ${convFindErr.message}`, {
        status: 500,
      });
    }

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
          id_received: false,
          last_inbound_at: new Date().toISOString(),
        })
        .select("id, stage, role, guest_language, host_language, id_received")
        .single();

      if (convCreateErr) {
        return new Response(`Error creating conversation: ${convCreateErr.message}`, {
          status: 500,
        });
      }

      existingConv = newConv;
    } else {
      await supabaseAdmin
        .from("conversations")
        .update({ last_inbound_at: new Date().toISOString() })
        .eq("id", existingConv.id);
    }

    const conversationId = existingConv.id as string;
    const stage = (existingConv.stage as string) || "new";
    const role = (existingConv.role as string) || null;
    const idReceived = Boolean((existingConv as any)?.id_received);

    let guestLanguage = (existingConv as any)?.guest_language as string | null;
    if (!guestLanguage && body.trim()) {
      guestLanguage = await detectGuestLanguage(body);
      await supabaseAdmin
        .from("conversations")
        .update({ guest_language: guestLanguage })
        .eq("id", conversationId);
    }

    let hostLanguage = (existingConv as any)?.host_language as string | null;
    if (!hostLanguage) {
      const looksLikeHostMessage = role === "host";
      if (looksLikeHostMessage && body.trim()) {
        hostLanguage = await detectGuestLanguage(body);
        await supabaseAdmin
          .from("conversations")
          .update({ host_language: hostLanguage })
          .eq("id", conversationId);
      }
    }

    const topic = detectTopic(body);

    const { error: inboundErr } = await supabaseAdmin.from("messages").insert({
      conversation_id: conversationId,
      direction: "inbound",
      body: body || `[media message with ${mediaItems.length} attachment(s)]`,
      topic,
      provider: "twilio",
      provider_message_id: messageSid,
    });

    if (inboundErr) {
      return new Response(`Error saving inbound message: ${inboundErr.message}`, {
        status: 500,
      });
    }

    const requiresIdUpload =
      !idReceived &&
      (
        stage === "awaiting_guest_id" ||
        stage === "awaiting_passport" ||
        stage === "awaiting_checkin_document"
      );

    if (requiresIdUpload) {
      if (!hasMedia) {
        const reminderReply = await translateIfNeeded(
          "To continue check-in, please send a clear photo of your ID or passport here on WhatsApp. You can send it now or later when ready. Accepted formats: JPG, PNG, PDF.",
          guestLanguage
        );

        const outboundProviderMsgId = `local-reply-${messageSid}`;
        await supabaseAdmin.from("messages").insert({
          conversation_id: conversationId,
          direction: "outbound",
          body: reminderReply,
          topic: "general",
          provider: "twilio",
          provider_message_id: outboundProviderMsgId,
        });

        const twiml =
          `<?xml version="1.0" encoding="UTF-8"?>` +
          `<Response>` +
          `<Message>${xmlEscape(reminderReply)}</Message>` +
          `</Response>`;

        return new Response(twiml, {
          status: 200,
          headers: { "Content-Type": "text/xml" },
        });
      }

      let successCount = 0;
      let invalidCount = 0;
      let failedCount = 0;

      const bookingId = null;

      for (const mediaItem of mediaItems) {
        console.log("Processing media item", {
          index: mediaItem.index,
          contentType: mediaItem.contentType,
          url: mediaItem.url,
        });

        if (!isAllowedDocumentType(mediaItem.contentType)) {
          console.log("Rejected media type", mediaItem.contentType);
          invalidCount += 1;
          continue;
        }

        try {
          const fileBuffer = await downloadTwilioMedia(mediaItem.url);
          console.log("Downloaded media bytes", fileBuffer.length);

          const extension = getExtensionFromMimeType(mediaItem.contentType);

          const storagePath = `conversation-${conversationId}/${Date.now()}-${mediaItem.index}-${messageSid}.${extension}`;
          console.log("Uploading to storage path", storagePath);

          const uploaded = await uploadGuestDocument({
            fileBuffer,
            contentType: mediaItem.contentType || "application/octet-stream",
            storagePath,
          });

          console.log("Upload success", uploaded);

          const retentionDeleteAt = new Date();
          retentionDeleteAt.setDate(retentionDeleteAt.getDate() + 7);

          const { error: insertError } = await supabaseAdmin
            .from("guest_documents")
            .insert({
              conversation_id: conversationId,
              booking_id: bookingId,
              guest_phone: guestPhone,
              twilio_message_sid: messageSid,
              storage_bucket: uploaded.bucket,
              storage_path: uploaded.path,
              mime_type: mediaItem.contentType,
              file_size_bytes: fileBuffer.length,
              document_kind: "id_document",
              review_status: "pending",
              retention_delete_at: retentionDeleteAt.toISOString(),
            });

          if (insertError) {
            console.error("guest_documents insert error", insertError);
            throw insertError;
          }

          console.log("guest_documents insert success");
          successCount += 1;
        } catch (error) {
          console.error("Failed processing media item:", error);
          failedCount += 1;
        }
      }

      let replyText = "";

      if (successCount > 0) {
        replyText = `Thank you — we received ${successCount} document(s) securely.`;

        if (invalidCount > 0 || failedCount > 0) {
          replyText += ` ${invalidCount + failedCount} file(s) could not be processed. If needed, please resend them as JPG, PNG, or PDF.`;
        }

        console.log("Forcing conversation stage update to document_received", {
          conversationId,
          successCount,
        });

        const { data: updatedConv, error: convUpdateErr } = await supabaseAdmin
          .from("conversations")
          .update({
            stage: "document_received",
            id_received: true,
            last_inbound_at: new Date().toISOString(),
          })
          .eq("id", conversationId)
          .select("id, stage, id_received")
          .single();

        if (convUpdateErr) {
          console.error("Conversation stage update error:", convUpdateErr);
        } else {
          console.log("Conversation stage updated successfully:", updatedConv);
        }
      } else {
        replyText =
          "We could not process your document yet. To continue check-in, please send a clear photo of your ID or passport here on WhatsApp in JPG, PNG, or PDF format.";
      }

      const translatedReply = await translateIfNeeded(replyText, guestLanguage);

      const outboundProviderMsgId = `local-reply-${messageSid}`;
      const { error: outboundErr } = await supabaseAdmin.from("messages").insert({
        conversation_id: conversationId,
        direction: "outbound",
        body: translatedReply,
        topic: "general",
        provider: "twilio",
        provider_message_id: outboundProviderMsgId,
      });

      if (outboundErr) {
        return new Response(`Error saving outbound message: ${outboundErr.message}`, {
          status: 500,
        });
      }

      const twiml =
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<Response>` +
        `<Message>${xmlEscape(translatedReply)}</Message>` +
        `</Response>`;

      return new Response(twiml, {
        status: 200,
        headers: { "Content-Type": "text/xml" },
      });
    }

    let replyText = "";
    let nextStage = stage;
    let nextRole: "guest" | "host" | null =
      role === "guest" || role === "host" ? role : null;

    if (isHostInitiated && !role) {
      nextRole = "host";
      nextStage = "active";
      replyText =
        "Hi Host 👋\nRight now this MVP is optimized for guest inbound messages.\nNext step: we’ll add a host dashboard + host-initiated flows.\nFor now, please test by messaging from the guest number into the sandbox.";
    } else if (!role) {
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
        nextStage = "awaiting_role";
        replyText =
          "Quick check 😊 Are you:\n1) Guest\n2) Host / Owner\n\nReply with 1 or 2.";
      }
    } else {
      nextStage = "active";
      replyText = TOPIC_REPLIES[topic] || TOPIC_REPLIES.general;
    }

    const convUpdate: Record<string, any> = {};
    if (nextStage !== stage) convUpdate.stage = nextStage;
    if (nextRole !== role) convUpdate.role = nextRole;

    if (Object.keys(convUpdate).length > 0) {
      const { error: convUpdateErr } = await supabaseAdmin
        .from("conversations")
        .update(convUpdate)
        .eq("id", conversationId);

      if (convUpdateErr) {
        return new Response(`Error updating conversation: ${convUpdateErr.message}`, {
          status: 500,
        });
      }
    }

    const effectiveRole = (nextRole ?? role) as string | null;
    let finalReplyText = replyText;
    const targetLang = effectiveRole === "host" ? hostLanguage : guestLanguage;

    if (targetLang && targetLang !== "en") {
      finalReplyText = await translateIfNeeded(replyText, targetLang);
    }

    const outboundProviderMsgId = `local-reply-${messageSid}`;
    const { error: outboundErr } = await supabaseAdmin.from("messages").insert({
      conversation_id: conversationId,
      direction: "outbound",
      body: finalReplyText,
      topic,
      provider: "twilio",
      provider_message_id: outboundProviderMsgId,
    });

    if (outboundErr) {
      return new Response(`Error saving outbound message: ${outboundErr.message}`, {
        status: 500,
      });
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
    return new Response(`Server error: ${e?.message ?? String(e)}`, {
      status: 500,
    });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    note: "Twilio WhatsApp webhook endpoint. Use POST from Twilio.",
  });
}
