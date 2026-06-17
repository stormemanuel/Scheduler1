import { NextResponse } from "next/server";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

async function requireSignedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  return { ok: true as const, user };
}



async function canEditEventDetails(userId: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return false;
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  const role = String((profile as { role?: string | null } | null)?.role || "").toLowerCase().trim();
  if (role === "owner" || role === "admin") return true;

  const { data: access, error } = await admin
    .from("user_access_settings")
    .select("can_edit_event_details")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return false;
  return Boolean((access as { can_edit_event_details?: boolean | null } | null)?.can_edit_event_details);
}

async function canDeleteEventDetails(userId: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return false;
  const { data } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  const role = String((data as { role?: string | null } | null)?.role || "").toLowerCase().trim();
  return role === "owner" || role === "admin";
}

type GoogleCalendarConnectionRow = {
  id?: string;
  user_id: string;
  account_email: string | null;
  calendar_id: string | null;
  refresh_token_encrypted: string;
  created_at?: string;
  updated_at?: string | null;
};

type GoogleCalendarEventLinkRow = {
  id?: string;
  user_id: string;
  show_id: string;
  calendar_id: string | null;
  google_event_id: string | null;
  google_event_html_link: string | null;
  synced_at: string | null;
  last_error: string | null;
};

type GoogleEventPayload = {
  summary: string;
  location?: string;
  description?: string;
  colorId?: string;
  start: { date: string };
  end: { date: string };
  extendedProperties?: { private?: Record<string, string> };
};

function googleCalendarConfig() {
  return {
    clientId: process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || "",
    tokenKey: process.env.GOOGLE_CALENDAR_TOKEN_KEY || process.env.W9_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  };
}

function googleCalendarReady() {
  const config = googleCalendarConfig();
  return Boolean(config.clientId && config.clientSecret && config.tokenKey);
}

function googleRedirectUri(request: Request) {
  return process.env.GOOGLE_CALENDAR_REDIRECT_URI || `${new URL(request.url).origin}/api/shows/google-calendar-callback`;
}

function googleTokenKey() {
  const config = googleCalendarConfig();
  if (!config.tokenKey) throw new Error("GOOGLE_CALENDAR_TOKEN_KEY or SUPABASE_SERVICE_ROLE_KEY is required.");
  return createHash("sha256").update(config.tokenKey).digest();
}

