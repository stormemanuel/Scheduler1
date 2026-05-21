import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { MasterRateRecord } from "@/lib/rates-types";
import type { ShowRecord, LaborDayRecord, SubCallRecord, AssignmentRecord, AssignmentNoteRecord, AssignmentChecklistRecord, TextAutomationSettingsRecord, TextMessageQueueRecord } from "@/lib/events-types";
import type { TechRatingRecord } from "@/lib/client-types";

export async function getEventsPageData() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      shows: [] as ShowRecord[],
      laborDays: [] as LaborDayRecord[],
      subCalls: [] as SubCallRecord[],
      assignments: [] as AssignmentRecord[],
      masterRates: [] as MasterRateRecord[],
      assignmentNotes: [] as AssignmentNoteRecord[],
      assignmentChecklists: [] as AssignmentChecklistRecord[],
      textAutomationSettings: [] as TextAutomationSettingsRecord[],
      textMessageQueue: [] as TextMessageQueueRecord[],
      techRatings: [] as TechRatingRecord[],
      setupMissing: true,
      error: null as string | null,
    };
  }

  const showsResInitial = await supabase
    .from("shows")
    .select("id, name, client, business_client_id, client_contact_id, venue, rate_city, show_start, show_end, notes")
    .order("show_start", { ascending: true });
  const showClientColumnsMissing = Boolean(showsResInitial.error && (showsResInitial.error.message.includes("business_client_id") || showsResInitial.error.message.includes("client_contact_id")));
  const showsRes = showClientColumnsMissing
    ? await supabase.from("shows").select("id, name, client, venue, rate_city, show_start, show_end, notes").order("show_start", { ascending: true })
    : showsResInitial;

  const subCallsResInitial = await supabase
    .from("sub_calls")
    .select("id, labor_day_id, area, role_name, master_rate_id, start_time, end_time, crew_needed, notes")
    .order("start_time", { ascending: true });
  const subCallMasterRateMissing = Boolean(subCallsResInitial.error && subCallsResInitial.error.message.includes("master_rate_id"));
  const subCallsRes = subCallMasterRateMissing
    ? await supabase.from("sub_calls").select("id, labor_day_id, area, role_name, start_time, end_time, crew_needed, notes").order("start_time", { ascending: true })
    : subCallsResInitial;

  const [laborDaysRes, assignmentsRes, notesRes, checklistRes, automationRes, textQueueRes, ratesRes, ratingsRes] = await Promise.all([
    supabase.from("labor_days").select("id, show_id, labor_date, label, notes").order("labor_date", { ascending: true }),
    supabase.from("assignments").select("id, sub_call_id, crew_id, status"),
    supabase.from("assignment_notes").select("id, show_id, crew_member_id, assignment_id, note_code, note_label, custom_note, visibility, created_at").order("created_at", { ascending: true }),
    supabase.from("assignment_checklists").select("id, show_id, crew_id, schedule_sent, confirmed, day_before_confirmed, schedule_sent_at, confirmed_at, day_before_confirmed_at, updated_at"),
    supabase.from("show_text_automations").select("*"),
    supabase.from("text_message_queue").select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at").order("scheduled_for", { ascending: false }).limit(500),
    supabase.from("master_rates").select("id, city_name, role_name, full_day, half_day, overtime_multiplier, doubletime_multiplier").order("city_name", { ascending: true }).order("role_name", { ascending: true }),
    supabase.from("tech_ratings").select("id, show_id, client_id, client_contact_id, crew_id, assignment_id, rating, notes, created_at, updated_at").order("updated_at", { ascending: false }),
  ]);

  const assignmentsMissing = Boolean(assignmentsRes.error && assignmentsRes.error.message.includes('relation "assignments" does not exist'));
  const notesMissing = Boolean(notesRes.error && notesRes.error.message.includes('relation "assignment_notes" does not exist'));
  const checklistsMissing = Boolean(checklistRes.error && checklistRes.error.message.includes('relation "assignment_checklists" does not exist'));
  const automationMissing = Boolean(automationRes.error && automationRes.error.message.includes('relation "show_text_automations" does not exist'));
  const textQueueMissing = Boolean(textQueueRes.error && textQueueRes.error.message.includes('relation "text_message_queue" does not exist'));
  const ratingsMissing = Boolean(ratingsRes.error && ratingsRes.error.message.includes('relation "tech_ratings" does not exist'));
  const error = showsRes.error || laborDaysRes.error || (subCallMasterRateMissing ? null : subCallsRes.error) || (assignmentsMissing ? null : assignmentsRes.error) || (notesMissing ? null : notesRes.error) || (checklistsMissing ? null : checklistRes.error) || (automationMissing ? null : automationRes.error) || (textQueueMissing ? null : textQueueRes.error) || (ratingsMissing ? null : ratingsRes.error) || ratesRes.error;
  if (error) {
    return {
      shows: [] as ShowRecord[],
      laborDays: [] as LaborDayRecord[],
      subCalls: [] as SubCallRecord[],
      assignments: [] as AssignmentRecord[],
      masterRates: [] as MasterRateRecord[],
      assignmentNotes: [] as AssignmentNoteRecord[],
      assignmentChecklists: [] as AssignmentChecklistRecord[],
      textAutomationSettings: [] as TextAutomationSettingsRecord[],
      textMessageQueue: [] as TextMessageQueueRecord[],
      techRatings: [] as TechRatingRecord[],
      setupMissing: false,
      error: error.message,
    };
  }

  const shows = (showsRes.data ?? []).map((row) => {
    const typed = row as { id: string; name: string | null; client: string | null; business_client_id?: string | null; client_contact_id?: string | null; venue: string | null; rate_city: string | null; show_start: string; show_end: string; notes: string | null };
    return {
      id: typed.id,
      name: typed.name ?? "",
      client: typed.client ?? "",
      business_client_id: typed.business_client_id ?? null,
      client_contact_id: typed.client_contact_id ?? null,
      venue: typed.venue ?? "",
      rate_city: typed.rate_city ?? "Default",
      show_start: typed.show_start,
      show_end: typed.show_end,
      notes: typed.notes ?? "",
    } as ShowRecord;
  });

  const laborDays = (laborDaysRes.data ?? []).map((row) => {
    const typed = row as { id: string; show_id: string; labor_date: string; label: string | null; notes: string | null };
    return { id: typed.id, show_id: typed.show_id, labor_date: typed.labor_date, label: typed.label ?? "", notes: typed.notes ?? "" } as LaborDayRecord;
  });

  const subCalls = (subCallsRes.data ?? []).map((row) => {
    const typed = row as { id: string; labor_day_id: string; area: string | null; role_name: string | null; master_rate_id?: string | null; start_time: string; end_time: string | null; crew_needed: number | null; notes: string | null };
    return { id: typed.id, labor_day_id: typed.labor_day_id, area: typed.area ?? "", role_name: typed.role_name ?? "", master_rate_id: typed.master_rate_id ?? null, start_time: typed.start_time, end_time: typed.end_time ?? "", crew_needed: typed.crew_needed ?? 1, notes: typed.notes ?? "" } as SubCallRecord;
  });

  const assignments = assignmentsMissing ? [] : ((assignmentsRes.data ?? []).map((row) => {
    const typed = row as { id: string; sub_call_id: string; crew_id: string; status: string | null };
    return { id: typed.id, sub_call_id: typed.sub_call_id, crew_id: typed.crew_id, status: typed.status ?? 'confirmed' } as AssignmentRecord;
  }));

  const assignmentNotes = notesMissing ? [] : ((notesRes.data ?? []).map((row) => {
    const typed = row as { id: string; show_id: string; crew_member_id: string; assignment_id: string | null; note_code: string | null; note_label: string | null; custom_note: string | null; visibility: string | null; created_at: string };
    return {
      id: typed.id,
      show_id: typed.show_id,
      crew_member_id: typed.crew_member_id,
      assignment_id: typed.assignment_id,
      note_code: typed.note_code ?? "custom",
      note_label: typed.note_label ?? "Custom note",
      custom_note: typed.custom_note ?? "",
      visibility: typed.visibility ?? "admin_only",
      created_at: typed.created_at,
    } as AssignmentNoteRecord;
  }));

  const assignmentChecklists = checklistsMissing ? [] : ((checklistRes.data ?? []).map((row) => {
    const typed = row as {
      id: string;
      show_id: string;
      crew_id: string;
      schedule_sent: boolean | null;
      confirmed: boolean | null;
      day_before_confirmed: boolean | null;
      schedule_sent_at: string | null;
      confirmed_at: string | null;
      day_before_confirmed_at: string | null;
      updated_at: string | null;
    };
    return {
      id: typed.id,
      show_id: typed.show_id,
      crew_id: typed.crew_id,
      schedule_sent: Boolean(typed.schedule_sent),
      confirmed: Boolean(typed.confirmed),
      day_before_confirmed: Boolean(typed.day_before_confirmed),
      schedule_sent_at: typed.schedule_sent_at,
      confirmed_at: typed.confirmed_at,
      day_before_confirmed_at: typed.day_before_confirmed_at,
      updated_at: typed.updated_at ?? "",
    } as AssignmentChecklistRecord;
  }));

  const textAutomationSettings = automationMissing ? [] : ((automationRes.data ?? []).map((row) => {
    const typed = row as Partial<TextAutomationSettingsRecord> & { show_id: string };
    return {
      show_id: typed.show_id,
      enabled: Boolean(typed.enabled),
      sending_method: typed.sending_method === "shortcut" || typed.sending_method === "provider" ? typed.sending_method : "manual",
      shortcut_token: typed.shortcut_token || "",
      send_availability: Boolean(typed.send_availability),
      send_schedule: typed.send_schedule !== false,
      reminder_7_day: typed.reminder_7_day !== false,
      reminder_3_day: typed.reminder_3_day !== false,
      reminder_day_before: typed.reminder_day_before !== false,
      reminder_day_of: typed.reminder_day_of !== false,
      timezone: typed.timezone || "America/Chicago",
      availability_template: typed.availability_template || "",
      schedule_template: typed.schedule_template || "",
      reminder_template: typed.reminder_template || "",
      updated_at: typed.updated_at || null,
    } as TextAutomationSettingsRecord;
  }));

  const textMessageQueue = textQueueMissing ? [] : ((textQueueRes.data ?? []).map((row) => {
    const typed = row as Partial<TextMessageQueueRecord> & { id: string; show_id: string; scheduled_for: string; created_at: string };
    return {
      id: typed.id,
      show_id: typed.show_id,
      crew_id: typed.crew_id || null,
      crew_name: typed.crew_name || "",
      phone: typed.phone || "",
      message_type: typed.message_type || "schedule",
      reminder_key: typed.reminder_key || "manual",
      scheduled_for: typed.scheduled_for,
      status: typed.status || "scheduled",
      body: typed.body || "",
      sent_at: typed.sent_at || null,
      error: typed.error || null,
      created_at: typed.created_at,
    } as TextMessageQueueRecord;
  }));

  const techRatings = ratingsMissing ? [] : ((ratingsRes.data ?? []).map((row) => {
    const typed = row as Partial<TechRatingRecord> & { id: string; show_id: string; crew_id: string };
    return {
      id: typed.id,
      show_id: typed.show_id,
      client_id: typed.client_id || null,
      client_contact_id: typed.client_contact_id || null,
      crew_id: typed.crew_id,
      assignment_id: typed.assignment_id || null,
      rating: Number(typed.rating || 0),
      notes: typed.notes || "",
      created_at: typed.created_at || "",
      updated_at: typed.updated_at || null,
    } as TechRatingRecord;
  }));

  return {
    shows,
    laborDays,
    subCalls,
    assignments,
    assignmentNotes,
    assignmentChecklists,
    textAutomationSettings,
    textMessageQueue,
    techRatings,
    masterRates: (ratesRes.data ?? []) as MasterRateRecord[],
    setupMissing: false,
    error: null as string | null,
  };
}
