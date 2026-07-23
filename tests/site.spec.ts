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
    test.setTimeout(60_000);
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

test('static agent discovery artifacts are present and preserve HTML as the default', async ({ request, browserName }) => {
  test.skip(browserName !== 'chromium', 'Static HTTP behavior is browser-independent.');

  const homepage = await request.get('/');
  expect(homepage.status()).toBe(200);
  expect(homepage.headers()['content-type']).toMatch(/^text\/html/u);
  expect(homepage.headers().link).toContain('</alchemist/docs/openapi.yaml>; rel="service-desc"; type="application/vnd.oai.openapi"');
  expect(homepage.headers()['content-signal']).toBe('ai-train=no, search=yes, ai-input=yes');

  const robots = await request.get('/robots.txt');
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toContain('Content-Signal: ai-train=no, search=yes, ai-input=yes');

  const auth = await request.get('/auth.md');
  expect(auth.status()).toBe(200);
  expect(await auth.text()).toContain('# Dead Signal Works auth.md');

  const skillsIndex = await request.get('/.well-known/agent-skills/index.json');
  expect(skillsIndex.status()).toBe(200);
  expect(skillsIndex.headers()['content-type']).toMatch(/^application\/json/u);
  const index = await skillsIndex.json() as { skills?: Array<{ url?: string }> };
  expect(index.skills).toHaveLength(1);
  const skill = await request.get(new URL(index.skills?.[0]?.url ?? '', productionOrigin).pathname);
  expect(skill.status()).toBe(200);
  expect(await skill.text()).toContain('# Dead Signal Works site');

});

test('WebMCP tools are read-only, allowlisted, executable, and not duplicated after navigation', async ({ page }) => {
  await page.addInitScript(() => {
    const tools = new Map<string, { name: string; execute: (input: unknown) => Promise<unknown> }>();
    const state = globalThis as typeof globalThis & { __webMcp?: { tools: typeof tools; registerCalls: number } };
    state.__webMcp = { tools, registerCalls: 0 };
    const context = {
      registerTool: async (tool: { name: string; execute: (input: unknown) => Promise<unknown> }, options: { signal: AbortSignal }) => {
        state.__webMcp!.registerCalls += 1;
        tools.set(tool.name, tool);
        options.signal.addEventListener('abort', () => tools.delete(tool.name), { once: true });
      },
    };
    Object.defineProperty(Document.prototype, 'modelContext', {
      configurable: true,
      get: () => context,
    });
  });

  await page.goto('/');
  await expect.poll(() => page.evaluate(() => (
    globalThis as typeof globalThis & { __webMcp?: { tools: Map<string, unknown>; registerCalls: number } }
  ).__webMcp?.tools.size ?? 0)).toBe(3);

  const listed = await page.evaluate(async () => {
    const state = (globalThis as typeof globalThis & { __webMcp?: { tools: Map<string, { execute: (input: unknown) => Promise<unknown> }> } }).__webMcp!;
    return state.tools.get('list_public_resources')!.execute({});
  });
  expect(listed).toMatchObject({ content: [{ type: 'text' }] });
  expect(JSON.parse((listed as { content: Array<{ text: string }> }).content[0]!.text).resources).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'meridian' }),
    expect.objectContaining({ id: 'alchemist' }),
  ]));

  const invalidPathError = await page.evaluate(async () => {
    const state = (globalThis as typeof globalThis & { __webMcp?: { tools: Map<string, { execute: (input: unknown) => Promise<unknown> }> } }).__webMcp!;
    try {
      await state.tools.get('open_public_page')!.execute({ path: 'https://example.com/' });
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
  expect(invalidPathError).toContain('allowlisted canonical public page');

  allowExpectedNavigationCancellation(page, '/meridian/');
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Meridian', exact: true }).click();
  await expect(page).toHaveURL(`${localOrigin}/meridian/`);
  await expect.poll(() => page.evaluate(() => (
    globalThis as typeof globalThis & { __webMcp?: { tools: Map<string, unknown> } }
  ).__webMcp?.tools.size ?? 0)).toBe(3);
  expect(await page.evaluate(() => (
    globalThis as typeof globalThis & { __webMcp?: { registerCalls: number } }
  ).__webMcp?.registerCalls ?? 0)).toBe(6);
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
  const wordmark = page.getByRole('link', { name: 'Dead Signal Works', exact: true });
  await expect(wordmark).toHaveAttribute('href', '/');
  const works = wordmark.locator('span').last();
  const restingColor = await works.evaluate((element) => getComputedStyle(element).color);
  const restingOpacity = await wordmark.evaluate((element) => getComputedStyle(element).opacity);
  await wordmark.hover();
  await expect(works).toHaveCSS('color', restingColor);
  await expect(wordmark).toHaveCSS('opacity', restingOpacity);
});

test('Steam wishlist status exposes a useful follow-up action without pretending Steam is live', async ({ page }) => {
  await page.goto('/');
  const homeFollowLinks = page.getByRole('link', { name: /Follow development/u });
  await expect(homeFollowLinks).toHaveCount(2);
  await expect(homeFollowLinks.first()).toHaveAttribute('href', '/updates/');
  await expect(page.locator('[data-wishlist-flip]')).toHaveCount(0);

  await page.goto('/project-meridian/');
  const wishlist = page.locator('[data-wishlist-flip]');
  const toggle = wishlist.getByRole('button', { name: /Steam wishlist coming soon/u });
  const follow = wishlist.getByRole('link', { name: /Follow development/u });
  await expect(wishlist).toHaveAttribute('data-wishlist-ready', 'true');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(follow).toHaveAttribute('href', '/updates/');

  await toggle.focus();
  await expect.poll(() => wishlist.locator('.wishlist-flip-inner').evaluate(
    (element) => getComputedStyle(element).transform !== 'none',
  )).toBe(true);

  await toggle.evaluate((button) => (button as HTMLButtonElement).click());
  await expect(wishlist).toHaveAttribute('data-wishlist-flipped', 'true');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
});

test('Steam wishlist fallback remains useful without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const diagnostics = monitorPage(page);
  await page.goto('/');

  await expect(page.locator('[data-wishlist-flip]')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Follow development/u })).toHaveCount(2);

  await page.goto('/project-meridian/');
  await expect(page.locator('.faq-list details[data-faq-item]').first()).toHaveAttribute('name', 'project-faq');

  expectCleanDiagnostics(diagnostics);
  await context.close();
});

