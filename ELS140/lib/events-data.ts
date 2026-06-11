import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getSessionUser, normalizeRole } from "@/lib/auth";
import type { MasterRateRecord } from "@/lib/rates-types";
import type { ShowRecord, LaborDayRecord, SubCallRecord, AssignmentRecord, AssignmentNoteRecord, AssignmentChecklistRecord, TextAutomationSettingsRecord, TextMessageQueueRecord, EventUserAccessRecord, ClientFeedbackResponseRecord, ClientFeedbackScoreRecord, FeedbackTechRatingRecord } from "@/lib/events-types";
import type { AppUserSummaryRecord, TechRatingRecord } from "@/lib/client-types";

function cleanEventSearchTerm(value: string | null | undefined) {
  return (value || "").replace(/[%_,]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

function eventSearchOrFilter(search: string) {
  const token = cleanEventSearchTerm(search);
  if (!token) return null;
  const pattern = `*${token}*`;
  return [`name.ilike.${pattern}`, `client.ilike.${pattern}`, `venue.ilike.${pattern}`, `rate_city.ilike.${pattern}`].join(",");
}

export async function getEventsPageData(options: { search?: string; showLimit?: number } = {}) {
  const session = await getSessionUser();
  const role = normalizeRole(session.profile?.role as string | null | undefined);
  const restrictToOwner = Boolean(session.access?.restrict_events_to_owner && role === "coordinator" && session.user?.id);
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
      clientFeedbackResponses: [] as ClientFeedbackResponseRecord[],
      clientFeedbackScores: [] as ClientFeedbackScoreRecord[],
      feedbackTechRatings: [] as FeedbackTechRatingRecord[],
      eventUserAccess: [] as EventUserAccessRecord[],
      appUsers: [] as AppUserSummaryRecord[],
      setupMissing: true,
      error: null as string | null,
    };
  }

  const serverSearch = cleanEventSearchTerm(options.search);
  const showLimit = Math.min(Math.max(options.showLimit ?? 80, 20), 200);
  const recentFloor = new Date(Date.now() - 1000 * 60 * 60 * 24 * 45).toISOString().slice(0, 10);
  const searchFilter = eventSearchOrFilter(serverSearch);

  let showsQueryInitial = supabase
    .from("shows")
    .select("id, name, client, business_client_id, client_contact_id, coordinator_contact_id, assigned_coordinator_user_id, venue, rate_city, show_start, show_end, notes, created_by")
    .order("show_start", { ascending: true });
  if (searchFilter) {
    showsQueryInitial = showsQueryInitial.or(searchFilter);
  } else {
    showsQueryInitial = showsQueryInitial.gte("show_end", recentFloor).limit(showLimit);
  }
  const showsResInitial = await showsQueryInitial;
  const showClientColumnsMissing = Boolean(showsResInitial.error && (showsResInitial.error.message.includes("business_client_id") || showsResInitial.error.message.includes("client_contact_id") || showsResInitial.error.message.includes("coordinator_contact_id") || showsResInitial.error.message.includes("assigned_coordinator_user_id") || showsResInitial.error.message.includes("created_by")));
  let fallbackShowsQuery = supabase
    .from("shows")
    .select("id, name, client, venue, rate_city, show_start, show_end, notes")
    .order("show_start", { ascending: true });
  if (searchFilter) {
    fallbackShowsQuery = fallbackShowsQuery.or(searchFilter);
  } else {
    fallbackShowsQuery = fallbackShowsQuery.gte("show_end", recentFloor).limit(showLimit);
  }
  const showsRes = showClientColumnsMissing ? await fallbackShowsQuery : showsResInitial;

  const allLoadedShowRows = (showsRes.data ?? []) as Array<{ id: string; created_by?: string | null }> ;
  let eventAccessRows: EventUserAccessRecord[] = [];
  if (allLoadedShowRows.length) {
    const showIds = allLoadedShowRows.map((show) => show.id);
    const accessRes = await supabase
      .from("event_user_access")
      .select("id, show_id, user_id, user_profile_id, access_role, created_at")
      .in("show_id", showIds);
    const accessFallbackRes = accessRes.error && accessRes.error.message.includes("user_profile_id")
      ? await supabase
          .from("event_user_access")
          .select("id, show_id, user_id, access_role, created_at")
          .in("show_id", showIds)
      : accessRes;
    if (!accessFallbackRes.error) {
      eventAccessRows = ((accessFallbackRes.data ?? []) as Array<EventUserAccessRecord & { user_profile_id?: string | null }>).map((row) => ({
        ...row,
        user_id: row.user_id || row.user_profile_id || "",
        user_profile_id: row.user_profile_id || row.user_id || null,
      }));
    }
  }
  const sharedShowIdsForUser = new Set(eventAccessRows.filter((row) => row.user_id === session.user?.id || row.user_profile_id === session.user?.id).map((row) => row.show_id));
  const visibleShowIds = new Set(
    allLoadedShowRows.flatMap((show) => {
      if (!restrictToOwner) return [show.id];
      return show.created_by === session.user?.id || sharedShowIdsForUser.has(show.id) ? [show.id] : [];
    })
  );

  const visibleShowIdList = [...visibleShowIds];
  eventAccessRows = eventAccessRows.filter((row) => visibleShowIds.has(row.show_id));
  const emptyResult = { data: [], error: null };

  const laborDaysRes = visibleShowIdList.length
    ? await supabase
        .from("labor_days")
        .select("id, show_id, labor_date, label, notes")
        .in("show_id", visibleShowIdList)
        .order("labor_date", { ascending: true })
    : emptyResult;

  const visibleLaborDayIds = (laborDaysRes.data ?? []).map((row) => String((row as { id: string }).id));

  const subCallsResInitial = visibleLaborDayIds.length
    ? await supabase
        .from("sub_calls")
        .select("id, labor_day_id, area, location, po_number, role_name, master_rate_id, message_rate, start_time, end_time, crew_needed, notes, sort_order, day_type, one_hour_walkaway")
        .in("labor_day_id", visibleLaborDayIds)
        .order("labor_day_id", { ascending: true })
        .order("sort_order", { ascending: true })
        .order("start_time", { ascending: true })
    : emptyResult;
  const subCallExtraColumnsMissing = Boolean(subCallsResInitial.error && (subCallsResInitial.error.message.includes("master_rate_id") || subCallsResInitial.error.message.includes("message_rate") || subCallsResInitial.error.message.includes("location") || subCallsResInitial.error.message.includes("po_number") || subCallsResInitial.error.message.includes("sort_order") || subCallsResInitial.error.message.includes("day_type") || subCallsResInitial.error.message.includes("one_hour_walkaway")));
  const subCallsRes = subCallExtraColumnsMissing && visibleLaborDayIds.length
    ? await supabase
        .from("sub_calls")
        .select("id, labor_day_id, area, role_name, start_time, end_time, crew_needed, notes")
        .in("labor_day_id", visibleLaborDayIds)
        .order("labor_day_id", { ascending: true })
        .order("start_time", { ascending: true })
    : subCallsResInitial;

  const visibleSubCallIds = (subCallsRes.data ?? []).map((row) => String((row as { id: string }).id));

  const assignmentsResInitial = visibleSubCallIds.length
    ? await supabase
        .from("assignments")
        .select("id, sub_call_id, crew_id, status, sort_order, start_time, end_time, day_type")
        .in("sub_call_id", visibleSubCallIds)
        .order("sub_call_id", { ascending: true })
        .order("sort_order", { ascending: true })
    : emptyResult;
  const assignmentsSortOrderMissing = Boolean(assignmentsResInitial.error && (assignmentsResInitial.error.message.includes("sort_order") || assignmentsResInitial.error.message.includes("start_time") || assignmentsResInitial.error.message.includes("end_time") || assignmentsResInitial.error.message.includes("day_type")));
  const assignmentsRes = assignmentsSortOrderMissing && visibleSubCallIds.length
    ? await supabase
        .from("assignments")
        .select("id, sub_call_id, crew_id, status")
        .in("sub_call_id", visibleSubCallIds)
    : assignmentsResInitial;

  const [notesRes, checklistRes, automationRes, textQueueRes, ratesRes, ratingsRes] = await Promise.all([
    visibleShowIdList.length
      ? supabase
          .from("assignment_notes")
          .select("id, show_id, crew_member_id, assignment_id, note_code, note_label, custom_note, visibility, created_at")
          .in("show_id", visibleShowIdList)
          .order("created_at", { ascending: true })
      : emptyResult,
    visibleShowIdList.length
      ? supabase
          .from("assignment_checklists")
          .select("id, show_id, crew_id, schedule_sent, confirmed, day_before_confirmed, schedule_sent_at, confirmed_at, day_before_confirmed_at, updated_at")
          .in("show_id", visibleShowIdList)
      : emptyResult,
    visibleShowIdList.length
      ? supabase
          .from("show_text_automations")
          .select("*")
          .in("show_id", visibleShowIdList)
      : emptyResult,
    visibleShowIdList.length
      ? supabase
          .from("text_message_queue")
          .select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at")
          .in("show_id", visibleShowIdList)
          .order("scheduled_for", { ascending: false })
          .limit(500)
      : emptyResult,
    supabase.from("master_rates").select("id, city_name, role_name, full_day, half_day, overtime_multiplier, doubletime_multiplier").order("city_name", { ascending: true }).order("role_name", { ascending: true }),
    visibleShowIdList.length
      ? supabase
          .from("tech_ratings")
          .select("id, show_id, client_id, client_contact_id, crew_id, assignment_id, rating, notes, created_at, updated_at")
          .in("show_id", visibleShowIdList)
          .order("updated_at", { ascending: false })
      : emptyResult,
  ]);

  const feedbackRatingsRes = visibleShowIdList.length
    ? await supabase
        .from("client_feedback_top_tech_ratings")
        .select("id, show_id, client_id, client_contact_id, crew_id, assignment_id, rating, notes, created_at, updated_at, rating_source")
        .in("show_id", visibleShowIdList)
        .order("updated_at", { ascending: false })
    : emptyResult;

  const feedbackResponsesResInitial = visibleShowIdList.length
    ? await supabase
        .from("client_feedback_responses")
        .select("id, survey_link_id, show_id, client_id, client_contact_id, form_kind, area_name, respondent_name, respondent_title, respondent_email, request_again, testimonial_permission, testimonial_text, went_well, follow_up, additional_comments, submitted_at, rating_approved, reviewed_at, reviewed_by, excluded_from_ratings, excluded_reason, excluded_at")
        .in("show_id", visibleShowIdList)
        .order("submitted_at", { ascending: false })
    : emptyResult;
  const feedbackResponsesExcludeColumnsMissing = Boolean(feedbackResponsesResInitial.error && (
    feedbackResponsesResInitial.error.message.includes("excluded_from_ratings") ||
    feedbackResponsesResInitial.error.message.includes("excluded_reason") ||
    feedbackResponsesResInitial.error.message.includes("excluded_at") ||
    feedbackResponsesResInitial.error.message.includes("rating_approved") ||
    feedbackResponsesResInitial.error.message.includes("reviewed_at") ||
    feedbackResponsesResInitial.error.message.includes("reviewed_by")
  ));
  const feedbackResponsesRes = feedbackResponsesExcludeColumnsMissing && visibleShowIdList.length
    ? await supabase
        .from("client_feedback_responses")
        .select("id, survey_link_id, show_id, client_id, client_contact_id, form_kind, area_name, respondent_name, respondent_title, respondent_email, request_again, testimonial_permission, testimonial_text, went_well, follow_up, additional_comments, submitted_at")
        .in("show_id", visibleShowIdList)
        .order("submitted_at", { ascending: false })
    : feedbackResponsesResInitial;

  const visibleFeedbackResponseIds = (feedbackResponsesRes.data ?? []).map((row) => String((row as { id: string }).id));

  const feedbackScoresRes = visibleFeedbackResponseIds.length
    ? await supabase
        .from("client_feedback_scores")
        .select("id, response_id, question_key, question_label, rating, created_at")
        .in("response_id", visibleFeedbackResponseIds)
        .order("created_at", { ascending: true })
    : emptyResult;

  const feedbackTechRowsRes = visibleShowIdList.length
    ? await supabase
        .from("feedback_tech_ratings")
        .select("id, response_id, survey_link_id, show_id, client_id, client_contact_id, crew_id, assignment_id, area_name, rating, request_again, notes, submitted_at")
        .in("show_id", visibleShowIdList)
        .order("submitted_at", { ascending: false })
    : emptyResult;

  const profilesRes = await supabase.from("profiles").select("id, email, full_name, role, is_active");
  const appUsers = (profilesRes.data ?? []).map((row) => {
    const typed = row as Partial<AppUserSummaryRecord> & { id: string };
    return {
      id: typed.id,
      email: typed.email || "",
      full_name: typed.full_name || typed.email || "Unknown user",
      role: typed.role || "viewer",
      is_active: typed.is_active !== false,
    } as AppUserSummaryRecord;
  });

  const assignmentsMissing = Boolean(assignmentsRes.error && assignmentsRes.error.message.includes('relation "assignments" does not exist'));
  const notesMissing = Boolean(notesRes.error && notesRes.error.message.includes('relation "assignment_notes" does not exist'));
  const checklistsMissing = Boolean(checklistRes.error && checklistRes.error.message.includes('relation "assignment_checklists" does not exist'));
  const automationMissing = Boolean(automationRes.error && automationRes.error.message.includes('relation "show_text_automations" does not exist'));
  const textQueueMissing = Boolean(textQueueRes.error && textQueueRes.error.message.includes('relation "text_message_queue" does not exist'));
  const ratingsMissing = Boolean(ratingsRes.error && ratingsRes.error.message.includes('relation "tech_ratings" does not exist'));
  const feedbackRatingsMissing = Boolean(feedbackRatingsRes.error && (feedbackRatingsRes.error.message.includes('relation "client_feedback_top_tech_ratings" does not exist') || feedbackRatingsRes.error.message.includes('client_feedback_top_tech_ratings') || feedbackRatingsRes.error.message.includes('schema cache')));
  const feedbackResponsesMissing = Boolean(feedbackResponsesRes.error && (feedbackResponsesRes.error.message.includes('relation "client_feedback_responses" does not exist') || feedbackResponsesRes.error.message.includes('client_feedback_responses') || feedbackResponsesRes.error.message.includes('schema cache')));
  const feedbackScoresMissing = Boolean(feedbackScoresRes.error && (feedbackScoresRes.error.message.includes('relation "client_feedback_scores" does not exist') || feedbackScoresRes.error.message.includes('client_feedback_scores') || feedbackScoresRes.error.message.includes('schema cache')));
  const feedbackTechRowsMissing = Boolean(feedbackTechRowsRes.error && (feedbackTechRowsRes.error.message.includes('relation "feedback_tech_ratings" does not exist') || feedbackTechRowsRes.error.message.includes('feedback_tech_ratings') || feedbackTechRowsRes.error.message.includes('schema cache')));
  const error = showsRes.error || laborDaysRes.error || (subCallExtraColumnsMissing ? null : subCallsRes.error) || (assignmentsMissing ? null : assignmentsRes.error) || (notesMissing ? null : notesRes.error) || (checklistsMissing ? null : checklistRes.error) || (automationMissing ? null : automationRes.error) || (textQueueMissing ? null : textQueueRes.error) || (ratingsMissing ? null : ratingsRes.error) || (feedbackRatingsMissing ? null : feedbackRatingsRes.error) || (feedbackResponsesMissing ? null : feedbackResponsesRes.error) || (feedbackScoresMissing ? null : feedbackScoresRes.error) || (feedbackTechRowsMissing ? null : feedbackTechRowsRes.error) || ratesRes.error;
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
      clientFeedbackResponses: [] as ClientFeedbackResponseRecord[],
      clientFeedbackScores: [] as ClientFeedbackScoreRecord[],
      feedbackTechRatings: [] as FeedbackTechRatingRecord[],
      eventUserAccess: [] as EventUserAccessRecord[],
      appUsers: [] as AppUserSummaryRecord[],
      setupMissing: false,
      error: error.message,
    };
  }

  const shows = (showsRes.data ?? []).filter((row) => visibleShowIds.has(String((row as { id: string }).id))).map((row) => {
    const typed = row as { id: string; name: string | null; client: string | null; business_client_id?: string | null; client_contact_id?: string | null; coordinator_contact_id?: string | null; assigned_coordinator_user_id?: string | null; venue: string | null; rate_city: string | null; show_start: string; show_end: string; notes: string | null; created_by?: string | null };
    return {
      id: typed.id,
      name: typed.name ?? "",
      client: typed.client ?? "",
      business_client_id: typed.business_client_id ?? null,
      client_contact_id: typed.client_contact_id ?? null,
      coordinator_contact_id: typed.coordinator_contact_id ?? null,
      assigned_coordinator_user_id: typed.assigned_coordinator_user_id ?? null,
      venue: typed.venue ?? "",
      rate_city: typed.rate_city ?? "Default",
      show_start: typed.show_start,
      show_end: typed.show_end,
      notes: typed.notes ?? "",
      created_by: typed.created_by ?? null,
    } as ShowRecord;
  });

  const laborDays = (laborDaysRes.data ?? []).filter((row) => visibleShowIds.has(String((row as { show_id: string }).show_id))).map((row) => {
    const typed = row as { id: string; show_id: string; labor_date: string; label: string | null; notes: string | null; created_by?: string | null };
    return { id: typed.id, show_id: typed.show_id, labor_date: typed.labor_date, label: typed.label ?? "", notes: typed.notes ?? "" } as LaborDayRecord;
  });

  const subCalls = (subCallsRes.data ?? []).map((row) => {
    const typed = row as { id: string; labor_day_id: string; area: string | null; location?: string | null; role_name: string | null; master_rate_id?: string | null; message_rate?: string | number | null; start_time: string; end_time: string | null; crew_needed: number | null; notes: string | null; sort_order?: number | null; day_type?: string | null; one_hour_walkaway?: boolean | null; created_by?: string | null };
    return { id: typed.id, labor_day_id: typed.labor_day_id, area: typed.area ?? "", location: typed.location ?? "", role_name: typed.role_name ?? "", master_rate_id: typed.master_rate_id ?? null, message_rate: typed.message_rate != null ? String(typed.message_rate) : null, start_time: typed.start_time, end_time: typed.end_time ?? "", crew_needed: typed.crew_needed ?? 1, notes: typed.notes ?? "", sort_order: typed.sort_order ?? 0, day_type: typed.day_type || "full_day", one_hour_walkaway: Boolean(typed.one_hour_walkaway) } as SubCallRecord;
  });

  const assignments = assignmentsMissing ? [] : ((assignmentsRes.data ?? []).map((row, index) => {
    const typed = row as { id: string; sub_call_id: string; crew_id: string; status: string | null; sort_order?: number | null; start_time?: string | null; end_time?: string | null; day_type?: string | null };
    return { id: typed.id, sub_call_id: typed.sub_call_id, crew_id: typed.crew_id, status: typed.status ?? 'confirmed', sort_order: typed.sort_order ?? index + 1, start_time: typed.start_time || null, end_time: typed.end_time || null, day_type: typed.day_type || null } as AssignmentRecord;
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
      sending_method: typed.sending_method === "provider" ? "provider" : "shortcut",
      shortcut_token: typed.shortcut_token || "",
      send_availability: Boolean(typed.send_availability),
      send_schedule: typed.send_schedule !== false,
      reminder_7_day: typed.reminder_7_day !== false,
      reminder_3_day: Boolean(typed.reminder_3_day),
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

  const adminRatings = ratingsMissing ? [] : ((ratingsRes.data ?? []).map((row) => {
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
      rating_source: "admin",
    } as TechRatingRecord;
  }));

  const feedbackRatings = feedbackRatingsMissing ? [] : ((feedbackRatingsRes.data ?? []).map((row) => {
    const typed = row as Partial<TechRatingRecord> & { id: string; show_id: string; crew_id: string };
    return {
      id: `feedback-${typed.id}`,
      show_id: typed.show_id,
      client_id: typed.client_id || null,
      client_contact_id: typed.client_contact_id || null,
      crew_id: typed.crew_id,
      assignment_id: typed.assignment_id || null,
      rating: Number(typed.rating || 0),
      notes: typed.notes || "",
      created_at: typed.created_at || "",
      updated_at: typed.updated_at || null,
      rating_source: typed.rating_source || "client_feedback",
    } as TechRatingRecord;
  }));

  const techRatings = [...adminRatings, ...feedbackRatings];

  const clientFeedbackResponses = feedbackResponsesMissing ? [] : ((feedbackResponsesRes.data ?? []).map((row) => {
    const typed = row as Partial<ClientFeedbackResponseRecord> & { id: string; survey_link_id: string; show_id: string; form_kind: string; submitted_at: string };
    return {
      id: typed.id,
      survey_link_id: typed.survey_link_id,
      show_id: typed.show_id,
      client_id: typed.client_id || null,
      client_contact_id: typed.client_contact_id || null,
      form_kind: typed.form_kind === "area-manager" ? "area-manager" : typed.form_kind === "crew-lead" ? "crew-lead" : typed.form_kind === "labor-coordinator" ? "labor-coordinator" : "project-manager",
      area_name: typed.area_name || "",
      respondent_name: typed.respondent_name || "",
      respondent_title: typed.respondent_title || "",
      respondent_email: typed.respondent_email || "",
      request_again: typed.request_again || "",
      testimonial_permission: typed.testimonial_permission || "",
      testimonial_text: typed.testimonial_text || "",
      went_well: typed.went_well || "",
      follow_up: typed.follow_up || "",
      additional_comments: typed.additional_comments || "",
      submitted_at: typed.submitted_at,
      rating_approved: Boolean(typed.rating_approved),
      reviewed_at: typed.reviewed_at || null,
      reviewed_by: typed.reviewed_by || null,
      excluded_from_ratings: Boolean(typed.excluded_from_ratings),
      excluded_reason: typed.excluded_reason || "",
      excluded_at: typed.excluded_at || null,
    } as ClientFeedbackResponseRecord;
  }));

  const clientFeedbackScores = feedbackScoresMissing ? [] : ((feedbackScoresRes.data ?? []).map((row) => {
    const typed = row as Partial<ClientFeedbackScoreRecord> & { id: string; response_id: string; question_key: string; question_label: string; created_at: string };
    return {
      id: typed.id,
      response_id: typed.response_id,
      question_key: typed.question_key || "",
      question_label: typed.question_label || "",
      rating: typed.rating == null ? null : Number(typed.rating),
      created_at: typed.created_at || "",
    } as ClientFeedbackScoreRecord;
  }));

  const feedbackTechRatings = feedbackTechRowsMissing ? [] : ((feedbackTechRowsRes.data ?? []).map((row) => {
    const typed = row as Partial<FeedbackTechRatingRecord> & { id: string; response_id: string; survey_link_id: string; show_id: string; crew_id: string; rating: number; submitted_at: string };
    return {
      id: typed.id,
      response_id: typed.response_id,
      survey_link_id: typed.survey_link_id,
      show_id: typed.show_id,
      client_id: typed.client_id || null,
      client_contact_id: typed.client_contact_id || null,
      crew_id: typed.crew_id,
      assignment_id: typed.assignment_id || null,
      area_name: typed.area_name || "",
      rating: Number(typed.rating || 0),
      request_again: typed.request_again || "",
      notes: typed.notes || "",
      submitted_at: typed.submitted_at,
    } as FeedbackTechRatingRecord;
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
    clientFeedbackResponses,
    clientFeedbackScores,
    feedbackTechRatings,
    eventUserAccess: eventAccessRows,
    appUsers,
    masterRates: (ratesRes.data ?? []) as MasterRateRecord[],
    setupMissing: false,
    error: null as string | null,
  };
}
