"use client";

import { useState, useTransition } from "react";
import { inviteUserAction, sendPasswordResetEmailAction, setTemporaryPasswordAction } from "./actions";

export function ViewAsUserButton({ userId, userName, disabled = false }: { userId: string; userName: string; disabled?: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function startPreview() {
    if (disabled || pending) return;
    const confirmed = window.confirm(`Open the app as ${userName} in read-only mode?`);
    if (!confirmed) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/user-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start_preview", user_id: userId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Could not start user view.");
      window.location.assign("/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start user view.");
      setPending(false);
    }
  }

  return (
    <span style={{ display: "inline-grid", gap: 4 }}>
      <button type="button" className="ghost" onClick={startPreview} disabled={disabled || pending}>
        {disabled ? "Your account" : pending ? "Opening..." : "View as user"}
      </button>
      {error ? <span className="error small">{error}</span> : null}
    </span>
  );
}

export default function InviteUserForm() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form className="list" action={(formData) => {
      setMessage(null);
      setError(null);
      startTransition(async () => {
        const result = await inviteUserAction(formData);
        if (result.ok) setMessage(result.message);
        else setError(result.message);
      });
    }}>
      <label className="field">
        <span>Full name</span>
        <input name="fullName" type="text" placeholder="Storm Leigh" />
      </label>
      <label className="field">
        <span>Email</span>
        <input name="email" type="email" required placeholder="name@example.com" />
      </label>
      <label className="field">
        <span>Role</span>
        <select name="role" defaultValue="coordinator">
          <option value="owner">Owner</option>
          <option value="admin">Admin</option>
          <option value="coordinator">Coordinator</option>
          <option value="salesman">Salesman</option>
          <option value="viewer">Viewer</option>
        </select>
      </label>
      <label className="field">
        <span>Temporary password</span>
        <input name="temporaryPassword" type={showPassword ? "text" : "password"} minLength={8} placeholder="Optional — creates login now" autoComplete="off" />
      </label>
      <label className="checkbox-line">
        <input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} />
        <span>Show password</span>
      </label>
      <p className="muted small">
        Fill in a temporary password to create the login immediately so you can test it before sending access. Leave it blank to send a normal Supabase invite email. Coordinators can change their password later from Account.
      </p>
      {message ? <p className="success">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      <button type="submit" className="primary" disabled={pending}>{pending ? "Saving user..." : "Create / invite user"}</button>
    </form>
  );
}

export function AdminPasswordControls({ userId, userName, email }: { userId: string; userName: string; email: string }) {
  const [pending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<"temporary" | "email" | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(action: "temporary" | "email", formData: FormData) {
    setMessage(null);
    setError(null);
    setPendingAction(action);
    startTransition(async () => {
      const result = action === "temporary"
        ? await setTemporaryPasswordAction(formData)
        : await sendPasswordResetEmailAction(formData);
      if (result.ok) setMessage(result.message);
      else setError(result.message);
      setPendingAction(null);
    });
  }

  return (
    <div className="card compact accent-card">
      <h3 style={{ marginBottom: 8 }}>Login & Authentication</h3>
      <div className="small muted" style={{ marginBottom: 10 }}>Login Email: {email || "No email saved"}</div>
      <form className="list" action={(formData) => run("temporary", formData)}>
        <input type="hidden" name="userId" value={userId} />
        <label className="field">
          <span>Set Temporary Password</span>
          <input name="temporaryPassword" type={showPassword ? "text" : "password"} minLength={8} placeholder={`Temporary password for ${userName}`} autoComplete="off" />
        </label>
        <label className="checkbox-line">
          <input type="checkbox" name="requirePasswordChange" defaultChecked />
          <span>Require password change at next login</span>
        </label>
        <label className="checkbox-line">
          <input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} />
          <span>Show password</span>
        </label>
        <button type="submit" className="ghost" disabled={pending}>{pendingAction === "temporary" ? "Setting password..." : "Set Temporary Password"}</button>
      </form>
      <form action={(formData) => run("email", formData)} style={{ marginTop: 10 }}>
        <input type="hidden" name="userId" value={userId} />
        <button type="submit" className="ghost" disabled={pending || !email}>{pendingAction === "email" ? "Sending reset..." : "Send Password Reset Email"}</button>
      </form>
      {message ? <p className="success" style={{ marginBottom: 0 }}>{message}</p> : null}
      {error ? <p className="error" style={{ marginBottom: 0 }}>{error}</p> : null}
    </div>
  );
}
