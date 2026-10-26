import { test, expect, type Page } from "@playwright/test";
async function create(p: Page) {
  await p.goto("/");
  await p.getByRole("button", { name: /Roulette.*Européenne/ }).click();
  await p.getByLabel("Votre pseudo").fill("Vote Alice");
  await p.getByRole("button", { name: "Créer le salon" }).click();
  await expect(p.getByRole("heading", { name: /Salon / })).toBeVisible();
  return (await p
    .getByRole("heading", { name: /Salon / })
    .textContent())!.match(/[A-Z2-9]{6}/)![0];
}
test("solo: drag palette onto official targets, move existing chip, reject empty space, accelerate", async ({
  page,
}) => {
  await create(page);
  const source = page.locator(".denomination").filter({ hasText: /^25$/ });
  await source.dragTo(
    page.getByRole("button", { name: "Plein 17", exact: true }),
  );
  await expect(
    page.getByText("Total misé : 25", { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.chip-layer [data-bet="STRAIGHT:17"]')).toHaveText(
    "25",
  );
  await page.waitForTimeout(150);
  await page
    .locator('.chip-layer [data-bet="STRAIGHT:17"]')
    .dragTo(page.locator('button[data-bet="SPLIT:1,2"]'));
  await expect(page.locator('.chip-layer [data-bet="SPLIT:1,2"]')).toHaveText(
    "25",
  );
  await expect(
    page.locator('.chip-layer [data-bet="STRAIGHT:17"]'),
  ).toHaveCount(0);
  await expect(
    page.getByText("Total misé : 25", { exact: true }),
  ).toBeVisible();
  await source.dragTo(page.locator(".roulette-tapis"), {
    targetPosition: { x: 40, y: 212 },
  });
  await expect(
    page.getByText("Total misé : 25", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Accélérer le tour" }).click();
  await expect(
    page.getByRole("button", { name: "Vote enregistré" }),
  ).toBeDisabled();
  await expect(page.locator(".roulette-announcement strong")).toHaveText(
    /^(10|9)s$/,
  );
  await expect(page.locator(".toast")).toHaveCount(0);
  await expect(page.getByText("Résultat officiel", { exact: false })).toBeVisible({ timeout: 25000 });
  const repeat = page.getByRole("button", { name: "Répéter les mises" });
  await expect(repeat).toBeEnabled({ timeout: 10000 });
  await repeat.click();
  await expect(page.locator('.chip-layer [data-bet="SPLIT:1,2"]')).toHaveText("25");
  await page.waitForTimeout(150);
  await page.locator('.chip-layer [data-bet="SPLIT:1,2"]').dragTo(page.getByRole("button", { name: "Plein 0", exact: true }));
  await expect(page.locator('.chip-layer [data-bet="STRAIGHT:0"]')).toHaveText("25");
  await expect(page.getByText("Total misé : 25", { exact: true })).toBeVisible();
  await expect(page.locator(".toast")).toHaveCount(0);
});
test("two browsers must both vote, refresh preserves vote, shared result and next round reset", async ({
  browser,
}) => {
  const c1 = await browser.newContext(),
    c2 = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
  const a = await c1.newPage(),
    b = await c2.newPage();
  try {
    const code = await create(a);
    await b.goto("/");
    await b.getByRole("button", { name: "Créer ma table" }).click();
    await b.getByLabel("Votre pseudo").fill("Vote Bob");
    await b.getByLabel("Code du salon").fill(code);
    await b.getByRole("button", { name: "Rejoindre la table" }).click();
    await expect(b.locator(".roulette-wheel")).toBeVisible();
    await a.getByRole("button", { name: "Accélérer le tour" }).click();
    await expect(b.getByText(/1\/2 votes/)).toBeVisible();
    await a.reload();
    await expect(
      a.getByRole("button", { name: "Vote enregistré" }),
    ).toBeDisabled();
    await b.getByRole("button", { name: "Accélérer le tour" }).click();
    await expect(a.locator(".roulette-announcement strong")).toHaveText(
      /^(10|9)s$/,
    );
    await expect(b.locator(".roulette-announcement strong")).toHaveText(
      /^(10|9)s$/,
    );
    await expect(
      a.getByText("Résultat officiel", { exact: false }),
    ).toBeVisible({ timeout: 25000 });
    await expect(a.locator(".winning-number .number")).toHaveText(
      await b.locator(".winning-number .number").innerText(),
    );
    await expect(
      a.getByRole("button", { name: "Accélérer le tour" }),
    ).toBeEnabled({ timeout: 10000 });
    await expect(a.getByText(/0\/2 votes/)).toBeVisible();
    await expect(a.locator(".toast")).toHaveCount(0);
    await expect(b.locator(".toast")).toHaveCount(0);
  } finally {
    await c1.close();
    await c2.close();
  }
});
