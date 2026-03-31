import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type ConversationMessage = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  translatedBody: string | null;
  created_at: string;
};

export type ConversationDetail = {
  id: string;
  guestName: string;
  guestLanguage: string;
  hostLanguage: string;
  stage: string;
  documentStatus: string;
  requiredDocs: number;
  receivedDocs: number;
  checkinDate: string;
  propertyName: string;
  bookingId: string | null;
  aiPaused: boolean; // 👈 NEW
  messages: ConversationMessage[];
};

export async function getConversationDetail(
  conversationId: string
): Promise<ConversationDetail | null> {
  const convoRes = await supabaseAdmin
    .from("conversations")
    .select(`
  id,
  guest_name,
  guest_language,
  host_language,
  stage,
  document_status,
  required_guest_documents,
  received_guest_documents,
  booking_id,
  ai_paused
`)
    .eq("id", conversationId)
    .maybeSingle();

  if (convoRes.error) {
    throw new Error(convoRes.error.message);
  }

  if (!convoRes.data) return null;

  const conversation = convoRes.data;

  let booking: any = null;
  let propertyName = "Property";
  let checkinDate = "No check-in";

  if (conversation.booking_id) {
    const bookingRes = await supabaseAdmin
      .from("bookings")
      .select("id, checkin_date, property_id, lead_guest_name")
      .eq("id", conversation.booking_id)
      .maybeSingle();

    if (bookingRes.error) {
      throw new Error(bookingRes.error.message);
    }

    booking = bookingRes.data;

    if (booking?.checkin_date) {
      checkinDate = booking.checkin_date;
    }

    if (booking?.property_id) {
      const propertyRes = await supabaseAdmin
        .from("properties")
        .select("id, name")
        .eq("id", booking.property_id)
        .maybeSingle();

      if (propertyRes.error) {
        throw new Error(propertyRes.error.message);
      }

      propertyName = propertyRes.data?.name || "Property";
    }
  }

  const messagesRes = await supabaseAdmin
    .from("messages")
    .select("id, direction, body, translated_body, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (messagesRes.error) {
    throw new Error(messagesRes.error.message);
  }

  return {
    aiPaused: conversation.ai_paused || false,
    id: conversation.id,
    guestName: conversation.guest_name || booking?.lead_guest_name || "Guest",
    guestLanguage: (conversation.guest_language || "en").toUpperCase(),
    hostLanguage: (conversation.host_language || "en").toUpperCase(),
    stage: conversation.stage || "active",
    documentStatus: conversation.document_status || "unknown",
    requiredDocs: conversation.required_guest_documents || 0,
    receivedDocs: conversation.received_guest_documents || 0,
    checkinDate,
    propertyName,
    bookingId: conversation.booking_id || null,
    messages: (messagesRes.data || []).map((m: any) => ({
      id: m.id,
      direction: m.direction,
      body: m.body || "",
      translatedBody: m.translated_body || null,
      created_at: m.created_at,
    })),
  };
}
