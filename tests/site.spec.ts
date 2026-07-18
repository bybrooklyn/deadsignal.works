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

  diagnosticsByPage.set(page, diagnostics);
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
    test.setTimeout(45_000);
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

test('Steam wishlist availability is an honest disabled status button', async ({ page }) => {
  for (const route of ['/', '/project-meridian/']) {
    await page.goto(route);
    const wishlist = page.getByRole('button', { name: 'Steam wishlist coming soon', exact: true });
    await expect(wishlist).toHaveCount(route === '/' ? 2 : 1);
    await expect(wishlist.first()).toBeDisabled();
    await expect(page.locator('.wishlist-action')).not.toHaveAttribute('href');
  }
});

test('Current status confines technical build provenance to one snapshot block', async ({ page }) => {
  await page.goto('/meridian/docs/learn/current-status/');

  const provenance = page.locator('[data-docs-snapshot]');
  await expect(provenance).toHaveAttribute('data-docs-snapshot', '9e8f80b0ae3432f10501472598ea19c11a1894ed');
  const siteBuild = provenance.locator('[data-site-build]');
  await expect(siteBuild).toHaveCount(1);
  await expect(siteBuild).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
  await expect(page.locator('.site-footer')).not.toContainText('Last updated:');
});

test('each press copy button writes only its own value once', async ({ page }) => {
  await page.addInitScript(() => {
    const state = globalThis as typeof globalThis & { __copyWrites?: number };
    state.__copyWrites = 0;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: () => {
          state.__copyWrites = (state.__copyWrites ?? 0) + 1;
          return Promise.resolve();
        },
      },
    });
  });

  await page.goto('/press/');
  await page.getByRole('button', { name: 'Copy studio description' }).click();
  await expect.poll(() => page.evaluate(() => (
    globalThis as typeof globalThis & { __copyWrites?: number }
  ).__copyWrites ?? 0)).toBe(1);
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

test('rapid successive navigation remains clickable during the root view transition', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Root view-transition input behavior is native to Chromium.');

  await page.goto('/');
  allowExpectedNavigationCancellation(page, '/project-meridian/');
  await page.getByRole('navigation', { name: 'Primary navigation' })
    .getByRole('link', { name: 'Project Meridian', exact: true })
    .click();
  await expect(page).toHaveURL(`${localOrigin}/project-meridian/`);

  const studio = page.getByRole('navigation', { name: 'Primary navigation' })
    .getByRole('link', { name: 'Studio', exact: true });
  await expect(studio).toBeVisible();
  await page.waitForTimeout(60);
  allowExpectedNavigationCancellation(page, '/studio/');
  const box = await studio.boundingBox();
  expect(box).not.toBeNull();
  if (box) await page.mouse.click(box.x + (box.width / 2), box.y + (box.height / 2));
  await expect(page).toHaveURL(`${localOrigin}/studio/`);
});

test('Meridian subsystem navigation retains its specialized transition state', async ({ page }) => {
  const navigateToPenumbra = async () => {
    await page.locator('astro-island').scrollIntoViewIfNeeded();
    await expect(page.locator('astro-island:not([ssr])')).toHaveCount(1);
    const penumbraCard = page.locator('[data-subsystem-transition="penumbra"]');
    await expectStableLayout(penumbraCard);
    await page.evaluate(() => {
      const state = globalThis as typeof globalThis & { __sawSubsystemTransition?: boolean };
      state.__sawSubsystemTransition = false;
      document.addEventListener('astro:before-swap', () => {
        state.__sawSubsystemTransition = document.documentElement.dataset.subsystemTransition === 'penumbra';
      }, { once: true });
    });
    allowExpectedNavigationCancellation(page, '/meridian/penumbra/');
    await penumbraCard.click();
    await expect(page).toHaveURL(`${localOrigin}/meridian/penumbra/`);
    expect(await page.evaluate(() => (
      globalThis as typeof globalThis & { __sawSubsystemTransition?: boolean }
    ).__sawSubsystemTransition)).toBe(true);
  };

  await page.goto('/meridian/');
  await navigateToPenumbra();
  allowExpectedNavigationCancellation(page, '/meridian/');
  await page.getByRole('navigation', { name: 'Primary navigation' })
    .getByRole('link', { name: 'Meridian', exact: true })
    .click();
  await expect(page).toHaveURL(`${localOrigin}/meridian/`);
  await navigateToPenumbra();
});

