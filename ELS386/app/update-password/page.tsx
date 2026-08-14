"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The two passwords do not match.");
      return;
    }

    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setError("Supabase environment variables are missing.");
      return;
    }

    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const currentMetadata = user?.user_metadata || {};
    const { error } = await supabase.auth.updateUser({
      password,
      data: { ...currentMetadata, force_password_change: false },
    });
    setLoading(false);
    if (error) {
      setError(`Password could not be updated: ${error.message}`);
      return;
    }
    setMessage("Password updated successfully.");
    window.setTimeout(() => {
      router.push("/");
      router.refresh();
    }, 900);
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card" style={{ maxWidth: 720 }}>
        <h2>Update Password</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Enter a new password after using a reset email or temporary password.
        </p>
        <form onSubmit={handleSubmit} className="list">
          <label className="field">
            <span>New password</span>
            <input value={password} onChange={(event) => setPassword(event.target.value)} type={showPasswords ? "text" : "password"} minLength={8} required autoComplete="new-password" />
          </label>
          <label className="field">
            <span>Confirm new password</span>
            <input value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} type={showPasswords ? "text" : "password"} minLength={8} required autoComplete="new-password" />
          </label>
          <label className="checkbox-line">
            <input type="checkbox" checked={showPasswords} onChange={(event) => setShowPasswords(event.target.checked)} />
            <span>Show passwords</span>
          </label>
          {message ? <p className="success">{message}</p> : null}
          {error ? <p className="error">{error}</p> : null}
          <button type="submit" className="primary" disabled={loading}>{loading ? "Updating..." : "Update Password"}</button>
        </form>
      </section>
    </div>
  );
}
