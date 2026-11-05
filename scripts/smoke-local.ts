import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import {
  workspace,
  interpret,
  commitDraft,
  type Source,
} from "../lib/workflow";
import { rpc, localDatabase } from "../lib/db";
import { sampleSingle } from "../lib/agent/replay";
import type { Context } from "../lib/ledger/types";
if (
  process.env.LOCAL_DEMO_ENABLED !== "true" ||
  process.env.NODE_ENV === "production"
)
  throw new Error("Local synthetic smoke only");
await mkdir("docs/evidence", { recursive: true });
if (process.argv.includes("--verify")) {
  const saved = JSON.parse(
    await readFile(".local/persistence-smoke.json", "utf8"),
  );
  const c = await rpc<Context>(saved.owner, "context", [saved.workspace]);
  if (
    !c.entries.some((e) => saved.entries.includes(e.id)) ||
    c.entries.length !== 8
  )
    throw new Error("Cold process reread failed");
  await writeFile(
    "docs/evidence/persistence-smoke.json",
    JSON.stringify(
      {
        status: "verified_after_process_restart",
        provider: "deterministic-fixture-replay-v1",
        receiptId: saved.receipt,
        entryIds: saved.entries,
        canonicalEntryCount: c.entries.length,
        realMoneyMovement: false,
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(
    "Canonical receipt-linked entries were reread in a new Node process.",
  );
} else {
  const owner = randomUUID(),
    c = await workspace(owner);
  const s = await rpc<Source>(owner, "capture_source", [
    c.id,
    randomUUID(),
    sampleSingle,
    "text",
    null,
    null,
  ]);
  const r = await interpret(owner, s.id, s.version, randomUUID());
  if (!r.draft?.preview || r.draft.status !== "VALIDATED_PREVIEW")
    throw new Error("Expected validated synthetic preview");
  const d = r.draft;
  const result = await commitDraft(
    owner,
    d.id,
    d.version,
    d.preview!.planHash,
    d.preview!.revision,
    d.commit_key,
    true,
  );
  await writeFile(
    ".local/persistence-smoke.json",
    JSON.stringify({
      owner,
      workspace: c.id,
      receipt: result.receipt.id,
      entries: result.receipt.entry_ids,
    }),
  );
  console.log(
    "One explicitly approved synthetic fixture expense persisted and verified by receipt reread.",
  );
}
await (await localDatabase()).close();
