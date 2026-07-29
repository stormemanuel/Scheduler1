import { NextResponse } from "next/server";
import { canUsePage, getSessionUser, normalizeRole } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Result = {
  id: string;
  type: string;
  label: string;
  detail: string;
  href: string;
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function matches(row: Record<string, unknown>, query: string) {
  const haystack = Object.values(row).map(clean).join(" ").toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function searchPattern(query: string) {
  return `*${query.replace(/[%_,]/g, " ").replace(/\s+/g, " ").trim()}*`;
}

function qHref(path: string, q: string) {
  return `${path}?q=${encodeURIComponent(q)}`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = clean(url.searchParams.get("q")).slice(0, 120);
  if (query.length < 2) return NextResponse.json({ results: [] });

  const session = await getSessionUser();
  if (!session.user) return NextResponse.json({ results: [] }, { status: 401 });

  const role = normalizeRole(session.profile?.role as string | null | undefined);
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ results: [] });
  const pattern = searchPattern(query);

  const results: Result[] = [];

  if (canUsePage(role, session.access, "events")) {
    const restrictEvents = Boolean(role === "coordinator" && session.access?.restrict_events_to_owner && session.user?.id);
    const { data: accessRows } = restrictEvents
      ? await supabase.from("event_user_access").select("show_id").eq("user_id", session.user.id)
      : { data: [] as Array<{ show_id: string }> };
    const sharedIds = new Set((accessRows ?? []).map((row) => String((row as { show_id: string }).show_id)));
    const { data } = await supabase
      .from("shows")
      .select("id, name, client, venue, rate_city, show_start, show_end, notes, created_by")
      .or(`name.ilike.${pattern},client.ilike.${pattern},venue.ilike.${pattern},rate_city.ilike.${pattern},notes.ilike.${pattern}`)
      .order("show_start", { ascending: false })
      .limit(20);
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      if (restrictEvents && clean(row.created_by) !== session.user.id && !sharedIds.has(clean(row.id))) continue;
      if (!matches(row, query)) continue;
      results.push({
        id: clean(row.id),
        type: "Event",
        label: clean(row.name) || "Untitled event",
        detail: [clean(row.client), clean(row.venue), clean(row.show_start)].filter(Boolean).join(" • "),
        href: qHref("/events", query),
      });
    }
  }

  if (canUsePage(role, session.access, "crew")) {
    const restrictCrew = Boolean(role === "coordinator" && session.access?.restrict_crew_to_owner && session.user?.id);
    const allowedPoolIds = new Set(session.access?.allowed_city_pool_ids ?? []);
    const { data } = await supabase
      .from("crew")
      .select("id, name, phone, email, other_city, group_name, tier, notes, created_by, city_pool_id")
      .or(`name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern},other_city.ilike.${pattern},group_name.ilike.${pattern},tier.ilike.${pattern},notes.ilike.${pattern}`)
      .order("name", { ascending: true })
      .limit(20);
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      if (restrictCrew && clean(row.created_by) !== session.user.id) continue;
      if (!restrictCrew && role === "coordinator" && allowedPoolIds.size && !allowedPoolIds.has(clean(row.city_pool_id))) continue;
      if (!matches(row, query)) continue;
      results.push({
        id: clean(row.id),
        type: "Crew",
        label: clean(row.name) || "Unnamed tech",
        detail: [clean(row.other_city), clean(row.group_name), clean(row.tier), clean(row.phone), clean(row.email)].filter(Boolean).join(" • "),
        href: qHref("/crew", query),
      });
    }
  }

  if (canUsePage(role, session.access, "clients")) {
    const restrictClients = Boolean(role === "coordinator" && session.user?.id);
    const { data } = await supabase
      .from("business_clients")
      .select("id, name, legal_company_name, main_email, main_phone, billing_city, billing_state, notes, created_by")
      .or(`name.ilike.${pattern},legal_company_name.ilike.${pattern},main_email.ilike.${pattern},main_phone.ilike.${pattern},billing_city.ilike.${pattern},billing_state.ilike.${pattern},notes.ilike.${pattern}`)
      .order("name", { ascending: true })
      .limit(12);
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      if (restrictClients && clean(row.created_by) !== session.user.id) continue;
      if (!matches(row, query)) continue;
      results.push({
        id: clean(row.id),
        type: "Client",
        label: clean(row.name) || clean(row.legal_company_name) || "Client",
        detail: [clean(row.billing_city), clean(row.billing_state), clean(row.main_phone), clean(row.main_email)].filter(Boolean).join(" • "),
        href: qHref("/clients", query),
      });
    }
  }

  if (canUsePage(role, session.access, "pipelines")) {
    const { data } = await supabase
      .from("sales_opportunities")
      .select("id, opportunity_name, city, state, venue, service_line, status, notes")
      .or(`opportunity_name.ilike.${pattern},city.ilike.${pattern},state.ilike.${pattern},venue.ilike.${pattern},service_line.ilike.${pattern},status.ilike.${pattern},notes.ilike.${pattern}`)
      .order("opportunity_name", { ascending: true })
      .limit(12);
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      if (!matches(row, query)) continue;
      results.push({
        id: clean(row.id),
        type: "Sales",
        label: clean(row.opportunity_name) || "Opportunity",
        detail: [clean(row.service_line), clean(row.city), clean(row.state), clean(row.status)].filter(Boolean).join(" • "),
        href: qHref("/pipelines", query),
      });
    }
  }

  return NextResponse.json({ results: results.slice(0, 12) });
}
