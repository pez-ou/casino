import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
async function table(page: Page, seats: number[]) {
  await page.goto("/");
  await page.getByRole("button", { name: "Créer ma table" }).click();
  await page.getByLabel("Votre pseudo").fill("Repeat Alice");
  await page.getByRole("button", { name: "Créer le salon" }).click();
  for (const id of seats)
    await page
      .locator(`[data-seat="${id}"]`)
      .getByRole("button", { name: "S’installer" })
      .click();
  await start(page);
}
async function start(page: Page) {
  await page
    .getByRole("button", { name: /Ouvrir les mises|Nouvelle manche/ })
    .click();
}
async function chip(page: Page, value: number, label: string) {
  await page.getByRole("button", { name: String(value), exact: true }).click();
  await page.getByRole("button", { name: label, exact: true }).click();
}
test("repeat real previous wagers for two seats with both side bets after refresh", async ({
  page,
}) => {
  test.skip(process.env.VELVET_INSURANCE_TESTS !== "true");
  await table(page, [1, 2]);
  for (const id of [1, 2]) {
    for (let n = 0; n < id; n++)
      await chip(page, 100, `Ajouter un jeton principal au siège ${id}`);
    await chip(page, 5, `Ajouter PP siège ${id}`);
    await chip(page, 10, `Ajouter 21+3 siège ${id}`);
    await page
      .getByRole("button", { name: `Miser siège ${id}`, exact: true })
      .click();
  }
  await page.getByRole("button", { name: "Je suis prêt", exact: true }).click();
  await page.getByRole("button", { name: "Lancer la manche" }).click();
  for (const id of [1, 2])
    await page
      .getByLabel(`Assurance siège ${id}`)
      .getByRole("button", { name: "Refuser", exact: true })
      .click();
  for (let n = 0; n < 2; n++)
    await page.getByRole("button", { name: "Rester", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Nouvelle manche", exact: true }),
  ).toBeVisible();
  await start(page);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Répéter la mise", exact: true }),
  ).toBeEnabled();
  await chip(page, 25, "Ajouter un jeton principal au siège 1");
  await page
    .getByRole("button", { name: "Effacer les mises", exact: true })
    .click();
  await expect(
    page
      .getByRole("button", {
        name: "Ajouter un jeton principal au siège 1",
        exact: true,
      })
      .locator("b"),
  ).toHaveText("0");
  await page
    .getByRole("button", { name: "Répéter la mise", exact: true })
    .click();
  await page.getByRole("button", { name: "Je suis prêt", exact: true }).click();
  await page.getByRole("button", { name: "Lancer la manche" }).click();
  await expect(page.getByLabel("Assurance siège 1")).toBeVisible();
  for (const id of [1, 2]) {
    await expect(page.locator(`[data-seat="${id}"] .bet-chip`)).toHaveText(
      String(id * 100),
    );
    await expect(
      page.locator(`[data-seat="${id}"] .side-results`),
    ).toContainText("PP");
    await expect(
      page.locator(`[data-seat="${id}"] .side-results`),
    ).toContainText("21+3");
  }
  const saved = await page.evaluate(() =>
    Object.entries(localStorage)
      .filter(([k]) => k.startsWith("velvet.blackjack.previous."))
      .map(([, v]) => JSON.parse(v)),
  );
  expect(saved[0].bets["1"]).toEqual({ MAIN: 100, PP: 5, "21+3": 10 });
  expect(saved[0].bets["2"]).toEqual({ MAIN: 200, PP: 5, "21+3": 10 });
  for (const id of [1, 2])
    await page
      .getByLabel(`Assurance siège ${id}`)
      .getByRole("button", { name: "Refuser", exact: true })
      .click();
  for (let n = 0; n < 2; n++)
    await page.getByRole("button", { name: "Rester", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Nouvelle manche", exact: true }),
  ).toBeVisible();
  await start(page);
  await chip(page, 100, "Ajouter un jeton principal au siège 1");
  await chip(page, 50, "Ajouter un jeton principal au siège 1");
  await page
    .getByRole("button", { name: "Miser siège 1", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Répéter la mise", exact: true })
    .click();
  await page.getByRole("button", { name: "Je suis prêt", exact: true }).click();
  await page.getByRole("button", { name: "Lancer la manche" }).click();
  await expect(page.getByLabel("Assurance siège 2")).toBeVisible();
  await expect(page.locator('[data-seat="1"] .bet-chip')).toHaveText("150");
  await expect(page.locator('[data-seat="2"] .bet-chip')).toHaveText("200");
});
test("fixed felt fits seven seats and insufficient repeat never sends wagers", async ({
  page,
}) => {
  test.skip(process.env.VELVET_INSURANCE_TESTS !== "true");
  await table(page, [1, 2, 3, 4, 5, 6, 7]);
  for (const id of [1, 2, 3, 4, 5, 6, 7]) {
    await chip(page, 10, `Ajouter un jeton principal au siège ${id}`);
    await page
      .getByRole("button", { name: `Miser siège ${id}`, exact: true })
      .click();
  }
  await page.getByRole("button", { name: "Je suis prêt", exact: true }).click();
  await page.getByRole("button", { name: "Lancer la manche" }).click();
  await expect(
    page.getByRole("button", { name: "Rester", exact: true }),
  ).toBeVisible({ timeout: 10000 });
  while (
    await page.getByRole("button", { name: "Rester", exact: true }).count()
  ) {
    await page.getByRole("button", { name: "Rester", exact: true }).click();
    await page.waitForTimeout(150);
  }
  await expect(
    page.getByRole("button", { name: "Nouvelle manche", exact: true }),
  ).toBeVisible();
  await start(page);
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) =>
      k.startsWith("velvet.blackjack.previous."),
    )!;
    localStorage.setItem(
      key,
      JSON.stringify({
        round: 1,
        bets: Object.fromEntries(
          Array.from({ length: 7 }, (_, i) => [
            i + 1,
            { MAIN: 2000, PP: 200, "21+3": 200 },
          ]),
        ),
      }),
    );
  });
  await page.reload();
  let betRequests = 0;
  page.on("websocket", (ws) =>
    ws.on("framesent", (event) => {
      if (String(event.payload).includes('"BET_ON_SEAT"')) betRequests++;
    }),
  );
  await page
    .getByRole("button", { name: "Répéter la mise", exact: true })
    .click();
  await expect(page.locator(".toast")).toContainText("Solde insuffisant");
  expect(betRequests).toBe(0);
  await expect(
    page
      .getByRole("button", {
        name: "Ajouter un jeton principal au siège 1",
        exact: true,
      })
      .locator("b"),
  ).toHaveText("0");
  mkdirSync("artifacts/ux-fixed-table", { recursive: true });
  for (const [width, height] of [
    [1920, 1080],
    [1440, 900],
    [1366, 768],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(200);
    const dimensions = await page.locator(".felt").evaluate((el) => ({
      height: el.clientHeight,
      scrollHeight: el.scrollHeight,
      overflow: getComputedStyle(el).overflowY,
    }));
    expect(dimensions.overflow).toBe("clip");
    expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.height + 1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `artifacts/ux-fixed-table/seven-betting-${width}.png`,
    });
  }
});
