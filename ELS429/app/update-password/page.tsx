"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

function hasRecoveryHash() {
  if (typeof window === "undefined") return false;
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return false;
  const hashParams = new URLSearchParams(hash);
  return hashParams.get("type") === "recovery" || Boolean(hashParams.get("access_token") && hashParams.get("refresh_token"));
}

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function prepareRecoverySession() {
      setCheckingSession(true);
      setError(null);

      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!alive) return;
        setError("Supabase environment variables are missing.");
        setCheckingSession(false);
        return;
      }

      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError && alive) {
          setError(`Recovery link could not be opened: ${exchangeError.message}`);
        } else {
          url.searchParams.delete("code");
          window.history.replaceState({}, "", `${url.pathname}${url.search}${window.location.hash}`);
        }
      }

      if (hasRecoveryHash()) {
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const accessToken = hashParams.get("access_token");
        const refreshToken = hashParams.get("refresh_token");
        if (accessToken && refreshToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (sessionError && alive) {
            setError(`Recovery session could not be opened: ${sessionError.message}`);
          } else {
            window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}`);
          }
        }
      }

      const { data, error: sessionError } = await supabase.auth.getSession();
      if (!alive) return;
      if (sessionError) {
        setError(`Password recovery session could not be verified: ${sessionError.message}`);
      }
      setSessionReady(Boolean(data.session));
      setCheckingSession(false);
    }

    const supabase = createSupabaseBrowserClient();
    const subscription = supabase?.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) {
        setSessionReady(Boolean(session));
        setCheckingSession(false);
      }
    }).data.subscription;

    prepareRecoverySession();
    return () => {
      alive = false;
      subscription?.unsubscribe();
    };
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    if (!sessionReady) {
      setError("This reset link is not active. Open the newest password reset email, or request a new reset link.");
      return;
    }
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
        {checkingSession ? <p className="muted small">Opening password recovery session...</p> : null}
        {!checkingSession && !sessionReady ? (
          <p className="error">
            This reset link is not active. Request a new password reset email, then open the newest link.
          </p>
        ) : null}
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
          <button type="submit" className="primary" disabled={loading || checkingSession || !sessionReady}>{loading ? "Updating..." : "Update Password"}</button>
        </form>
      </section>
    </div>
  );
}
