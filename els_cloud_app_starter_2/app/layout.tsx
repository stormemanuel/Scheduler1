import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "ELS Cloud Scheduler Starter",
  description: "Hosted Mac/iPhone synchronized scheduler starter for Emanuel Labor Services.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <div className="topbar">
            <div className="brand">
              <h1>Emanuel Labor Services</h1>
              <p>Cloud scheduler starter for app.emanuel-labor-services.com</p>
            </div>
            <nav className="nav">
              <Link href="/">Overview</Link>
              <Link href="/crew">Crew</Link>
              <Link href="/events">Events</Link>
              <Link href="/payroll">Payroll</Link>
              <Link href="/settings">Settings</Link>
            </nav>
          </div>
          {children}
        </div>
      </body>
    </html>
  );
}
