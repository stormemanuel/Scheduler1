import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";
import { editCallNext, notesWithCallNext, readCallNext } from "@/lib/call-next";

export async function POST(request: Request) {
  const session = await createSupabaseServerClient();
  const user = session ? (await session.auth.getUser()).data.user : null;
  if (!user) return NextResponse.json({message:"Unauthorized."},{status:401});
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({message:"Supabase is not configured."},{status:500});
  try {
    const body = await request.json();
    const showId = String(body.show_id || "").trim();
    const action = String(body.action || "");
    if (!showId || !["list","add","remove","up","down"].includes(action)) return NextResponse.json({message:"Choose an event and a valid action."},{status:400});
    const profile = await admin.from("profiles").select("role").eq("id",user.id).maybeSingle();
    if (profile.error) throw new Error(profile.error.message);
    const role = String(profile.data?.role || "").toLowerCase();
    const owner = ["owner","admin"].includes(role);
    if (!owner && role !== "coordinator") return NextResponse.json({message:"Only event coordinators and admins can manage Call Next."},{status:403});
    const show = await admin.from("shows").select("id, notes, created_by, assigned_coordinator_user_id").eq("id",showId).maybeSingle();
    if (show.error) throw new Error(show.error.message);
    if (!show.data) return NextResponse.json({message:"Event not found."},{status:404});
    let allowed = owner || show.data.created_by === user.id || show.data.assigned_coordinator_user_id === user.id;
    if (!allowed) {
      let shared = await admin.from("event_user_access").select("id").eq("show_id",showId).eq("user_id",user.id).limit(1);
      if (shared.error?.message.includes("user_id")) shared = await admin.from("event_user_access").select("id").eq("show_id",showId).eq("user_profile_id",user.id).limit(1);
      if (shared.error) throw new Error(shared.error.message);
      allowed = Boolean(shared.data?.length);
    }
    if (!allowed) {
      const days = await admin.from("labor_days").select("id").eq("show_id",showId);
      if (days.error) throw new Error(days.error.message);
      if (days.data?.length) {
        const calls = await admin.from("sub_calls").select("id").in("labor_day_id",days.data.map(day=>day.id)).eq("assigned_coordinator_user_id",user.id).limit(1);
        if (calls.error) throw new Error(calls.error.message);
        allowed = Boolean(calls.data?.length);
      }
    }
    if (!allowed) return NextResponse.json({message:"You do not have access to this event."},{status:403});
    if (action === "list") return NextResponse.json({ok:true,show:{id:showId,notes:show.data.notes}});
    const crewId = String(body.crew_id || "").trim();
    if (action === "add") {
      const crew = await admin.from("crew").select("id").eq("id",crewId).maybeSingle();
      if (crew.error || !crew.data) return NextResponse.json({message:"Choose an existing crew member."},{status:400});
    }
    const entries = editCallNext(readCallNext(show.data.notes),user.id,owner,action,String(body.id || ""),action === "add" ? {id:randomUUID(),crew_id:crewId,created_by:user.id,created_at:new Date().toISOString(),note:String(body.note || "").trim().slice(0,200)} : undefined);
    let update = admin.from("shows").update({notes:notesWithCallNext(show.data.notes,entries)}).eq("id",showId);
    update = show.data.notes == null ? update.is("notes",null) : update.eq("notes",show.data.notes);
    const saved = await update.select("id, notes").maybeSingle();
    if (saved.error) throw new Error(saved.error.message);
    if (!saved.data) return NextResponse.json({message:"This event changed while saving. Refresh Call Next and try again."},{status:409});
    return NextResponse.json({ok:true,show:saved.data});
  } catch (error) { return NextResponse.json({message:error instanceof Error?error.message:"Could not update Call Next."},{status:400}); }
}
