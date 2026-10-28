import { NextResponse } from "next/server";
import { canUsePage, getSessionUser, normalizeRole } from "@/lib/auth";
import { getCrewPageData } from "@/lib/crew-data";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

async function authorize(id: string, write = false) {
  const session = await getSessionUser();
  if (!session.user) return { response: NextResponse.json({ message: "Sign in to view ratings." }, { status: 401 }) };
  const role = normalizeRole(session.profile?.role);
  if (!canUsePage(role, session.access, "crew") || (write && !["owner", "admin"].includes(role))) {
    return { response: NextResponse.json({ message: "Only owners and admins can rate as ELS." }, { status: 403 }) };
  }
  const page = await getCrewPageData();
  if (page.setupMissing || page.error) return { response: NextResponse.json({ message: page.error || "Supabase is not configured." }, { status: 503 }) };
  if (!page.crewRecords.some((crew) => crew.id === id)) return { response: NextResponse.json({ message: "Crew member not found." }, { status: 404 }) };
  const admin = createSupabaseAdminClient();
  if (!admin) return { response: NextResponse.json({ message: "Ratings service is unavailable." }, { status: 503 }) };
  return { admin, page, canRate: ["owner", "admin"].includes(role) };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorize(id);
  if (auth.response) return auth.response;
  const ratings = auth.page.techRatings.filter((rating) => rating.crew_id === id);
  const showIds = [...new Set(ratings.map((rating) => rating.show_id).filter(Boolean))];
  const clientIds = [...new Set(ratings.map((rating) => rating.client_id).filter((id): id is string => Boolean(id)))];
  const [shows, clients, recentShows] = await Promise.all([
    showIds.length ? auth.admin.from("shows").select("id, name").in("id", showIds) : { data: [], error: null },
    clientIds.length ? auth.admin.from("business_clients").select("id, name").in("id", clientIds) : { data: [], error: null },
    auth.canRate ? auth.admin.from("shows").select("id, name").order("show_start", { ascending: false }).limit(250) : { data: [], error: null },
  ]);
  const error = shows.error || clients.error || recentShows.error;
  if (error) return NextResponse.json({ message: error.message }, { status: 503 });
  const allShows = [...new Map([...(recentShows.data || []), ...(shows.data || [])].map((show) => [show.id, show])).values()];
  return NextResponse.json({ ratings, clients: clients.data || [], shows: allShows, canRate: auth.canRate });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorize(id, true);
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => ({}));
  const rating = body.rating;
  const showId = typeof body.show_id === "string" ? body.show_id.trim() : "";
  if (!Number.isInteger(rating) || rating < 1 || rating > 5 || !showId) return NextResponse.json({ message: "Choose an event and a whole-star rating from 1 to 5." }, { status: 400 });
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  if (notes.length > 2000) return NextResponse.json({ message: "Notes must be 2,000 characters or fewer." }, { status: 400 });
  const show = await auth.admin.from("shows").select("id, business_client_id, client_contact_id").eq("id", showId).single();
  if (show.error || !show.data) return NextResponse.json({ message: "Event not found." }, { status: 400 });
  const result = await auth.admin.from("tech_ratings").upsert({ show_id: showId, crew_id: id, assignment_id: auth.page.techRatings.find((row) => row.show_id === showId && row.crew_id === id && row.rating_source !== "client_feedback")?.assignment_id || null, client_id: show.data.business_client_id || null, client_contact_id: show.data.client_contact_id || null, rating, notes: notes || null, updated_at: new Date().toISOString() }, { onConflict: "show_id,crew_id" }).select("id, show_id, client_id, client_contact_id, crew_id, assignment_id, rating, notes, created_at, updated_at").single();
  if (result.error) return NextResponse.json({ message: result.error.message }, { status: 400 });
  return NextResponse.json({ rating: { ...result.data, rating_source: "admin" }, message: "ELS rating saved." });
}
