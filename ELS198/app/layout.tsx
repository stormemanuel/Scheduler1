import type { Metadata, Viewport, Route } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { canUsePage, getSessionUser, normalizeRole, pageHrefByKey, pageLabelByKey, type AppPageKey } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import GlobalSearch from "@/app/components/global-search";
import OnboardingTutorial from "@/app/components/onboarding-tutorial";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ELS Cloud Scheduler",
  description: "Hosted Mac/iPhone synchronized scheduler for Emanuel Labor Services.",
  icons: {
    icon: [{ url: "/favicon.ico" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

const navPages: AppPageKey[] = ["overview", "coordinator", "crew", "events", "clients", "pipelines", "payroll", "users", "settings"];

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const requestHeaders = await headers();
  const pathname = requestHeaders.get("x-els-pathname") || "";
  const isPublicFeedbackRoute = pathname === "/feedback" || pathname.startsWith("/feedback/");

  if (isPublicFeedbackRoute) {
    return (
      <html lang="en">
        <body>
          <div className="feedback-route-shell" aria-label="Public feedback survey">
            {children}
          </div>
          <SpeedInsights />
        </body>
      </html>
    );
  }

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
          <header className="app-header" aria-label="Application header">
            <div className="brand-search-card card">
              <Link href={(session.user ? "/overview" : "/") as Route} className="brand-logo-link" aria-label="Emanuel Labor Services home">
                <img src="/els-logo.png" alt="Emanuel Labor Services" className="brand-mark" />
              </Link>
              <GlobalSearch enabled={Boolean(session.user)} />
            </div>
            <nav className="page-nav-card card nav" aria-label="Primary navigation">
              {session.user ? (
                visiblePages.map((page) => (
                  <Link key={page} href={pageHrefByKey[page] as Route}>{pageLabelByKey[page]}</Link>
                ))
              ) : (
                <Link href="/login">Login</Link>
              )}
            </nav>
          </header>
          {session.user ? (
            <div className="sessionbar card compact">
              <div>
                <strong>{session.profile?.full_name || session.user.email}</strong>
                <div className="muted small">{session.user.email} • {role}</div>
                {session.user.user_metadata?.force_password_change ? (
                  <div className="error small" style={{ marginTop: 4 }}>Temporary password in use. Open Account to change it.</div>
                ) : null}
              </div>
              <div className="toolbar">
                <Link href={"/account" as Route} className="ghost">Account</Link>
                <form action={signOut}>
                  <button className="ghost" type="submit">Sign out</button>
                </form>
              </div>
            </div>
          ) : null}
          {session.user ? <OnboardingTutorial role={role} userName={session.profile?.full_name || session.user.email || ""} /> : null}
          {children}
        </div>
        <SpeedInsights />
      </body>
    </html>
  );
}
