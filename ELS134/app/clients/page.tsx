import { requirePage } from "@/lib/auth";
import { getClientDirectoryData } from "@/lib/clients-data";
import { getCrewPageData } from "@/lib/crew-data";
import ClientsClient from "./clients-client";

export default async function ClientsPage() {
  const session = await requirePage("clients");
  const { businessClients, clientContacts, techRatings, appUsers, setupMissing, error } = await getClientDirectoryData();
  const { crewRecords } = await getCrewPageData();

  if (setupMissing) {
    return (
      <div className="card">
        <h2>Clients</h2>
        <p className="muted">Supabase environment variables are missing, so Clients cannot load yet.</p>
      </div>
    );
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="row">
          <div>
            <h2 style={{ marginBottom: 6 }}>Clients</h2>
            <p className="muted" style={{ margin: 0 }}>
              Business client records, client contacts, and client-specific top techs built from show ratings.
            </p>
          </div>
          <div className="small muted">Signed in as <strong>{session.profile?.full_name || session.user?.email}</strong></div>
        </div>
        {error ? <p className="error" style={{ marginTop: 12 }}>{error}</p> : null}
      </section>
      <ClientsClient
        initialClients={businessClients}
        initialContacts={clientContacts}
        initialRatings={techRatings}
        crewRecords={crewRecords}
        appUsers={appUsers}
      />
    </div>
  );
}
