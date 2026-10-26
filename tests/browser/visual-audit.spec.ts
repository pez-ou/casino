import {test, expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
const sizes = [[1920,1080],[1440,900],[1366,768],[390,844]];
test('capture existing Velvet layout before redesign', async ({browser}) => {
  test.skip(process.env.VELVET_AUDIT !== 'true');
  test.setTimeout(120000);
  mkdirSync('artifacts/ux-audit/before',{recursive:true});
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const captures = async (state:string) => {
    for(const [width,height] of sizes) {
      await p.setViewportSize({width,height});
      await p.screenshot({path:`artifacts/ux-audit/before/${state}-${width}.png`,fullPage:true});
    }
  };
  await p.goto('/');
  await captures('lobby');
  await p.getByRole('button',{name:'Créer ma table'}).click();
  await p.getByLabel('Votre pseudo').fill('Camille');
  await p.getByRole('button',{name:'Créer le salon'}).click();
  await expect(p.locator('.seats')).toBeVisible();
  await captures('blackjack-empty');
  for(let seat=1;seat<=7;seat++) {
    await p.locator(`[data-seat="${seat}"]`).getByRole('button',{name:'S’installer'}).click();
    await expect(p.locator(`[data-seat="${seat}"] .seat-name`)).toContainText('Camille');
  }
  await p.getByRole('button',{name:'Je suis prêt',exact:true}).click();
  await expect(p.getByRole('button',{name:'Lancer la manche'})).toBeEnabled();
  await p.getByRole('button',{name:'Lancer la manche'}).click();
  await captures('blackjack-seven');
  await ctx.close();
  const rc = await browser.newContext();
  const r = await rc.newPage();
  await r.goto('/');
  await r.getByRole('button',{name:/Roulette.*Européenne/}).click();
  await r.getByLabel('Votre pseudo').fill('Alex');
  await r.getByRole('button',{name:'Créer le salon'}).click();
  await expect(r.locator('.roulette-tapis')).toBeVisible();
  for(const [width,height] of sizes) {
    await r.setViewportSize({width,height});
    await r.screenshot({path:`artifacts/ux-audit/before/roulette-${width}.png`,fullPage:true});
  }
  await rc.close();
});
