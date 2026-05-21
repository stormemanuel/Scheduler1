import { requireUser } from "@/lib/auth";
import { getPipelinePageData } from "@/lib/pipeline-data";
import PipelinesClient from "./pipelines-client";

export default async function PipelinesPage() {
  const session = await requireUser();
  const { pipelineRows, setupMissing, tableMissing, error } = await getPipelinePageData();

  if (setupMissing) {
    return (
      <div className="card">
        <h2>Pipelines</h2>
        <p className="muted">Supabase environment variables are missing, so Pipelines cannot load yet.</p>
      </div>
    );
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="row">
          <div>
            <h2 style={{ marginBottom: 6 }}>Pipelines</h2>
            <p className="muted" style={{ margin: 0 }}>
              Track upcoming opportunities before they become confirmed shows: inquiry, estimate, quote, verbal yes, confirmed, lost, and archived.
            </p>
          </div>
          <div className="small muted">
            Signed in as <strong>{session.profile?.full_name || session.user?.email}</strong>
          </div>
        </div>
        {error ? <p className="error" style={{ marginTop: 12 }}>{error}</p> : null}
        {tableMissing ? (
          <p className="error" style={{ marginTop: 12 }}>
            Pipeline table is not installed yet. Run the supplied Supabase SQL for sales_pipeline, then refresh this page.
          </p>
        ) : null}
      </section>
      <PipelinesClient initialRows={pipelineRows} tableMissing={tableMissing} />
    </div>
  );
}