function encryptGoogleToken(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", googleTokenKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

function decryptGoogleToken(value: string) {
  const [ivText, tagText, encryptedText] = String(value || "").split(":");
  if (!ivText || !tagText || !encryptedText) throw new Error("Stored Google Calendar token is invalid.");
  const decipher = createDecipheriv("aes-256-gcm", googleTokenKey(), Buffer.from(ivText, "base64"));
  decipher.setAuthTag(Buffer.from(tagText, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64")), decipher.final()]).toString("utf8");
}

function plusOneDate(dateText: string) {
  const [year, month, day] = String(dateText || "").slice(0, 10).split("-").map((item) => Number(item));
  if (!year || !month || !day) return new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function formatDisplayDate(dateText: string | null | undefined) {
  const value = String(dateText || "").slice(0, 10);
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return month && day && year ? `${month}/${day}/${year}` : value;
}

function cleanGoogleText(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function joinGoogleParts(parts: Array<string | null | undefined>, separator = " • ") {
  return parts.map(cleanGoogleText).filter(Boolean).join(separator);
}

async function googleFetchJson<T>(url: string, init: RequestInit) {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = cleanGoogleText((data as { error_description?: string; error?: { message?: string } | string }).error_description || (typeof (data as { error?: unknown }).error === "string" ? (data as { error?: string }).error : (data as { error?: { message?: string } }).error?.message) || `Google request failed (${res.status}).`);
    const error = new Error(message) as Error & { status?: number; data?: unknown };
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data as T;
}

async function exchangeGoogleCode(request: Request, code: string) {
  const config = googleCalendarConfig();
  return googleFetchJson<{ access_token?: string; refresh_token?: string; expires_in?: number; token_type?: string }>("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: googleRedirectUri(request),
    }),
  });
}

async function refreshGoogleAccessToken(refreshToken: string) {
  const config = googleCalendarConfig();
  return googleFetchJson<{ access_token: string; expires_in?: number; token_type?: string }>("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
}

async function getGoogleUserEmail(accessToken: string) {
  try {
    const profile = await googleFetchJson<{ email?: string }>("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return profile.email || null;
  } catch {
    return null;
  }
}

async function getGoogleConnection(admin: ReturnType<typeof createSupabaseAdminClient>, userId: string) {
  if (!admin) return null;
  const { data, error } = await admin
    .from("google_calendar_connections")
    .select("id, user_id, account_email, calendar_id, refresh_token_encrypted, created_at, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message.includes("google_calendar_connections") ? "Run ELS229_required_sql.sql before connecting Google Calendar." : error.message);
  return (data as GoogleCalendarConnectionRow | null) || null;
}

async function getGoogleAccessForUser(admin: ReturnType<typeof createSupabaseAdminClient>, userId: string) {
  const connection = await getGoogleConnection(admin, userId);
  if (!connection?.refresh_token_encrypted) throw new Error("Google Calendar is not connected yet.");
  const refreshToken = decryptGoogleToken(connection.refresh_token_encrypted);
  const token = await refreshGoogleAccessToken(refreshToken);
  if (!token.access_token) throw new Error("Google did not return an access token.");
  return { connection, accessToken: token.access_token, calendarId: connection.calendar_id || "primary" };
}

async function buildGoogleEventPayload(admin: ReturnType<typeof createSupabaseAdminClient>, showId: string): Promise<GoogleEventPayload> {
  if (!admin) throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing.");
  const { data: show, error: showError } = await admin
    .from("shows")
    .select("id, name, client, business_client_id, client_contact_id, coordinator_contact_id, assigned_coordinator_user_id, venue, event_location, rate_city, show_start, show_end, notes")
    .eq("id", showId)
    .maybeSingle();
  if (showError) throw new Error(showError.message);
  if (!show) throw new Error("Show not found.");
  const typedShow = show as {
    id: string;
    name?: string | null;
    client?: string | null;
    business_client_id?: string | null;
    client_contact_id?: string | null;
    coordinator_contact_id?: string | null;
    assigned_coordinator_user_id?: string | null;
    venue?: string | null;
    event_location?: string | null;
    rate_city?: string | null;
    show_start?: string | null;
    show_end?: string | null;
    notes?: string | null;
  };

  const contactIds = [typedShow.client_contact_id, typedShow.coordinator_contact_id].filter(Boolean) as string[];
  const contactsRes = contactIds.length
    ? await admin.from("client_contacts").select("id, name, title, email, phone, cell_phone").in("id", contactIds)
    : { data: [], error: null };
  const contacts = new Map((contactsRes.data || []).map((row) => [String((row as { id: string }).id), row as { id: string; name?: string | null; title?: string | null; email?: string | null; phone?: string | null; cell_phone?: string | null }]));
  const projectManager = typedShow.client_contact_id ? contacts.get(typedShow.client_contact_id) : null;
  const clientCoordinator = typedShow.coordinator_contact_id ? contacts.get(typedShow.coordinator_contact_id) : null;

  let elsCoordinator: { full_name?: string | null; email?: string | null } | null = null;
  if (typedShow.assigned_coordinator_user_id) {
    const { data } = await admin.from("profiles").select("full_name, email").eq("id", typedShow.assigned_coordinator_user_id).maybeSingle();
    elsCoordinator = data as { full_name?: string | null; email?: string | null } | null;
  }

  const { data: laborDays } = await admin
    .from("labor_days")
    .select("id, labor_date, label")
    .eq("show_id", showId)
    .order("labor_date", { ascending: true });
  const dayRows = (laborDays || []) as Array<{ id: string; labor_date?: string | null; label?: string | null }>;
  const dayIds = dayRows.map((day) => day.id);
  const { data: subCalls } = dayIds.length
    ? await admin
        .from("sub_calls")
        .select("labor_day_id, area, role_name, start_time, end_time, crew_needed")
        .in("labor_day_id", dayIds)
        .order("start_time", { ascending: true })
    : { data: [] };
  const callsByDay = new Map<string, Array<{ area?: string | null; role_name?: string | null; start_time?: string | null; end_time?: string | null; crew_needed?: number | null }>>();
  for (const call of (subCalls || []) as Array<{ labor_day_id: string; area?: string | null; role_name?: string | null; start_time?: string | null; end_time?: string | null; crew_needed?: number | null }>) {
    const rows = callsByDay.get(call.labor_day_id) || [];
    rows.push(call);
    callsByDay.set(call.labor_day_id, rows);
  }

  const startDate = cleanGoogleText(typedShow.show_start).slice(0, 10);
  const endDate = cleanGoogleText(typedShow.show_end || typedShow.show_start).slice(0, 10) || startDate;
  if (!startDate) throw new Error("Show start date is required before syncing to Google Calendar.");

  const dayLines = dayRows.slice(0, 20).map((day) => {
    const calls = callsByDay.get(day.id) || [];
    const callText = calls.slice(0, 4).map((call) => joinGoogleParts([
      call.start_time && call.end_time ? `${call.start_time}-${call.end_time}` : call.start_time || "",
      call.area || "Area",
      call.role_name || "Role",
      call.crew_needed ? `${call.crew_needed} crew` : "",
    ], " · ")).join("; ");
    return `${formatDisplayDate(day.labor_date)}${day.label ? ` — ${day.label}` : ""}${callText ? `: ${callText}` : ""}`;
  });
  if (dayRows.length > 20) dayLines.push(`+ ${dayRows.length - 20} more labor day(s) in ELS`);

  const description = [
    "Synced from Emanuel Labor Services.",
    "",
    `Client: ${cleanGoogleText(typedShow.client) || "Not set"}`,
    `Venue: ${cleanGoogleText(typedShow.venue) || "Not set"}`,
    typedShow.event_location ? `Event Location: ${cleanGoogleText(typedShow.event_location)}` : "",
    `Dates: ${formatDisplayDate(startDate)} to ${formatDisplayDate(endDate)}`,
    projectManager ? `Project Manager: ${joinGoogleParts([projectManager.name, projectManager.phone || projectManager.cell_phone, projectManager.email], " · ")}` : "",
    clientCoordinator ? `Client Contact: ${joinGoogleParts([clientCoordinator.name, clientCoordinator.phone || clientCoordinator.cell_phone, clientCoordinator.email], " · ")}` : "",
    elsCoordinator ? `ELS Coordinator: ${joinGoogleParts([elsCoordinator.full_name || elsCoordinator.email, elsCoordinator.email], " · ")}` : "",
    "",
    dayLines.length ? "Labor Days / Sub-calls:" : "",
    ...dayLines,
    typedShow.notes ? "" : "",
    typedShow.notes ? `ELS Notes: ${cleanGoogleText(typedShow.notes).slice(0, 1200)}` : "",
    "",
    "ELS remains the master schedule. Update the show inside ELS, then sync again.",
  ].filter((line) => line !== "").join("\n");

  return {
    summary: `ELS: ${cleanGoogleText(typedShow.name) || "Show"}`,
    colorId: "2",
    location: joinGoogleParts([typedShow.venue, typedShow.event_location || typedShow.rate_city], ", ") || undefined,
    description,
    start: { date: startDate },
    end: { date: plusOneDate(endDate) },
    extendedProperties: { private: { els_show_id: showId, els_source: "Emanuel Labor Services" } },
  };
}

async function upsertGoogleEventLink(admin: ReturnType<typeof createSupabaseAdminClient>, row: GoogleCalendarEventLinkRow) {
  if (!admin) throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing.");
  const { error } = await admin
    .from("google_calendar_event_links")
    .upsert({ ...row, synced_at: row.synced_at || new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "user_id,show_id" });
  if (error) throw new Error(error.message.includes("google_calendar_event_links") ? "Run ELS229_required_sql.sql before syncing Google Calendar." : error.message);
}

async function syncSingleShowToGoogle(admin: ReturnType<typeof createSupabaseAdminClient>, userId: string, showId: string) {
  if (!admin) throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing.");
  const { accessToken, connection, calendarId } = await getGoogleAccessForUser(admin, userId);
  const payload = await buildGoogleEventPayload(admin, showId);
  const { data: linkData, error: linkError } = await admin
    .from("google_calendar_event_links")
    .select("id, user_id, show_id, calendar_id, google_event_id, google_event_html_link, synced_at, last_error")
    .eq("user_id", userId)
    .eq("show_id", showId)
    .maybeSingle();
  if (linkError) throw new Error(linkError.message.includes("google_calendar_event_links") ? "Run ELS229_required_sql.sql before syncing Google Calendar." : linkError.message);
  const existingLink = linkData as GoogleCalendarEventLinkRow | null;

  let googleEvent: { id: string; htmlLink?: string };
  if (existingLink?.google_event_id) {
    try {
      googleEvent = await googleFetchJson<{ id: string; htmlLink?: string }>(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(existingLink.google_event_id)}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      if ((error as Error & { status?: number }).status !== 404 && (error as Error & { status?: number }).status !== 410) throw error;
      googleEvent = await googleFetchJson<{ id: string; htmlLink?: string }>(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }
  } else {
    googleEvent = await googleFetchJson<{ id: string; htmlLink?: string }>(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  await upsertGoogleEventLink(admin, {
    user_id: userId,
    show_id: showId,
    calendar_id: calendarId,
    google_event_id: googleEvent.id,
    google_event_html_link: googleEvent.htmlLink || null,
    synced_at: new Date().toISOString(),
    last_error: null,
  });
  return {
    show_id: showId,
    google_event_id: googleEvent.id,
    google_event_html_link: googleEvent.htmlLink || null,
    account_email: connection.account_email || null,
    calendar_id: calendarId,
    synced_at: new Date().toISOString(),
  };
}

async function handleGoogleCalendarConnect(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  if (!(await canEditEventDetails(auth.user.id))) return NextResponse.json({ message: "Only users with event editing access can connect Google Calendar." }, { status: 403 });
  if (!googleCalendarReady()) return NextResponse.json({ message: "Google Calendar environment variables are missing." }, { status: 500 });
  const config = googleCalendarConfig();
  const state = randomBytes(18).toString("hex");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", googleRedirectUri(request));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("scope", "openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/drive.file");
  url.searchParams.set("state", state);
  const response = NextResponse.redirect(url.toString());
  response.cookies.set("els_google_calendar_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 10 * 60 });
  return response;
}

async function handleGoogleCalendarCallback(request: Request) {
  const auth = await requireSignedIn();
  const baseRedirect = new URL("/events", new URL(request.url).origin);
  if (!auth.ok) {
    baseRedirect.searchParams.set("google_calendar", "sign-in-required");
    return NextResponse.redirect(baseRedirect.toString());
  }
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.redirect(`${baseRedirect.toString()}?google_calendar=missing-supabase-admin`);
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  if (error) {
    baseRedirect.searchParams.set("google_calendar", "denied");
    return NextResponse.redirect(baseRedirect.toString());
  }
  const state = url.searchParams.get("state") || "";
  const cookieState = request.headers.get("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith("els_google_calendar_oauth_state="))?.split("=")[1] || "";
  if (!state || decodeURIComponent(cookieState) !== state) {
    baseRedirect.searchParams.set("google_calendar", "state-mismatch");
    return NextResponse.redirect(baseRedirect.toString());
  }
  const code = url.searchParams.get("code") || "";
  if (!code) {
    baseRedirect.searchParams.set("google_calendar", "missing-code");
    return NextResponse.redirect(baseRedirect.toString());
  }
  try {
    const token = await exchangeGoogleCode(request, code);
    const existing = await getGoogleConnection(admin, auth.user.id);
    const refreshToken = token.refresh_token || (existing?.refresh_token_encrypted ? decryptGoogleToken(existing.refresh_token_encrypted) : "");
    if (!refreshToken) throw new Error("Google did not return a refresh token. Disconnect access in Google and try Connect again.");
    const accountEmail = token.access_token ? await getGoogleUserEmail(token.access_token) : existing?.account_email || null;
    const { error: upsertError } = await admin
      .from("google_calendar_connections")
      .upsert({
        user_id: auth.user.id,
        account_email: accountEmail || existing?.account_email || auth.user.email || null,
        calendar_id: existing?.calendar_id || "primary",
        refresh_token_encrypted: encryptGoogleToken(refreshToken),
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
    if (upsertError) throw new Error(upsertError.message.includes("google_calendar_connections") ? "Run ELS229_required_sql.sql before connecting Google Calendar." : upsertError.message);
    baseRedirect.searchParams.set("google_calendar", "connected");
    const response = NextResponse.redirect(baseRedirect.toString());
    response.cookies.delete("els_google_calendar_oauth_state");
    return response;
  } catch (callbackError) {
    baseRedirect.searchParams.set("google_calendar", "error");
    baseRedirect.searchParams.set("google_calendar_message", callbackError instanceof Error ? callbackError.message.slice(0, 160) : "Connection failed.");
    return NextResponse.redirect(baseRedirect.toString());
  }
}

async function handleGoogleCalendarStatus(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
  try {
    const connection = await getGoogleConnection(admin, auth.user.id);
    const showId = new URL(request.url).searchParams.get("show_id") || "";
    let link: GoogleCalendarEventLinkRow | null = null;
    if (showId) {
      const { data, error } = await admin
        .from("google_calendar_event_links")
        .select("id, user_id, show_id, calendar_id, google_event_id, google_event_html_link, synced_at, last_error")
        .eq("user_id", auth.user.id)
        .eq("show_id", showId)
        .maybeSingle();
      if (!error) link = data as GoogleCalendarEventLinkRow | null;
    }
    return NextResponse.json({
      ok: true,
      connected: Boolean(connection),
      account_email: connection?.account_email || null,
      calendar_id: connection?.calendar_id || "primary",
      show_synced: Boolean(link?.google_event_id),
      google_event_id: link?.google_event_id || null,
      google_event_html_link: link?.google_event_html_link || null,
      synced_at: link?.synced_at || null,
      last_error: link?.last_error || null,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, connected: false, message: error instanceof Error ? error.message : "Google Calendar status failed." }, { status: 200 });
  }
}

async function handleGoogleCalendarDisconnect() {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
  const existing = await getGoogleConnection(admin, auth.user.id);
  if (existing?.refresh_token_encrypted) {
    try {
      const token = decryptGoogleToken(existing.refresh_token_encrypted);
      await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }) });
    } catch {
      // Do not block local disconnect if Google revoke fails.
    }
  }
  await admin.from("google_calendar_event_links").delete().eq("user_id", auth.user.id);
  await admin.from("google_calendar_connections").delete().eq("user_id", auth.user.id);
  return NextResponse.json({ ok: true, connected: false, message: "Google Calendar disconnected from ELS." });
}

async function handleGoogleCalendarSyncShow(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  if (!(await canEditEventDetails(auth.user.id))) return NextResponse.json({ message: "Only users with event editing access can sync Google Calendar." }, { status: 403 });
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
  const body = await request.json().catch(() => ({}));
  const showId = cleanGoogleText((body as { show_id?: string }).show_id);
  if (!showId) return NextResponse.json({ message: "show_id is required." }, { status: 400 });
  const result = await syncSingleShowToGoogle(admin, auth.user.id, showId);
  return NextResponse.json({ ok: true, ...result, connected: true, show_synced: true, message: "Show synced to Google Calendar." });
}

async function handleGoogleCalendarSyncUpcoming() {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  if (!(await canEditEventDetails(auth.user.id))) return NextResponse.json({ message: "Only users with event editing access can sync Google Calendar." }, { status: 403 });
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
  await getGoogleAccessForUser(admin, auth.user.id);
  const today = new Date().toISOString().slice(0, 10);
  const { data: shows, error } = await admin
    .from("shows")
    .select("id, name, show_start, show_end")
    .gte("show_end", today)
    .order("show_start", { ascending: true })
    .limit(100);
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  const rows = (shows || []) as Array<{ id: string; name?: string | null }>;
  const synced: Array<{ show_id: string; name?: string | null; google_event_id?: string | null }> = [];
  const failed: Array<{ show_id: string; name?: string | null; error: string }> = [];
  for (const show of rows) {
    try {
      const result = await syncSingleShowToGoogle(admin, auth.user.id, show.id);
      synced.push({ show_id: show.id, name: show.name, google_event_id: result.google_event_id });
    } catch (syncError) {
      failed.push({ show_id: show.id, name: show.name, error: syncError instanceof Error ? syncError.message : "Sync failed." });
    }
  }
  return NextResponse.json({ ok: true, connected: true, synced_count: synced.length, failed_count: failed.length, synced, failed, message: `Synced ${synced.length} upcoming show${synced.length === 1 ? "" : "s"} to Google Calendar${failed.length ? `; ${failed.length} failed.` : "."}` });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (id === "google-calendar-callback") return handleGoogleCalendarCallback(request);
  if (id !== "google-calendar") return NextResponse.json({ message: "Not found." }, { status: 404 });
  const action = new URL(request.url).searchParams.get("action") || "status";
  if (action === "connect") return handleGoogleCalendarConnect(request);
  return handleGoogleCalendarStatus(request);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (id !== "google-calendar") return NextResponse.json({ message: "Not found." }, { status: 404 });
  const action = new URL(request.url).searchParams.get("action") || "sync-show";
  if (action === "disconnect") return handleGoogleCalendarDisconnect();
  if (action === "sync-upcoming") return handleGoogleCalendarSyncUpcoming();
  return handleGoogleCalendarSyncShow(request);
}


const optionalShowColumns = [
  "business_client_id",
  "client_contact_id",
  "coordinator_contact_id",
  "assigned_coordinator_user_id",
  "event_location",
] as const;

type OptionalShowColumn = (typeof optionalShowColumns)[number];

type ShowUpdatePayload = {
  name: string;
  client: string | null;
  business_client_id?: string | null;
  client_contact_id?: string | null;
  coordinator_contact_id?: string | null;
  assigned_coordinator_user_id?: string | null;
  venue: string | null;
  event_location?: string | null;
  rate_city: string;
  show_start: string;
  show_end: string;
  notes: string | null;
};

function missingShowColumnFromMessage(message: string): OptionalShowColumn | null {
  return optionalShowColumns.find((column) => message.includes(column)) ?? null;
}

async function updateShowWithSchemaFallback(admin: ReturnType<typeof createSupabaseAdminClient>, showId: string, payload: ShowUpdatePayload) {
  if (!admin) throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing.");
  const workingPayload: Record<string, unknown> = { ...payload };

  for (let attempt = 0; attempt < optionalShowColumns.length + 1; attempt += 1) {
    const result = await admin.from("shows").update(workingPayload).eq("id", showId);
    if (!result.error) return result;

    const missingColumn = missingShowColumnFromMessage(result.error.message);
    if (!missingColumn) return result;
    delete workingPayload[missingColumn];
  }

  return admin.from("shows").update(workingPayload).eq("id", showId);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  if (!(await canEditEventDetails(auth.user.id))) {
    return NextResponse.json({ message: "Only owner/admin users or coordinators with Event detail editing enabled can edit event details." }, { status: 403 });
  }
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
  const { id } = await params;
  const body = await request.json();
  const payload: ShowUpdatePayload = {
    name: String(body.name || "").trim(),
    client: String(body.client || "").trim() || null,
    business_client_id: String(body.business_client_id || "").trim() || null,
    client_contact_id: String(body.client_contact_id || "").trim() || null,
    coordinator_contact_id: String(body.coordinator_contact_id || "").trim() || null,
    assigned_coordinator_user_id: String(body.assigned_coordinator_user_id || "").trim() || null,
    venue: String(body.venue || "").trim() || null,
    event_location: String(body.event_location || "").trim() || null,
    rate_city: String(body.rate_city || "Default").trim() || "Default",
    show_start: String(body.show_start || "").trim(),
    show_end: String(body.show_end || "").trim(),
    notes: String(body.notes || "").trim() || null,
  };
  const { error } = await updateShowWithSchemaFallback(admin, id, payload);
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });

  // Keep previously saved show ratings tied to the current saved business client
  // and project manager/contact. If older schemas are missing those columns, do not block saving the event.
  const ratingsUpdate: Record<string, unknown> = {
    client_id: payload.business_client_id ?? null,
    client_contact_id: payload.client_contact_id ?? null,
    updated_at: new Date().toISOString(),
  };
  let ratingsError = (await admin.from("tech_ratings").update(ratingsUpdate).eq("show_id", id)).error;
  if (ratingsError && ratingsError.message.includes("client_contact_id")) {
    delete ratingsUpdate.client_contact_id;
    ratingsError = (await admin.from("tech_ratings").update(ratingsUpdate).eq("show_id", id)).error;
  }
  if (ratingsError && !ratingsError.message.includes("client_id")) return NextResponse.json({ message: ratingsError.message }, { status: 400 });

  return NextResponse.json({ ok: true, message: "Show updated. Ratings are synced to the selected client and project manager/contact." });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  if (!(await canDeleteEventDetails(auth.user.id))) {
    return NextResponse.json({ message: "Only owner/admin users can delete events. Coordinators can view and help fill assigned events, but they cannot delete event details." }, { status: 403 });
  }
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
  const { id } = await params;
  const { error } = await admin.from("shows").delete().eq("id", id);
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, message: "Show deleted." });
}
