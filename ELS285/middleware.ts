import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

type CookieToSet = {
  name: string;
  value: string;
  options?: CookieOptions;
};

export async function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-els-pathname", request.nextUrl.pathname);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) return NextResponse.next({ request: { headers: requestHeaders } });

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = NextResponse.next({ request: { headers: requestHeaders } });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const pathname = request.nextUrl.pathname;

  // Public feedback survey links must not require login.
  // These pages are token-protected and only expose the fillable survey/submit endpoint.
  // All normal app pages remain behind login.
  const isPwaAsset =
    pathname === "/apple-touch-icon.png" ||
    pathname === "/favicon.ico" ||
    (pathname === "/api/user-access" && request.nextUrl.searchParams.get("action") === "manifest");

  const isPublic =
    isPwaAsset ||
    pathname === "/login" ||
    pathname.startsWith("/auth/") ||
    pathname === "/onboarding" ||
    pathname.startsWith("/onboarding/") ||
    pathname.startsWith("/feedback/") ||
    pathname.startsWith("/api/onboarding") ||
    pathname.startsWith("/api/feedback/") ||
    pathname.startsWith("/api/text-automation/shortcut");

  if (!user && !isPublic) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && pathname === "/login") {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/";
    return NextResponse.redirect(redirectUrl);
  }

  const previewUserId = request.cookies.get("els_view_as_user")?.value || "";
  if (previewUserId) {
    const isPreviewControl = pathname === "/api/user-access";
    const isPreviewOnboardingRead =
      request.method === "GET" &&
      pathname === "/api/onboarding" &&
      request.nextUrl.searchParams.get("action") === "coordinator_dashboard";
    if (pathname.startsWith("/api/") && !isPreviewControl && !isPreviewOnboardingRead) {
      return NextResponse.json({ message: "View as user mode is read-only. Exit user view to use app actions." }, { status: 423 });
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && !isPreviewControl) {
      return NextResponse.json({ message: "View as user mode is read-only. Exit user view to make changes." }, { status: 423 });
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
