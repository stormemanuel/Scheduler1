import { randomUUID } from "crypto";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { activeBookingHolds, notesWithBookingHolds, readBookingHolds, validHoldDate } from "@/lib/booking-holds";

type Admin = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
export async function updateBookingHold(admin: Admin, callId: string, actor: string, ownerAdmin: boolean, action: string, crewId: string, holdId: string, respondBy: string) {
  if (!validHoldDate(respondBy)) throw new Error("Choose a valid respond-by date.");
  const call = await admin.from("sub_calls").select("id, notes, crew_needed").eq("id", callId).maybeSingle();
  if (call.error) throw new Error(call.error.message);
  if (!call.data) throw new Error("This shift no longer exists.");
  const assigned = await admin.from("assignments").select("crew_id, status").eq("sub_call_id", callId);
  if (assigned.error) throw new Error(assigned.error.message);
  const booked = (assigned.data || []).filter(row => !["no_show_replaced", "called_in_replacement_used", "cancelled", "canceled", "removed", "declined", "unavailable"].includes(String(row.status || "").toLowerCase())).map(row => String(row.crew_id));
  let holds = activeBookingHolds(call.data.notes, booked);
  if (action === "booking_hold_add") {
    if (!crewId) throw new Error("Choose a crew member for the hold.");
    if (booked.includes(crewId)) throw new Error("This crew member is already booked on this shift.");
    if (holds.some(hold => hold.crew_id === crewId)) throw new Error("This crew member already has a hold on this shift.");
    if (booked.length + holds.length >= Number(call.data.crew_needed || 0)) throw new Error("All positions are booked or held. Release a hold before adding another.");
    const crew = await admin.from("crew").select("id").eq("id", crewId).maybeSingle();
    if (crew.error || !crew.data) throw new Error("That crew member could not be found.");
    holds.push({ id: randomUUID(), crew_id: crewId, respond_by: respondBy, created_by: actor, created_at: new Date().toISOString() });
  } else {
    const hold = readBookingHolds(call.data.notes).find(item => item.id === holdId);
    if (hold && !ownerAdmin && hold.created_by !== actor) throw new Error("Only the coordinator who placed this hold or an admin can release it.");
    holds = holds.filter(item => item.id !== holdId);
  }
  let update = admin.from("sub_calls").update({ notes: notesWithBookingHolds(call.data.notes, holds) }).eq("id", callId);
  update = call.data.notes == null ? update.is("notes", null) : update.eq("notes", call.data.notes);
  const saved = await update.select("id, notes").maybeSingle();
  if (saved.error) throw new Error(saved.error.message);
  if (!saved.data) throw new Error("This shift changed while saving the hold. Refresh staffing and try again.");
  return saved.data;
}

/** Remove the reservation after a successful booking so it cannot reappear later. */
export async function consumeBookingHoldsForCrew(admin: Admin, callId: string, crewId: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await admin.from("sub_calls").select("id, notes").eq("id", callId).maybeSingle();
    if (current.error) throw new Error(current.error.message);
    if (!current.data) return null;
    const holds = readBookingHolds(current.data.notes);
    if (!holds.some(hold => hold.crew_id === crewId)) return current.data;
    let update = admin.from("sub_calls").update({ notes: notesWithBookingHolds(current.data.notes, holds.filter(hold => hold.crew_id !== crewId)) }).eq("id", callId);
    update = current.data.notes == null ? update.is("notes", null) : update.eq("notes", current.data.notes);
    const saved = await update.select("id, notes").maybeSingle();
    if (saved.error) throw new Error(saved.error.message);
    if (saved.data) return saved.data;
  }
  throw new Error("Booking saved, but the hold changed during cleanup. Refresh staffing before making further changes.");
}
