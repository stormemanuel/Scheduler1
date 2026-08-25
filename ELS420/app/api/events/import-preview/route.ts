import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";
import { buildImportPreview, getImportOverrides } from "@/lib/event-import-server";

export const runtime = "nodejs";

async function requireSignedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      ok: false as const,
      response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }),
    };
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }),
    };
  }
  return { ok: true as const, user };
}

export async function POST(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ message: "Import file is required." }, { status: 400 });
    }

    const mode = String(formData.get("mode") || "").trim().toLowerCase();
    const targetShowId = mode === "merge" ? String(formData.get("target_show_id") || "").trim() : "";
    const preview = await buildImportPreview(admin, file, getImportOverrides(formData), { existingEventId: targetShowId });

    return NextResponse.json({
      ok: true,
      message: `Parsed ${preview.payload.subCallGroups.length} sub-calls from ${file.name}.`,
      show: preview.payload.show,
      laborDays: preview.payload.laborDays,
      subCallPreview: preview.subCallPreview,
      needsReview: preview.needsReview,
      importDebug: preview.importDebug,
      importFormat: preview.importFormat,
      clientMatch: preview.clientMatch,
      existingEventMatch: preview.existingEventMatch,
      comparison: preview.comparison,
      matchedCrewCount: preview.matchedCrewCount,
      unmatchedCrewCount: preview.unmatchedCrewCount,
      sourceType: preview.parsed.sourceType,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import preview failed.";
    const debugMatch = message.match(/Debug:\s*(\{.*\})$/);
    let importDebug: unknown = null;
    if (debugMatch) {
      try {
        importDebug = JSON.parse(debugMatch[1]);
      } catch {
        importDebug = null;
      }
    }
    return NextResponse.json(
      { message: message.replace(/\s*Debug:\s*\{.*\}$/s, ""), importDebug },
      { status: 400 }
    );
  }
}
