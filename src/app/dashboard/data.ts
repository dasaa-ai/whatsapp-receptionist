import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type DashboardConversation = {
  id: string; // real conversation UUID for routing
  displayId: string; // short id shown in UI
  guest: string;
  property: string;
  stage: string;
  language: string;
  latest: string;
  checkin: string;
  docs: string;
  status: string;
};

export type DashboardStats = {
  activeConversations: number;
  pendingIds: number;
  readyCheckins: number;
  languagesUsed: number;
};

function formatCheckin(date: string | null) {
  if (!date) return "No check-in";
  return date;
}

function mapStageToStatus(stage: string | null, documentStatus: string | null) {
  if (documentStatus === "received") return "Ready";
  if (
    stage === "awaiting_guest_id" ||
    stage === "awaiting_passport" ||
    stage === "awaiting_checkin_document"
  ) {
    return "Needs action";
  }
  return "Live chat";
}

export async function getDashboardData() {
  const [
    { count: activeConversations },
    { count: pendingIds },
    { count: readyCheckins },
    convoRes,
  ] = await Promise.all([
    supabaseAdmin
      .from("conversations")
      .select("*", { count: "exact", head: true })
      .eq("status", "open"),

    supabaseAdmin
      .from("booking_guests")
      .select("*", { count: "exact", head: true })
      .eq("id_required", true)
      .eq("id_received", false),

    supabaseAdmin
      .from("conversations")
      .select("*", { count: "exact", head: true })
      .eq("document_status", "received"),

    supabaseAdmin
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
        last_inbound_at,
        booking_id
      `)
      .order("last_inbound_at", { ascending: false })
      .limit(20),
  ]);

  if (convoRes.error) {
    throw new Error(convoRes.error.message);
  }

  const conversationsRaw = convoRes.data || [];
  const bookingIds = conversationsRaw
    .map((c: any) => c.booking_id)
    .filter(Boolean);

  const bookingsMap = new Map<string, any>();
  const propertiesMap = new Map<string, string>();

  if (bookingIds.length > 0) {
    const bookingsRes = await supabaseAdmin
      .from("bookings")
      .select(`
        id,
        checkin_date,
        lead_guest_name,
        property_id
      `)
      .in("id", bookingIds);

    if (bookingsRes.error) {
      throw new Error(bookingsRes.error.message);
    }

    for (const booking of bookingsRes.data || []) {
      bookingsMap.set(booking.id, booking);
    }

    const propertyIds = (bookingsRes.data || [])
      .map((b: any) => b.property_id)
      .filter(Boolean);

    if (propertyIds.length > 0) {
      const propertiesRes = await supabaseAdmin
        .from("properties")
        .select("id, name")
        .in("id", propertyIds);

      if (propertiesRes.error) {
        throw new Error(propertiesRes.error.message);
      }

      for (const property of propertiesRes.data || []) {
        propertiesMap.set(property.id, property.name);
      }
    }
  }

  const conversations = conversationsRaw.map((item: any): DashboardConversation => {
    const booking = item.booking_id ? bookingsMap.get(item.booking_id) : null;
    const propertyName = booking?.property_id
      ? propertiesMap.get(booking.property_id) || "Property"
      : "Property";

    const guestName =
      item.guest_name ||
      booking?.lead_guest_name ||
      "Guest";

    const language = (item.guest_language || item.host_language || "en").toUpperCase();
    const docs = `${item.received_guest_documents || 0} / ${item.required_guest_documents || 0}`;
    const status = mapStageToStatus(item.stage, item.document_status);

    return {
      id: item.id, // full conversation UUID for route
      displayId: item.booking_id
        ? String(item.booking_id).slice(0, 8)
        : String(item.id).slice(0, 8),
      guest: guestName,
      property: propertyName,
      stage: item.stage || "active",
      language,
      latest: item.last_inbound_at
        ? `Last inbound: ${item.last_inbound_at}`
        : "No recent message",
      checkin: formatCheckin(booking?.checkin_date || null),
      docs,
      status,
    };
  });

  const languageSet = new Set(
    conversations.map((c) => c.language).filter(Boolean)
  );

  const stats: DashboardStats = {
    activeConversations: activeConversations || 0,
    pendingIds: pendingIds || 0,
    readyCheckins: readyCheckins || 0,
    languagesUsed: languageSet.size,
  };

  return { stats, conversations };
}
