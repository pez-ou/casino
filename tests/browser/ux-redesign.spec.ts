import { test, expect, type Page } from "@playwright/test";
import { io, type Socket } from "socket.io-client";
import { mkdirSync } from "node:fs";
import type { RoomState, Action } from "../../packages/shared/types";
const sizes = [
  [1920, 1080],
  [1440, 900],
  [1366, 768],
  [390, 844],
];
const folder = "artifacts/ux-audit/after";
async function capture(page: Page, name: string, actions = false) {
  mkdirSync(folder, { recursive: true });
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(200);
    await page.evaluate(() => scrollTo(0, 0));
    if (name.startsWith("blackjack")) {
      const layout = await page.locator(".felt").evaluate((el) => {
        const box = el.getBoundingClientRect();
        return {
          overflow: getComputedStyle(el).overflowY,
          height: el.clientHeight,
          scrollHeight: el.scrollHeight,
          cardsFit: [...el.querySelectorAll(".card")].every((card) => {
            const rect = card.getBoundingClientRect();
            return rect.top >= box.top && rect.bottom <= box.bottom;
          }),
        };
      });
      expect(layout.overflow).toBe("clip");
      expect(layout.scrollHeight).toBeLessThanOrEqual(layout.height + 1);
      expect(layout.cardsFit, `${name}: cards fit ${width}`).toBe(true);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `${name} overflow ${width}`,
    ).toBe(true);
    if (actions) {
      for (const label of ["Tirer", "Rester", "Doubler", "Séparer"]) {
        const box = await page
          .getByRole("button", { name: label, exact: true })
          .boundingBox();
        expect(box).toBeTruthy();
        expect(box!.y).toBeGreaterThan(0);
        expect(box!.y + box!.height).toBeLessThanOrEqual(height);
      }
    }
    await page.screenshot({
      path: `${folder}/${name}-${width}.png`,
      fullPage: true, animations: "disabled", timeout:10000,
    });
    await page.screenshot({ animations: "disabled", timeout:10000, path: `${folder}/${name}-${width}-viewport.png` });
  }
}
async function create(page: Page, game = "blackjack") {
  await page.goto("/");
  await page
    .getByRole(
      "button",
      game === "blackjack"
        ? { name: "Créer ma table" }
        : { name: /Roulette.*Européenne/ },
    )
    .click();
  await page.getByLabel("Votre pseudo").fill("Camille");
  await page.getByRole("button", { name: "Créer le salon" }).click();
  await expect(page.getByRole("heading", { name: /Salon / })).toBeVisible();
  return (await page
    .getByRole("heading", { name: /Salon / })
    .textContent())!.match(/[A-Z2-9]{6}/)![0];
}
async function peer(name: string, code: string, seatId: number) {
  const socket = io("http://localhost:5197", {
    transports: ["websocket"],
    extraHeaders: { Origin: "http://localhost:5197" },
  });
  let state: RoomState;
  socket.on("room_state", (s) => (state = s));
  const session = await new Promise<{ token: string }>((resolve) =>
    socket.on("session", resolve),
  );
  const send = (type: Action["type"], extra: Partial<Action> = {}) =>
    new Promise<void>((resolve, reject) =>
      socket.emit(
        "action",
        {
          requestId: crypto.randomUUID(),
          type,
          ...(state ? { round: state.game.round, version: state.version } : {}),
          ...extra,
        },
        (r: { ok: boolean; error?: string }) =>
          r.ok ? resolve() : reject(new Error(r.error)),
      ),
    );
  await send("JOIN", { name, code });
  await send("TAKE_SEAT", { seatId });
  return {
    socket,
    send,
    token: session.token,
    get state() {
      return state!;
    },
  };
}
test("visual blackjack: seven occupied seats, insurance, active hand, split, hidden double and results", async ({
  page,
  browser,
}) => {
  test.skip(process.env.VELVET_UX_FIXTURE !== "true");
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const code = await create(page);
  await capture(page, "blackjack-empty");
  for (const seat of [1, 2]) {
    await page
      .locator(`[data-seat="${seat}"]`)
      .getByRole("button", { name: "S’installer" })
      .click();
    await expect(
      page.locator(`[data-seat="${seat}"] .seat-name`),
    ).toContainText("Camille");
  }
  const names = ["Alex", "Noémie", "Gabriel", "Léa", "Hugo"];
  const peers = [];
  try {
    for (let i = 0; i < 5; i++) peers.push(await peer(names[i], code, i + 3));
    await page.getByRole("button", { name: "Ouvrir les mises" }).click();
    await capture(page, "blackjack-seven-betting");
    await page.getByRole("button", { name: "100", exact: true }).click();
    for (const seat of [1, 2]) {
      await page
        .getByRole("button", {
          name: `Ajouter un jeton principal au siège ${seat}`,
          exact: true,
        })
        .click();
      await page
        .getByRole("button", { name: `Miser siège ${seat}`, exact: true })
        .click();
      await expect(page.locator(`[data-seat="${seat}"]`)).toContainText(
        "Mise confirmée",
      );
    }
    for (let i = 0; i < 5; i++)
      await peers[i].send("BET_ON_SEAT", { seatId: i + 3, amount: 100 });
    for (const p of peers) await p.send("READY");
    await page
      .getByRole("button", { name: "Je suis prêt", exact: true })
      .click();
    await page.getByRole("button", { name: "Lancer la manche" }).click();
    await expect(page.getByLabel("Assurance siège 1")).toBeVisible({timeout:10000});
    await capture(page, "blackjack-insurance");
    if (process.env.VELVET_INSURANCE_VISUAL_ONLY === "true") return;
    // Viewers and network peers decide independently; this remains the real engine.
    for (const seat of [1, 2]) {
      const offer = page.getByLabel(`Assurance siège ${seat}`);
      if (await offer.count())
        await offer
          .getByRole("button", {
            name: seat === 1 ? "Prendre l’assurance" : "Refuser",
            exact: true,
          })
          .click();
    }
    for (let i = 0; i < 5; i++)
      if (
        peers[i].state.game.phase === "INSURANCE" &&
        peers[i].state.game.seats![i + 2].insurance?.decision === "PENDING"
      )
        await peers[i].send("DECLINE_INSURANCE", { seatId: i + 3 });
    await expect(
      page.getByRole("button", { name: "Séparer", exact: true }),
    ).toBeEnabled();
    await capture(page, "blackjack-active", true);
    await page.getByRole("button", { name: "Séparer", exact: true }).click();
    await expect(page.locator('[data-seat="1"] .table-hand')).toHaveCount(2);
    await capture(page, "blackjack-split", true);
    await page.getByRole("button", { name: "Doubler", exact: true }).click();
    await page
      .getByRole("button", { name: "Face cachée", exact: true })
      .click();
    await expect(page.locator('[data-seat="1"] .card-back')).toHaveCount(1);
    await capture(page, "blackjack-multiple-hands", true);
    // Refresh preserves ownership and the concealed card.
    await page.reload();
    await expect(page.locator('[data-seat="1"] .card-back')).toHaveCount(1);
    for (let i = 0; i < 2; i++) {
      await page.getByRole("button", { name: "Rester", exact: true }).click();
      await page.waitForTimeout(150);
    }
    for (let i = 0; i < 3; i++)
      await peers[0].send("SPLIT", { seatId: 3, hand: i === 0 ? 0 : 0 });
    await expect(page.locator('[data-seat="3"] .table-hand')).toHaveCount(4);
    await capture(page, "blackjack-four-split-hands");
    await page
      .getByRole("button", { name: "Voir les mains siège 3", exact: true })
      .click();
    await expect(
      page.getByRole("dialog").locator(".inspected-hands > div"),
    ).toHaveCount(4);
    await page.keyboard.press("Escape");
    for (const p of peers) {
      while (
        p.state.game.phase === "PLAYER_TURN" &&
        p.state.game.turn?.playerId ===
          p.state.players.find((x) => x.name === names[peers.indexOf(p)])?.id
      ) {
        const turn = p.state.game.turn!;
        await p.send("STAND", { seatId: turn.seatId, hand: turn.hand });
        await page.waitForTimeout(150);
      }
    }
    await expect(page.locator(".win-banner")).toBeVisible({ timeout: 15000 });
    await expect(page.locator(".card-back")).toHaveCount(0);
    await expect(page.locator('[data-seat="4"]')).toContainText("Blackjack");
    await capture(page, "blackjack-results");
    const winnerContext = await browser.newContext();
    await winnerContext.addInitScript(
      (token) => localStorage.setItem("velvet.token", token),
      peers[1].token,
    );
    const winner = await winnerContext.newPage();
    await winner.goto("/");
    await expect(winner.locator(".win-banner")).toContainText("jetons gagnés");
    await capture(winner, "blackjack-victory");
    await winnerContext.close();
    await page.getByRole("button", { name: /Règles/ }).click();
    await expect(page.getByRole("dialog")).toContainText("Perfect Pairs");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    for (const p of peers) p.socket.disconnect();
  }
});
test("visual roulette: chips, precision, countdown, synchronized spin and winning result", async ({
  page,
}) => {
  test.skip(process.env.VELVET_UX_FIXTURE !== "true");
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await create(page, "roulette");
  await capture(page, "roulette-empty");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Plein 17", exact: true }).click();
  await expect(
    page.getByText("Total misé : 25", { exact: true }),
  ).toBeVisible();
  for (const name of [
    "Rouge",
    "SPLIT 1 / 2",
    "CORNER 1 / 2 / 4 / 5",
    "STREET Transversale 1–3",
    "SIX_LINE Sixain 1–6",
    "FIRST_FOUR Premiers quatre",
  ]) {
    await page.getByRole("button", { name, exact: true }).click();
    await page.waitForTimeout(150);
  }
  await capture(page, "roulette-chips");
  await page.getByRole("button", { name: "Précision", exact: true }).click();
  await expect(page.locator(".tapis-scroll")).toHaveClass(/zoomed/);
  await page.getByLabel("Choisir un pari précis").selectOption("SPLIT:1,2");
  await page.getByRole("button", { name: "Miser 25 sur ce pari" }).click();
  await expect(
    page.getByText("Total misé : 200", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Vue normale", exact: true }).click();
  await page.getByRole("button", { name: "Accélérer le tour" }).click();
  await expect(page.locator(".roulette-announcement")).toContainText(
    "Dernières mises",
    { timeout: 15000 },
  );
  await capture(page, "roulette-last-five");
  await expect(page.locator(".roulette-announcement")).toContainText(
    "Les jeux sont faits",
    { timeout: 10000 },
  );
  await capture(page, "roulette-spinning");
  await page.reload();
  await expect(page.locator(".roulette-announcement")).toContainText(
    "Résultat officiel",
    { timeout: 15000 },
  );
  await expect(page.locator(".winning-number .number")).toHaveText("17");
  await expect(page.locator(".win-banner")).toContainText("jetons gagnés");
  await capture(page, "roulette-result");
  const wheel = await page.locator(".roulette-wheel").evaluate((svg) => {
    const ball = svg.querySelector(".roulette-ball")!;
    return {
      x: Number(ball.getAttribute("cx")),
      y: Number(ball.getAttribute("cy")),
    };
  });
  expect(Number.isFinite(wheel.x)).toBe(true);
  expect(errors).toEqual([]);
});
