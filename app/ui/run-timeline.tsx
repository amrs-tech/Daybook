"use client";
import { useEffect, useState } from "react";
type Event = {
  ordinal: number;
  agent_role: string;
  outcome: string;
  duration_ms: number;
  redacted_summary: string;
};
export default function RunTimeline({
  runId,
  status,
}: {
  runId?: string;
  status?: string;
}) {
  const [events, setEvents] = useState<Event[]>([]);
  useEffect(() => {
    if (runId)
      fetch(`/api/agent/runs/${runId}`)
        .then((r) => r.json())
        .then((r) => setEvents(r.data?.events ?? []))
        .catch(() => setEvents([]));
  }, [runId, status]);
  if (!runId) return null;
  return (
    <section className="card data-panel" style={{ marginBottom: 20 }}>
      <h2>Persisted execution timeline</h2>
      <p>Each event belongs to this owner-scoped investigation.</p>
      {events.map((e) => (
        <div className="data-row" key={e.ordinal}>
          <span className="draft-number">
            {String(e.ordinal).padStart(2, "0")}
          </span>
          <div>
            <strong>{e.agent_role}</strong>
            <small>{e.redacted_summary}</small>
          </div>
          <span className="status-tag">{e.outcome}</span>
          <small>{e.duration_ms ? `${e.duration_ms} ms` : ""}</small>
        </div>
      ))}
    </section>
  );
}
