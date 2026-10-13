import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";
import { buildImportComparison, buildImportPreview, getImportOverrides } from "@/lib/event-import-server";
import { normalizeImportedRoleName } from "@/lib/event-import";

export const runtime = "nodejs";


function cleanDate(value: unknown) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function cleanTime(value: unknown) {
  const text = String(value || "").trim();
  return /^\d{2}:\d{2}$/.test(text) ? text : "";
}

function applyPreviewEdits(preview: Awaited<ReturnType<typeof buildImportPreview>>, rawOverrides: string) {
  if (!rawOverrides.trim()) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawOverrides);
  } catch {
    throw new Error("Import preview edits could not be read. Preview again and retry.");
  }
  const subCalls = Array.isArray((parsed as { subCalls?: unknown[] })?.subCalls)
    ? (parsed as { subCalls: Array<Record<string, unknown>> }).subCalls
    : [];
  if (!subCalls.length) return;

  const editsByKey = new Map<string, Record<string, unknown>>();
  subCalls.forEach((row) => {
    const key = String(row.key || "").trim();
    if (key) editsByKey.set(key, row);
  });

  preview.payload.subCallGroups = preview.payload.subCallGroups.map((call, index) => {
    const previewCall = preview.subCallPreview[index];
    const edit = (previewCall?.key ? editsByKey.get(previewCall.key) : null) || subCalls[index];
    if (!edit) return call;
    const dayType = String(edit.day_type || call.day_type || "full_day").trim();
    return {
      ...call,
      labor_date: cleanDate(edit.labor_date) || call.labor_date,
      area: String(edit.area || call.area || "").trim() || call.area,
      role_name: normalizeImportedRoleName(String(edit.role_name || call.role_name || "").trim() || call.role_name),
      start_time: cleanTime(edit.start_time) || call.start_time,
      end_time: cleanTime(edit.end_time) || call.end_time,
      crew_needed: Math.max(1, Math.floor(Number(edit.crew_needed || call.crew_needed || 1))),
      po_number: String(edit.po_number || "").trim() || null,
      booth_number: String(edit.booth_number || call.booth_number || "").trim() || null,
      sub_call_reference_number: String(edit.sub_call_reference_number || "").trim() || null,
      message_rate: String(edit.message_rate || "").replace(/[^0-9.]/g, "").trim() || null,
      day_type: ["full_day", "half_day", "hourly", "custom"].includes(dayType) ? dayType as "full_day" | "half_day" | "hourly" | "custom" : "full_day",
    };
  });

  preview.subCallPreview = preview.subCallPreview.map((call, index) => {
    const edited = preview.payload.subCallGroups[index];
    return edited ? {
      ...call,
      labor_date: edited.labor_date,
      area: edited.area,
      role_name: edited.role_name,
      start_time: edited.start_time,
      end_time: edited.end_time,
      crew_needed: edited.crew_needed,
      po_number: edited.po_number || null,
      booth_number: edited.booth_number || null,
      sub_call_reference_number: edited.sub_call_reference_number || null,
      message_rate: edited.message_rate || null,
      day_type: edited.day_type || null,
    } : call;
  });
}

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
    const rawPreviewOverrides = String(formData.get("import_preview_overrides") || "");
    if (rawPreviewOverrides.trim()) {
      applyPreviewEdits(preview, rawPreviewOverrides);
      if (targetShowId && preview.existingEventMatch) {
        preview.comparison = await buildImportComparison(admin, preview.payload, preview.existingEventMatch);
      }
    }

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