test('Steam wishlist tile flips deliberately on touch input', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const diagnostics = monitorPage(page);
  await page.goto('/project-meridian/');

  const tile = page.locator('[data-wishlist-flip]').first();
  const toggle = tile.getByRole('button', { name: /Steam wishlist coming soon/u });
  await toggle.tap();
  await expect(tile).toHaveAttribute('data-wishlist-flipped', 'true');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(tile.getByRole('link', { name: /Follow development/u })).toHaveAttribute('href', '/updates/');

  expectCleanDiagnostics(diagnostics);
  await context.close();
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

  allowExpectedNavigationCancellation(page, '/');
  await page.getByRole('link', { name: 'Dead Signal Works', exact: true }).click();
  await expect(page).toHaveURL(`${localOrigin}/`);
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
  const incomingAnimation = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement, '::view-transition-new(site-main)');
    return {
      animationName: style.animationName,
      duration: style.animationDuration,
      filter: style.filter,
    };
  });
  expect(incomingAnimation.animationName).toBe('route-page-in');
  expect(incomingAnimation.duration).toBe('0.28s');
  expect(incomingAnimation.filter).toBe('none');
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

test('Meridian subsystem navigation retains its specialized transition state for every subsystem', async ({ page }) => {
  for (const slug of ['penumbra', 'cairn', 'wavefront', 'alluvium']) {
    await page.goto('/meridian/');
    const card = page.locator(`[data-subsystem-transition="${slug}"]`);
    await card.scrollIntoViewIfNeeded();
    await expectStableLayout(card);
    await page.evaluate(() => {
      const state = globalThis as typeof globalThis & { __sawSubsystemTransition?: string };
      state.__sawSubsystemTransition = '';
      document.addEventListener('astro:before-swap', () => {
        state.__sawSubsystemTransition = document.documentElement.dataset.subsystemTransition ?? '';
      }, { once: true });
    });
    allowExpectedNavigationCancellation(page, `/meridian/${slug}/`);
    await card.click();
    await expect(page).toHaveURL(`${localOrigin}/meridian/${slug}/`);
    expect(await page.evaluate(() => (
      globalThis as typeof globalThis & { __sawSubsystemTransition?: string }
    ).__sawSubsystemTransition)).toBe(slug);

    await page.evaluate(() => {
      const state = globalThis as typeof globalThis & { __sawSubsystemBack?: boolean };
      state.__sawSubsystemBack = false;
      document.addEventListener('astro:before-swap', () => {
        state.__sawSubsystemBack = document.documentElement.dataset.subsystemDirection === 'back';
      }, { once: true });
    });
    allowExpectedNavigationCancellation(page, '/meridian/');
    await page.locator('[data-subsystem-back]').click();
    await expect(page).toHaveURL(`${localOrigin}/meridian/`);
    expect(await page.evaluate(() => (
      globalThis as typeof globalThis & { __sawSubsystemBack?: boolean }
    ).__sawSubsystemBack)).toBe(true);
  }
});

