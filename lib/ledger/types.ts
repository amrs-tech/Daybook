import { z } from "zod";
export type Account = {
  id: string;
  label: string;
  kind: "bank" | "cash" | "expense" | "income" | "receivable" | "equity";
};
export type Contact = { id: string; label: string };
export type Claim = {
  id: string;
  contactId: string;
  label: string;
  outstanding: string;
  entryId: string;
  openedOn: string;
};
export type Bill = {
  id: string;
  description: string;
  amount: string;
  dueOn: string;
  paid: boolean;
  createdOn: string;
};
export type Entry = {
  id: string;
  kind: string;
  bookedOn: string;
  description: string;
  amount: string;
  accountId: string | null;
  reversed: boolean;
  lines: Line[];
  claimId?: string | null;
  billId?: string | null;
};
export type Context = {
  id: string;
  ownerId: string;
  revision: number;
  openedOn: string;
  timezone: string;
  accounts: Account[];
  contacts: Contact[];
  claims: Claim[];
  bills: Bill[];
  entries: Entry[];
  defaults: Record<string, string>;
  balances: Record<string, string>;
  closedDays: string[];
};
const money = z
  .string()
  .regex(/^[1-9]\d{0,12}$/)
  .refine((s) => BigInt(s) <= 1_000_000_000_000n);
const zeroMoney = z
  .string()
  .regex(/^\d{1,13}$/)
  .refine((s) => BigInt(s) <= 1_000_000_000_000n);
const id = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const base = {
  stepRef: z.string(),
  bookedOn: date,
  description: z.string().max(500),
};
const financial = { ...base, amount: money, accountId: id };
export const ActionSchema = z.discriminatedUnion("kind", [
  z.object({ ...financial, kind: z.literal("expense") }).strict(),
  z.object({ ...financial, kind: z.literal("income") }).strict(),
  z
    .object({ ...financial, kind: z.literal("transfer"), destinationId: id })
    .strict(),
  z
    .object({
      ...financial,
      kind: z.literal("shared_payment"),
      personal: zeroMoney,
      shares: z
        .array(z.object({ contactId: id, amount: money, claimId: id }).strict())
        .min(1)
        .max(10),
    })
    .strict(),
  z
    .object({
      ...financial,
      kind: z.literal("lend"),
      contactId: id,
      claimId: id,
    })
    .strict(),
  z
    .object({ ...financial, kind: z.literal("settle_claim"), claimId: id })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal("create_bill"),
      amount: money,
      dueOn: date,
      billId: id,
    })
    .strict(),
  z.object({ ...financial, kind: z.literal("pay_bill"), billId: id }).strict(),
  z.object({ ...base, kind: z.literal("undo"), targetId: id }).strict(),
  z
    .object({
      ...financial,
      kind: z.literal("correct"),
      targetId: id,
      replacementKind: z.enum(["expense", "income"]),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal("cash_count"),
      amount: zeroMoney,
      accountId: id,
    })
    .strict(),
]);
export type Action = z.infer<typeof ActionSchema>;
export type Line = { accountId: string; amount: string };
export type Effect = {
  stepRef: string;
  kind: string;
  lines: Line[];
  description: string;
  bookedOn: string;
};
export type Issue = {
  stepRef: string;
  field: string;
  code: string;
  message: string;
};
export type Preview = {
  actions: Action[];
  effects: Effect[];
  warnings: Issue[];
  issues: Issue[];
  revision: number;
  planHash: string;
  version: number;
};
