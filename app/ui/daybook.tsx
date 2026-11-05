"use client";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  BookOpen,
  Users,
  CalendarClock,
  Settings2,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowRight,
  Plus,
  Mic,
  Type,
  Check,
  ShieldCheck,
  ChevronRight,
  ChevronDown,
  Clock3,
  MoreHorizontal,
  Search,
  LogOut,
  Activity,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Download,
  Wallet,
  Sparkles,
  Menu,
  X,
  FileCheck2,
  ArrowLeftRight,
  Copy,
} from "lucide-react";
import { samples } from "@/lib/agent/replay";
import { formatINR, rupeeText } from "@/lib/money";
import type { Context } from "@/lib/ledger/types";
import type { WriterOutput, WriterDraft } from "@/lib/agent/contracts";
import type { Draft } from "@/lib/workflow";
import Recorder from "./recorder";
import DayClose from "./day-close";
import RunTimeline from "./run-timeline";
type Session = {
  context: Context;
  localReplay: boolean;
  voiceAvailable: boolean;
  modelId: string | null;
};
type Receipt = {
  receipt: { id: string; entry_ids: string[] };
  verified: boolean;
};
const titles: Record<string, string> = {
  expense: "Expense",
  income: "Income",
  transfer: "Account transfer",
  shared_payment: "Shared payment",
  lend: "Loan given",
  settle_claim: "Repayment received",
  create_bill: "Unpaid bill",
  pay_bill: "Bill payment",
  undo: "Reverse a record",
  correct: "Correct a record",
  cash_count: "Cash observation",
};
async function api<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      result.error?.message ?? "Something interrupted this request.",
    );
  return result.data;
}
export default function Daybook() {
  const [session, setSession] = useState<Session | null>(null),
    [config, setConfig] = useState({
      localDemoAvailable: false,
      authConfigured: false,
    }),
    [view, setView] = useState("Assistant"),
    [mode, setMode] = useState<"type" | "voice">("type"),
    [text, setText] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null),
    [writer, setWriter] = useState<WriterOutput | null>(null),
    [source, setSource] = useState<{ id: string; version: number } | null>(
      null,
    ),
    [transcription, setTranscription] = useState<string | null>(null),
    [receipt, setReceipt] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [approved, setApproved] = useState(false),
    [dirty, setDirty] = useState(false),
    [duplicates, setDuplicates] = useState(false),
    [menu, setMenu] = useState(false),
    [search, setSearch] = useState("");
  const [sourceChanged, setSourceChanged] = useState(false);
  const [login, setLogin] = useState({ email: "", password: "" });
  async function refresh() {
    const s = await api<Session>("/api/session");
    setSession(s);
    return s;
  }
  useEffect(() => {
    api<typeof config>("/api/config").then(setConfig);
    refresh()
      .then(async () => {
        const last = localStorage.getItem("daybook:last-draft");
        if (last)
          try {
            const d = await api<Draft>(`/api/drafts/${last}`);
            setDraft(d);
            setWriter(d.writer);
            setSource({ id: d.source_id, version: d.source_version });
          } catch {
            localStorage.removeItem("daybook:last-draft");
          }
      })
      .catch(() => {});
  }, []);
  function loadDraft(d: Draft) {
    setDraft(d);
    setWriter(structuredClone(d.writer));
    setDirty(false);
    setApproved(false);
    localStorage.setItem("daybook:last-draft", d.id);
  }
  async function action(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy("");
    }
  }
  async function signIn(local = false) {
    await action("Signing in", async () => {
      await api(
        "/api/session",
        "POST",
        local ? { mode: "local" } : { mode: "password", ...login },
      );
      await refresh();
    });
  }
  async function interpret() {
    await action("Planner is reading your request", async () => {
      setReceipt(null);
      setApproved(false);
      setDraft(null);
      setWriter(null);
      const captured = await api<{ id: string; version: number }>(
        "/api/utterances",
        "POST",
        {
          sourceText: text,
          sourceMode: transcription ? "voice" : "text",
          requestId: crypto.randomUUID(),
          confirmed: true,
          previousSourceId: source?.id ?? null,
          transcriptionId: transcription,
        },
      );
      setSource(captured);
      setBusy("Planner → lookups → Writer");
      const result = await api<{ draft: Draft | null; status: string }>(
        "/api/agent/plan",
        "POST",
        {
          sourceId: captured.id,
          sourceVersion: captured.version,
          requestId: crypto.randomUUID(),
        },
      );
      if (result.draft) {
        loadDraft(result.draft);
        setSourceChanged(false);
      } else
        throw new Error(
          `The saved run is ${result.status}. Edit the source and retry.`,
        );
    });
  }
  function edit(index: number, field: string, value: unknown) {
    if (!writer) return;
    const updated = structuredClone(writer),
      d = updated.drafts[index];
    (d.fields as Record<string, unknown>)[field] = value || null;
    d.unresolvedFields = d.unresolvedFields.filter((f) => f !== field);
    setWriter(updated);
    setDirty(true);
    setApproved(false);
  }
  async function preview() {
    if (!draft || !writer) return;
    await action("Checking financial effects", async () => {
      let d = draft;
      if (dirty)
        d = await api<Draft>(`/api/drafts/${draft.id}`, "PATCH", {
          expectedVersion: draft.version,
          writer,
        });
      d = await api<Draft>(`/api/drafts/${d.id}/preview`, "POST", {
        expectedVersion: d.version,
        acknowledgeDuplicates: duplicates,
      });
      loadDraft(d);
    });
  }
  async function commit() {
    if (!draft?.preview || !approved) return;
    await action("Posting reviewed batch", async () => {
      const result = await api<Receipt>(
        `/api/drafts/${draft.id}/commit`,
        "POST",
        {
          version: draft.version,
          planHash: draft.preview!.planHash,
          revision: draft.preview!.revision,
          idempotencyKey: draft.commit_key,
          approved: true,
        },
      );
      setReceipt(result);
      setDraft({ ...draft, status: "COMMITTED" });
      setSource(null);
      setSourceChanged(false);
      await refresh();
    });
  }
  const ctx = session?.context,
    assets =
      ctx?.accounts.filter((a) => ["bank", "cash"].includes(a.kind)) ?? [];
  const total = (kind: string) =>
    ctx?.accounts
      .filter((a) => a.kind === kind)
      .reduce((s, a) => s + BigInt(ctx.balances[a.id] ?? "0"), 0n) ?? 0n;
  const nav = [
    { name: "Assistant", icon: LayoutDashboard },
    { name: "Transactions", icon: BookOpen },
    { name: "Receivables", icon: Users },
    { name: "Pending bills", icon: CalendarClock },
  ];
  const activeDraft = draft && draft.status !== "REJECTED",
    isCommitted = draft?.status === "COMMITTED";
  const canPost =
    draft?.status === "VALIDATED_PREVIEW" &&
    !dirty &&
    !sourceChanged &&
    approved &&
    !busy;
  return (
    <div className="app-shell">
      <aside className={`sidebar ${menu ? "mobile-open" : ""}`}>
        <a className="brand" href="/" aria-label="DayBook home">
          <span className="brand-symbol">
            <BookOpen size={20} />
          </span>
          daybook<span className="brand-dot">.</span>
        </a>
        <div className="workspace-label">
          <span className="workspace-avatar">P</span>
          <div>
            <strong>Personal workspace</strong>
            <small>Synthetic demo</small>
          </div>
          <ChevronDown size={14} />
        </div>
        <div className="nav-section-label">WORKSPACE</div>
        <nav>
          {nav.map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={`nav-link ${view === name ? "active" : ""}`}
              onClick={() => {
                setView(name);
                setMenu(false);
              }}
            >
              <Icon size={18} />
              {name}
              {name === "Assistant" && <span className="new-badge">NEW</span>}
              {name === "Receivables" && ctx && (
                <span className="nav-count">
                  {ctx.claims.filter((c) => BigInt(c.outstanding) > 0n).length}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="guard-note">
            <ShieldCheck size={21} />
            <strong>You’re always in control.</strong>
            <p>Every financial record needs your review and approval.</p>
            <span>
              Built with care <span>↗</span>
            </span>
          </div>
          <button
            className={`nav-link ${view === "Activity" ? "active" : ""}`}
            onClick={() => setView("Activity")}
          >
            <Activity size={18} />
            Activity & evidence
          </button>
          <button
            className={`nav-link ${view === "Settings" ? "active" : ""}`}
            onClick={() => setView("Settings")}
          >
            <Settings2 size={18} />
            Settings
          </button>
          <div className="profile">
            <span className="profile-avatar">D</span>
            <div>
              <strong>Demo explorer</strong>
              <small>Personal ledger</small>
            </div>
            {session && (
              <button
                className="icon-button"
                aria-label="Sign out"
                onClick={() =>
                  action("Signing out", async () => {
                    await api("/api/session", "DELETE");
                    localStorage.removeItem("daybook:last-draft");
                    setSession(null);
                    setDraft(null);
                    setWriter(null);
                    setSource(null);
                  })
                }
              >
                <LogOut size={16} />
              </button>
            )}
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="row">
            <button
              className="mobile-menu icon-button"
              aria-label="Open navigation"
              onClick={() => setMenu(!menu)}
            >
              <Menu size={20} />
            </button>
            <span className="breadcrumb">
              Workspace <ChevronRight size={13} />
              <strong>{view}</strong>
            </span>
          </div>
          <div className="row">
            <span className="environment-badge">
              <span />
              Synthetic records
            </span>
            <span className="top-avatar">D</span>
          </div>
        </header>
        <main>
          <div className="page-intro">
            <div>
              <div className="eyebrow">A LITTLE CLARITY, EVERY DAY</div>
              <h1>
                {view === "Assistant"
                  ? "Your money. In your words."
                  : view === "Transactions"
                    ? "Every record, accounted for."
                    : view === "Receivables"
                      ? "What’s coming back to you."
                      : view === "Pending bills"
                        ? "Stay a step ahead."
                        : view === "Activity"
                          ? "A clear trail of every decision."
                          : "Make this workspace yours."}
              </h1>
              <p>
                {view === "Assistant"
                  ? "Speak or type. Review the details. Keep your day in balance."
                  : "Canonical ledger facts, with the history preserved."}
              </p>
            </div>
            <div className="intro-date">
              <CalendarClock size={15} />
              {new Intl.DateTimeFormat("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
                timeZone: "Asia/Kolkata",
              }).format(new Date())}
            </div>
          </div>
          {error && (
            <div role="alert" className="error-banner">
              <AlertCircle size={18} />
              <span>{error.replaceAll("_", " ")}</span>
              <button
                aria-label="Dismiss error"
                className="icon-button"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {!session ? (
            <section className="login-card card">
              <div className="login-icon">
                <ShieldCheck size={26} />
              </div>
              <h2>A private place for your daybook.</h2>
              <p>
                Sign in to an owner-isolated synthetic workspace. No real funds
                move.
              </p>
              {config.localDemoAvailable && (
                <>
                  <button
                    className="button dark"
                    disabled={!!busy}
                    onClick={() => signIn(true)}
                  >
                    Explore local demo <ArrowRight size={16} />
                  </button>
                  <small className="local-explanation">
                    Deterministic example replay · No live AI responses
                  </small>
                  <div className="login-divider">
                    or connect your Supabase account
                  </div>
                </>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  signIn(false);
                }}
              >
                <label>
                  Email
                  <input
                    type="email"
                    autoComplete="username"
                    required
                    value={login.email}
                    onChange={(e) =>
                      setLogin({ ...login, email: e.target.value })
                    }
                  />
                </label>
                <label>
                  Password
                  <input
                    type="password"
                    autoComplete="current-password"
                    required
                    value={login.password}
                    onChange={(e) =>
                      setLogin({ ...login, password: e.target.value })
                    }
                  />
                </label>
                <button
                  className="button secondary"
                  disabled={!!busy || !config.authConfigured}
                >
                  Sign in
                </button>
              </form>
              {!config.localDemoAvailable && !config.authConfigured && (
                <p className="subtle">
                  Authentication requires configuration. See the setup
                  instructions.
                </p>
              )}
            </section>
          ) : (
            <>
              <div className="stats-grid">
                <Stat
                  label="Tracked funds"
                  value={formatINR(total("bank") + total("cash"))}
                  icon={<Wallet size={17} />}
                  note="Across your cash & bank accounts"
                />
                <Stat
                  label="Personal spending"
                  value={formatINR(total("expense"))}
                  icon={<ArrowUpRight size={17} />}
                  note="Transfers & repayments excluded"
                />
                <Stat
                  label="Waiting to come back"
                  value={formatINR(
                    ctx!.claims.reduce((s, c) => s + BigInt(c.outstanding), 0n),
                  )}
                  icon={<ArrowDownLeft size={17} />}
                  note={`${ctx!.claims.filter((c) => BigInt(c.outstanding) > 0n).length} open receivables · no new income`}
                />
              </div>
              {view === "Activity" && (
                <RunTimeline runId={draft?.run_id} status={draft?.status} />
              )}
              {view === "Assistant" && (
                <div className="content-grid">
                  <div className="primary-column">
                    <section className="compose card">
                      <div className="card-heading">
                        <div className="row">
                          <span className="mint-icon">
                            <Sparkles size={19} />
                          </span>
                          <div>
                            <h2>What happened today?</h2>
                            <p>
                              Let’s turn the little details into clear records.
                            </p>
                          </div>
                        </div>
                        <span className="agent-pill">TWO AGENTS</span>
                      </div>
                      <div className="input-tabs">
                        <button
                          className={mode === "type" ? "selected" : ""}
                          onClick={() => setMode("type")}
                        >
                          <Type size={16} />
                          Type it out
                        </button>
                        <button
                          className={mode === "voice" ? "selected" : ""}
                          onClick={() => setMode("voice")}
                        >
                          <Mic size={16} />
                          Use your voice
                        </button>
                      </div>
                      {mode === "voice" && (
                        <Recorder
                          available={session.voiceAvailable}
                          onError={setError}
                          onTranscript={(t, id) => {
                            setText(t);
                            setTranscription(id);
                            setMode("type");
                            setApproved(false);
                            setSourceChanged(true);
                          }}
                        />
                      )}
                      {mode === "type" && (
                        <>
                          <label className="sr-only" htmlFor="instruction">
                            Financial instruction
                          </label>
                          <textarea
                            id="instruction"
                            placeholder={
                              "“I spent 250 on coffee, paid for lunch through UPI, and moved 2,000 to my cash wallet…”"
                            }
                            maxLength={8000}
                            value={text}
                            onChange={(e) => {
                              setText(e.target.value);
                              setApproved(false);
                              setSourceChanged(true);
                            }}
                          />
                          <div className="compose-bottom">
                            <span>
                              <ShieldCheck size={14} />
                              {transcription
                                ? "Review the transcript, especially numbers and names."
                                : "Nothing posts without your approval."}
                            </span>
                            <button
                              className="button dark"
                              disabled={!text.trim() || !!busy}
                              onClick={interpret}
                            >
                              {busy || "Confirm & interpret"}
                              {!busy && <ArrowRight size={16} />}
                            </button>
                          </div>
                        </>
                      )}
                      <div className="example-list">
                        <span>TRY AN EXAMPLE</span>
                        {samples.slice(0, 3).map((s, i) => (
                          <button
                            disabled={!!busy}
                            key={s.label}
                            onClick={() => {
                              setText(s.text);
                              setMode("type");
                              setTranscription(null);
                              setApproved(false);
                              setSourceChanged(true);
                            }}
                          >
                            {s.label}
                            <ArrowUpRight size={12} />
                          </button>
                        ))}
                      </div>
                    </section>
                    {session.localReplay && (
                      <div className="replay-note">
                        <span className="tiny-dot" />
                        Local replay mode <span>·</span> Examples replay labeled
                        fixtures. Live interpretation needs Gemini credentials.
                      </div>
                    )}
                    {activeDraft && writer && (
                      <section className="review card">
                        <div className="card-heading">
                          <div>
                            <div className="eyebrow">
                              {isCommitted
                                ? "PERSISTED RECORD"
                                : "REVIEW BEFORE POSTING"}
                            </div>
                            <h2>
                              {isCommitted
                                ? "Your daybook is up to date."
                                : writer.drafts.length
                                  ? `${writer.drafts.length} ${writer.drafts.length === 1 ? "record" : "records"}, ready for a closer look.`
                                  : "Let’s clarify that first."}
                            </h2>
                          </div>
                          <span
                            className={`status-tag ${isCommitted ? "green" : ""}`}
                          >
                            {isCommitted
                              ? "Committed"
                              : draft!.status === "VALIDATED_PREVIEW" && !dirty
                                ? "Preview verified"
                                : "Review needed"}
                          </span>
                        </div>
                        {writer.rejectedSteps.map((s) => (
                          <div className="issue-card" key={s.stepRef}>
                            <AlertCircle size={17} />
                            <p>
                              {s.reason} Edit the original instruction and
                              interpret again.
                            </p>
                          </div>
                        ))}
                        {writer.drafts.map((d, i) => (
                          <DraftCard
                            key={d.stepRef}
                            draft={d}
                            index={i}
                            previousDrafts={writer.drafts.slice(0, i)}
                            context={ctx!}
                            disabled={isCommitted || !!busy}
                            onEdit={(f, v) => edit(i, f, v)}
                          />
                        ))}
                        {!isCommitted &&
                          draft!.preview?.issues.length !== 0 && (
                            <div className="issues-list">
                              {draft!.preview?.issues.map((issue, i) => (
                                <p key={i}>
                                  <AlertCircle size={13} />
                                  <strong>{issue.stepRef}</strong>
                                  {issue.message}
                                </p>
                              ))}
                            </div>
                          )}
                        {!isCommitted && writer.drafts.length > 0 && (
                          <>
                            <label className="checkbox-label">
                              <input
                                type="checkbox"
                                checked={duplicates}
                                onChange={(e) => {
                                  setDuplicates(e.target.checked);
                                  setDirty(true);
                                  setApproved(false);
                                }}
                              />
                              If a match is flagged, I confirm this is a
                              separate event.
                            </label>
                            <div className="review-toolbar">
                              <button
                                className="button secondary"
                                disabled={!!busy}
                                onClick={preview}
                              >
                                <RefreshCw size={14} />
                                {dirty
                                  ? "Save changes & preview"
                                  : "Refresh preview"}
                              </button>
                              <button
                                className="text-button"
                                disabled={!!busy}
                                onClick={() =>
                                  action("Rejecting draft", async () => {
                                    const d = await api<Draft>(
                                      `/api/drafts/${draft!.id}`,
                                      "PATCH",
                                      {
                                        expectedVersion: draft!.version,
                                        writer,
                                        reject: true,
                                      },
                                    );
                                    loadDraft(d);
                                  })
                                }
                              >
                                Reject batch
                              </button>
                            </div>
                            {draft!.preview?.effects && (
                              <div className="impact">
                                <h4>
                                  Financial impact{" "}
                                  <span>Preview · not posted</span>
                                </h4>
                                {draft!.preview.effects.map((e) => (
                                  <div className="impact-row" key={e.stepRef}>
                                    <span>{e.description}</span>
                                    <span>
                                      {e.lines.length
                                        ? `${e.lines.length} balanced journal lines`
                                        : "Planning / observation only"}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {sourceChanged && (
                              <p className="issue-card">
                                The instruction changed. Confirm & interpret it
                                again before approval.
                              </p>
                            )}
                            <label className="checkbox-label approval">
                              <input
                                type="checkbox"
                                checked={approved}
                                disabled={
                                  dirty ||
                                  sourceChanged ||
                                  draft!.status !== "VALIDATED_PREVIEW" ||
                                  !!busy
                                }
                                onChange={(e) => setApproved(e.target.checked)}
                              />
                              I reviewed these fields and approve the complete
                              batch.
                            </label>
                            <button
                              className="button approve-button"
                              disabled={!canPost}
                              onClick={commit}
                            >
                              <Check size={17} />
                              Approve & post{" "}
                              {writer.drafts.length > 1
                                ? `${writer.drafts.length} records`
                                : "record"}
                            </button>
                            <small className="review-footnote">
                              Version {draft!.version} · Workspace revision{" "}
                              {draft!.preview?.revision} · Atomic posting
                            </small>
                          </>
                        )}
                        {isCommitted && (
                          <div className="receipt">
                            <CheckCircle2 size={23} />
                            <div>
                              <strong>
                                {receipt?.verified
                                  ? "Verified by reading the stored receipt and journal."
                                  : "This batch is committed in the database."}
                              </strong>
                              <p>
                                {receipt
                                  ? `Receipt ${receipt.receipt.id}`
                                  : `Draft ${draft!.id}`}
                                <br />
                                Repeated approval cannot create another posting.
                              </p>
                            </div>
                          </div>
                        )}
                      </section>
                    )}
                    <section className="card recent">
                      <div className="section-title">
                        <h2>Recent activity</h2>
                        <button
                          className="text-button"
                          onClick={() => setView("Transactions")}
                        >
                          View all <ArrowRight size={13} />
                        </button>
                      </div>
                      <TransactionList context={ctx!} limit={4} />
                    </section>
                  </div>
                  <aside className="right-column">
                    <section className="how-card card">
                      <div className="eyebrow">THOUGHTFUL BY DESIGN</div>
                      <h2>
                        Two agents.
                        <br />
                        One clear daybook.
                      </h2>
                      <p>
                        A little intelligence at each step.
                        <br />
                        Your say at the one that matters.
                      </p>
                      <div className="timeline">
                        <Timeline
                          number="01"
                          title="Planner"
                          text="Understands the intent, separates actions, checks what’s missing."
                          active={!!draft}
                        />
                        <Timeline
                          number="02"
                          title="Writer"
                          text="Maps each action to editable, evidence-linked fields."
                          active={!!writer}
                        />
                        <Timeline
                          number="03"
                          title="You review"
                          text="Check the account, amount, and financial impact."
                          active={!!draft && !isCommitted}
                        />
                        <Timeline
                          number="04"
                          title="Daybook records"
                          text="An immutable, balanced entry. Posted exactly once."
                          active={isCommitted}
                        />
                      </div>
                      <div className="timeline-note">
                        <ShieldCheck size={14} />
                        The agents can propose. Only you approve.
                      </div>
                    </section>
                    <section className="accounts-card card">
                      <div className="section-title">
                        <h3>Your accounts</h3>
                        <Wallet size={16} />
                      </div>
                      {assets.map((a) => (
                        <div className="account-row" key={a.id}>
                          <span className={`account-icon ${a.kind}`}>
                            <Wallet size={15} />
                          </span>
                          <div>
                            <strong>{a.label}</strong>
                            <small>
                              {a.kind === "bank"
                                ? "Bank account"
                                : "Cash on hand"}
                            </small>
                          </div>
                          <span>{formatINR(ctx!.balances[a.id] ?? "0")}</span>
                        </div>
                      ))}
                      <small className="subtle">
                        Synthetic opening balances. No bank connection.
                      </small>
                    </section>
                    <div className="quote-note">
                      Less bookkeeping.
                      <br />
                      <span>More breathing room.</span>
                      <span className="quote-star">✳</span>
                    </div>
                  </aside>
                </div>
              )}
              {view === "Transactions" && (
                <section className="card ledger-view">
                  <div className="section-title">
                    <div>
                      <h2>Journal history</h2>
                      <p>Original records and reversals stay visible.</p>
                    </div>
                    <a
                      className="button secondary"
                      href="/api/export?format=csv"
                    >
                      <Download size={15} />
                      Export CSV
                    </a>
                  </div>
                  <label className="search">
                    <Search size={16} />
                    <input
                      placeholder="Search descriptions"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  <TransactionList
                    context={{
                      ...ctx!,
                      entries: ctx!.entries.filter((e) =>
                        e.description
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                      ),
                    }}
                  />
                </section>
              )}
              {view === "Receivables" && (
                <section className="card data-panel">
                  <h2>Receivables</h2>
                  <p>
                    Repayments lower these claims. They never count as earned
                    income.
                  </p>
                  {ctx!.claims.map((c) => (
                    <div className="data-row" key={c.id}>
                      <span className="contact-avatar">{c.label[0]}</span>
                      <div>
                        <strong>{c.label}</strong>
                        <small>
                          Opened {c.openedOn} · {c.id.slice(0, 8)}
                        </small>
                      </div>
                      <strong>{formatINR(c.outstanding)}</strong>
                      <span className="status-tag">
                        {BigInt(c.outstanding) > 0n ? "Outstanding" : "Settled"}
                      </span>
                    </div>
                  ))}
                </section>
              )}
              {view === "Pending bills" && (
                <section className="card data-panel">
                  <h2>Pending bills</h2>
                  <p>
                    Unpaid bills have no cash movement. Payment requires a
                    reviewed batch.
                  </p>
                  {ctx!.bills.length ? (
                    ctx!.bills.map((b) => (
                      <div className="data-row" key={b.id}>
                        <CalendarClock size={20} />
                        <div>
                          <strong>{b.description}</strong>
                          <small>Due {b.dueOn}</small>
                        </div>
                        <strong>{formatINR(b.amount)}</strong>
                        <span className="status-tag">
                          {b.paid ? "Paid" : "Pending"}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="empty-state">
                      <CalendarClock size={35} />
                      <h3>Nothing due here.</h3>
                      <p>
                        Record a bill through the assistant when you need to
                        plan ahead.
                      </p>
                    </div>
                  )}
                </section>
              )}
              {view === "Activity" && (
                <section className="card data-panel">
                  <h2>Execution evidence</h2>
                  <p>
                    {session.localReplay
                      ? "The current session uses exact synthetic fixture replay."
                      : `Configured Gemini model: ${session.modelId}`}
                  </p>
                  {draft ? (
                    <>
                      <div className="evidence-pair">
                        <span>Investigation</span>
                        <code>{draft.run_id}</code>
                      </div>
                      <div className="evidence-pair">
                        <span>Planner prompt</span>
                        <code>daybook-planner-v2.1</code>
                      </div>
                      <div className="evidence-pair">
                        <span>Writer prompt</span>
                        <code>daybook-writer-v2.1</code>
                      </div>
                      <div className="evidence-pair">
                        <span>Persisted status</span>
                        <strong>{draft.status}</strong>
                      </div>
                      <details>
                        <summary>Planner operations & evidence</summary>
                        <pre>{JSON.stringify(draft.planner, null, 2)}</pre>
                      </details>
                      <details>
                        <summary>Writer proposals & evidence</summary>
                        <pre>{JSON.stringify(draft.writer, null, 2)}</pre>
                      </details>
                    </>
                  ) : (
                    <div className="empty-state">
                      <Activity size={30} />
                      <h3>Every request leaves a trail.</h3>
                      <p>
                        Interpret an instruction to see the separate Planner and
                        Writer outputs.
                      </p>
                    </div>
                  )}
                  <p className="subtle">
                    Live Langfuse export requires configured credentials and
                    verification. A local run ID is not proof of an exported
                    trace.
                  </p>
                </section>
              )}
              {view === "Settings" && (
                <section className="card data-panel">
                  <h2>Workspace settings</h2>
                  <p>
                    Timezone: Asia/Kolkata · Currency: INR · One owner per
                    workspace
                  </p>
                  <h3>Payment defaults</h3>
                  <p>
                    Payment methods are labels. Choose the actual owned account
                    explicitly.
                  </p>
                  {["UPI", "Cash", "Online"].map((method) => (
                    <label className="settings-label" key={method}>
                      {method}
                      <select
                        value={ctx!.defaults[method] ?? ""}
                        onChange={(e) =>
                          action("Saving account default", async () => {
                            const defaults = { ...ctx!.defaults };
                            if (e.target.value)
                              defaults[method] = e.target.value;
                            else delete defaults[method];
                            await api("/api/settings", "PATCH", {
                              revision: ctx!.revision,
                              defaults,
                            });
                            await refresh();
                            setApproved(false);
                          })
                        }
                      >
                        <option value="">Ask every time</option>
                        {assets.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                  <div className="settings-divider" />
                  <DayClose
                    closedDays={ctx!.closedDays}
                    onSaved={async () => {
                      await refresh();
                      setApproved(false);
                    }}
                  />
                  <div className="settings-divider" />
                  <h3>Fresh synthetic demo</h3>
                  <p>
                    This archives the current demo workspace and creates fresh
                    synthetic IDs. Financial history is preserved.
                  </p>
                  <button
                    className="button secondary"
                    disabled={!!busy}
                    onClick={() =>
                      action("Starting fresh demo", async () => {
                        await api("/api/demo/reset", "POST", {
                          workspaceId: ctx!.id,
                          confirmed: true,
                        });
                        localStorage.removeItem("daybook:last-draft");
                        setDraft(null);
                        setWriter(null);
                        setSource(null);
                        setReceipt(null);
                        setText("");
                        await refresh();
                      })
                    }
                  >
                    <RefreshCw size={15} />
                    Start fresh demo
                  </button>
                  <p>
                    <a href="/api/export?format=json">
                      Download owner-scoped JSON
                    </a>
                  </p>
                </section>
              )}
            </>
          )}
          <footer>
            <span>
              daybook<span className="brand-dot">.</span>{" "}
              <span className="footer-separator">|</span> A calmer way to keep
              track.
            </span>
            <span>Personal ledger · Synthetic data · No real payments</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
function Stat({
  label,
  value,
  icon,
  note,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  note: string;
}) {
  return (
    <section className="stat-card card">
      <div className="stat-label">
        {label}
        <span>{icon}</span>
      </div>
      <strong>{value}</strong>
      <small>{note}</small>
    </section>
  );
}
function Timeline({
  number,
  title,
  text,
  active,
}: {
  number: string;
  title: string;
  text: string;
  active: boolean;
}) {
  return (
    <div className={`timeline-step ${active ? "done" : ""}`}>
      <span>{active ? <Check size={12} /> : number}</span>
      <div>
        <strong>{title}</strong>
        <p>{text}</p>
      </div>
    </div>
  );
}
function TransactionList({
  context,
  limit,
}: {
  context: Context;
  limit?: number;
}) {
  return (
    <div className="transaction-list">
      {context.entries.slice(0, limit).map((e) => (
        <div className="transaction-row" key={e.id}>
          <span className={`transaction-icon ${e.kind}`}>
            {e.kind === "transfer" ? (
              <ArrowLeftRight size={18} />
            ) : e.kind === "settle_claim" ? (
              <ArrowDownLeft size={18} />
            ) : (
              <BookOpen size={18} />
            )}
          </span>
          <div className="transaction-description">
            <strong>{e.description}</strong>
            <small>
              {titles[e.kind] ?? e.kind} <span>·</span>{" "}
              {context.accounts.find((a) => a.id === e.accountId)?.label ??
                "Journal"}
            </small>
          </div>
          <div className="transaction-amount">
            <strong>{formatINR(e.amount)}</strong>
            <small>
              {e.bookedOn}
              {e.reversed ? " · Reversed" : ""}
            </small>
          </div>
          <span className={`table-status ${e.reversed ? "reversed" : ""}`}>
            {e.reversed ? "Reversed" : "Posted"}
          </span>
        </div>
      ))}
      {!context.entries.length && (
        <p className="empty-state">No records yet.</p>
      )}
    </div>
  );
}
function DraftCard({
  draft: d,
  index,
  previousDrafts,
  context,
  disabled,
  onEdit,
}: {
  draft: WriterDraft;
  index: number;
  previousDrafts: WriterDraft[];
  context: Context;
  disabled: boolean;
  onEdit: (field: string, value: unknown) => void;
}) {
  const fields = d.fields as Record<string, unknown>,
    assets = context.accounts.filter((a) => ["bank", "cash"].includes(a.kind));
  const targetOptions =
    d.kind === "settle_claim"
      ? context.claims
          .filter((c) => BigInt(c.outstanding) > 0n)
          .map((c) => ({
            id: c.id,
            label: `${c.label} · ${formatINR(c.outstanding)} outstanding · ${c.id.slice(0, 8)}`,
          }))
      : d.kind === "pay_bill"
        ? context.bills
            .filter((b) => !b.paid)
            .map((b) => ({
              id: b.id,
              label: `${b.description} · ${formatINR(b.amount)}`,
            }))
        : context.entries
            .filter(
              (e) => !e.reversed && !["opening", "reversal"].includes(e.kind),
            )
            .map((e) => ({
              id: e.id,
              label: `${e.description} · ${formatINR(e.amount)} · ${e.bookedOn} · ${e.id.slice(0, 8)}`,
            }));
  if (d.kind === "settle_claim")
    for (const prior of previousDrafts) {
      if (prior.kind === "shared_payment")
        for (const share of prior.fields.shares)
          targetOptions.push({
            id: `new:${prior.stepRef}:${share.contactAlias}`,
            label: `New in this batch: ${share.contactAlias} · ${prior.stepRef}`,
          });
      if (prior.kind === "lend" && prior.fields.counterpartyAlias)
        targetOptions.push({
          id: `new:${prior.stepRef}:${prior.fields.counterpartyAlias}`,
          label: `New loan in this batch: ${prior.fields.counterpartyAlias}`,
        });
    }
  function input(field: string, label: string, placeholder = "") {
    return (
      <label>
        {label}
        <input
          disabled={disabled}
          value={String(fields[field] ?? "")}
          placeholder={placeholder}
          onChange={(e) => onEdit(field, e.target.value)}
        />
      </label>
    );
  }
  function account(field: string, label: string) {
    return (
      <label>
        {label}
        <select
          disabled={disabled}
          value={String(fields[field] ?? "")}
          onChange={(e) => onEdit(field, e.target.value)}
        >
          <option value="">Select account</option>
          {assets.map((a) => (
            <option key={a.id} value={a.label}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <article className="draft-card">
      <div className="draft-card-top">
        <span className="draft-number">
          {String(index + 1).padStart(2, "0")}
        </span>
        <strong>{titles[d.kind]}</strong>
        <span>{d.stepRef}</span>
        <span className="draft-proposal">
          {disabled ? "Saved" : "Proposal"}
        </span>
      </div>
      <div className="form-grid">
        {"amountText" in fields &&
          input("amountText", "Amount in rupees", "e.g. 250.00")}
        <label>
          Booked date
          <select
            disabled={disabled}
            value={String(fields.bookedOnText ?? "")}
            onChange={(e) => onEdit("bookedOnText", e.target.value)}
          >
            <option value="">Confirm date</option>
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            {!!fields.bookedOnText &&
              !["today", "yesterday"].includes(String(fields.bookedOnText)) && (
                <option value={String(fields.bookedOnText)}>
                  {String(fields.bookedOnText)}
                </option>
              )}
          </select>
        </label>
        {"accountAlias" in fields &&
          account(
            "accountAlias",
            d.kind === "transfer" ? "From account" : "Payment account",
          )}
        {d.kind === "transfer" && account("destinationAlias", "To account")}
        {d.kind === "shared_payment" &&
          input(
            "personalShareText",
            "Your share in rupees",
            "Confirm your own share",
          )}
        {"counterpartyAlias" in fields && (
          <label>
            Counterparty
            <select
              disabled={disabled}
              value={String(fields.counterpartyAlias ?? "")}
              onChange={(e) => onEdit("counterpartyAlias", e.target.value)}
            >
              <option value="">Select person</option>
              {context.contacts.map((c) => (
                <option key={c.id} value={c.label}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {"targetHint" in fields && (
          <label className="full-width">
            {d.kind === "settle_claim"
              ? "Specific receivable"
              : d.kind === "pay_bill"
                ? "Specific unpaid bill"
                : "Exact transaction to reverse / correct"}
            <select
              disabled={disabled}
              value={String(fields.targetHint ?? "")}
              onChange={(e) => onEdit("targetHint", e.target.value)}
            >
              <option value="">Review candidates and select explicitly</option>
              {targetOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {d.kind === "create_bill" &&
          input("dueOnText", "Due date (YYYY-MM-DD)")}
        {input("description", "Description")}
        {d.kind === "shared_payment" &&
          (fields.shares as { contactAlias: string; amountText: string }[]).map(
            (s, i) => (
              <label key={i}>
                {s.contactAlias}’s share
                <input
                  disabled={disabled}
                  value={s.amountText}
                  onChange={(e) => {
                    const shares = structuredClone(
                      fields.shares as (typeof s)[],
                    );
                    shares[i].amountText = e.target.value;
                    onEdit("shares", shares);
                  }}
                />
              </label>
            ),
          )}
      </div>
      <details className="source-details">
        <summary>
          <FileCheck2 size={13} />
          Source evidence <ChevronDown size={12} />
        </summary>
        <p>
          {Object.entries(d.evidence)
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <span key={k}>
                <strong>{k}:</strong> “{v}”{" "}
              </span>
            ))}
        </p>
      </details>
    </article>
  );
}
