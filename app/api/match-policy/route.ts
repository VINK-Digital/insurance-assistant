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

    // 1) Load the policy (insurer + wording_version)
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

    const insurerRaw = policy.insurer || "";
    const versionRaw = policy.wording_version || "";

    // Normalise helper
    const norm = (s: string) =>
      s
        .toLowerCase()
        .replace(/pty\.?|limited|ltd\.?/g, "")
        .replace(/\s+/g, " ")
        .trim();

    const targetInsurer = norm(insurerRaw);
    const targetVersion = versionRaw.toLowerCase();

    // 2) Pull all candidate wordings for that insurer family
    const mainWord = insurerRaw.split(" ")[0] || ""; // e.g. "DUAL", "Agile"
    const { data: candidates, error: wordingError } = await supabase
      .from("policy_wording")
      .select("id, insurer, wording_version, file_name")
      .ilike("insurer", `%${mainWord}%`);

    if (wordingError) {
      return NextResponse.json(
        { error: "Failed to search wordings", details: wordingError },
        { status: 500 }
      );
    }

    if (!candidates || candidates.length === 0) {
      return NextResponse.json(
        {
          error: "No matching wording found",
          details: { insurer_searched: insurerRaw, version_searched: versionRaw },
        },
        { status: 404 }
      );
    }

    // 3) Fuzzy match by wording_version / file_name
    let bestMatch: any = null;

    for (const w of candidates) {
      const wInsurer = norm(w.insurer || "");
      const wVersion = (w.wording_version || "").toLowerCase();
      const fileName = (w.file_name || "").toLowerCase();

      const insurerMatch =
        wInsurer.includes(targetInsurer) || targetInsurer.includes(wInsurer);

      const versionMatch =
        !targetVersion && !wVersion
          ? true
          : targetVersion.includes(wVersion) ||
            wVersion.includes(targetVersion) ||
            fileName.includes(targetVersion) ||
            targetVersion.includes(fileName);

      if (insurerMatch && versionMatch) {
        bestMatch = w;
        break;
      }
    }

    if (!bestMatch) {
      return NextResponse.json(
        {
          error: "No matching wording found",
          details: {
            insurer_searched: insurerRaw,
            version_searched: versionRaw,
            candidates,
          },
        },
        { status: 404 }
      );
    }

    // 4) Update policy with wording_id + status
    const { data: updated, error: updateError } = await supabase
      .from("policies")
      .update({
        wording_id: bestMatch.id,
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
      { success: true, policy: updated, matched_to: bestMatch },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: "Unexpected error", details: String(err) },
      { status: 500 }
    );
  }
}
