"use client";
import { useEffect, useState } from "react";
import { CalendarCheck, RotateCcw } from "lucide-react";
type Close = {
  id: string;
  booked_on: string;
  snapshot: unknown;
  recorded_at: string;
};
export default function DayClose({
  closedDays,
  onSaved,
}: {
  closedDays: string[];
  onSaved: () => Promise<void>;
}) {
  const [day, setDay] = useState(() =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
    ),
    [reason, setReason] = useState(""),
    [reviewed, setReviewed] = useState(false),
    [history, setHistory] = useState<Close[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    const r = await fetch("/api/day-close"),
      body = await r.json();
    if (r.ok) setHistory(body.data);
  }
  useEffect(() => {
    load();
  }, []);
  async function save(action: "close" | "reopen") {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/day-close", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            bookedOn: day,
            confirmed: true,
            ...(action === "reopen" ? { reason } : {}),
          }),
        }),
        body = await r.json();
      if (!r.ok)
        throw new Error(body.error?.message ?? "Day review could not finish.");
      await onSaved();
      await load();
      setReviewed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="day-close">
      <h3>Daily close & review</h3>
      <p>
        A close preserves a snapshot. Cash differences stay unresolved; no
        balancing expense is invented.
      </p>
      <div className="form-grid">
        <label>
          Booked day
          <input
            type="date"
            value={day}
            onChange={(e) => {
              setDay(e.target.value);
              setReviewed(false);
            }}
          />
        </label>
        <label>
          Reason for reopening
          <input
            value={reason}
            placeholder="Required only to reopen"
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      </div>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={reviewed}
          onChange={(e) => setReviewed(e.target.checked)}
        />
        I reviewed this day and authorize the selected close or reopen action.
      </label>
      <div className="row" style={{ marginTop: 16, flexWrap: "wrap" }}>
        <button
          className="button secondary"
          disabled={!reviewed || busy || closedDays.includes(day)}
          onClick={() => save("close")}
        >
          <CalendarCheck size={14} />
          Close day
        </button>
        <button
          className="button secondary"
          disabled={
            !reviewed ||
            busy ||
            reason.trim().length < 3 ||
            !closedDays.some((d) => d >= day)
          }
          onClick={() => save("reopen")}
        >
          <RotateCcw size={14} />
          Reopen for review
        </button>
      </div>
      {error && (
        <p role="alert" className="issue-card">
          {error.replaceAll("_", " ")}
        </p>
      )}
      {history.length > 0 && (
        <details>
          <summary>Immutable close history ({history.length})</summary>
          {history.map((c) => (
            <details key={c.id}>
              <summary>
                {c.booked_on} · {c.id.slice(0, 8)}
              </summary>
              <pre>{JSON.stringify(c.snapshot, null, 2)}</pre>
            </details>
          ))}
        </details>
      )}
    </div>
  );
}
