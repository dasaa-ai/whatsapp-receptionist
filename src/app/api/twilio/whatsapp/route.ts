import twilio from "twilio";
import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { extractIncomingMedia } from "@/lib/extractIncomingMedia";
import { isAllowedDocumentType } from "@/lib/isAllowedDocumentType";
import { downloadTwilioMedia } from "@/lib/downloadTwilioMedia";
import { getExtensionFromMimeType } from "@/lib/getExtensionFromMimeType";
import { uploadGuestDocument } from "@/lib/uploadGuestDocument";

export const runtime = "nodejs";

function xmlEscape(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function emptyTwimlResponse() {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

type TwilioInbound = {
  From?: string;
  To?: string;
  Body?: string;
  MessageSid?: string;
  ProfileName?: string;
};

type TopicKey =
  | "checkin"
  | "checkout"
  | "wifi"
  | "parking"
  | "pricing"
  | "general";

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

    return { payload, paramsObj };
  }

  try {
    const json = JSON.parse(rawBody || "{}") as TwilioInbound;
    return { payload: json, paramsObj: {} };
  } catch {
    return { payload: {}, paramsObj: {} };
  }
}

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
      .select(`
        id,
        stage,
        role,
        guest_language,
        host_language,
        booking_id,
        guest_name,
        required_guest_documents,
        received_guest_documents,
        verified_guest_documents,
        document_status,
        id_received
      `)
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
          document_status: "not_requested",
          required_guest_documents: 1,
          received_guest_documents: 0,
          verified_guest_documents: 0,
          id_received: false,
          last_inbound_at: new Date().toISOString(),
        })
        .select(`
          id,
          stage,
          role,
          guest_language,
          host_language,
          booking_id,
          guest_name,
          required_guest_documents,
          received_guest_documents,
          verified_guest_documents,
          document_status,
          id_received
        `)
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
    const bookingId = (existingConv as any)?.booking_id ?? null;

    // Idempotency: if inbound message already logged, do not process again.
    const { count: existingInboundMessageCount, error: existingInboundMessageErr } =
      await supabaseAdmin
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("conversation_id", conversationId)
        .eq("provider", "twilio")
        .eq("provider_message_id", messageSid)
        .eq("direction", "inbound");

    if (existingInboundMessageErr) {
      console.error(
        "Error checking existing inbound message for MessageSid:",
        existingInboundMessageErr
      );
    }

    if ((existingInboundMessageCount ?? 0) > 0) {
      console.log("Skipping duplicate inbound processing for MessageSid:", messageSid);
      return emptyTwimlResponse();
    }

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
      from_e164: from,
    });

    if (inboundErr) {
      return new Response(`Error saving inbound message: ${inboundErr.message}`, {
        status: 500,
      });
    }

    let requiredGuestDocuments = 1;

    if (bookingId) {
      const { count: requiredCount, error: requiredCountErr } = await supabaseAdmin
        .from("booking_guests")
        .select("*", { count: "exact", head: true })
        .eq("booking_id", bookingId)
        .eq("id_required", true);

      if (!requiredCountErr && typeof requiredCount === "number" && requiredCount > 0) {
        requiredGuestDocuments = requiredCount;
      } else {
        const { data: bookingRow, error: bookingErr } = await supabaseAdmin
          .from("bookings")
          .select("adult_guest_count")
          .eq("id", bookingId)
          .maybeSingle();

        if (bookingErr) {
          console.error("Error fetching booking adult count:", bookingErr);
        }

        const adults = Number((bookingRow as any)?.adult_guest_count ?? 1) || 1;
        requiredGuestDocuments = adults;
      }
    } else {
      requiredGuestDocuments =
        Number((existingConv as any)?.required_guest_documents ?? 1) || 1;
    }

    const { count: existingDocumentCount, error: existingDocumentCountErr } =
      await supabaseAdmin
        .from("guest_documents")
        .select("*", { count: "exact", head: true })
        .eq("conversation_id", conversationId)
        .is("deleted_at", null);

    if (existingDocumentCountErr) {
      return new Response(
        `Error checking guest documents: ${existingDocumentCountErr.message}`,
        { status: 500 }
      );
    }

    const receivedGuestDocuments = existingDocumentCount ?? 0;
    const idReceived =
      receivedGuestDocuments >= requiredGuestDocuments && requiredGuestDocuments > 0;

    const requiresIdUpload =
      !idReceived &&
      (
        stage === "awaiting_guest_id" ||
        stage === "awaiting_passport" ||
        stage === "awaiting_checkin_document"
      );

    if (requiresIdUpload) {
      // Extra idempotency protection for document uploads.
      const { count: existingDocForMessageCount, error: existingDocForMessageErr } =
        await supabaseAdmin
          .from("guest_documents")
          .select("*", { count: "exact", head: true })
          .eq("conversation_id", conversationId)
          .eq("twilio_message_sid", messageSid)
          .is("deleted_at", null);

      if (existingDocForMessageErr) {
        console.error(
          "Error checking existing guest documents for message:",
          existingDocForMessageErr
        );
      }

      if ((existingDocForMessageCount ?? 0) > 0) {
        console.log("Skipping duplicate document processing for MessageSid:", messageSid);
        return emptyTwimlResponse();
      }

      if (!hasMedia) {
        await supabaseAdmin
          .from("conversations")
          .update({
            required_guest_documents: requiredGuestDocuments,
            received_guest_documents: receivedGuestDocuments,
            id_received: idReceived,
            document_status: receivedGuestDocuments > 0 ? "partial" : "requested",
            last_inbound_at: new Date().toISOString(),
          })
          .eq("id", conversationId);

        const remaining = Math.max(requiredGuestDocuments - receivedGuestDocuments, 0);

        const reminderReply = await translateIfNeeded(
          remaining > 1
            ? `To continue check-in, please send the remaining ${remaining} guest ID documents here on WhatsApp. Accepted formats: JPG, PNG, PDF.`
            : `To continue check-in, please send the remaining guest ID document here on WhatsApp. Accepted formats: JPG, PNG, PDF.`,
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
          to_e164: guestPhone,
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

      for (const mediaItem of mediaItems) {
        if (!isAllowedDocumentType(mediaItem.contentType)) {
          invalidCount += 1;
          continue;
        }

        try {
          const fileBuffer = await downloadTwilioMedia(mediaItem.url);
          const extension = getExtensionFromMimeType(mediaItem.contentType);

          const storagePath = `conversation-${conversationId}/${Date.now()}-${mediaItem.index}-${messageSid}.${extension}`;

          const uploaded = await uploadGuestDocument({
            fileBuffer,
            contentType: mediaItem.contentType || "application/octet-stream",
            storagePath,
          });

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
              verification_status: "pending",
              retention_delete_at: retentionDeleteAt.toISOString(),
            });

          if (insertError) {
            throw insertError;
          }

          successCount += 1;
        } catch (error) {
          console.error("Failed processing media item:", error);
          failedCount += 1;
        }
      }

      let replyText = "";

      if (successCount > 0) {
        // Mark next missing required guests as received.
        if (bookingId) {
          const { data: missingGuests, error: missingGuestsErr } = await supabaseAdmin
            .from("booking_guests")
            .select("id, full_name")
            .eq("booking_id", bookingId)
            .eq("id_required", true)
            .eq("id_received", false)
            .order("created_at", { ascending: true })
            .limit(successCount);

          if (missingGuestsErr) {
            console.error("Error fetching missing booking guests:", missingGuestsErr);
          } else if (missingGuests && missingGuests.length > 0) {
            const guestIdsToUpdate = missingGuests.map((g) => g.id);

            const { error: guestUpdateErr } = await supabaseAdmin
              .from("booking_guests")
              .update({
                id_received: true,
                verification_status: "received",
              })
              .in("id", guestIdsToUpdate);

            if (guestUpdateErr) {
              console.error("Error updating booking guests:", guestUpdateErr);
            } else {
              console.log("Marked booking guests as received:", guestIdsToUpdate);
            }
          }
        }

        let finalReceivedCount = successCount;

        if (bookingId) {
          const { count: receivedGuestCount, error: receivedGuestCountErr } =
            await supabaseAdmin
              .from("booking_guests")
              .select("*", { count: "exact", head: true })
              .eq("booking_id", bookingId)
              .eq("id_required", true)
              .eq("id_received", true);

          if (receivedGuestCountErr) {
            console.error(
              "Error counting received booking guests:",
              receivedGuestCountErr
            );
          } else if (typeof receivedGuestCount === "number") {
            finalReceivedCount = receivedGuestCount;
          }
        }

        const isComplete =
          finalReceivedCount >= requiredGuestDocuments && requiredGuestDocuments > 0;
        const remaining = Math.max(requiredGuestDocuments - finalReceivedCount, 0);

        const updatePayload = {
          stage: isComplete ? "document_received" : "awaiting_guest_id",
          id_received: isComplete,
          required_guest_documents: requiredGuestDocuments,
          received_guest_documents: finalReceivedCount,
          document_status: isComplete ? "received" : "partial",
          last_inbound_at: new Date().toISOString(),
        };

        const { error: convUpdateErr } = await supabaseAdmin
          .from("conversations")
          .update(updatePayload)
          .eq("id", conversationId);

        if (convUpdateErr) {
          console.error("Conversation update error:", convUpdateErr);
        }

        if (isComplete) {
          replyText = `Thank you — we have received all ${finalReceivedCount} required guest ID document(s).`;
        } else {
          replyText = `Thank you — we have received ${finalReceivedCount} of ${requiredGuestDocuments} required guest ID document(s). Please send the remaining ${remaining}.`;
        }

        if (invalidCount > 0 || failedCount > 0) {
          replyText += ` ${invalidCount + failedCount} file(s) could not be processed. If needed, please resend them as JPG, PNG, or PDF.`;
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
        to_e164: guestPhone,
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
      if (idReceived) {
        nextRole = "guest";
        nextStage = "active";
        replyText = TOPIC_REPLIES[topic] || TOPIC_REPLIES.general;
      } else if (stage === "new") {
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

    const convUpdate: Record<string, any> = {
      required_guest_documents: requiredGuestDocuments,
      received_guest_documents: receivedGuestDocuments,
      id_received: idReceived,
      document_status: idReceived
        ? "received"
        : receivedGuestDocuments > 0
          ? "partial"
          : "not_requested",
    };

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
      to_e164: guestPhone,
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

