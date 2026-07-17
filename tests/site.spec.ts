import { readFileSync, readdirSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

const localOrigin = 'http://127.0.0.1:4323';
const productionOrigin = 'https://deadsignal.works';
const distRoot = new URL('../dist/', import.meta.url);

const sitemapRoutes = readdirSync(distRoot)
  .filter((file) => /^sitemap-\d+\.xml$/u.test(file))
  .flatMap((file) => {
    const sitemap = readFileSync(new URL(file, distRoot), 'utf8');
    return [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/gu)].map((match) => new URL(match[1]).pathname);
  })
  .sort();

if (sitemapRoutes.length === 0) throw new Error('The generated sitemap contains no routes.');
if (new Set(sitemapRoutes).size !== sitemapRoutes.length) throw new Error('The generated sitemap contains duplicate routes.');
if (sitemapRoutes.some((route) => route !== '/' && !route.endsWith('/'))) {
  throw new Error('Every generated page route must use its trailing-slash URL.');
}

const accessibilityRoutes = [...sitemapRoutes, '/404/'];

interface BrowserDiagnostics {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: Array<{ label: string; error: string }>;
  expectedNavigationCancellations: Set<string>;
}

const diagnosticsByPage = new WeakMap<Page, BrowserDiagnostics>();

function monitorPage(page: Page): BrowserDiagnostics {
  const diagnostics: BrowserDiagnostics = {
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    expectedNavigationCancellations: new Set(),
  };

  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    const url = new URL(request.url());
    if (url.origin === localOrigin) {
      diagnostics.failedRequests.push({
        label: `${request.method()} ${url.pathname}`,
        error: request.failure()?.errorText ?? 'unknown failure',
      });
    }
  });

  return diagnostics;
}

function expectCleanDiagnostics(diagnostics: BrowserDiagnostics): void {
  const cancellationErrors = new Set(['net::ERR_ABORTED', 'NS_BINDING_ABORTED']);
  const unexpectedFailedRequests = diagnostics.failedRequests
    .filter(({ label, error }) => !(cancellationErrors.has(error) && diagnostics.expectedNavigationCancellations.has(label)))
    .map(({ label, error }) => `${label}: ${error}`);
  expect(diagnostics.consoleErrors, 'unexpected browser console errors').toEqual([]);
  expect(diagnostics.pageErrors, 'unexpected uncaught browser errors').toEqual([]);
  expect(unexpectedFailedRequests, 'unexpected failed first-party requests').toEqual([]);
}

function allowExpectedNavigationCancellation(page: Page, targetPath: string): void {
  const diagnostics = diagnosticsByPage.get(page);
  if (!diagnostics) throw new Error('Browser diagnostics were not initialized.');
  diagnostics.expectedNavigationCancellations.add(`GET ${targetPath}`);
}

async function horizontalViewportState(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const usableViewportWidth = root.clientWidth;
    const overflow = Math.max(0, root.scrollWidth - usableViewportWidth);

    return {
      fits: overflow <= 1,
      overflow,
      rootScrollWidth: root.scrollWidth,
      rootClientWidth: root.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      usableViewportWidth,
    };
  });
}

async function expectStableLayout(locator: Locator): Promise<void> {
  await expect.poll(
    () => locator.evaluate(() => document.fonts.status),
    { message: 'fonts should finish loading before geometry is measured' },
  ).toBe('loaded');
  await expect.poll(
    () => locator.evaluate((element) => {
      const ancestors = new Set<Element>();
      for (let current: Element | null = element; current; current = current.parentElement) ancestors.add(current);
      return document.getAnimations().every((animation) => {
        const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
        return !(target instanceof Element && ancestors.has(target) && animation.playState === 'running');
      });
    }),
    { message: 'animations affecting click geometry should finish' },
  ).toBe(true);

  let previousBox: number[] | undefined;
  let consecutiveMatches = 0;

  await expect.poll(async () => {
    const box = await locator.boundingBox();
    if (!box) return false;

    const currentBox = [box.x, box.y, box.width, box.height];
    const matches = previousBox?.every((value, index) => Math.abs(value - currentBox[index]!) <= 0.25) ?? false;
    consecutiveMatches = matches ? consecutiveMatches + 1 : 0;
    previousBox = currentBox;
    return consecutiveMatches >= 2;
  }, {
    message: 'navigation geometry should settle after fonts and disclosure animation load',
    intervals: [50, 100, 150, 250],
  }).toBe(true);
}

