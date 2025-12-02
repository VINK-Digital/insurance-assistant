import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Normalize insurer names so "Pty Ltd" and "Pty Limited" match
function normalizeInsurer(name: string | null) {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/pty[\.\s]*limited/g, "pty ltd")   // convert "pty limited" → "pty ltd"
    .replace(/limited/g, "ltd")                // convert "limited" → "ltd"
    .replace(/\./g, "")                        // remove dots
    .replace(/\s+/g, " ")                      // fix spacing
    .trim();
}

export async function POST(req: NextRequest) {
  try {
    const { policyId } = await req.json();

    if (!policyId) {
      return NextResponse.json(
        { error: "Missing policyId in body" },
        { status: 400 }
      );
    }

    // 1) Load policy
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

    const extractedInsurer = normalizeInsurer(policy.insurer);
    const extractedVersion = policy.wording_version.trim();

    // 2) Load all wordings to match manually
    const { data: wordings, error: wordingError } = await supabase
      .from("policy_wording")
      .select("id, insurer, wording_version");

    if (wordingError || !wordings) {
      return NextResponse.json(
        { error: "Failed to load wordings", details: wordingError },
        { status: 500 }
      );
    }

    // 3) Find best match
    const match = wordings.find((w) => {
      const normalizedW = normalizeInsurer(w.insurer);
      return (
        normalizedW === extractedInsurer &&
        w.wording_version === extractedVersion
      );
    });

    if (!match) {
      return NextResponse.json(
        {
          error: "No matching wording found",
          searched: {
            extractedInsurer,
            extractedVersion
          },
          availableWordings: wordings.map((w) => ({
            id: w.id,
            insurer: normalizeInsurer(w.insurer),
            wording_version: w.wording_version
          }))
        },
        { status: 404 }
      );
    }

    // 4) Update policy
    const { data: updated, error: updateError } = await supabase
      .from("policies")
      .update({
        wording_id: match.id,
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
