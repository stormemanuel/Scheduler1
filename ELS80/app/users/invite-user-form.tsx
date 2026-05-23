"use client";

import { useState, useTransition } from "react";
import { inviteUserAction } from "./actions";

export default function InviteUserForm() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      <p className="muted small">
        Salesman users only get Sales Pipeline access by default. Coordinators get Events/Crew only and can be limited to their own work.
      </p>
      {message ? <p className="success">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      <button type="submit" className="primary" disabled={pending}>{pending ? "Sending invite..." : "Invite user"}</button>
    </form>
  );
}
