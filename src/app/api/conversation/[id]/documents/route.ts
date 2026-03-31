import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;

    const convoRes = await supabaseAdmin
      .from("conversations")
      .select("id, guest_name")
      .eq("id", id)
      .maybeSingle();

    if (convoRes.error) {
      return NextResponse.json({ error: convoRes.error.message }, { status: 500 });
    }

    if (!convoRes.data) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const docsRes = await supabaseAdmin
      .from("guest_documents")
      .select(`
        id,
        mime_type,
        review_status,
        verification_status,
        storage_bucket,
        storage_path,
        file_size_bytes,
        document_kind,
        created_at,
        ai_screening_status,
        ai_screening_notes,
        ai_screened_at
      `)
      .eq("conversation_id", id)
      .order("created_at", { ascending: false });

    if (docsRes.error) {
      return NextResponse.json({ error: docsRes.error.message }, { status: 500 });
    }

    return NextResponse.json({
      guestName: convoRes.data.guest_name || "Guest",
      conversationId: id,
      documents: docsRes.data || [],
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Unknown server error" },
      { status: 500 }
    );
  }
}