test.beforeEach(async ({ page }) => {
  diagnosticsByPage.set(page, monitorPage(page));
});

test.afterEach(async ({ page }) => {
  const diagnostics = diagnosticsByPage.get(page);
  if (diagnostics) expectCleanDiagnostics(diagnostics);
});

for (const route of accessibilityRoutes) {
  test(`passes full-page accessibility and layout checks at ${route}`, async ({ page }) => {
    await page.goto(route);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toBeVisible();
    let horizontalState = await horizontalViewportState(page);
    try {
      await expect.poll(
        async () => {
          horizontalState = await horizontalViewportState(page);
          return horizontalState.fits;
        },
        {
          message: `${route} should not overflow the viewport horizontally`,
          timeout: 10_000,
        },
      ).toBe(true);
    } catch (error) {
      throw new Error(`${route} horizontal viewport state: ${JSON.stringify(horizontalState)}`, { cause: error });
    }

    const failedImages = await page.locator('img').evaluateAll((images) => images
      .filter((image) => !(image instanceof HTMLImageElement) || !image.complete || image.naturalWidth === 0)
      .map((image) => image.getAttribute('src') ?? '(missing src)'));
    expect(failedImages, 'broken images').toEqual([]);

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
}

test('canonical sitemap routes return 200 without redirects and match page metadata', async ({ request, browserName }) => {
  test.skip(browserName !== 'chromium', 'Canonical HTTP behavior is browser-independent.');

  for (const route of sitemapRoutes) {
    const response = await request.get(route, { maxRedirects: 0 });
    expect(response.status(), route).toBe(200);
    const html = await response.text();
    const canonical = new URL(route, productionOrigin).toString();
    expect(html, route).toContain(`<link rel="canonical" href="${canonical}">`);
    expect(html, route).toContain(`<meta property="og:url" content="${canonical}">`);
  }
});

test('the custom 404 is accessible at a missing route', async ({ page }) => {
  const response = await page.goto('/audit-route-that-does-not-exist/');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1, name: 'You found somewhere that doesn’t exist.' })).toBeVisible();

  const diagnostics = diagnosticsByPage.get(page);
  if (diagnostics) {
    diagnostics.consoleErrors = diagnostics.consoleErrors.filter(
      (message) => !/Failed to load resource:.*404.*Not Found/iu.test(message),
    );
  }
});

test('the wordmark accessible name matches its visible text', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Dead Signal Works', exact: true })).toHaveAttribute('href', '/');
});

test('ordinary page navigation starts the global view transition', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native document view transitions are exercised in Chromium.');

  await page.addInitScript(() => {
    const state = globalThis as typeof globalThis & {
      __astroPageLoads?: number;
      __viewTransitionStarts?: number;
    };
    state.__astroPageLoads = 0;
    state.__viewTransitionStarts = 0;
    document.addEventListener('astro:page-load', () => {
      state.__astroPageLoads = (state.__astroPageLoads ?? 0) + 1;
    });
    const startViewTransition = document.startViewTransition.bind(document);
    document.startViewTransition = (update) => {
      state.__viewTransitionStarts = (state.__viewTransitionStarts ?? 0) + 1;
      return startViewTransition(update);
    };
  });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => (
    globalThis as typeof globalThis & { __astroPageLoads?: number }
  ).__astroPageLoads ?? 0)).toBeGreaterThan(0);
  allowExpectedNavigationCancellation(page, '/project-meridian/');
  await page.locator('.home-project-actions a[href="/project-meridian/"]').click();
  await expect(page).toHaveURL(`${localOrigin}/project-meridian/`);
  await expect.poll(() => page.evaluate(() => (
    globalThis as typeof globalThis & { __viewTransitionStarts?: number }
  ).__viewTransitionStarts ?? 0)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => (
    globalThis as typeof globalThis & { __astroPageLoads?: number }
  ).__astroPageLoads ?? 0)).toBeGreaterThan(1);
});

