import type { Metadata } from "next";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import "./globals.css";

export const metadata: Metadata = {
  title: "ELS Cloud Scheduler",
  description: "Hosted Mac/iPhone synchronized scheduler for Emanuel Labor Services.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionUser();

  async function signOut() {
    "use server";
    const supabase = await createSupabaseServerClient();
    await supabase?.auth.signOut();
  }

  return (
    <html lang="en">
      <body>
        <div className="shell">
          <div className="topbar">
            <div className="brand">
              <h1>Emanuel Labor Services</h1>
              <p>{session.user ? "Cloud operations app" : "Sign in to manage crew, events, payroll, and users."}</p>
            </div>
            <nav className="nav">
              {session.user ? (
                <>
                  <Link href="/">Overview</Link>
                  <Link href="/crew">Crew</Link>
                  <Link href="/events">Events</Link>
                  <Link href="/payroll">Payroll</Link>
                  <Link href="/users">Users</Link>
                  <Link href="/settings">Settings</Link>
                </>
              ) : (
                <Link href="/login">Login</Link>
              )}
            </nav>
          </div>
          {session.user ? (
            <div className="sessionbar card compact">
              <div>
                <strong>{session.profile?.full_name || session.user.email}</strong>
                <div className="muted small">{session.user.email} • {(session.profile?.role || "viewer").toString()}</div>
              </div>
              <form action={signOut}>
                <button className="ghost" type="submit">Sign out</button>
              </form>
            </div>
          ) : null}
          {children}
        </div>
      </body>
    </html>
  );
}
