import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getSessionUser, normalizeRole } from "@/lib/auth";
import type { CrewRecord } from "@/lib/crew-types";
import type { MasterRateRecord } from "@/lib/rates-types";
import type { ShowRecord, LaborDayRecord, SubCallRecord, AssignmentRecord, AssignmentNoteRecord, AssignmentChecklistRecord, TextAutomationSettingsRecord, TextMessageQueueRecord, EventUserAccessRecord, ClientFeedbackResponseRecord, ClientFeedbackScoreRecord, FeedbackTechRatingRecord } from "@/lib/events-types";
import type { AppUserSummaryRecord, BusinessClientRecord, ClientContactRecord, TechRatingRecord } from "@/lib/client-types";

function cleanEventSearchTerm(value: string | null | undefined) {
  return (value || "").replace(/[%_,]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

function eventSearchOrFilter(search: string) {
  const token = cleanEventSearchTerm(search);
  if (!token) return null;
  const pattern = `*${token}*`;
  return [`name.ilike.${pattern}`, `client.ilike.${pattern}`, `venue.ilike.${pattern}`, `rate_city.ilike.${pattern}`].join(",");
}

function eventCrewRecord(row: Record<string, unknown>, cityMap: Map<string, string>, extraPoolsByCrew: Map<string, string[]>, positionsByCrew: Map<string, CrewRecord["positions"]>, unavailableByCrew: Map<string, string[]>): CrewRecord {
  const id = String(row.id || "");
  const extraPoolIds = extraPoolsByCrew.get(id) ?? [];
  return {
    id,
    name: String(row.name || ""),
    description: String(row.description || ""),
    city_pool_id: row.city_pool_id ? String(row.city_pool_id) : null,
    city_name: row.city_pool_id ? cityMap.get(String(row.city_pool_id)) ?? "Unassigned" : "Unassigned",
    additional_city_pool_ids: extraPoolIds,
    additional_city_pool_names: extraPoolIds.map((poolId) => cityMap.get(poolId)).filter((name): name is string => Boolean(name)),
    group_name: String(row.group_name || "Ungrouped"),
    tier: String(row.tier || ""),
    email: String(row.email || ""),
    phone: String(row.phone || ""),
    address: "",
    lead_from: "",
    other_city: String(row.other_city || ""),
    ob: Boolean(row.ob),
    onboarding_texted_called: false,
    onboarding_response: false,
    onboarding_paperwork_sent: false,
    onboarding_successfully_onboarded: false,
    onboarding_called_placed_tier: false,
    onboarding_status: "not_loaded",
    w9_status: "not_loaded",
    contract_status: "not_loaded",
    questionnaire_status: "not_loaded",
    tax_profile_status: "not_loaded",
    profile_photo_url: null,
    work_photo_urls: [],
    w9_document_url: null,
    contract_document_url: null,
    tax_profile_notes: "",
    onboarding_request_sent_at: null,
    onboarding_completed_at: null,
    blacklisted: Boolean(row.blacklisted),
    blacklist_reason: String(row.blacklist_reason || ""),
    notes: String(row.notes || ""),
    conflict_companies: Array.isArray(row.conflict_companies) ? row.conflict_companies.map(String).filter(Boolean) : [],
    positions: positionsByCrew.get(id) ?? [],
    unavailable_dates: unavailableByCrew.get(id) ?? [],
    created_by: row.created_by ? String(row.created_by) : null,
    coordinator_hidden_at: row.coordinator_hidden_at ? String(row.coordinator_hidden_at) : null,
    coordinator_hidden_by: row.coordinator_hidden_by ? String(row.coordinator_hidden_by) : null,
    coordinator_hidden_reviewed_at: null,
  };
}

export async function getEventsCrewLookupData() {
  const session = await getSessionUser();
  const role = normalizeRole(session.profile?.role as string | null | undefined);
  const restrictToOwner = Boolean(session.access?.restrict_crew_to_owner && role === "coordinator" && session.user?.id);
  const allowedPoolIds = new Set(session.access?.allowed_city_pool_ids ?? []);
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { crewRecords: [] as CrewRecord[] };

  const [cityPoolsRes, crewRes, positionsRes, unavailableRes, extraPoolsRes] = await Promise.all([
    supabase.from("city_pools").select("id, name").order("name", { ascending: true }),
    supabase
      .from("crew")
      .select("id, name, description, city_pool_id, group_name, tier, email, phone, other_city, ob, notes, conflict_companies, blacklisted, blacklist_reason, created_by, coordinator_hidden_at, coordinator_hidden_by")
      .order("name", { ascending: true }),
    supabase.from("crew_positions").select("id, crew_id, role_name, rate").order("role_name", { ascending: true }),
    supabase.from("crew_unavailable_dates").select("crew_id, unavailable_date").order("unavailable_date", { ascending: true }),
    supabase.from("crew_city_pools").select("crew_id, city_pool_id"),
  ]);

  if (crewRes.error) return { crewRecords: [] as CrewRecord[] };

  const cityMap = new Map((cityPoolsRes.data ?? []).map((row) => [String((row as { id: string }).id), String((row as { name?: string | null }).name || "")]));
  const extraPoolsByCrew = new Map<string, string[]>();
  if (!extraPoolsRes.error) {
    for (const row of extraPoolsRes.data ?? []) {
      const typed = row as { crew_id?: string | null; city_pool_id?: string | null };
      if (!typed.crew_id || !typed.city_pool_id) continue;
      extraPoolsByCrew.set(String(typed.crew_id), [...(extraPoolsByCrew.get(String(typed.crew_id)) ?? []), String(typed.city_pool_id)]);
    }
  }

  const positionsByCrew = new Map<string, CrewRecord["positions"]>();
  if (!positionsRes.error) {
    for (const row of positionsRes.data ?? []) {
      const typed = row as { id?: string | null; crew_id?: string | null; role_name?: string | null; rate?: number | string | null };
      if (!typed.crew_id) continue;
      positionsByCrew.set(String(typed.crew_id), [
        ...(positionsByCrew.get(String(typed.crew_id)) ?? []),
        { id: typed.id ? String(typed.id) : undefined, role_name: String(typed.role_name || ""), rate: Number(typed.rate || 0) },
      ]);
    }
  }

  const unavailableByCrew = new Map<string, string[]>();
  if (!unavailableRes.error) {
    for (const row of unavailableRes.data ?? []) {
      const typed = row as { crew_id?: string | null; unavailable_date?: string | null };
      if (!typed.crew_id || !typed.unavailable_date) continue;
      unavailableByCrew.set(String(typed.crew_id), [...(unavailableByCrew.get(String(typed.crew_id)) ?? []), String(typed.unavailable_date)]);
    }
  }

  const crewRecords = (crewRes.data ?? [])
    .filter((row) => {
      const typed = row as { id?: string | null; created_by?: string | null; city_pool_id?: string | null; coordinator_hidden_at?: string | null; coordinator_hidden_by?: string | null };
      if (role === "coordinator" && typed.coordinator_hidden_at && typed.coordinator_hidden_by === session.user?.id) return false;
      if (role !== "coordinator") return true;
      if (typed.created_by !== session.user?.id) return false;
      const extraPoolIds = extraPoolsByCrew.get(String(typed.id || "")) ?? [];
      const primaryAllowed = Boolean(typed.city_pool_id && allowedPoolIds.has(typed.city_pool_id));
      const extraAllowed = extraPoolIds.some((poolId) => allowedPoolIds.has(poolId));
      const ownUnassignedCrew = !typed.city_pool_id && extraPoolIds.length === 0;
      return !restrictToOwner || primaryAllowed || extraAllowed || ownUnassignedCrew;
    })
    .map((row) => eventCrewRecord(row as Record<string, unknown>, cityMap, extraPoolsByCrew, positionsByCrew, unavailableByCrew));

  return { crewRecords };
}

export async function getEventsClientLookupData() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      businessClients: [] as BusinessClientRecord[],
      clientContacts: [] as ClientContactRecord[],
    };
  }

  const [clientsRes, contactsRes] = await Promise.all([
    supabase.from("business_clients").select("id, name, default_rate_city").order("name", { ascending: true }),
    supabase.from("client_contacts").select("id, client_id, name, title, email, phone, cell_phone, contact_type, is_primary, is_onsite_contact, is_billing_contact").order("name", { ascending: true }),
  ]);

  const businessClients = clientsRes.error ? [] : (clientsRes.data ?? []).map((row) => {
    const typed = row as { id: string; name?: string | null; default_rate_city?: string | null };
    return {
      id: typed.id,
      name: typed.name || "",
      legal_company_name: "",
      billing_address: "",
      billing_city: "",
      billing_state: "",
      billing_zip: "",
      main_phone: "",
      main_email: "",
      website: "",
      default_rate_city: typed.default_rate_city || "Default",
      default_market_notes: "",
      notes: "",
      ap_contact_name: "",
      ap_email: "",
      ap_phone: "",
      payment_terms: "",
      po_required: null,
      w9_coi_notes: "",
      default_invoice_email: "",
      billing_notes: "",
      created_at: "",
      updated_at: null,
    } satisfies BusinessClientRecord;
  });

  const clientContacts = contactsRes.error ? [] : (contactsRes.data ?? []).map((row) => {
    const typed = row as Partial<ClientContactRecord> & { id: string; client_id: string };
    return {
      id: typed.id,
      client_id: typed.client_id,
      name: typed.name || "",
      title: typed.title || "",
      email: typed.email || "",
      phone: typed.phone || "",
      cell_phone: typed.cell_phone || "",
      notes: "",
      contact_type: typed.contact_type || "project-manager",
      is_primary: Boolean(typed.is_primary),
      is_onsite_contact: Boolean(typed.is_onsite_contact),
      is_billing_contact: Boolean(typed.is_billing_contact),
      created_at: "",
      updated_at: null,
    } satisfies ClientContactRecord;
  });

  return { businessClients, clientContacts };
}