test('Meridian subsystem history traversal preserves specialized back and forward transitions', async ({ page }) => {
  await page.goto('/meridian/');
  const card = page.locator('[data-subsystem-transition="penumbra"]');
  await card.scrollIntoViewIfNeeded();
  await expectStableLayout(card);
  allowExpectedNavigationCancellation(page, '/meridian/penumbra/');
  await card.click();
  await expect(page).toHaveURL(`${localOrigin}/meridian/penumbra/`);

  await page.goBack();
  await expect(page).toHaveURL(`${localOrigin}/meridian/`);
  await expect.poll(() => page.evaluate(() => (
    document.documentElement.dataset.subsystemTransition ?? ''
  ))).toBe('');
  await page.evaluate(() => {
    const state = globalThis as typeof globalThis & {
      __subsystemForwardEvent?: { direction: string; navigationType: string; path: string; cardCount: number; slug: string };
    };
    state.__subsystemForwardEvent = { direction: '', navigationType: '', path: '', cardCount: 0, slug: '' };
    document.addEventListener('astro:before-preparation', (event) => {
      const navigation = event as Event & {
        direction?: string;
        navigationType?: string;
        to?: URL;
      };
      state.__subsystemForwardEvent = {
        direction: navigation.direction ?? '',
        navigationType: navigation.navigationType ?? '',
        path: navigation.to?.pathname ?? '',
        cardCount: document.querySelectorAll('[data-subsystem-transition="penumbra"]').length,
        slug: document.documentElement.dataset.subsystemTransition ?? '',
      };
    }, { once: true });
  });

  await page.goForward();
  await expect(page).toHaveURL(`${localOrigin}/meridian/penumbra/`);
  const forwardEvent = await page.evaluate(() => (
    globalThis as typeof globalThis & {
      __subsystemForwardEvent?: { direction: string; navigationType: string; path: string; cardCount: number; slug: string };
    }
  ).__subsystemForwardEvent);
  expect(forwardEvent).toMatchObject({
    direction: 'forward',
    navigationType: 'traverse',
    path: '/meridian/penumbra/',
    slug: 'penumbra',
  });
  expect(forwardEvent?.cardCount).toBeGreaterThan(0);
});

test('Meridian subsystem cards remain navigable on a narrow touch viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/meridian/');
  const card = page.locator('[data-subsystem-transition="alluvium"]');
  await card.scrollIntoViewIfNeeded();
  await expectStableLayout(card);
  allowExpectedNavigationCancellation(page, '/meridian/alluvium/');
  await card.click();
  await expect(page).toHaveURL(`${localOrigin}/meridian/alluvium/`);
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

test('Alchemist is a first-class project with software metadata and public project links', async ({ page }) => {
  await page.goto('/alchemist/');
  await expect(page.getByRole('heading', { level: 1, name: 'Alchemist' })).toBeVisible();
  await expect(page.getByLabel('Alchemist project facts').getByText('AGPL-3.0-or-later', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Read the documentation/u }).first()).toHaveAttribute('href', '/alchemist/docs/');
  const structuredData = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent() ?? '{}') as Record<string, unknown>;
  expect(structuredData['@type']).toBe('SoftwareApplication');
  expect(structuredData.operatingSystem).toContain('Linux');
  expect(structuredData.license).toBe('https://www.gnu.org/licenses/agpl-3.0.html');
});

