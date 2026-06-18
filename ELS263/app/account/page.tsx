import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";

function validatePassword(password: string, confirmPassword: string) {
  if (!password || !confirmPassword) return "Enter the new password twice.";
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (password !== confirmPassword) return "The two passwords do not match.";
  return null;
}

export default async function AccountPage({ searchParams }: { searchParams?: Promise<{ status?: string; error?: string }> }) {
  const session = await requireUser();
  const params = searchParams ? await searchParams : {};
  const forcePasswordChange = Boolean(session.user?.user_metadata?.force_password_change);

  async function changePasswordAction(formData: FormData) {
    "use server";

    const activeSession = await requireUser();
    const supabase = await createSupabaseServerClient();
    if (!supabase) redirect("/account?error=missing-supabase");

    const password = String(formData.get("password") || "").trim();
    const confirmPassword = String(formData.get("confirmPassword") || "").trim();
    const validationError = validatePassword(password, confirmPassword);
    if (validationError) redirect(`/account?error=${encodeURIComponent(validationError)}`);

    const currentMetadata = activeSession.user?.user_metadata || {};
    const { error } = await supabase.auth.updateUser({
      password,
      data: { ...currentMetadata, force_password_change: false },
    });

    if (error) redirect(`/account?error=${encodeURIComponent(error.message)}`);
    redirect("/account?status=password-changed");
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="row">
          <div>
            <h2>Account</h2>
            <p className="muted" style={{ margin: 0 }}>
              Manage your login password. Coordinators who received a temporary password can replace it here after signing in.
            </p>
          </div>
          <span className="badge">{session.profile?.role || "user"}</span>
        </div>
        {forcePasswordChange ? (
          <p className="error" style={{ marginTop: 12 }}>
            You are signed in with a temporary password. Change it here before continuing regular work.
          </p>
        ) : null}
        {params.status === "password-changed" ? <p className="success" style={{ marginTop: 12 }}>Password changed.</p> : null}
        {params.error ? <p className="error" style={{ marginTop: 12 }}>{params.error}</p> : null}
      </section>

      <section className="card" style={{ maxWidth: 720 }}>
        <h2>Change password</h2>
        <form action={changePasswordAction} className="list">
          <label className="field">
            <span>Signed in email</span>
            <input value={session.user?.email || ""} readOnly />
          </label>
          <label className="field">
            <span>New password</span>
            <input name="password" type="password" minLength={8} required autoComplete="new-password" />
          </label>
          <label className="field">
            <span>Confirm new password</span>
            <input name="confirmPassword" type="password" minLength={8} required autoComplete="new-password" />
          </label>
          <p className="muted small">
            Passwords must be at least 8 characters. After changing it, use the new password the next time you sign in.
          </p>
          <button className="primary" type="submit">Change password</button>
        </form>
      </section>
    </div>
  );
}
