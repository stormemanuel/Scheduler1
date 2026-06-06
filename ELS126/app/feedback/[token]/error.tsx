"use client";

import { useEffect } from "react";

export default function FeedbackError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("ELS public feedback route failed", error);
  }, [error]);

  return (
    <main className="feedback-public-wrap" style={{ padding: 16 }}>
      <section className="feedback-public-card" style={{ maxWidth: 680, margin: "0 auto", background: "#fff", border: "1px solid #d6e0e0", borderRadius: 24, padding: 24 }}>
        <h1 style={{ marginTop: 0 }}>We could not load this feedback form</h1>
        <p style={{ color: "#637276" }}>Please refresh and try again. If it keeps happening, send this link back to Emanuel Labor Services so we can correct it.</p>
        <button type="button" onClick={reset} style={{ minHeight: 48, borderRadius: 12, border: "1px solid #062a31", background: "#062a31", color: "#fff", padding: "10px 14px", font: "inherit" }}>
          Try again
        </button>
      </section>
    </main>
  );
}