test('Alchemist project pages use the shared Dead Signal Works theme', async ({ page }) => {
  const projectTheme = async () => page.locator('.meridian-hero').evaluate((hero) => {
    const primaryAction = hero.querySelector('.action-primary');
    const sectionNumber = hero.querySelector('.section-number');
    if (!(primaryAction instanceof HTMLElement) || !(sectionNumber instanceof HTMLElement)) {
      throw new Error('Expected the shared project-page theme controls.');
    }
    return {
      actionBackground: getComputedStyle(primaryAction).backgroundColor,
      actionColor: getComputedStyle(primaryAction).color,
      sectionNumberColor: getComputedStyle(sectionNumber).color,
    };
  });

  await page.goto('/meridian/');
  const meridianTheme = await projectTheme();
  await page.goto('/alchemist/');
  expect(await projectTheme()).toEqual(meridianTheme);

  await page.goto('/');
  const [engineAction, alchemistAction] = await Promise.all([
    page.locator('#engine .action-primary').evaluate((element) => getComputedStyle(element).backgroundColor),
    page.locator('#software .action-primary').evaluate((element) => getComputedStyle(element).backgroundColor),
  ]);
  expect(alchemistAction).toBe(engineAction);
});

test('Alchemist overview is rendered at the documentation root with visible license and source identity', async ({ page }) => {
  await page.goto('/alchemist/docs/');
  await expect(page.getByRole('heading', { level: 1, name: 'Alchemist.' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'What it does' })).toBeVisible();
  await expect(page.locator('link[rel="license"]')).toHaveAttribute('href', 'https://creativecommons.org/licenses/by-sa/4.0/');
  await expect(page.locator('.docs-license')).toContainText('Documentation © Brooklyn Halmstad');
  await expect(page.locator('.docs-license')).toContainText('A Dead Signal Works project');
  await expect(page.locator('[data-docs-product="alchemist"]')).toHaveCount(1);
});

test('Alchemist documentation search is isolated from Meridian', async ({ page }) => {
  await page.goto('/alchemist/docs/hardware/');
  const searchTrigger = page.getByRole('button', { name: /Search docs/u });
  await expect(searchTrigger).toHaveAttribute('data-search-ready', 'true');
  await searchTrigger.click();
  const dialog = page.getByRole('dialog', { name: 'Find a page.' });
  await expect(dialog.getByText('Alchemist documentation')).toBeVisible();
  const input = dialog.getByLabel('Search terms');
  await expect(input).toHaveAttribute('placeholder', /NVENC/u);
  await input.fill('NVENC');
  await expect(dialog.locator('.docs-search-results a').first()).toBeVisible();
  const resultPaths = await dialog.locator('.docs-search-results a').evaluateAll((links) => links.map((link) => new URL((link as HTMLAnchorElement).href).pathname));
  expect(resultPaths.length).toBeGreaterThan(0);
  for (const path of resultPaths) expect(path.startsWith('/alchemist/docs/')).toBe(true);
  expect(resultPaths.some((path) => path.startsWith('/meridian/docs/'))).toBe(false);
});

test('Alchemist generated contracts are published and the manifest describes the mirror', async ({ request, browserName }) => {
  test.skip(browserName !== 'chromium', 'Generated publication contracts are browser-independent.');
  const manifestResponse = await request.get('/alchemist/docs/source-manifest.json');
  expect(manifestResponse.status()).toBe(200);
  const manifest = await manifestResponse.json() as {
    schemaVersion: number;
    sourceRevision: string;
    sourceContentSha256: string;
    fileCount: number;
    files: Array<{ sourcePath: string; outputPath: string; sha256: string }>;
  };
  expect(manifest.schemaVersion).toBe(1);
  expect(manifest.sourceRevision).toMatch(/^[0-9a-f]{40}$/u);
  expect(manifest.sourceContentSha256).toMatch(/^[0-9a-f]{64}$/u);
  expect(manifest.fileCount).toBe(48);
  expect(manifest.files).toHaveLength(50);
  expect(manifest.files.some((file) => file.outputPath === 'public/alchemist/docs/openapi.yaml')).toBe(true);
  const openApiResponse = await request.get('/alchemist/docs/openapi.yaml');
  expect(openApiResponse.status()).toBe(200);
  expect(await openApiResponse.text()).toContain('openapi:');
});

