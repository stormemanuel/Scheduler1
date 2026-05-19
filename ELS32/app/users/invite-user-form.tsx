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
        <select name="role" defaultValue="viewer">
          <option value="owner">owner</option>
          <option value="admin">admin</option>
          <option value="coordinator">coordinator</option>
          <option value="viewer">viewer</option>
        </select>
      </label>
      {message ? <p className="success">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      <button type="submit" className="primary" disabled={pending}>{pending ? "Sending invite..." : "Invite user"}</button>
    </form>
  );
}
