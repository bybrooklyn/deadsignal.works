import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const accessibilityRoutes = [
  '/',
  '/project-meridian',
  '/meridian',
  '/meridian/penumbra',
  '/meridian/docs',
  '/meridian/docs/learn/architecture-boundaries',
  '/studio',
  '/contact',
  '/press',
  '/updates',
] as const;

for (const route of accessibilityRoutes) {
  test(`has no automated accessibility violations at ${route}`, async ({ page }) => {
    await page.goto(route);
    await expect(page.locator('h1')).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
}

test('primary navigation works without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/');

  const disclosure = page.locator('.nav-cluster-meridian');
  await disclosure.locator('summary').click();
  await expect(disclosure).toHaveAttribute('open', '');
  await expect(disclosure.getByRole('link', { name: 'Documentation' })).toBeVisible();
  await disclosure.getByRole('link', { name: 'Documentation' }).click();
  await expect(page).toHaveURL(/\/meridian\/docs\/?$/u);
  await expect(page.getByRole('heading', { level: 1, name: 'Start with Meridian.' })).toBeVisible();

  await context.close();
});

test('documentation search is keyboard accessible and returns safe local results', async ({ page }) => {
  await page.goto('/meridian/docs');
  await expect(page.locator('astro-island:not([ssr])')).toHaveCount(1);
  await page.keyboard.press('Control+K');

  const dialog = page.getByRole('dialog', { name: 'Find a page.' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Search terms').fill('Cairn');
  const result = dialog.getByRole('link', { name: /Cairn/u }).first();
  await expect(result).toBeVisible();
  await expect(result).toHaveAttribute('href', /^\/meridian\/docs\//u);

  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

test('mobile navigation and workbench stay inside the viewport', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto('/');

  const menu = page.locator('.mobile-nav');
  await menu.locator('summary').click();
  await expect(menu).toHaveAttribute('open', '');
  await expect(menu.getByRole('link', { name: 'Press kit' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await menu.locator('summary').click();
  const drawers = page.locator('.workbench-drawer');
  await expect(drawers).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) {
    const drawerBox = await drawers.nth(index).boundingBox();
    const titleBox = await drawers.nth(index).locator('strong').boundingBox();
    expect(drawerBox).not.toBeNull();
    expect(titleBox).not.toBeNull();
    if (drawerBox && titleBox) {
      expect(titleBox.y).toBeGreaterThanOrEqual(drawerBox.y);
      expect(titleBox.y + titleBox.height).toBeLessThanOrEqual(drawerBox.y + drawerBox.height + 1);
    }
  }

  await context.close();
});

test('reduced-motion preference disables smooth scrolling and long transitions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');

  const values = await page.evaluate(() => ({
    scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
    transitionDuration: getComputedStyle(document.querySelector('.workbench-drawer')!).transitionDuration,
  }));
  expect(values.scrollBehavior).toBe('auto');
  expect(Math.max(...values.transitionDuration.split(',').map((value) => Number.parseFloat(value)))).toBeLessThanOrEqual(0.001);
});
