import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { communicationChecklistStage, type TextMessageQueueRecord } from "@/lib/events-types";

function getConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { url, anonKey, serviceRoleKey };
}

export function hasSupabaseEnv() {
  const { url, anonKey } = getConfig();
  return Boolean(url && anonKey);
}

export async function createSupabaseServerClient() {
  const { url, anonKey } = getConfig();
  if (!url || !anonKey) return null;

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(
        cookiesToSet: { name: string; value: string; options?: Parameters<typeof cookieStore.set>[2] }[]
      ) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components may not be allowed to set cookies here.
        }
      },
    },
  });
}

export function createSupabaseAdminClient() {
  const { url, serviceRoleKey } = getConfig();
  if (!url || !serviceRoleKey) return null;

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}


type SentQueueChecklistRow = {
  show_id: string;
  crew_id: string | null;
  message_type: string | null;
  reminder_key: string | null;
  sent_at: string | null;
};

export async function syncAssignmentChecklistFromSentMessage(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  row: SentQueueChecklistRow | null | undefined,
) {
  if (!row?.show_id || !row.crew_id || communicationChecklistStage({ message_type: row.message_type || "", reminder_key: row.reminder_key || "" }) !== "schedule") return null;

  const sentAt = row.sent_at || new Date().toISOString();
  const { data: existing, error: existingError } = await admin
    .from("assignment_checklists")
    .select("id, schedule_sent, schedule_sent_at")
    .eq("show_id", row.show_id)
    .eq("crew_id", row.crew_id)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);

  if (existing?.id) {
    if (existing.schedule_sent) return existing;
    const { data, error } = await admin
      .from("assignment_checklists")
      .update({
        schedule_sent: true,
        schedule_sent_at: existing.schedule_sent_at || sentAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("id, show_id, crew_id, schedule_sent, confirmed, day_before_confirmed, schedule_sent_at, confirmed_at, day_before_confirmed_at, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  const { data, error } = await admin
    .from("assignment_checklists")
    .insert({
      show_id: row.show_id,
      crew_id: row.crew_id,
      schedule_sent: true,
      confirmed: false,
      day_before_confirmed: false,
      schedule_sent_at: sentAt,
      confirmed_at: null,
      day_before_confirmed_at: null,
      updated_at: new Date().toISOString(),
    })
    .select("id, show_id, crew_id, schedule_sent, confirmed, day_before_confirmed, schedule_sent_at, confirmed_at, day_before_confirmed_at, updated_at")
    .single();
  if (error) throw new Error(error.message);
  return data;
}
