import type { Metadata, Viewport, Route } from "next";
import Link from "next/link";
import { canUsePage, getSessionUser, normalizeRole, pageHrefByKey, pageLabelByKey, type AppPageKey } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import GlobalSearch from "@/app/components/global-search";
import "./globals.css";

export const metadata: Metadata = {
  title: "ELS Cloud Scheduler",
  description: "Hosted Mac/iPhone synchronized scheduler for Emanuel Labor Services.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

const navPages: AppPageKey[] = ["overview", "crew", "events", "clients", "pipelines", "payroll", "users", "settings"];

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionUser();
  const role = normalizeRole(session.profile?.role as string | null | undefined);
  const visiblePages = navPages.filter((page) => canUsePage(role, session.access, page));

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
              <img src="/els-logo.png" alt="Emanuel Labor Services" className="brand-mark" />
              <div>
                <h1>Emanuel Labor Services</h1>
                <p>{session.user ? "Cloud operations app" : "Sign in to manage crew, events, payroll, and users."}</p>
              </div>
            </div>
            <GlobalSearch enabled={Boolean(session.user)} />
            <nav className="nav">
              {session.user ? (
                visiblePages.map((page) => (
                  <Link key={page} href={pageHrefByKey[page] as Route}>{pageLabelByKey[page]}</Link>
                ))
              ) : (
                <Link href="/login">Login</Link>
              )}
            </nav>
          </div>
          {session.user ? (
            <div className="sessionbar card compact">
              <div>
                <strong>{session.profile?.full_name || session.user.email}</strong>
                <div className="muted small">{session.user.email} • {role}</div>
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