test('Meridian subsystem navigation retains its specialized transition state', async ({ page }) => {
  await page.goto('/meridian/');
  await page.locator('astro-island').scrollIntoViewIfNeeded();
  await expect(page.locator('astro-island:not([ssr])')).toHaveCount(1);
  await page.evaluate(() => {
    const state = globalThis as typeof globalThis & { __sawSubsystemTransition?: boolean };
    state.__sawSubsystemTransition = false;
    document.addEventListener('astro:before-swap', () => {
      state.__sawSubsystemTransition = document.documentElement.dataset.subsystemTransition === 'penumbra';
    }, { once: true });
  });
  await page.locator('[data-subsystem-transition="penumbra"]').click();
  await expect(page).toHaveURL(`${localOrigin}/meridian/penumbra/`);
  expect(await page.evaluate(() => (
    globalThis as typeof globalThis & { __sawSubsystemTransition?: boolean }
  ).__sawSubsystemTransition)).toBe(true);
});

test('primary navigation works without JavaScript after fonts settle', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const diagnostics = monitorPage(page);
  await page.goto('/', { waitUntil: 'networkidle' });

  const disclosure = page.locator('.nav-cluster-meridian');
  await disclosure.locator('summary').click();
  await expect(disclosure).toHaveAttribute('open', '');
  const docsLink = disclosure.getByRole('link', { name: 'Documentation' });
  await expect(docsLink).toBeVisible();
  await expectStableLayout(docsLink);
  await docsLink.click({ force: true });
  await expect(page).toHaveURL(`${localOrigin}/meridian/docs/`);
  await expect(page.getByRole('heading', { level: 1, name: 'Start with Meridian.' })).toBeVisible();

  expectCleanDiagnostics(diagnostics);
  await context.close();
});

test('documentation search is keyboard accessible and returns safe local results', async ({ page }) => {
  await page.goto('/meridian/docs/');
  const searchTrigger = page.getByRole('button', { name: /Search docs/u });
  await expect(searchTrigger).toHaveAttribute('data-search-ready', 'true');
  await page.keyboard.press('Control+K');

  const dialog = page.getByRole('dialog', { name: 'Find a page.' });
  const input = dialog.getByLabel('Search terms');
  await expect(dialog).toBeVisible();
  await expect(input).toBeFocused();
  await input.fill('Cairn');
  const result = dialog.getByRole('link', { name: /Cairn/u }).first();
  await expect(result).toBeVisible();
  await expect(result).toHaveAttribute('href', /^\/meridian\/docs\/.*\/$/u);

  const resultUrls = await dialog.locator('.docs-search-results a').evaluateAll((links) => links.map((link) => {
    const url = new URL((link as HTMLAnchorElement).href);
    return { origin: url.origin, pathname: url.pathname };
  }));
  expect(resultUrls.length).toBeGreaterThan(0);
  for (const url of resultUrls) {
    expect(url.origin).toBe(localOrigin);
    expect(url.pathname.startsWith('/meridian/docs/')).toBe(true);
    expect(url.pathname.endsWith('/')).toBe(true);
  }

  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

test('mobile navigation and workbench stay inside the viewport', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const diagnostics = monitorPage(page);
  await page.goto('/');

  const menu = page.locator('.mobile-nav');
  await menu.locator('summary').click();
  await expect(menu).toHaveAttribute('open', '');
  await expect(menu.getByRole('link', { name: 'Press kit' })).toBeVisible();
  await expect.poll(async () => (await horizontalViewportState(page)).fits).toBe(true);

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

  expectCleanDiagnostics(diagnostics);
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
