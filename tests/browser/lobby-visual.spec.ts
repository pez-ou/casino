import {test, expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
test('lobby and invitation remain usable at all audit sizes', async ({page}) => {
  test.skip(process.env.VELVET_CAPTURE_LOBBY !== 'true');
  mkdirSync('artifacts/ux-audit/after',{recursive:true});
  for (const [width,height] of [[1920,1080],[1440,900],[1366,768],[390,844]]) {
    await page.setViewportSize({width,height});
    await page.goto('/');
    await expect(page.getByRole('button',{name:'Créer ma table'})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`artifacts/ux-audit/after/lobby-${width}.png`,fullPage:true});
    await page.getByRole('button',{name:'Créer ma table'}).click();
    await expect(page.getByLabel('Votre pseudo')).toBeVisible();
    await page.screenshot({path:`artifacts/ux-audit/after/invitation-${width}.png`,fullPage:true});
  }
});