test('Alchemist documentation remains readable and navigable without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const diagnostics = monitorPage(page);
  await page.goto('/alchemist/docs/hardware/nvidia/');
  await expect(page.getByRole('heading', { level: 1, name: 'NVIDIA' })).toBeVisible();
  const docsMenu = page.locator('details.docs-mobile-menu');
  await docsMenu.locator('summary').click();
  await expect(docsMenu.getByRole('link', { name: 'NVIDIA', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.docs-pagination')).toBeVisible();
  expectCleanDiagnostics(diagnostics);
  await context.close();
});

test('documentation sidebar keeps its scroll position while current-page semantics update', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 700 });
  await page.goto('/meridian/docs/learn/current-status/');
  const sidebar = page.locator('.docs-sidebar');
  await sidebar.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const initialScroll = await sidebar.evaluate((element) => element.scrollTop);
  expect(initialScroll).toBeGreaterThan(0);

  const target = sidebar.locator('a').last();
  const targetHref = await target.getAttribute('href');
  expect(targetHref).toBeTruthy();
  if (!targetHref) return;
  allowExpectedNavigationCancellation(page, targetHref);
  await target.click();
  await expect(page).toHaveURL(`${localOrigin}${targetHref}`);
  await expect(page.locator(`.docs-sidebar a[href="${targetHref}"]`)).toHaveAttribute('aria-current', 'page');
  await expect.poll(() => page.locator('.docs-sidebar').evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
});

test('documentation breadcrumbs expose an ordered hierarchy', async ({ page }) => {
  await page.goto('/meridian/docs/learn/current-status/');
  const breadcrumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
  await expect(breadcrumbs.locator('ol')).toHaveCount(1);
  await expect(breadcrumbs.locator('li')).toHaveCount(2);
  await expect(breadcrumbs.locator('[aria-current="page"]')).toHaveText('Learn');
});

test('Alchemist documentation keeps product-specific sidebar and breadcrumb state', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 700 });
  await page.goto('/alchemist/docs/hardware/nvidia/');
  const breadcrumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
  await expect(breadcrumbs.getByRole('link', { name: 'Alchemist docs' })).toHaveAttribute('href', '/alchemist/docs/');
  await expect(breadcrumbs.locator('[aria-current="page"]')).toHaveText('Hardware');

  const sidebar = page.locator('.docs-sidebar');
  await sidebar.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const initialScroll = await sidebar.evaluate((element) => element.scrollTop);
  expect(initialScroll).toBeGreaterThan(0);
  const target = sidebar.getByRole('link', { name: 'Development Setup', exact: true });
  await expect(target).toHaveAttribute('href', '/alchemist/docs/contributing/development/');
  allowExpectedNavigationCancellation(page, '/alchemist/docs/contributing/development/');
  await target.click();
  await expect(page).toHaveURL(`${localOrigin}/alchemist/docs/contributing/development/`);
  await expect(page.locator('.docs-sidebar a[href="/alchemist/docs/contributing/development/"]')).toHaveAttribute('aria-current', 'page');
  await expect.poll(() => page.locator('.docs-sidebar').evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
});

test('mobile navigation and workbench stay inside the viewport', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const diagnostics = monitorPage(page);
  await page.goto('/');

  const menu = page.locator('.mobile-nav');
  await menu.locator('summary').click();
  await expect(menu).toHaveAttribute('open', '');
  await expect(menu.getByRole('link', { name: 'Press information' })).toBeVisible();
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

test('successful project sharing can be followed by immediate client navigation', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.resolve() },
    });
  });
  await page.goto('/project-meridian/');
  await page.getByRole('button', { name: /Share project/u }).click();
  await expect(page.getByRole('status')).toHaveText('Project link copied.');
  allowExpectedNavigationCancellation(page, '/studio/');
  await page.getByRole('navigation', { name: 'Primary navigation' })
    .getByRole('link', { name: 'Studio', exact: true })
    .click();
  await expect(page).toHaveURL(`${localOrigin}/studio/`);
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
    await expect(items.nth(0)).not.toHaveAttribute('name', 'project-faq');
    await expect(items.nth(0)).toHaveAttribute('open', '');
    await expect(firstSummary).toHaveCSS('min-height', '64px');

    await secondSummary.click();
    await expect(page).toHaveURL(initialUrl);
    await expect(items.nth(0)).not.toHaveAttribute('open', '');
    await expect(items.nth(1)).toHaveAttribute('open', '');
    await expect(items.nth(1).locator('.faq-answer')).toBeVisible();

    const remainedOpenDuringClose = await secondSummary.evaluate((summary) => {
      (summary as HTMLElement).click();
      return (summary.parentElement as HTMLDetailsElement | null)?.open ?? false;
    });
    expect(remainedOpenDuringClose).toBe(true);
    await expect(page).toHaveURL(initialUrl);
    await expect(items.nth(1)).not.toHaveAttribute('open', '');
  }
});

