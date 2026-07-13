import Link from "next/link";
import { requirePage } from "@/lib/auth";
import { getEventsClientLookupData, getEventsCrewLookupData, getEventsPageData } from "@/lib/events-data";
import EventsClient from "./events-client";

export default async function EventsPage({ searchParams }: { searchParams?: Promise<{ q?: string; feedback?: string; review?: string }> }) {
  const params = searchParams ? await searchParams : {};
  const initialSearch = typeof params?.q === "string" ? params.q.slice(0, 120) : "";
  const initialOpenFeedback = params?.feedback === "1";
  const initialReviewFeedback = initialOpenFeedback && params?.review === "1";
  const session = await requirePage("events");
  const { shows, laborDays, subCalls, assignments, assignmentNotes, assignmentChecklists, textAutomationSettings, textMessageQueue, techRatings, clientFeedbackResponses, clientFeedbackScores, feedbackTechRatings, eventUserAccess, appUsers, masterRates, setupMissing, error } = await getEventsPageData({
    search: initialSearch,
    includeLatestPendingFeedback: initialReviewFeedback,
  });
  const { crewRecords } = await getEventsCrewLookupData();
  const { businessClients, clientContacts } = await getEventsClientLookupData();
  const pendingFeedbackCount = clientFeedbackResponses.filter((response) => !response.excluded_from_ratings && !response.rating_approved).length;

  if (setupMissing) {
    return (
      <div className="card">
        <h2>Events</h2>
        <p className="muted">Supabase environment variables are missing, so Events cannot load yet.</p>
      </div>
    );
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="row">
          <div>
            <h2 style={{ marginBottom: 6 }}>Events</h2>
            <p className="muted" style={{ margin: 0 }}>
              Review events as event → labor day → sub-call → assigned crew, preview imports before saving, merge into existing events when needed, and export clean crew lists.
            </p>
          </div>
          <div className="toolbar" style={{ justifyContent: "flex-end" }}>
            <Link href="/events?feedback=1&review=1" className={pendingFeedbackCount ? "primary" : "ghost"}>
              Feedback forms {pendingFeedbackCount ? <span className="badge danger" style={{ marginLeft: 6 }}>{pendingFeedbackCount}</span> : null}
            </Link>
            <div className="small muted">
              Signed in as <strong>{session.profile?.full_name || session.user?.email}</strong>
            </div>
          </div>
        </div>
        {error ? <p className="error" style={{ marginTop: 12 }}>{error}</p> : null}
      </section>
      <EventsClient
        initialShows={shows}
        initialLaborDays={laborDays}
        initialSubCalls={subCalls}
        initialAssignments={assignments}
        initialAssignmentNotes={assignmentNotes}
        initialAssignmentChecklists={assignmentChecklists}
        initialTextAutomationSettings={textAutomationSettings}
        initialTextMessageQueue={textMessageQueue}
        initialTechRatings={techRatings}
        initialClientFeedbackResponses={clientFeedbackResponses}
        initialClientFeedbackScores={clientFeedbackScores}
        initialFeedbackTechRatings={feedbackTechRatings}
        initialEventUserAccess={eventUserAccess}
        appUsers={appUsers}
        initialBusinessClients={businessClients}
        initialClientContacts={clientContacts}
        initialCrew={crewRecords}
        masterRates={masterRates}
        initialSearch={initialSearch}
        initialOpenFeedback={initialOpenFeedback}
        initialReviewFeedback={initialReviewFeedback}
        currentUserRole={session.role}
        currentUserId={session.user?.id || ""}
        currentUserEmail={session.user?.email || ""}
        currentUserName={session.profile?.full_name || session.user?.email || ""}
        currentUserCanEditEventDetails={Boolean(session.access?.can_edit_event_details)}
      />
    </div>
  );
}
