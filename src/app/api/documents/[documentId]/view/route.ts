import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type RouteContext = {
  params: Promise<{
    documentId: string;
  }>;
};

function looksLikeUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

export async function GET(_req: Request, context: RouteContext) {
  try {
    const { documentId } = await context.params;

    let docRes;

    if (looksLikeUuid(documentId)) {
      docRes = await supabaseAdmin
        .from("guest_documents")
        .select("id, storage_bucket, storage_path")
        .eq("id", documentId)
        .maybeSingle();
    } else {
      docRes = await supabaseAdmin
        .from("guest_documents")
        .select("id, storage_bucket, storage_path")
        .ilike("storage_path", `%${documentId}%`)
        .maybeSingle();
    }

    if (docRes.error) {
      return NextResponse.json({ error: docRes.error.message }, { status: 500 });
    }

    if (!docRes.data) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const bucket = docRes.data.storage_bucket;
    const path = docRes.data.storage_path;

    if (!bucket || !path) {
      return NextResponse.json(
        { error: "Document storage location missing" },
        { status: 400 }
      );
    }

    const signedRes = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUrl(path, 60 * 10);

    if (signedRes.error) {
      return NextResponse.json({ error: signedRes.error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      url: signedRes.data.signedUrl,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Unknown server error" },
      { status: 500 }
    );
  }
}
