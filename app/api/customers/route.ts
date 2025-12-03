import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ------------------------
// GET /api/customers
// ------------------------
export async function GET(req: NextRequest) {
  try {
    const customerId = req.nextUrl.searchParams.get("customerId");

    if (customerId) {
      // Return a single customer & their policies
      const { data: customer, error: customerError } = await supabase
        .from("customers")
        .select("*")
        .eq("id", customerId)
        .single();

      const { data: policies } = await supabase
        .from("policies")
        .select("*")
        .eq("customer_id", customerId);

      return NextResponse.json({
        customer,
        policies,
        error: customerError || null
      });
    }

    // Return all customers
    const { data: customers, error } = await supabase
      .from("customers")
      .select("*")
      .order("created_at", { ascending: false });

    return NextResponse.json({ customers, error });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Unexpected server error", details: err.message },
      { status: 500 }
    );
  }
}

// ------------------------
// POST /api/customers
// ------------------------
export async function POST(req: NextRequest) {
  try {
    const { name } = await req.json();

    if (!name || name.trim() === "") {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("customers")
      .insert({ name })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error }, { status: 400 });
    }

    return NextResponse.json({ customer: data });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Unexpected server error", details: err.message },
      { status: 500 }
    );
  }
}