export async function getEventsPageData(options: { search?: string; showLimit?: number; includeLatestPendingFeedback?: boolean } = {}) {
  const session = await getSessionUser();
  const role = normalizeRole(session.profile?.role as string | null | undefined);
  const restrictToOwner = Boolean(role === "coordinator" && session.user?.id);
  const canReviewFeedback = role === "owner" || role === "admin";
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
  const todayKey = new Date().toISOString().slice(0, 10);
  const activeOrFutureOrRecentFilter = `show_end.gte.${recentFloor},show_start.gte.${todayKey}`;
  const searchFilter = eventSearchOrFilter(serverSearch);
  let latestPendingFeedbackShowId = "";

  if (options.includeLatestPendingFeedback && canReviewFeedback) {
    const latestPendingFeedbackRes = await supabase
      .from("client_feedback_responses")
      .select("show_id")
      .or("rating_approved.is.null,rating_approved.eq.false")
      .or("excluded_from_ratings.is.null,excluded_from_ratings.eq.false")
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!latestPendingFeedbackRes.error) {
      latestPendingFeedbackShowId = String(latestPendingFeedbackRes.data?.show_id || "");
    }
  }

  const reviewShowFilter = latestPendingFeedbackShowId ? `id.eq.${latestPendingFeedbackShowId}` : "";
  const effectiveSearchFilter = [searchFilter, reviewShowFilter].filter(Boolean).join(",");
  const effectiveDefaultFilter = [activeOrFutureOrRecentFilter, reviewShowFilter].filter(Boolean).join(",");

  let showsQueryInitial = supabase
    .from("shows")
    .select("id, name, client, business_client_id, client_contact_id, coordinator_contact_id, assigned_coordinator_user_id, venue, event_location, rate_city, show_start, show_end, notes, created_by")
    .order("show_start", { ascending: true });
  if (searchFilter) {
    showsQueryInitial = showsQueryInitial.or(effectiveSearchFilter);
  } else {
    showsQueryInitial = showsQueryInitial.or(effectiveDefaultFilter).limit(showLimit);
  }
  const showsResInitial = await showsQueryInitial;
  const showClientColumnsMissing = Boolean(showsResInitial.error && (showsResInitial.error.message.includes("business_client_id") || showsResInitial.error.message.includes("client_contact_id") || showsResInitial.error.message.includes("coordinator_contact_id") || showsResInitial.error.message.includes("assigned_coordinator_user_id") || showsResInitial.error.message.includes("created_by") || showsResInitial.error.message.includes("event_location")));
  let fallbackShowsQuery = supabase
    .from("shows")
    .select("id, name, client, venue, rate_city, show_start, show_end, notes")
    .order("show_start", { ascending: true });
  if (searchFilter) {
    fallbackShowsQuery = fallbackShowsQuery.or(effectiveSearchFilter);
  } else {
    fallbackShowsQuery = fallbackShowsQuery.or(effectiveDefaultFilter).limit(showLimit);
  }
  const showsRes = showClientColumnsMissing ? await fallbackShowsQuery : showsResInitial;

  const allLoadedShowRows = (showsRes.data ?? []) as Array<{ id: string; created_by?: string | null; assigned_coordinator_user_id?: string | null }> ;
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
  const currentUserId = session.user?.id || "";
  const currentProfileId = String((session.profile as { id?: string } | null)?.id || currentUserId);
  const userAccessIds = new Set([currentUserId, currentProfileId].filter(Boolean));
  const sharedShowIdsForUser = new Set(
    eventAccessRows
      .filter((row) => userAccessIds.has(row.user_id || "") || userAccessIds.has(row.user_profile_id || ""))
      .map((row) => row.show_id)
  );
  const fullAccessShowIds = new Set(
    allLoadedShowRows.flatMap((show) => {
      if (!restrictToOwner) return [show.id];
      const assignedCoordinatorId = show.assigned_coordinator_user_id || "";
      return show.created_by === currentUserId || userAccessIds.has(assignedCoordinatorId) || sharedShowIdsForUser.has(show.id) ? [show.id] : [];
    })
  );

  let partialAssignedSubCallIds = new Set<string>();
  let partialAssignedLaborDayIds = new Set<string>();
  let partialAccessShowIds = new Set<string>();
  if (restrictToOwner && userAccessIds.size) {
    const partialCallRes = await supabase
      .from("sub_calls")
      .select("id, labor_day_id, assigned_coordinator_user_id")
      .in("assigned_coordinator_user_id", [...userAccessIds]);
    if (!partialCallRes.error) {
      partialAssignedSubCallIds = new Set((partialCallRes.data ?? []).map((row) => String((row as { id: string }).id)));
      partialAssignedLaborDayIds = new Set((partialCallRes.data ?? []).map((row) => String((row as { labor_day_id: string }).labor_day_id)));
      if (partialAssignedLaborDayIds.size) {
        const partialDayRes = await supabase
          .from("labor_days")
          .select("id, show_id")
          .in("id", [...partialAssignedLaborDayIds]);
        if (!partialDayRes.error) {
          partialAccessShowIds = new Set((partialDayRes.data ?? []).map((row) => String((row as { show_id: string }).show_id)));
        }
      }
    }
  }

  const visibleShowIds = new Set([...fullAccessShowIds, ...partialAccessShowIds]);
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
        .select("id, labor_day_id, area, location, po_number, area_lead_contact_id, area_lead_name, area_lead_phone, assigned_coordinator_user_id, role_name, master_rate_id, message_rate, start_time, end_time, crew_needed, notes, sort_order, day_type, one_hour_walkaway")
        .in("labor_day_id", visibleLaborDayIds)
        .order("labor_day_id", { ascending: true })
        .order("sort_order", { ascending: true })
        .order("start_time", { ascending: true })
    : emptyResult;
  const subCallExtraColumnsMissing = Boolean(subCallsResInitial.error && (subCallsResInitial.error.message.includes("master_rate_id") || subCallsResInitial.error.message.includes("message_rate") || subCallsResInitial.error.message.includes("location") || subCallsResInitial.error.message.includes("po_number") || subCallsResInitial.error.message.includes("area_lead") || subCallsResInitial.error.message.includes("sort_order") || subCallsResInitial.error.message.includes("day_type") || subCallsResInitial.error.message.includes("one_hour_walkaway") || subCallsResInitial.error.message.includes("assigned_coordinator_user_id")));
  const subCallsRes = subCallExtraColumnsMissing && visibleLaborDayIds.length
    ? await supabase
        .from("sub_calls")
        .select("id, labor_day_id, area, role_name, start_time, end_time, crew_needed, notes")
        .in("labor_day_id", visibleLaborDayIds)
        .order("labor_day_id", { ascending: true })
        .order("start_time", { ascending: true })
    : subCallsResInitial;

  const laborDayShowId = new Map((laborDaysRes.data ?? []).map((row) => [String((row as { id: string }).id), String((row as { show_id: string }).show_id)] as const));
  const scopedSubCallRows = (subCallsRes.data ?? []).filter((row) => {
    if (!restrictToOwner) return true;
    const typed = row as { id: string; labor_day_id: string; assigned_coordinator_user_id?: string | null };
    const showId = laborDayShowId.get(String(typed.labor_day_id)) || "";
    if (fullAccessShowIds.has(showId)) return true;
    return partialAssignedSubCallIds.has(String(typed.id)) || userAccessIds.has(String(typed.assigned_coordinator_user_id || ""));
  });
  const visibleSubCallIds = scopedSubCallRows.map((row) => String((row as { id: string }).id));
  const scopedLaborDayIds = new Set(scopedSubCallRows.map((row) => String((row as { labor_day_id: string }).labor_day_id)));

  const assignmentsResInitial = visibleSubCallIds.length
    ? await supabase
        .from("assignments")
        .select("id, sub_call_id, crew_id, status, sort_order, start_time, end_time, day_type, coordination_owner_user_id, coordination_owner_name, coordination_fee_waived")
        .in("sub_call_id", visibleSubCallIds)
        .order("sub_call_id", { ascending: true })
        .order("sort_order", { ascending: true })
    : emptyResult;
  const assignmentsSortOrderMissing = Boolean(assignmentsResInitial.error && (assignmentsResInitial.error.message.includes("sort_order") || assignmentsResInitial.error.message.includes("start_time") || assignmentsResInitial.error.message.includes("end_time") || assignmentsResInitial.error.message.includes("day_type") || assignmentsResInitial.error.message.includes("coordination_owner") || assignmentsResInitial.error.message.includes("coordination_fee_waived")));
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
          .select("id, show_id, crew_id, schedule_sent, confirmed, week_before_confirmed, day_before_confirmed, schedule_sent_at, confirmed_at, week_before_confirmed_at, day_before_confirmed_at, updated_at")
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
          .select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name")
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
    const typed = row as { id: string; name: string | null; client: string | null; business_client_id?: string | null; client_contact_id?: string | null; coordinator_contact_id?: string | null; assigned_coordinator_user_id?: string | null; venue: string | null; event_location?: string | null; rate_city: string | null; show_start: string; show_end: string; notes: string | null; created_by?: string | null };
    return {
      id: typed.id,
      name: typed.name ?? "",
      client: typed.client ?? "",
      business_client_id: typed.business_client_id ?? null,
      client_contact_id: typed.client_contact_id ?? null,
      coordinator_contact_id: typed.coordinator_contact_id ?? null,
      assigned_coordinator_user_id: typed.assigned_coordinator_user_id ?? null,
      venue: typed.venue ?? "",
      event_location: typed.event_location ?? "",
      rate_city: typed.rate_city ?? "Default",
      show_start: typed.show_start,
      show_end: typed.show_end,
      notes: typed.notes ?? "",
      created_by: typed.created_by ?? null,
      access_scope: restrictToOwner && !fullAccessShowIds.has(typed.id) ? "partial" : "full",
    } as ShowRecord;
  });

  const laborDays = (laborDaysRes.data ?? []).filter((row) => {
    const typed = row as { id: string; show_id: string };
    if (!visibleShowIds.has(String(typed.show_id))) return false;
    if (!restrictToOwner || fullAccessShowIds.has(String(typed.show_id))) return true;
    return scopedLaborDayIds.has(String(typed.id));
  }).map((row) => {
    const typed = row as { id: string; show_id: string; labor_date: string; label: string | null; notes: string | null; created_by?: string | null };
    return { id: typed.id, show_id: typed.show_id, labor_date: typed.labor_date, label: typed.label ?? "", notes: typed.notes ?? "" } as LaborDayRecord;
  });

  const subCalls = scopedSubCallRows.map((row) => {
    const typed = row as {
      id: string;
      labor_day_id: string;
      area: string | null;
      location?: string | null;
      po_number?: string | null;
      area_lead_contact_id?: string | null;
      area_lead_name?: string | null;
      area_lead_phone?: string | null;
      assigned_coordinator_user_id?: string | null;
      role_name: string | null;
      master_rate_id?: string | null;
      message_rate?: string | number | null;
      start_time: string;
      end_time: string | null;
      crew_needed: number | null;
      notes: string | null;
      sort_order?: number | null;
      day_type?: string | null;
      one_hour_walkaway?: boolean | null;
      created_by?: string | null;
    };
    return {
      id: typed.id,
      labor_day_id: typed.labor_day_id,
      area: typed.area ?? "",
      location: typed.location ?? "",
      po_number: typed.po_number ?? null,
      area_lead_contact_id: typed.area_lead_contact_id ?? null,
      area_lead_name: typed.area_lead_name ?? null,
      area_lead_phone: typed.area_lead_phone ?? null,
      assigned_coordinator_user_id: typed.assigned_coordinator_user_id ?? null,
      role_name: typed.role_name ?? "",
      master_rate_id: typed.master_rate_id ?? null,
      message_rate: typed.message_rate != null ? String(typed.message_rate) : null,
      start_time: typed.start_time,
      end_time: typed.end_time ?? "",
      crew_needed: typed.crew_needed ?? 1,
      notes: typed.notes ?? "",
      sort_order: typed.sort_order ?? 0,
      day_type: typed.day_type || "full_day",
      one_hour_walkaway: Boolean(typed.one_hour_walkaway),
    } as SubCallRecord;
  });

  const assignments = assignmentsMissing ? [] : ((assignmentsRes.data ?? []).map((row, index) => {
    const typed = row as { id: string; sub_call_id: string; crew_id: string; status: string | null; sort_order?: number | null; start_time?: string | null; end_time?: string | null; day_type?: string | null; coordination_owner_user_id?: string | null; coordination_owner_name?: string | null; coordination_fee_waived?: boolean | null };
    return { id: typed.id, sub_call_id: typed.sub_call_id, crew_id: typed.crew_id, status: typed.status ?? 'confirmed', sort_order: typed.sort_order ?? index + 1, start_time: typed.start_time || null, end_time: typed.end_time || null, day_type: typed.day_type || null, coordination_owner_user_id: typed.coordination_owner_user_id || null, coordination_owner_name: typed.coordination_owner_name || null, coordination_fee_waived: Boolean(typed.coordination_fee_waived) } as AssignmentRecord;
  }));

  const visibleAssignmentIds = new Set((assignmentsRes.data ?? []).map((row) => String((row as { id: string }).id)));
  const visibleCrewIds = new Set((assignmentsRes.data ?? []).map((row) => String((row as { crew_id: string }).crew_id)));

  const assignmentNotes = notesMissing ? [] : ((notesRes.data ?? []).filter((row) => {
    if (!restrictToOwner) return true;
    const assignmentId = String((row as { assignment_id?: string | null }).assignment_id || "");
    return Boolean(assignmentId && visibleAssignmentIds.has(assignmentId));
  }).map((row) => {
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

  const assignmentChecklists = checklistsMissing ? [] : ((checklistRes.data ?? []).filter((row) => {
    if (!restrictToOwner) return true;
    const showId = String((row as { show_id: string }).show_id || "");
    if (fullAccessShowIds.has(showId)) return true;
    return visibleCrewIds.has(String((row as { crew_id: string }).crew_id || ""));
  }).map((row) => {
    const typed = row as {
      id: string;
      show_id: string;
      crew_id: string;
      schedule_sent: boolean | null;
      confirmed: boolean | null;
      week_before_confirmed: boolean | null;
      day_before_confirmed: boolean | null;
      schedule_sent_at: string | null;
      confirmed_at: string | null;
      week_before_confirmed_at: string | null;
      day_before_confirmed_at: string | null;
      updated_at: string | null;
    };
    return {
      id: typed.id,
      show_id: typed.show_id,
      crew_id: typed.crew_id,
      schedule_sent: Boolean(typed.schedule_sent),
      confirmed: Boolean(typed.confirmed),
      week_before_confirmed: Boolean(typed.week_before_confirmed),
      day_before_confirmed: Boolean(typed.day_before_confirmed),
      schedule_sent_at: typed.schedule_sent_at,
      confirmed_at: typed.confirmed_at,
      week_before_confirmed_at: typed.week_before_confirmed_at,
      day_before_confirmed_at: typed.day_before_confirmed_at,
      updated_at: typed.updated_at ?? "",
    } as AssignmentChecklistRecord;
  }));

  const textAutomationSettings = automationMissing ? [] : ((automationRes.data ?? []).filter((row) => !restrictToOwner || fullAccessShowIds.has(String((row as { show_id: string }).show_id || ""))).map((row) => {
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

  const textMessageQueue = textQueueMissing ? [] : ((textQueueRes.data ?? []).filter((row) => !restrictToOwner || fullAccessShowIds.has(String((row as { show_id: string }).show_id || ""))).map((row) => {
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
      queued_by_user_id: typed.queued_by_user_id || null,
      queued_by_email: typed.queued_by_email || null,
      queued_by_name: typed.queued_by_name || null,
    } as TextMessageQueueRecord;
  }));

  const adminRatings = ratingsMissing ? [] : ((ratingsRes.data ?? []).filter((row) => {
    if (!restrictToOwner) return true;
    const showId = String((row as { show_id: string }).show_id || "");
    if (fullAccessShowIds.has(showId)) return true;
    const assignmentId = String((row as { assignment_id?: string | null }).assignment_id || "");
    return Boolean(assignmentId && visibleAssignmentIds.has(assignmentId));
  }).map((row) => {
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

  const clientFeedbackResponses = feedbackResponsesMissing ? [] : ((feedbackResponsesRes.data ?? []).filter((row) => !restrictToOwner || fullAccessShowIds.has(String((row as { show_id: string }).show_id || ""))).map((row) => {
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
