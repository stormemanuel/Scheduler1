import { laborDays, shows, subCalls } from "@/lib/mock-data";

export default function EventsPage() {
  return (
    <div className="grid grid-2">
      {shows.map((show) => {
        const days = laborDays.filter((day) => day.showId === show.id);
        return (
          <section key={show.id} className="card">
            <h2>{show.name}</h2>
            <p className="muted">{show.client} • {show.showStart} to {show.showEnd} • Rate city: {show.rateCity}</p>
            <div className="list">
              {days.map((day) => {
                const calls = subCalls.filter((call) => call.laborDayId === day.id).sort((a, b) => a.startTime.localeCompare(b.startTime));
                return (
                  <div key={day.id} className="card">
                    <strong>{day.date}</strong>
                    <div className="muted small">{day.label}</div>
                    <div className="list" style={{ marginTop: 10 }}>
                      {calls.map((call) => (
                        <div key={call.id} className="row small">
                          <span>{call.startTime}–{call.endTime} • {call.area}</span>
                          <span>{call.role} • {call.crewNeeded} needed</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
