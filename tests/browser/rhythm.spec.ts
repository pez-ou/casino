import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
async function create(page: Page, name: string, code?: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "Créer ma table" }).click();
  await page.getByLabel("Votre pseudo").fill(name);
  if (code) await page.getByLabel("Code du salon").fill(code);
  await page
    .getByRole("button", {
      name: code ? "Rejoindre la table" : "Créer le salon",
    })
    .click();
  await expect(page.getByRole("heading", { name: /Salon / })).toBeVisible();
  return (await page
    .getByRole("heading", { name: /Salon / })
    .textContent())!.match(/[A-Z2-9]{6}/)![0];
}
async function capture(page: Page, name: string) {
  mkdirSync("artifacts/blackjack-rhythm", { recursive: true });
  await page.screenshot({
    path: `artifacts/blackjack-rhythm/${name}.png`,
    animations: "disabled",
    timeout: 10000,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await page.locator(".felt").evaluate((e) => getComputedStyle(e).overflowY),
  ).toBe("clip");
}
test("two browsers: seven seats, animated reconnect, ready cancellation and one planned Hit", async ({
  browser,
}) => {
  test.skip(process.env.VELVET_UX_FIXTURE !== "true");
  test.setTimeout(100000);
  const ca = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    }),
    cb = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
  const a = await ca.newPage(),
    b = await cb.newPage();
  const errors: string[] = [];
  a.on("pageerror", (e) => errors.push(e.message));
  b.on("pageerror", (e) => errors.push(e.message));
  try {
    const code = await create(a, "Rhythm Alice");
    await create(b, "Rhythm Bob", code);
    await a
      .locator('[data-seat="1"]')
      .getByRole("button", { name: "S’installer" })
      .click();
    for (let i = 2; i <= 7; i++)
      await b
        .locator(`[data-seat="${i}"]`)
        .getByRole("button", { name: "S’installer" })
        .click();
    await a.getByRole("button", { name: "Ouvrir les mises" }).click();
    for (const p of [a, b]) {
      await p.getByRole("button", { name: "100", exact: true }).click();
      for (const i of p === a ? [1] : [2, 3, 4, 5, 6, 7])
        await p
          .getByRole("button", {
            name: `Ajouter un jeton principal au siège ${i}`,
            exact: true,
          })
          .click();
      await p
        .getByRole("button", { name: "Je suis prêt", exact: true })
        .click();
    }
    await b.getByRole("button", { name: "Annuler prêt", exact: true }).click();
    await expect(
      a.getByRole("button", { name: "Lancer la manche" }),
    ).toHaveCount(0);
    await b.getByRole("button", { name: "Je suis prêt", exact: true }).click();
    for (const [width, height] of [
      [1920, 1080],
      [1440, 900],
      [1366, 768],
      [390, 844],
    ]) {
      await a.setViewportSize({ width, height });
      await a.waitForTimeout(150);
      await capture(a, `ready-${width}`);
    }
    await a.setViewportSize({ width: 1440, height: 900 });
    await a.getByRole("button", { name: "Lancer la manche" }).click();
    await expect(a.locator(".felt .card")).toHaveCount(0);
    await a.waitForTimeout(1700);
    const count = await a.locator(".felt .card").count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(15);
    await capture(a, "dealing");
    await b.reload();
    await expect(
      b.getByRole("heading", { name: `Salon ${code}` }),
    ).toBeVisible();
    expect(await b.locator(".felt .card").count()).toBeLessThan(15);
    await expect(a.getByLabel("Assurance siège 1")).toBeVisible({
      timeout: 10000,
    });
    await a
      .getByLabel("Assurance siège 1")
      .getByRole("button", { name: "Refuser", exact: true })
      .click();
    while (
      await b.getByRole("button", { name: "Refuser", exact: true }).count()
    )
      await b
        .getByRole("button", { name: "Refuser", exact: true })
        .first()
        .click();
    const planner = b.getByLabel("Décision anticipée siège 2", { exact: true });
    await expect(planner).toBeVisible();
    const before = await b.locator('[data-seat="2"] .card').count();
    await planner.getByRole("button", { name: "Rester", exact: true }).click();
    await expect(planner).toContainText("Action prévue : Rester");
    await planner.getByRole("button", { name: "Tirer", exact: true }).click();
    await planner
      .getByRole("button", { name: "Annuler l’action prévue" })
      .click();
    await planner.getByRole("button", { name: "Tirer", exact: true }).click();
    expect(await b.locator('[data-seat="2"] .card').count()).toBe(before);
    for (const [width, height] of [
      [1920, 1080],
      [1440, 900],
      [1366, 768],
      [390, 844],
    ]) {
      await a.setViewportSize({ width, height });
      await a.waitForTimeout(150);
      await capture(a, `active-${width}`);
    }
    await capture(b, "planned-mobile");
    await a.getByRole("button", { name: "Rester", exact: true }).click();
    await expect(b.locator('[data-seat="2"] .card')).toHaveCount(before + 1);
    await b.waitForTimeout(750);
    expect(await b.locator('[data-seat="2"] .card').count()).toBe(before + 1);
    await expect(b.locator(".action-dock.your-turn")).toBeVisible();
    for (let i = 0; i < 8; i++) {
      const stand = b
        .locator(".action-dock")
        .getByRole("button", { name: "Rester", exact: true });
      if (!(await stand.count())) break;
      await stand.click();
      await b.waitForTimeout(200);
    }
    await expect(
      a.getByRole("button", { name: "Nouvelle manche" }),
    ).toBeVisible({ timeout: 15000 });
    expect(errors).toEqual([]);
  } finally {
    await ca.close();
    await cb.close();
  }
});
