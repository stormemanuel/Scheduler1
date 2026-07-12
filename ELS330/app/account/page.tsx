import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";

function validatePassword(password: string, confirmPassword: string) {
  if (!password || !confirmPassword) return "Enter the new password twice.";
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (password !== confirmPassword) return "The two passwords do not match.";
  return null;
}

type AccountSearchParams = {
  status?: string | string[];
  error?: string | string[];
  viewer?: string | string[];
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

export default async function AccountPage({ searchParams }: { searchParams?: Promise<AccountSearchParams> }) {
  const session = await requireUser();
  const params = searchParams ? await searchParams : {};
  const forcePasswordChange = Boolean(session.user?.user_metadata?.force_password_change);
  const status = firstParam(params.status);
  const errorMessage = firstParam(params.error);
  const viewerKey = firstParam(params.viewer).trim();

  async function changePasswordAction(formData: FormData) {
    "use server";

    const activeSession = await requireUser();
    const supabase = await createSupabaseServerClient();
    if (!supabase) redirect("/account?error=missing-supabase");

    const password = String(formData.get("password") || "").trim();
    const confirmPassword = String(formData.get("confirmPassword") || "").trim();
    const validationError = validatePassword(password, confirmPassword);
    if (validationError) redirect(`/account?error=${encodeURIComponent(validationError)}`);

    const currentMetadata = activeSession.user?.user_metadata || {};
    const { error } = await supabase.auth.updateUser({
      password,
      data: { ...currentMetadata, force_password_change: false },
    });

    if (error) redirect(`/account?error=${encodeURIComponent(error.message)}`);
    redirect("/account?status=password-changed");
  }

  if (viewerKey) {
    return (
      <div className="grid" style={{ gap: 12 }}>
        <section className="card" style={{ position: "sticky", top: 8, zIndex: 20 }}>
          <div className="row" style={{ alignItems: "center", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <h2 id="els-document-title" style={{ margin: 0 }}>Document preview</h2>
              <p className="muted small" style={{ margin: "4px 0 0" }}>Document preview inside ELS Scheduler.</p>
            </div>
            <div className="toolbar" style={{ justifyContent: "flex-end" }}>
              <a id="els-document-back" className="primary" href="/">Back to app</a>
              <a id="els-document-external" className="ghost" href="/" target="_blank" rel="noopener noreferrer">Open externally</a>
            </div>
          </div>
        </section>
        <section className="card" style={{ padding: 8, overflow: "hidden" }}>
          <iframe
            id="els-document-frame"
            title="Document preview"
            style={{ display: "block", width: "100%", minHeight: "78vh", border: 0, borderRadius: 12, background: "#fff" }}
            referrerPolicy="no-referrer"
          />
          <img
            id="els-document-image"
            alt="Document preview"
            style={{ display: "none", width: "100%", maxHeight: "78vh", objectFit: "contain", borderRadius: 12, background: "#111827" }}
            referrerPolicy="no-referrer"
          />
          <p id="els-document-status" className="muted small" style={{ margin: "10px 6px 4px" }}>
            Loading secure document preview...
          </p>
        </section>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){
              var key = new URLSearchParams(window.location.search).get('viewer') || '';
              var titleNode = document.getElementById('els-document-title');
              var frame = document.getElementById('els-document-frame');
              var image = document.getElementById('els-document-image');
              var back = document.getElementById('els-document-back');
              var external = document.getElementById('els-document-external');
              var status = document.getElementById('els-document-status');
              function safeDocumentUrl(value) {
                var clean = String(value || '').trim();
                if (!clean) return '';
                if (clean.charAt(0) === '/' && clean.slice(0, 2) !== '//') return clean;
                try {
                  var parsed = new URL(clean);
                  return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : '';
                } catch (_) { return ''; }
              }
              function safeReturnPath(value) {
                var clean = String(value || '').trim();
                return clean.charAt(0) === '/' && clean.slice(0, 2) !== '//' ? clean : '/';
              }
              function looksLikeImage(value, title, explicitKind) {
                if (explicitKind === 'image') return true;
                var combined = String(value || '').split('?')[0].toLowerCase() + ' ' + String(title || '').toLowerCase();
                return /\\.(jpe?g|png|webp|gif|heic|heif)$/.test(combined) || /crew-profile-photos|crew-work-photos|profile-photos|work-photos|profile photo|work photo|image/.test(combined);
              }
              function showError(message) {
                frame.style.display = 'none';
                image.style.display = 'none';
                external.style.display = 'inline-flex';
                status.textContent = message || 'Unable to load this document preview.';
              }
              try {
                var raw = window.sessionStorage.getItem(key);
                var payload = raw ? JSON.parse(raw) : null;
                var url = safeDocumentUrl(payload && payload.documentUrl);
                if (!url) throw new Error('The secure document preview has expired or is unavailable. Return to the app and open it again.');
                var title = String(payload && payload.title || 'Document preview').trim() || 'Document preview';
                titleNode.textContent = title;
                frame.title = title;
                image.alt = title;
                back.href = safeReturnPath(payload && payload.returnPath);
                external.href = url;
                window.setTimeout(function(){
                  if (status.textContent === 'Loading secure document preview...') {
                    status.textContent = 'Still trying to load this secure preview. Use Open externally if it stays blank, or go Back to app and reopen it.';
                  }
                }, 4000);
                if (looksLikeImage(url, title, payload && payload.viewerKind)) {
                  frame.style.display = 'none';
                  image.style.display = 'block';
                  image.onload = function(){ status.textContent = 'Secure image preview loaded. The Back to app button remains available here.'; };
                  image.onerror = function(){ showError('Unable to load this secure image preview. Use Open externally, or return to the app and try again.'); };
                  image.src = url;
                } else {
                  frame.style.display = 'block';
                  image.style.display = 'none';
                  frame.onload = function(){ status.textContent = 'Secure document preview loaded. The Back to app button remains available here.'; };
                  frame.src = url;
                  window.setTimeout(function(){
                    if (status.textContent === 'Loading secure document preview...') {
                      status.textContent = 'If the preview does not load, use Open externally. The Back to app button remains available here.';
                    }
                  }, 2500);
                }
              } catch (error) {
                frame.style.display = 'none';
                image.style.display = 'none';
                external.style.display = 'none';
                status.textContent = error && error.message ? error.message : 'Unable to load this document preview.';
              }
            })();`,
          }}
        />
      </div>
    );
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="row">
          <div>
            <h2>Account</h2>
            <p className="muted" style={{ margin: 0 }}>
              Manage your login password. Coordinators who received a temporary password can replace it here after signing in.
            </p>
          </div>
          <span className="badge">{session.profile?.role || "user"}</span>
        </div>
        {forcePasswordChange ? (
          <p className="error" style={{ marginTop: 12 }}>
            You are signed in with a temporary password. Change it here before continuing regular work.
          </p>
        ) : null}
        {status === "password-changed" ? <p className="success" style={{ marginTop: 12 }}>Password changed.</p> : null}
        {errorMessage ? <p className="error" style={{ marginTop: 12 }}>{errorMessage}</p> : null}
      </section>

      <section className="card" style={{ maxWidth: 720 }}>
        <h2>Change password</h2>
        <form action={changePasswordAction} className="list">
          <label className="field">
            <span>Signed in email</span>
            <input value={session.user?.email || ""} readOnly />
          </label>
          <label className="field">
            <span>New password</span>
            <input name="password" type="password" minLength={8} required autoComplete="new-password" />
          </label>
          <label className="field">
            <span>Confirm new password</span>
            <input name="confirmPassword" type="password" minLength={8} required autoComplete="new-password" />
          </label>
          <p className="muted small">
            Passwords must be at least 8 characters. After changing it, use the new password the next time you sign in.
          </p>
          <button className="primary" type="submit">Change password</button>
        </form>
      </section>
    </div>
  );
}
