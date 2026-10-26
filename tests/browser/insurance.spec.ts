import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
test("ENHC insurance per seat survives refresh and pays independently in two browsers", async ({
  browser,
}) => {
  test.skip(
    process.env.VELVET_INSURANCE_TESTS !== "true",
    "deterministic test-only dealer fixture",
  );
  const c1 = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    }),
    c2 = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const a = await c1.newPage(),
    b = await c2.newPage(),
    errors: string[] = [];
  a.on("pageerror", (e) => errors.push(e.message));
  b.on("pageerror", (e) => errors.push(e.message));
  const click = async (locator: ReturnType<typeof a.locator>) => {
    await locator.click();
    await a.waitForTimeout(150);
  };
  try {
    await a.goto("/");
    await click(a.getByRole("button", { name: "Créer ma table" }));
    await a.getByLabel("Votre pseudo").fill("Assurance Alice");
    await click(a.getByRole("button", { name: "Créer le salon" }));
    const heading = a.getByRole("heading", { name: /Salon / });
    await expect(heading).toBeVisible();
    const code = (await heading.textContent())!.match(/[A-Z2-9]{6}/)![0];
    await b.goto("/");
    await click(b.getByRole("button", { name: "Créer ma table" }));
    await b.getByLabel("Votre pseudo").fill("Observateur Bob");
    await b.getByLabel("Code du salon").fill(code);
    await click(b.getByRole("button", { name: "Rejoindre la table" }));
    for (const seat of [1, 2])
      await click(
        a
          .locator(`.seat[data-seat="${seat}"]`)
          .getByRole("button", { name: "S’installer" }),
      );
    await click(a.getByRole("button", { name: "Ouvrir les mises" }));
    await a.getByRole("button", { name: "100", exact: true }).click();
    await a
      .getByRole("button", {
        name: "Ajouter un jeton principal au siège 1",
        exact: true,
      })
      .click();
    await a
      .getByRole("button", {
        name: "Ajouter un jeton principal au siège 2",
        exact: true,
      })
      .click();
    await a
      .getByRole("button", {
        name: "Ajouter un jeton principal au siège 2",
        exact: true,
      })
      .click();
    for (const seat of [1, 2]) {
      await click(
        a.getByRole("button", {
          name: `Sélectionner siège ${seat}`,
          exact: true,
        }),
      );
      await click(
        a.getByRole("button", { name: `Miser siège ${seat}`, exact: true }),
      );
    }
    await click(a.getByRole("button", { name: "Je suis prêt", exact: true }));
    await click(a.getByRole("button", { name: "Lancer la manche" }));
    await expect(a.locator(".insurance-offer")).toHaveCount(2);
    await expect(a.locator(".dealer .card")).toHaveCount(1);
    await expect(a.locator(".seat-actions")).toHaveCount(0);
    // Keep this gameplay test inside the real ten-second decision window.
    // The longer visual fixture covers all four viewport sizes separately.
    for (const seat of [1, 2]) {
      const box = await a
        .getByLabel(`Assurance siège ${seat}`)
        .getByRole("button", { name: "Prendre l’assurance" })
        .boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
      expect(box!.y + box!.height).toBeLessThanOrEqual(844);
    }
    await click(
      a
        .getByLabel("Assurance siège 1")
        .getByRole("button", { name: "Prendre l’assurance" }),
    );
    await a.reload();
    await expect(a.locator('[data-insurance="1"]')).toContainText(
      "50 crédits engagés",
    );
    await expect(a.getByLabel("Assurance siège 2")).toBeVisible();
    await expect(a.locator(".dealer .card")).toHaveCount(1);
    await expect(a.locator(".wallet")).toContainText(/9\s*650/);
    const dir = join(
      "artifacts/browser",
      new Date().toISOString().replace(/[:.]/g, "-") + "-insurance",
    );
    mkdirSync(dir, { recursive: true });
    await a.screenshot({
      path: join(dir, "insurance-mobile.png"),
      fullPage: true,
    });
    expect(
      await a.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await click(
      a
        .getByLabel("Assurance siège 2")
        .getByRole("button", { name: "Refuser" }),
    );
    await expect(a.locator(".dealer .card")).toHaveCount(1);
    for (const seat of [1, 2])
      await click(a.getByRole("button", { name: "Rester", exact: true }));
    await expect(
      a.getByRole("button", { name: "Nouvelle manche", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await expect(a.locator('[data-insurance="1"]')).toContainText(
      "Gagnée · retour 150 · net 100",
    );
    await expect(a.locator('[data-insurance="2"]')).toContainText("Refusée");
    await expect(a.locator(".wallet")).toContainText(/9\s*800/);
    await expect(b.locator(".dealer .card")).toHaveCount(2);
    await expect(b.locator('[data-insurance="1"]')).toContainText("retour 150");
    await expect(a.locator(".toast")).toHaveCount(0);
    await expect(b.locator(".toast")).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await c1.close();
    await c2.close();
  }
});
