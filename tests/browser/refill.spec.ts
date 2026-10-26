import { test, expect } from "@playwright/test";

test("refill persists and Lobby appears only at a table", async ({ page }) => {
  await page.goto("/");
  const refill = page
    .getByRole("button", {
      name: "Ajouter des jetons",
      exact: true,
    })
    .first();
  const lobby = page.getByRole("button", { name: "Lobby", exact: true });
  const wallet = page.locator(".wallet b");
  await expect(refill).toBeEnabled();
  await expect(lobby).toHaveCount(0);
  const initial = Number((await wallet.innerText()).replace(/\s/g, ""));
  await refill.click();
  await page.getByLabel("Nombre de jetons").fill("10001");
  await expect(
    page.getByRole("button", { name: "Confirmer l’ajout" }),
  ).toBeDisabled();
  await page.getByLabel("Nombre de jetons").fill("2500");
  await page.getByRole("button", { name: "Confirmer l’ajout" }).click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText("jetons ajoutés");
  await page.getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(wallet).toHaveText((initial + 2500).toLocaleString("fr-FR"));
  await page.reload();
  await expect(refill).toBeEnabled();
  await expect(wallet).toHaveText((initial + 2500).toLocaleString("fr-FR"));
  await page.getByRole("button", { name: "Créer ma table" }).click();
  await expect(lobby).toHaveCount(0);
  await page.getByLabel("Votre pseudo").fill("Refill test");
  await page.getByRole("button", { name: "Créer le salon" }).click();
  await expect(lobby).toBeVisible();
  await refill.click();
  await page.getByLabel("Nombre de jetons").fill("10000");
  await page.getByRole("button", { name: "Confirmer l’ajout" }).click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText("jetons ajoutés");
  await page.getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(wallet).toHaveText((initial + 12500).toLocaleString("fr-FR"));
  await lobby.click();
  await expect(lobby).toHaveCount(0);
  await expect(wallet).toHaveText((initial + 12500).toLocaleString("fr-FR"));
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
