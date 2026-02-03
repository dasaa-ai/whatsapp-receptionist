import { NextResponse } from "next/server";
import { supabase } from "../../../lib/supabaseClient";

export async function GET() {
  // This checks that your app can reach Supabase.
  // It does NOT require auth; it just counts rows.
  const { count, error } = await supabase
    .from("hosts")
    .select("*", { count: "exact", head: true });

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, hosts_count: count ?? 0 });
}

