"use client";

import { FormEvent, useEffect, useState } from "react";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const hash = window.location.hash || "";
    const params = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(hash.replace(/^#/, ""));
    const isRecoveryLink = params.has("code")
      || params.get("type") === "recovery"
      || hashParams.get("type") === "recovery"
      || Boolean(hashParams.get("access_token") && hashParams.get("refresh_token"));
    if (isRecoveryLink) {
      window.location.replace(`/update-password${window.location.search}${hash}`);
    }
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setError("Supabase environment variables are missing.");
      setLoading(false);
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError("Unable to sign in. Check your email and password.");
      setLoading(false);
      return;
    }

    const safeNext: Route = next && next.startsWith("/") ? (next as Route) : "/";
    router.push(safeNext);
    router.refresh();
  }

  async function handleResetPassword() {
    setError(null);
    setMessage(null);
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setError("Enter your email first, then press Forgot password.");
      return;
    }
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setError("Supabase environment variables are missing.");
      return;
    }
    setResetLoading(true);
    const redirectTo = `${window.location.origin}/update-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, { redirectTo });
    setResetLoading(false);
    if (error) {
      setError(`Reset request failed: ${error.message}`);
      return;
    }
    setMessage(`Password reset request accepted for ${trimmedEmail}. Check that inbox for the recovery link.`);
  }

  return (
    <form onSubmit={handleSubmit} className="list">
      <label className="field">
        <span>Email</span>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
      </label>
      <label className="field">
        <span>Password</span>
        <input value={password} onChange={(e) => setPassword(e.target.value)} type={showPassword ? "text" : "password"} required />
      </label>
      <label className="checkbox-line">
        <input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} />
        <span>Show password</span>
      </label>
      {error ? <p className="error">{error}</p> : null}
      {message ? <p className="success">{message}</p> : null}
      <button type="submit" className="primary" disabled={loading}>{loading ? "Signing in..." : "Sign in"}</button>
      <button type="button" className="ghost" onClick={handleResetPassword} disabled={resetLoading || loading}>
        {resetLoading ? "Sending reset..." : "Forgot password?"}
      </button>
    </form>
  );
}