test('desktop primary navigation uses direct Meridian and Contact links', async ({ page }) => {
  await page.goto('/');
  const navigation = page.getByRole('navigation', { name: 'Primary navigation' });
  await expect(navigation.locator('details')).toHaveCount(0);

  const meridian = navigation.getByRole('link', { name: 'Meridian', exact: true });
  const contact = navigation.getByRole('link', { name: 'Contact', exact: true });
  await expect(meridian).toHaveAttribute('href', '/meridian/');
  await expect(contact).toHaveAttribute('href', '/contact/');

  allowExpectedNavigationCancellation(page, '/meridian/');
  await meridian.click();
  await expect(page).toHaveURL(`${localOrigin}/meridian/`);

  await page.goto('/');
  allowExpectedNavigationCancellation(page, '/contact/');
  await page.getByRole('navigation', { name: 'Primary navigation' })
    .getByRole('link', { name: 'Contact', exact: true })
    .click();
  await expect(page).toHaveURL(`${localOrigin}/contact/`);
});

test('primary navigation works without JavaScript after fonts settle', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const diagnostics = monitorPage(page);
  await page.goto('/', { waitUntil: 'networkidle' });

  const meridianLink = page.getByRole('link', { name: 'Meridian', exact: true });
  await expect(meridianLink).toBeVisible();
  await expectStableLayout(meridianLink);
  await meridianLink.click({ force: true });
  await expect(page).toHaveURL(`${localOrigin}/meridian/`);
  await expect(page.getByRole('heading', { level: 1, name: 'Meridian' })).toBeVisible();

  const subsystemCards = page.locator('.subsystem-card');
  await expect(subsystemCards).toHaveCount(4);
  const penumbra = page.locator('[data-subsystem-transition="penumbra"]');
  await expect(penumbra).toBeVisible();
  await expectStableLayout(penumbra);
  await penumbra.click({ force: true });
  await expect(page).toHaveURL(`${localOrigin}/meridian/penumbra/`);

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

test('mobile navigation disclosures are exclusive, dismissible, and route-aware', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const diagnostics = monitorPage(page);
  await page.goto('/meridian/docs/learn/current-status/');

  const siteMenu = page.locator('details.mobile-nav');
  const docsMenu = page.locator('details.docs-mobile-menu');
  const siteSummary = siteMenu.locator('summary');
  const docsSummary = docsMenu.locator('summary');

  await docsSummary.click();
  await expect(docsMenu).toHaveAttribute('open', '');
  await expect(docsMenu.getByRole('link', { name: 'Current status', exact: true })).toHaveAttribute('aria-current', 'page');

  await siteSummary.click();
  await expect(docsMenu).not.toHaveAttribute('open', '');
  await expect(siteMenu).toHaveAttribute('open', '');
  await page.keyboard.press('Escape');
  await expect(siteMenu).not.toHaveAttribute('open', '');
  await expect(siteSummary).toBeFocused();

  await docsSummary.click();
  await expect(docsMenu).toHaveAttribute('open', '');
  await page.mouse.click(8, 200);
  await expect(docsMenu).not.toHaveAttribute('open', '');

  await docsSummary.click();
  allowExpectedNavigationCancellation(page, '/meridian/docs/learn/what-is-meridian/');
  await docsMenu.getByRole('link', { name: 'What Meridian is', exact: true }).click();
  await expect(page).toHaveURL(`${localOrigin}/meridian/docs/learn/what-is-meridian/`);

  expectCleanDiagnostics(diagnostics);
  await context.close();
});

test('docs data tables become complete label-value cards at 320px', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 844 } });
  const page = await context.newPage();
  const diagnostics = monitorPage(page);
  await page.goto('/meridian/docs/systems/');

  const dataTable = page.locator('[data-docs-data-table]');
  await expect(dataTable.locator('table')).toBeHidden();
  const cards = dataTable.locator('.docs-data-cards');
  await expect(cards).toBeVisible();
  await expect(cards.locator('dt').first()).toHaveText('System');
  await expect(cards.locator('dd').first()).toHaveText('Penumbra');
  await expect.poll(async () => (await horizontalViewportState(page)).fits).toBe(true);

  expectCleanDiagnostics(diagnostics);
  await context.close();
});

test('share failure provides a selectable project URL and recovery announcement', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: () => Promise.reject(new DOMException('Clipboard access denied.', 'NotAllowedError')),
      },
    });
  });
  await page.goto('/project-meridian/');

  await page.getByRole('button', { name: /Share project/u }).click();
  const fallback = page.getByLabel('Project link');
  await expect(fallback).toBeVisible();
  await expect(fallback).toHaveValue(`${localOrigin}/project-meridian/`);
  await expect(page.getByRole('status')).toHaveText(/Select and copy the project URL instead/u);
});

