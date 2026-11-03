import { DEFAULT_COORDINATOR_COMPENSATION, normalizeCoordinatorCompensationSchedule, type CoordinatorCompensationSchedule } from "@/lib/payroll-calculations";

type Profile = { id: string; email?: string | null; full_name?: string | null };
type Account = { id: string; email?: string | null; user_metadata?: Record<string, unknown> };
const rates = ["full_day_rate_1_20", "full_day_rate_21_35", "full_day_rate_36_50", "full_day_rate_51_plus", "half_day_rate_1_49", "half_day_rate_50_plus"] as const;
const key = (value: unknown) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
function preferred(current: CoordinatorCompensationSchedule | undefined, next: CoordinatorCompensationSchedule) {
  const score = (value: CoordinatorCompensationSchedule) => rates.reduce((sum, field) => sum + (value[field] !== DEFAULT_COORDINATOR_COMPENSATION[field] ? 10 : 0), value.notes ? 1 : 0);
  return !current || score(next) >= score(current) ? next : current;
}

export function resolveCoordinatorAgreements(rows: unknown[], profiles: Profile[], accounts: Account[]) {
  const schedules = new Map<string, CoordinatorCompensationSchedule>();
  for (const value of rows) {
    if (!value || typeof value !== "object") continue;
    const row = value as Partial<CoordinatorCompensationSchedule> & { user_id?: string };
    const id = String(row.coordinator_user_id || row.user_id || "").trim();
    if (id) schedules.set(id, preferred(schedules.get(id), normalizeCoordinatorCompensationSchedule({ ...row, coordinator_user_id: id })));
  }
  const metadata = new Map<string, CoordinatorCompensationSchedule>();
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const byEmail = new Map<string, Account[]>(), byName = new Map<string, Account[]>();
  for (const account of accounts) {
    const email = key(account.email), name = key(account.user_metadata?.full_name);
    if (email) byEmail.set(email, [...(byEmail.get(email) || []), account]);
    if (name) byName.set(name, [...(byName.get(name) || []), account]);
    const raw = account.user_metadata?.els_coordinator_compensation;
    if (!raw || typeof raw !== "object" || !rates.some((field) => Object.prototype.hasOwnProperty.call(raw, field))) continue;
    metadata.set(account.id, normalizeCoordinatorCompensationSchedule({ ...raw, coordinator_user_id: account.id }));
  }
  for (const profile of profiles) {
    const emails = byEmail.get(key(profile.email)) || [];
    // Use names only for legacy profiles with no email and a unique account.
    // Never borrow another person's agreement solely because names match.
    const names = !key(profile.email) ? byName.get(key(profile.full_name)) || [] : [];
    const account = byId.get(profile.id) || (emails.length === 1 ? emails[0] : undefined) || (names.length === 1 ? names[0] : undefined);
    const saved = account && metadata.get(account.id);
    const table = account ? schedules.get(account.id) : undefined;
    const legacy = schedules.get(profile.id);
    const agreement = saved || (table && legacy ? preferred(table, legacy) : table || legacy);
    if (agreement) {
      schedules.set(profile.id, { ...agreement, coordinator_user_id: profile.id });
      if (account) schedules.set(account.id, { ...agreement, coordinator_user_id: account.id });
    }
  }
  // Saved account metadata is authoritative, including an intentional reset to
  // defaults or a zero-dollar agreement; stale table rows must not override it.
  for (const [id, agreement] of metadata) schedules.set(id, agreement);
  return schedules;
}

export async function loadCoordinatorAgreements(
  admin: ReturnType<typeof import("@/lib/supabase-server").createSupabaseAdminClient>, rows: unknown[],
) {
  if (!admin) return resolveCoordinatorAgreements(rows, [], []);
  const profiles: Profile[] = [], accounts: Account[] = [];
  for (let page = 0; page < 100; page++) {
    const result = await admin.from("profiles").select("id, email, full_name").order("id").range(page * 100, page * 100 + 99);
    if (result.error) throw new Error("Cannot load coordinator identities for their pay agreements. Please retry Payroll.");
    const batch = (result.data || []) as Profile[];
    profiles.push(...batch);
    if (batch.length < 100) break;
    if (page === 99) throw new Error("Coordinator identity lookup exceeded its safe limit.");
  }
  for (let page = 1; page <= 100; page++) {
    const result = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (result.error) throw new Error("Cannot load saved coordinator agreements. Please retry Payroll instead of using an unverified payout.");
    const batch = (result.data.users || []) as Account[];
    accounts.push(...batch);
    if (batch.length < 1000) break;
    if (page === 100) throw new Error("Coordinator agreement lookup exceeded its safe limit.");
  }
  return resolveCoordinatorAgreements(rows, profiles, accounts);
}