test('Project Meridian FAQ remains single-bound after repeated client-router visits', async ({ page }) => {
  await page.goto('/project-meridian/');
  for (let index = 0; index < 3; index += 1) {
    allowExpectedNavigationCancellation(page, '/studio/');
    await page.getByRole('navigation', { name: 'Primary navigation' })
      .getByRole('link', { name: 'Studio', exact: true })
      .click();
    await expect(page).toHaveURL(`${localOrigin}/studio/`);
    allowExpectedNavigationCancellation(page, '/project-meridian/');
    await page.getByRole('navigation', { name: 'Primary navigation' })
      .getByRole('link', { name: 'Project Meridian', exact: true })
      .click();
    await expect(page).toHaveURL(`${localOrigin}/project-meridian/`);
  }

  const items = page.locator('.faq-list details[data-faq-item]');
  await items.nth(1).locator('summary').click();
  await expect(items.nth(0)).not.toHaveAttribute('open', '');
  await expect(items.nth(1)).toHaveAttribute('open', '');
  expect(await items.evaluateAll((details) => details.filter((item) => item.hasAttribute('open')).length)).toBe(1);
});

test('Project Meridian FAQ closes immediately when reduced motion is requested', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/project-meridian/');
  const first = page.locator('.faq-list details[data-faq-item]').first();
  const openAfterClick = await first.locator('summary').evaluate((summary) => {
    (summary as HTMLElement).click();
    return (summary.parentElement as HTMLDetailsElement | null)?.open ?? true;
  });
  expect(openAfterClick).toBe(false);
});

test('updates expose RSS discovery and omit empty article pagination', async ({ page }) => {
  await page.goto('/updates/');
  await expect(page.getByRole('link', { name: /Follow by RSS/u })).toHaveAttribute('href', '/rss.xml');
  const firstUpdate = page.locator('.updates-list > a').first();
  const updateHref = await firstUpdate.getAttribute('href');
  expect(updateHref).toBeTruthy();
  if (!updateHref) return;
  allowExpectedNavigationCancellation(page, updateHref);
  await firstUpdate.click();
  await expect(page).toHaveURL(`${localOrigin}${updateHref}`);
  await expect(page.getByRole('navigation', { name: 'Updates navigation' })).toHaveCount(0);
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
  { name: 'alchemist', route: '/alchemist/' },
  { name: 'alchemist-docs', route: '/alchemist/docs/hardware/' },
  { name: 'updates', route: '/updates/' },
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

test('reduced-motion preference disables smooth scrolling and workbench transitions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');

  const pageValues = await page.evaluate(() => ({
    scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
    transitionDuration: getComputedStyle(document.querySelector('.workbench-drawer')!).transitionDuration,
  }));
  expect(pageValues.scrollBehavior).toBe('auto');
  expect(Math.max(...pageValues.transitionDuration.split(',').map((value) => Number.parseFloat(value)))).toBeLessThanOrEqual(0.001);
});

test('reduced-motion preference flattens the Project Meridian wishlist control', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/project-meridian/');
  const wishlistValues = await page.evaluate(() => ({
    transform: getComputedStyle(document.querySelector('.wishlist-flip-inner')!).transform,
    backPosition: getComputedStyle(document.querySelector('.wishlist-flip-back')!).position,
  }));
  expect(wishlistValues.transform).toBe('none');
  expect(wishlistValues.backPosition).toBe('static');
});
