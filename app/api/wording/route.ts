import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const { data, error } = await supabase
    .from("policy_wording")
    .select("id, insurer, wording_version")
    .order("insurer", { ascending: true });

  if (error) {
    return NextResponse.json({ wordings: [] });
  }

  return NextResponse.json({ wordings: data });
}
