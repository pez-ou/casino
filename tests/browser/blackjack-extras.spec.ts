import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
test("blackjack chip spots and side bets work on desktop and mobile", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Créer ma table" }).click();
  await page.getByLabel("Votre pseudo").fill("Jetons Alice");
  await page.getByRole("button", { name: "Créer le salon" }).click();
  const seat = page.locator('[data-seat="1"]');
  await seat.getByRole("button", { name: "S’installer" }).click();
  await page.getByRole("button", { name: /Ouvrir les mises|Nouvelle manche/ }).click();
  await expect(page.locator(".casino-chip")).toHaveCount(7);
  await page.getByRole("button", { name: "5", exact: true }).click();
  await page
    .getByRole("button", { name: "Ajouter PP siège 1", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Ajouter 21+3 siège 1", exact: true })
    .click();
  await expect(seat.locator(".side-spot b")).toHaveText(["5", "5"]);
  await expect(seat.getByRole("spinbutton")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Miser siège 1", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "25", exact: true }).click();
  const mainSpot = page.getByRole("button", {
    name: "Ajouter un jeton principal au siège 1",
    exact: true,
  });
  await mainSpot.click();
  await expect(mainSpot.locator("b")).toHaveText("25");
  await mainSpot.click();
  await expect(mainSpot.locator("b")).toHaveText("50");
  await expect(mainSpot).toHaveAttribute("aria-pressed", "true");
  const undo = page.getByRole("button", { name: /Annuler le dernier jeton/ });
  await page.getByRole("button", { name: "100", exact: true }).click();
  const pp = page.getByRole("button", {
    name: "Ajouter PP siège 1",
    exact: true,
  });
  await pp.click();
  await expect(pp.locator("b")).toHaveText("105");
  await undo.click();
  await expect(pp.locator("b")).toHaveText("5");
  await expect(mainSpot.locator("b")).toHaveText("50");
  await expect(seat.locator(".side-spot b")).toHaveText(["5", "5"]);
  await page.getByRole("button", { name: "500", exact: true }).click();
  await pp.click();
  await expect(pp.locator("b")).toHaveText("5");
  await expect(page.locator(".toast")).toContainText("200");
  await undo.click();
  await expect(pp.locator("b")).toHaveText("0");
  await page.getByRole("button", { name: "5", exact: true }).click();
  await pp.click();
  await expect(page.locator(".bet-limits")).toContainText("2 000");
  const boxes = await seat.locator(".bet-spot").evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { width: r.width, height: r.height, bottom: r.bottom };
    }),
  );
  expect(boxes[0].width).toBe(boxes[1].width);
  expect(boxes[0].height).toBe(boxes[1].height);
  expect(boxes[2].bottom).toBeGreaterThan(boxes[0].bottom);
  mkdirSync("artifacts/blackjack-extras", { recursive: true });
  await page.screenshot({
    path: "artifacts/blackjack-extras/betting-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/blackjack-extras/betting-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Miser siège 1", exact: true })
    .click();
  await page.getByRole("button", {name:"Je suis prêt", exact:true}).click();
  await page.getByRole("button", {name:"Lancer la manche"}).click();
  await expect(seat.locator(".side-results")).toContainText("PP · 5");
  await expect(page.locator(".wallet b")).toHaveText("9 940");
  await page.waitForTimeout(3000);
  if (
    await page.getByRole("button", { name: "Refuser", exact: true }).isVisible()
  )
    await page.getByRole("button", { name: "Refuser", exact: true }).click();
  const double = page.getByRole("button", { name: "Doubler", exact: true });
  if (await double.isVisible()) {
    await double.click();
    await expect(
      page.getByRole("button", { name: "Face cachée", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Face cachée", exact: true })
      .click();
  }
  await expect(page.locator(".win-banner")).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".card-back")).toHaveCount(0);
  await expect(page.locator(".toast")).toHaveCount(0);
  expect(errors).toEqual([]);
});
