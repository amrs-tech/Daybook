import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore local demo" }).click();
  await expect(
    page.getByRole("heading", { name: "What happened today?" }),
  ).toBeVisible();
});
test("three proposed expenses require edits, approve once, survive refresh", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Three everyday expenses" }).click();
  await page.getByRole("button", { name: "Confirm & interpret" }).click();
  await expect(page.locator(".draft-card")).toHaveCount(3);
  const approve = page.getByRole("button", {
    name: "Approve & post 3 records",
  });
  await expect(approve).toBeDisabled();
  for (let i = 0; i < 3; i++) {
    const card = page.locator(".draft-card").nth(i);
    await card.getByLabel("Booked date").selectOption("today");
    await card
      .getByLabel("Payment account")
      .selectOption(i === 2 ? "Cash wallet" : "Everyday bank");
  }
  await page.getByRole("button", { name: "Save changes & preview" }).click();
  await page
    .getByLabel("I reviewed these fields and approve the complete batch.")
    .check();
  const posted = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/commit"),
  );
  await approve.click();
  expect((await posted).status()).toBe(200);
  await expect(
    page.getByText("Verified by reading the stored receipt and journal."),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("This batch is committed in the database."),
  ).toBeVisible();
});
test("a changed transcript disables approval of an old preview", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Move bank → cash" }).click();
  await page.getByRole("button", { name: "Confirm & interpret" }).click();
  await expect(
    page.getByLabel("I reviewed these fields and approve the complete batch."),
  ).toBeEnabled();
  await page
    .getByLabel("Financial instruction")
    .fill("Different source instruction");
  await expect(
    page.getByLabel("I reviewed these fields and approve the complete batch."),
  ).toBeDisabled();
});
test("voice missing-provider state preserves the typed alternative", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Use your voice" }).click();
  await expect(page.getByText(/Scribe isn’t configured/)).toBeVisible();
  await page.getByRole("button", { name: "Type it out" }).click();
  await expect(page.getByLabel("Financial instruction")).toBeVisible();
});
test("mobile layout keeps primary content within the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "Your money. In your words." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Receivables", exact: false }).click();
  await expect(
    page.getByRole("heading", { name: "What’s coming back to you." }),
  ).toBeVisible();
});
test("run details expose separate Planner and Writer proposals", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Three everyday expenses" }).click();
  await page.getByRole("button", { name: "Confirm & interpret" }).click();
  await expect(page.locator(".draft-card")).toHaveCount(3);
  await page.getByRole("button", { name: "Activity & evidence" }).click();
  await expect(
    page.getByText("daybook-planner-v2.1", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("daybook-writer-v2.1", { exact: true }),
  ).toBeVisible();
});
test("rejecting a batch leaves journal history unchanged", async ({ page }) => {
  const before = await page.request.get("/api/ledger");
  const count = (await before.json()).data.entries.length;
  await page.getByRole("button", { name: "Move bank → cash" }).click();
  await page.getByRole("button", { name: "Confirm & interpret" }).click();
  await page.getByRole("button", { name: "Reject batch" }).click();
  const after = await page.request.get("/api/ledger");
  expect((await after.json()).data.entries.length).toBe(count);
});
test("a different browser session cannot read the current draft", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.getByRole("button", { name: "Three everyday expenses" }).click();
  await page.getByRole("button", { name: "Confirm & interpret" }).click();
  await expect(page.locator(".draft-card")).toHaveCount(3);
  const id = await page.evaluate(() =>
    localStorage.getItem("daybook:last-draft"),
  );
  const other = await browser.newContext({ baseURL });
  const second = await other.newPage();
  await second.goto("/");
  await second.getByRole("button", { name: "Explore local demo" }).click();
  await expect(
    second.getByRole("heading", { name: "What happened today?" }),
  ).toBeVisible();
  expect((await other.request.get(`/api/drafts/${id}`)).status()).toBe(404);
  await other.close();
});
