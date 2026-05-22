export function onRouterTransitionStart(url: string) {
  if (url.includes("/feedback/")) {
    console.info("ELS feedback navigation", { url, at: new Date().toISOString() });
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => {
    if (window.location.pathname.startsWith("/feedback/")) {
      console.error("ELS feedback client error", {
        message: event.message,
        source: event.filename,
        line: event.lineno,
        column: event.colno,
      });
    }
  });

  window.addEventListener("unhandledrejection", (event) => {
    if (window.location.pathname.startsWith("/feedback/")) {
      console.error("ELS feedback unhandled promise rejection", event.reason);
    }
  });
}
