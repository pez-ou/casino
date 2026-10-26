import {
  test,
  expect,
  errors as playwrightErrors,
  type Page,
  type Locator,
} from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
const captures = join(
  process.cwd(),
  "artifacts/browser",
  new Date().toISOString().replace(/[:.]/g, "-") + "-" + process.pid,
);
async function capture(page: Page, name: string) {
  mkdirSync(captures, { recursive: true });
  await page.screenshot({ path: join(captures, name), fullPage: true });
}
async function click(locator: Locator) {
  await locator.click();
  await locator.page().waitForTimeout(150);
}
test("two browsers play ENHC, refresh restores seat, mobile fits", async ({
  browser,
}) => {
  const c1 = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    c2 = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
  const a = await c1.newPage(),
    b = await c2.newPage();
  const errors: string[] = [];
  a.on("pageerror", (e) => errors.push(e.message));
  b.on("pageerror", (e) => errors.push(e.message));
  await a.goto("/");
  await expect(
    a.getByRole("heading", { name: "À quoi joue-t-on ce soir ?" }),
  ).toBeVisible();
  await capture(a, "home-desktop.png");
  await click(a.getByRole("button", { name: "Créer ma table" }));
  await a.getByLabel("Votre pseudo").fill("Camille");
  await click(a.getByRole("button", { name: "Créer le salon" }));
  const heading = a.getByRole("heading", { name: /Salon / });
  await expect(heading).toBeVisible();
  const code = (await heading.textContent())!.match(/[A-Z2-9]{6}/)![0];
  await b.goto("/");
  await click(b.getByRole("button", { name: "Créer ma table" }));
  await b.getByLabel("Votre pseudo").fill("Alex");
  await b.getByLabel("Code du salon").fill(code);
  await click(b.getByRole("button", { name: "Rejoindre la table" }));
  await expect(b.getByRole("heading", { name: `Salon ${code}` })).toBeVisible();
  await click(
    a
      .locator('.seat[data-seat="1"]')
      .getByRole("button", { name: "S’installer" }),
  );
  await click(
    a
      .locator('.seat[data-seat="2"]')
      .getByRole("button", { name: "S’installer" }),
  );
  await click(
    b
      .locator('.seat[data-seat="3"]')
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
  await a.getByRole("button", { name: "500", exact: true }).click();
  await a
    .getByRole("button", {
      name: "Ajouter un jeton principal au siège 2",
      exact: true,
    })
    .click();
  await b.getByRole("button", { name: "100", exact: true }).click();
  await b
    .getByRole("button", {
      name: "Ajouter un jeton principal au siège 3",
      exact: true,
    })
    .click();
  await click(
    a.getByRole("button", { name: "Sélectionner siège 1", exact: true }),
  );
  await click(a.getByRole("button", { name: "Miser siège 1", exact: true }));
  await click(
    a.getByRole("button", { name: "Sélectionner siège 2", exact: true }),
  );
  await click(a.getByRole("button", { name: "Miser siège 2", exact: true }));
  await click(b.getByRole("button", { name: "Miser siège 3", exact: true }));
  await click(a.getByRole("button", { name: "Je suis prêt", exact: true }));
  await click(b.getByRole("button", { name: "Je suis prêt", exact: true }));
  await click(a.getByRole("button", { name: "Lancer la manche" }));
  await a.waitForTimeout(4000);
  for (const page of [a, b]) {
    const refuse = page.getByRole("button", { name: "Refuser", exact: true });
    while (await refuse.count()) await click(refuse.first());
  }
  await expect(a.locator(".dealer .card")).toHaveCount(1);
  await a.reload();
  await expect(a.getByRole("heading", { name: `Salon ${code}` })).toBeVisible();
  await expect(a.locator(".seats .seat")).toHaveCount(7);
  await expect(a.locator(".toast")).toHaveCount(0);
  await expect(b.locator(".toast")).toHaveCount(0);
  await capture(a, "table-desktop.png");
  await capture(b, "table-mobile.png");
  expect(
    await b.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  for (let i = 0; i < 70; i++) {
    if (
      await a
        .getByRole("button", { name: "Nouvelle manche", exact: true })
        .isVisible()
    )
      break;
    for (const p of [a, b]) {
      const stand = p.getByRole("button", { name: "Rester", exact: true });
      // The previous player's button can disappear between count and isEnabled.
      const enabled = await stand.isEnabled({ timeout: 500 }).catch((error) => {
        if (error instanceof playwrightErrors.TimeoutError) return false;
        throw error;
      });
      if (enabled) {
        await stand.click({ timeout: 1000 }).catch(async (error) => {
          if (
            !(error instanceof playwrightErrors.TimeoutError) ||
            (await stand.count())
          )
            throw error;
        });
        await p.waitForTimeout(150);
      }
    }
    await a.waitForTimeout(300);
  }
  await expect(
    a.getByRole("button", { name: "Nouvelle manche", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await expect(b.getByText("L’hôte va ouvrir les mises.")).toBeVisible();
  await expect(a.locator(".toast")).toHaveCount(0);
  await expect(b.locator(".toast")).toHaveCount(0);
  expect(errors).toEqual([]);
  await c1.close();
  await c2.close();
});

test("roulette two browsers share wheel and result, mobile tapis, repeat and undo", async ({
  browser,
}) => {
  const c1 = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    c2 = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
  const a = await c1.newPage(),
    b = await c2.newPage();
  const errors: string[] = [];
  a.on("pageerror", (e) => errors.push(e.message));
  b.on("pageerror", (e) => errors.push(e.message));
  try {
    await a.goto("/");
    await click(a.getByRole("button", { name: /Roulette.*Européenne/ }));
    await a.getByLabel("Votre pseudo").fill("Roulette Camille");
    await click(a.getByRole("button", { name: "Créer le salon" }));
    const heading = a.getByRole("heading", { name: /Salon / });
    await expect(heading).toBeVisible();
    const code = (await heading.textContent())!.match(/[A-Z2-9]{6}/)![0];
    await b.goto("/");
    await click(b.getByRole("button", { name: "Créer ma table" }));
    await b.getByLabel("Votre pseudo").fill("Roulette Alex");
    await b.getByLabel("Code du salon").fill(code);
    await click(b.getByRole("button", { name: "Rejoindre la table" }));
    await expect(b.locator(".roulette-wheel")).toBeVisible();
    await expect(a.locator(".roulette-wheel text")).toHaveCount(37);
    const rotation = await a
      .locator(".roulette-wheel > g")
      .getAttribute("transform");
    await a.waitForTimeout(250);
    expect(
      await a.locator(".roulette-wheel > g").getAttribute("transform"),
    ).not.toBe(rotation);
    await click(a.locator(".zero-cell"));
    await click(b.getByRole("button", { name: "Rouge", exact: true }));
    await expect(a.locator('.chip-layer [data-bet="STRAIGHT:0"]')).toHaveText(
      "25",
    );
    await expect(b.getByText("Total misé : 25")).toBeVisible();
    await click(a.getByRole("button", { name: "Annuler dernière mise" }));
    await expect(a.getByText("Total misé : 0")).toBeVisible();
    await click(a.getByRole("button", { name: "Plein 17", exact: true }));
    for (const name of [
      "SPLIT 1 / 2",
      "CORNER 1 / 2 / 4 / 5",
      "STREET Transversale 1–3",
      "SIX_LINE Sixain 1–6",
      "FIRST_FOUR Premiers quatre",
    ])
      await click(a.getByRole("button", { name, exact: true }));
    await expect(a.getByText("Total misé : 150")).toBeVisible();
    await click(a.getByRole("button", { name: "Effacer les mises" }));
    await expect(a.getByText("Total misé : 0")).toBeVisible();
    await click(a.getByRole("button", { name: "Plein 17", exact: true }));
    await expect(a.locator(".toast")).toHaveCount(0);
    await expect(b.locator(".toast")).toHaveCount(0);
    await click(a.locator('.chip-layer [data-bet="STRAIGHT:17"]'));
    await expect(a.locator('.chip-layer [data-bet="STRAIGHT:17"]')).toHaveCount(
      1,
    );
    await expect(a.locator('.chip-layer [data-bet="STRAIGHT:17"]')).toHaveText(
      "50",
    );
    await expect(
      a.locator('.chip-layer [data-bet="STRAIGHT:17"]'),
    ).toHaveAttribute("data-stack", "2");
    await click(a.getByRole("button", { name: "Annuler dernière mise" }));
    await a.locator(".roulette-tapis").click({ position: { x: 40, y: 212 } });
    await expect(a.getByText("Total misé : 25")).toBeVisible();
    await b.getByLabel("Choisir un pari précis").selectOption("SPLIT:1,2");
    await click(b.getByRole("button", { name: "Miser 25 sur ce pari" }));
    await expect(b.getByText("Total misé : 50")).toBeVisible();
    await click(b.getByRole("button", { name: "Annuler dernière mise" }));
    await expect(b.getByText("Total misé : 25")).toBeVisible();
    const targets = await a.locator(".inside-spot").evaluateAll((els) =>
      els.map((el) => ({
        key: el.getAttribute("data-bet"),
        numbers: el.getAttribute("data-numbers"),
        rect: (() => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        })(),
      })),
    );
    expect(new Set(targets.map((t) => t.key)).size).toBe(targets.length);
    const overlaps: string[] = [];
    for (let i = 0; i < targets.length; i++)
      for (const t of targets.slice(i + 1)) {
        const p = targets[i].rect,
          q = t.rect;
        if (!(
          p.x + p.width <= q.x ||
          q.x + q.width <= p.x ||
          p.y + p.height <= q.y ||
          q.y + q.height <= p.y
        ))
          overlaps.push(`${targets[i].key}/${t.key}`);
      }
    expect(overlaps).toEqual([]);
    await expect(a.locator(".winning-number")).toContainText("Manche 1");
    await capture(a, "roulette-desktop.png");
    await capture(b, "roulette-mobile.png");
    expect(
      await b.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await b
        .locator(".tapis-scroll")
        .evaluate((el) => el.scrollWidth > el.clientWidth),
    ).toBe(true);
    await expect(a.locator(".roulette-announcement")).toContainText(
      "Dernières mises",
      {
        timeout: 35000,
      },
    );
    await expect(a.locator(".roulette-announcement")).toContainText(
      "Les jeux sont faits",
      {
        timeout: 10000,
      },
    );
    await a.reload();
    await expect(a.locator(".roulette-wheel")).toBeVisible();
    await expect(
      a.getByRole("button", { name: "Plein 17", exact: true }),
    ).toBeDisabled();
    const ball = await a.locator(".roulette-ball").getAttribute("cx");
    await a.waitForTimeout(200);
    expect(await a.locator(".roulette-ball").getAttribute("cx")).not.toBe(ball);
    await expect(a.locator(".roulette-announcement")).toContainText(
      "Résultat officiel",
      {
        timeout: 15000,
      },
    );
    await expect(b.locator(".roulette-announcement")).toContainText(
      "Résultat officiel",
    );
    expect(await a.locator(".winning-number .number").textContent()).toBe(
      await b.locator(".winning-number .number").textContent(),
    );
    const pockets = [
      0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
      24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
    ];
    const landing = await a.locator(".roulette-wheel").evaluate((svg) => {
      const ball = svg.querySelector(".roulette-ball")!;
      const x = Number(ball.getAttribute("cx")) - 210,
        y = Number(ball.getAttribute("cy")) - 210;
      const angle = (Math.atan2(y, x) * 180) / Math.PI + 90;
      const rotation = Number(
        svg
          .querySelector(":scope > g")!
          .getAttribute("transform")!
          .match(/rotate\(([^ ]+)/)![1],
      );
      return (
        Math.round(((((angle - rotation) % 360) + 360) % 360) / (360 / 37)) % 37
      );
    });
    expect(pockets[landing]).toBe(
      Number(await a.locator(".winning-number .number").textContent()),
    );
    await b.emulateMedia({ reducedMotion: "reduce" });
    await expect(b.locator(".roulette-wheel > g")).toHaveAttribute(
      "transform",
      "rotate(0 210 210)",
    );
    await expect(
      a.getByRole("button", { name: "Répéter les mises" }),
    ).toBeEnabled({ timeout: 10000 });
    await click(a.getByRole("button", { name: "Répéter les mises" }));
    await expect(a.getByText("Total misé : 25")).toBeVisible();
    await click(a.getByRole("button", { name: "Effacer les mises" }));
    await expect(a.getByText("Total misé : 0")).toBeVisible();
    await expect(a.locator(".toast")).toHaveCount(0);
    await expect(b.locator(".toast")).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await c1.close();
    await c2.close();
  }
});
