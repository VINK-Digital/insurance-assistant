import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { policyId } = await req.json();

    if (!policyId) {
      return NextResponse.json(
        { error: "Missing policyId in body" },
        { status: 400 }
      );
    }

    // 1) Load policy details
    const { data: policy, error: policyError } = await supabase
      .from("policies")
      .select("id, insurer, wording_version")
      .eq("id", policyId)
      .single();

    if (!policy || policyError) {
      return NextResponse.json(
        { error: "Policy not found", details: policyError },
        { status: 404 }
      );
    }

    // 2) Flexible matching for insurer (covers Pty Ltd vs Pty Limited)
    const { data: wording, error: wordingError } = await supabase
      .from("policy_wording")
      .select("id, insurer, wording_version")
      .ilike("insurer", `%${policy.insurer}%`)
      .eq("wording_version", policy.wording_version)
      .single();

    if (!wording || wordingError) {
      return NextResponse.json(
        {
          error: "No matching wording found",
          details: wordingError,
          debug: {
            insurer_searched: policy.insurer,
            version_searched: policy.wording_version,
          }
        },
        { status: 404 }
      );
    }

    // 3) Update policy with wording_id
    const { data: updated, error: updateError } = await supabase
      .from("policies")
      .update({
        wording_id: wording.id,
        status: "matched",
      })
      .eq("id", policy.id)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: "Failed to update policy", details: updateError },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { success: true, policy: updated },
      { status: 200 }
    );

  } catch (err: any) {
    return NextResponse.json(
      { error: "Unexpected error", details: String(err) },
      { status: 500 }
    );
  }
}