test('Project Meridian FAQ is exclusive and mobile taps do not navigate', async ({ page }) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/project-meridian/');
    const faq = page.locator('.faq-list');
    const items = faq.locator('details[data-faq-item]');
    const firstSummary = items.nth(0).locator('summary');
    const secondSummary = items.nth(1).locator('summary');
    const initialUrl = page.url();

    await expect(items).toHaveCount(5);
    await expect(items.nth(0)).toHaveAttribute('name', 'project-faq');
    await expect(items.nth(0)).toHaveAttribute('open', '');
    await expect(firstSummary).toHaveCSS('min-height', '64px');

    await secondSummary.click();
    await expect(page).toHaveURL(initialUrl);
    await expect(items.nth(0)).not.toHaveAttribute('open', '');
    await expect(items.nth(1)).toHaveAttribute('open', '');
    await expect(items.nth(1).locator('.faq-answer')).toBeVisible();

    await secondSummary.click();
    await expect(page).toHaveURL(initialUrl);
    await expect(items.nth(1)).not.toHaveAttribute('open', '');
  }
});

test('mobile wordmark and Menu controls retain 44px touch targets', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  for (const locator of [
    page.getByRole('link', { name: 'Dead Signal Works', exact: true }),
    page.locator('.mobile-nav-trigger'),
  ]) {
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  }
});

test('project and docs retain their intended breakpoint hierarchy', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Exact visual breakpoints are captured in the Chromium baseline.');

  for (const width of [980, 981]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/project-meridian/');
    const poster = await page.locator('.kinetic-poster').boundingBox();
    const summary = await page.locator('.project-summary').boundingBox();
    expect(poster).not.toBeNull();
    expect(summary).not.toBeNull();
    if (poster && summary) {
      expect(Math.abs(poster.y - summary.y), `${width}px keeps Project Meridian side-by-side`).toBeLessThanOrEqual(1);
      expect(summary.x, `${width}px keeps the project summary beside the poster`).toBeGreaterThan(poster.x);
    }
  }

  for (const width of [1120, 1121]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/meridian/docs/learn/current-status/');
    await expect(page.locator('.docs-sidebar')).toBeVisible();
    await expect(page.locator('.docs-toc')).toBeHidden();
    await expect(page.locator('.docs-frame')).toHaveCSS('grid-template-columns', /190px/u);
  }

  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto('/meridian/docs/learn/current-status/');
  await expect(page.locator('.docs-toc')).toBeVisible();
});

const visualRoutes = [
  { name: 'home', route: '/' },
  { name: 'project-meridian', route: '/project-meridian/' },
  { name: 'meridian', route: '/meridian/' },
  { name: 'current-status', route: '/meridian/docs/learn/current-status/' },
] as const;

for (const viewport of [
  { name: '390', width: 390, height: 844 },
  { name: '1440', width: 1440, height: 1000 },
] as const) {
  for (const visual of visualRoutes) {
    test(`visual baseline ${visual.name} at ${viewport.name}px`, async ({ page, browserName }) => {
      test.skip(
        browserName !== 'chromium' || process.platform !== 'darwin',
        'Visual snapshots are maintained from Chromium on macOS, where the committed baselines are captured.',
      );
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(visual.route);
      await expect(page).toHaveScreenshot(`${visual.name}-${viewport.name}.png`, {
        animations: 'disabled',
        caret: 'hide',
        fullPage: true,
        mask: [page.locator('[data-site-build]')],
      });
    });
  }
}

for (const boundary of [
  { name: 'project-980', route: '/project-meridian/', width: 980, locator: '.project-hero' },
  { name: 'project-981', route: '/project-meridian/', width: 981, locator: '.project-hero' },
  { name: 'docs-1120', route: '/meridian/docs/learn/current-status/', width: 1120, locator: '.docs-frame' },
  { name: 'docs-1121', route: '/meridian/docs/learn/current-status/', width: 1121, locator: '.docs-frame' },
] as const) {
  test(`visual baseline ${boundary.name}`, async ({ page, browserName }) => {
    test.skip(
      browserName !== 'chromium' || process.platform !== 'darwin',
      'Visual snapshots are maintained from Chromium on macOS, where the committed baselines are captured.',
    );
    await page.setViewportSize({ width: boundary.width, height: 900 });
    await page.goto(boundary.route);
    await expect(page.locator(boundary.locator)).toHaveScreenshot(`${boundary.name}.png`, {
      animations: 'disabled',
      caret: 'hide',
      mask: [page.locator('[data-site-build]')],
    });
  });
}

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
