import type { Metadata, Viewport, Route } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { canUsePage, getSessionUser, normalizeRole, pageHrefByKey, pageLabelByKey, type AppPageKey } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import GlobalSearch from "@/app/components/global-search";
import OnboardingTutorial, { AppBadgeSync, CoordinatorNotificationNavLink, CoordinatorNotificationPageMarker, OnboardingReviewNavLink } from "@/app/components/onboarding-tutorial";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

const elsBoltFavicon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cpath fill='%23F1BF2C' d='M38.5 2 13.5 36.5h16L23.8 62 51 25.5H35.7L38.5 2Z'/%3E%3C/svg%3E";

export const metadata: Metadata = {
  title: "ELS Scheduler",
  applicationName: "ELS Scheduler",
  description: "Emanuel Labor Services scheduling, staffing, client, and payroll app.",
  manifest: "/api/user-access?action=manifest",
  appleWebApp: {
    capable: true,
    title: "ELS Scheduler",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [{ url: elsBoltFavicon, type: "image/svg+xml" }],
    shortcut: [{ url: elsBoltFavicon, type: "image/svg+xml" }],
    apple: [{ url: "/api/user-access?action=app_icon", type: "image/png", sizes: "180x180" }],
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0d333d",
};

const navPages: AppPageKey[] = ["overview", "coordinator", "crew", "onboarding", "events", "clients", "pipelines", "payroll", "users", "settings"];

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const requestHeaders = await headers();
  const pathname = requestHeaders.get("x-els-pathname") || "";
  const isPublicFeedbackRoute = pathname === "/feedback" || pathname.startsWith("/feedback/");
  const isPublicOnboardingRoute = pathname === "/onboarding" || pathname.startsWith("/onboarding/");

  if (isPublicFeedbackRoute || isPublicOnboardingRoute) {
    return (
      <html lang="en">
        <body>
          <div className="feedback-route-shell" aria-label={isPublicOnboardingRoute ? "Public onboarding form" : "Public feedback survey"}>
            {children}
          </div>
          <SpeedInsights />
        </body>
      </html>
    );
  }

  const session = await getSessionUser();
  const role = normalizeRole(session.profile?.role as string | null | undefined);
  const actorRole = normalizeRole(session.actorProfile?.role as string | null | undefined);
  const isViewingAs = Boolean(session.isViewingAs && (actorRole === "owner" || actorRole === "admin"));
  const visiblePages = navPages.filter((page) => canUsePage(role, session.access, page));

  async function signOut() {
    "use server";
    const supabase = await createSupabaseServerClient();
    await supabase?.auth.signOut();
  }

  return (
    <html lang="en">
      <body className={isViewingAs ? "view-as-user-mode" : undefined}>
        <div className="shell">
          <header className="app-header" aria-label="Application header">
            <div className="brand-search-card card">
              <Link href={(session.user ? "/overview" : "/") as Route} className="brand-logo-link" aria-label="Emanuel Labor Services home">
                <img src="/els-logo.png" alt="Emanuel Labor Services" className="brand-mark" />
              </Link>
              <GlobalSearch enabled={Boolean(session.user)} readOnly={isViewingAs} trackActivity={Boolean(session.user) && !isViewingAs} />
            </div>
            <nav className="page-nav-card card nav" aria-label="Primary navigation">
              {session.user ? (
                visiblePages.map((page) => page === "onboarding" && (role === "owner" || role === "admin") ? (
                  <OnboardingReviewNavLink key={page} href={pageHrefByKey[page]} label={pageLabelByKey[page]} />
                ) : role === "coordinator" && (page === "events" || page === "coordinator") ? (
                  <CoordinatorNotificationNavLink key={page} href={pageHrefByKey[page]} label={pageLabelByKey[page]} />
                ) : (
                  <Link key={page} href={pageHrefByKey[page] as Route}>{pageLabelByKey[page]}</Link>
                ))
              ) : (
                <Link href="/login">Login</Link>
              )}
            </nav>
          </header>
          {isViewingAs ? (
            <div className="view-as-user-banner" role="status">
              <div>
                <strong>Viewing as {session.profile?.full_name || session.user?.email || "user"} — Read-only</strong>
                <div className="small">You are still signed in as {session.actorProfile?.full_name || session.actorUser?.email || "Admin"}. Changes and private admin APIs are blocked.</div>
              </div>
              <a className="ghost" href="/api/user-access?action=exit_preview" data-activity-ignore>Exit user view</a>
            </div>
          ) : null}
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
                {!isViewingAs ? <Link href={"/account" as Route} className="ghost">Account</Link> : null}
                {!isViewingAs ? (
                  <form action={signOut}>
                    <button className="ghost" type="submit">Sign out</button>
                  </form>
                ) : null}
              </div>
            </div>
          ) : null}
          {session.user ? <AppBadgeSync role={role} /> : null}
          {session.user && role === "coordinator" ? <CoordinatorNotificationPageMarker active={pathname.startsWith("/events") || pathname.startsWith("/coordinator")} /> : null}
          {session.user ? <OnboardingTutorial role={role} userName={session.profile?.full_name || session.user.email || ""} /> : null}
          {children}
        </div>
        <SpeedInsights />
      </body>
    </html>
  );
}
