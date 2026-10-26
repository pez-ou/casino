import { test, expect } from "@playwright/test";
test("host excludes a betting guest, refunds credits and prevents refresh rejoin", async ({
  browser,
}) => {
  const host = await browser.newContext(),
    guest = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
  const a = await host.newPage(),
    b = await guest.newPage();
  try {
    await a.goto("/");
    await a.getByRole("button", { name: "Créer ma table" }).click();
    await a.getByLabel("Votre pseudo").fill("Gestion Alice");
    await a.getByRole("button", { name: "Créer le salon" }).click();
    await expect(a.getByRole("heading", { name: /Salon / })).toBeVisible();
    const code = (await a
      .getByRole("heading", { name: /Salon / })
      .textContent())!.match(/[A-Z2-9]{6}/)![0];
    await b.goto("/");
    await b.getByRole("button", { name: "Créer ma table" }).click();
    await b.getByLabel("Votre pseudo").fill("Gestion Bob");
    await b.getByLabel("Code du salon").fill(code);
    await b.getByRole("button", { name: "Rejoindre la table" }).click();
    await b
      .locator('[data-seat="1"]')
      .getByRole("button", { name: "S’installer" })
      .click();
    await a.getByRole("button", { name: "Ouvrir les mises" }).click();
    await b.getByRole("button", { name: "100", exact: true }).click();
    await b
      .getByRole("button", {
        name: "Ajouter un jeton principal au siège 1",
        exact: true,
      })
      .click();
    await b.getByRole("button", { name: "Miser siège 1", exact: true }).click();
    await expect(b.locator(".wallet b")).toHaveText("9 900");
    await a.getByRole("button", { name: /Joueurs/ }).click();
    await a
      .getByRole("button", { name: "Exclure Gestion Bob", exact: true })
      .click();
    await expect(
      b.getByRole("heading", { name: "Votre soirée commence." }),
    ).toBeVisible();
    await expect(b.locator(".toast")).toContainText("exclu");
    await a.keyboard.press("Escape");
    await expect(a.locator('[data-seat="1"]')).toHaveClass(/empty-seat/);
    await b.reload();
    await expect(
      b.getByRole("heading", { name: "À quoi joue-t-on ce soir ?" }),
    ).toBeVisible();
    await b.getByRole("button", { name: "Créer ma table" }).click();
    await b.getByLabel("Votre pseudo").fill("Gestion Bob");
    await b.getByLabel("Code du salon").fill(code);
    await b.getByRole("button", { name: "Rejoindre la table" }).click();
    await expect(b.locator(".toast")).toContainText(/exclu/);
  } finally {
    await host.close();
    await guest.close();
  }
});
