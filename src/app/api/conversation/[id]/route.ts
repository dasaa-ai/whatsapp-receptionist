import { NextResponse } from "next/server";
import { getConversationDetail } from "@/app/dashboard/[conversationId]/data";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

// GET (already exists)
export async function GET(_req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const detail = await getConversationDetail(id);

    if (!detail) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    return NextResponse.json(detail);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Unknown server error" },
      { status: 500 }
    );
  }
}

// 👇 NEW: PATCH to toggle AI pause
export async function PATCH(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await req.json();

    const aiPaused = Boolean(body?.aiPaused);

    const { error } = await supabaseAdmin
      .from("conversations")
      .update({ ai_paused: aiPaused })
      .eq("id", id);

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ success: true, aiPaused });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to update AI state" },
      { status: 500 }
    );
  }
}

