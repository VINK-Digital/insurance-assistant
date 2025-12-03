import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const customerId = searchParams.get("customerId");

    // -------------------------------
    // MODE 1: Return ALL customers
    // -------------------------------
    if (!customerId) {
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        return NextResponse.json(
          { error: "Failed to load customers", details: error },
          { status: 500 }
        );
      }

      return NextResponse.json({
        customers: data,
      });
    }

    // -------------------------------
    // MODE 2: Return CUSTOMER + POLICIES
    // -------------------------------
    const { data: customer, error: customerErr } = await supabase
      .from("customers")
      .select("*")
      .eq("id", customerId)
      .single();

    if (!customer || customerErr) {
      return NextResponse.json(
        { error: "Customer not found", details: customerErr },
        { status: 404 }
      );
    }

    const { data: policies, error: policyErr } = await supabase
      .from("policies")
      .select("*")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false });

    if (policyErr) {
      return NextResponse.json(
        { error: "Failed to load policies", details: policyErr },
        { status: 500 }
      );
    }

    return NextResponse.json({
      customer,
      policies,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Unexpected server error", details: err.message },
      { status: 500 }
      export async function POST(req: NextRequest) {
  const { name } = await req.json();

  const { data, error } = await supabase
    .from("customers")
    .insert({ name })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }

  return NextResponse.json({ customer: data });
}

    );
  }
}
