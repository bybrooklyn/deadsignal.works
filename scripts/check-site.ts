import { createHash } from 'node:crypto';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { docsItems } from '../src/data/docs';
import { alchemistDocumentation } from '../src/data/alchemistDocs';
import { docsSnapshot } from '../src/data/docsSnapshot';
import { site } from '../src/data/site';
import { subsystems } from '../src/data/subsystems';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

// These are regression ceilings derived from the audited static build. They are
// guardrails against accidental global hydration, not product performance claims.
const performanceBudgets = {
  simpleInitialScriptBytes: 32 * 1024,
  transitionInitialScriptBytes: 40 * 1024,
  // The shared read-only WebMCP registration adds one bundled capability to
  // every page; keep the allowance narrow and explicit.
  docsInitialScriptBytes: 226 * 1024,
  // The native-share recovery route adds one bounded interactive state to the
  // Project Meridian island; leave room for that explicit accessibility path.
  homeAndProjectInitialScriptBytes: 306 * 1024,
  meridianInitialScriptBytes: 306 * 1024,
  initialStylesheetBytes: 96 * 1024,
  emittedApplicationScriptBytes: 200 * 1024,
} as const;

const allowedHydrations = new Set([
  'src/components/DocsToolbar.astro:DocsSearch:load',
  'src/pages/index.astro:StudioWorkbench:load',
  'src/pages/meridian.astro:MotionSubsystemGrid:visible',
  'src/pages/project-meridian.astro:KineticProjectHero:load',
]);

interface HtmlTag {
  raw: string;
  attributes: Record<string, string>;
}

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }
  return files;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function tags(html: string, tagName: string): HtmlTag[] {
  const pattern = new RegExp(`<${escapeRegExp(tagName)}\\b[^>]*>`, 'giu');
  return [...html.matchAll(pattern)].map(([raw]) => {
    const attributes: Record<string, string> = {};
    for (const match of raw.matchAll(/([:\w-]+)="([^"]*)"/gu)) attributes[match[1].toLowerCase()] = match[2];
    return { raw, attributes };
  });
}

function metaContent(html: string, key: 'name' | 'property', value: string): string | undefined {
  return tags(html, 'meta').find((tag) => tag.attributes[key] === value)?.attributes.content;
}

function linkHref(html: string, rel: string, type?: string): string | undefined {
  return tags(html, 'link').find((tag) => (
    tag.attributes.rel?.split(/\s+/u).includes(rel)
    && (!type || tag.attributes.type === type)
  ))?.attributes.href;
}

function routeCandidates(pathname: string): string[] {
  const decoded = decodeURIComponent(pathname);
  if (decoded === '/') return [join(root, 'index.html')];
  const clean = decoded.replace(/^\//u, '').replace(/\/$/u, '');
  if (extname(clean)) return [join(root, clean)];
  return [join(root, `${clean}.html`), join(root, clean, 'index.html')];
}

async function firstExisting(paths: string[]): Promise<string | undefined> {
  for (const path of paths) if (await exists(path)) return path;
  return undefined;
}

async function scriptGraphBytes(publicPaths: Iterable<string>): Promise<{ bytes: number; missing: string[] }> {
  const visited = new Set<string>();
  const missing: string[] = [];
  let bytes = 0;

  const visit = async (publicPath: string): Promise<void> => {
    if (visited.has(publicPath)) return;
    visited.add(publicPath);
    const assetPath = join(root, publicPath.replace(/^\//u, ''));
    if (!(await exists(assetPath))) {
      missing.push(publicPath);
      return;
    }

    const source = await readFile(assetPath, 'utf8');
    bytes += Buffer.byteLength(source);
    for (const match of source.matchAll(/(?:from\s*|import\s*\(\s*)["'](\.\.?\/[^"']+)["']/gu)) {
      const dependency = new URL(match[1], new URL(publicPath, site.url)).pathname;
      await visit(dependency);
    }
  };

  for (const publicPath of publicPaths) await visit(publicPath);
  return { bytes, missing };
}

function outputRouteFromSourcePage(file: string): string | undefined {
  const path = relative(join(sourceRoot, 'pages'), file).split(sep).join('/');
  if (path.includes('[')) return undefined;
  const withoutExtension = path.replace(/\.(?:astro|ts)$/u, '');
  if (withoutExtension === 'index') return 'index.html';
  if (withoutExtension === '404') return '404.html';
  if (extname(withoutExtension)) return withoutExtension;
  if (withoutExtension.endsWith('/index')) return `${withoutExtension.slice(0, -'/index'.length)}/index.html`;
  return `${withoutExtension}/index.html`;
}

function outputRouteFromUrl(pathname: string): string {
  const clean = pathname.replace(/^\//u, '').replace(/\/$/u, '');
  return clean ? `${clean}/index.html` : 'index.html';
}

function publicPathFromOutputRoute(outputPath: string): string {
  if (outputPath === 'index.html') return '/';
  if (outputPath.endsWith('/index.html')) return `/${outputPath.slice(0, -'index.html'.length)}`;
  if (outputPath.endsWith('.html')) return `/${outputPath.slice(0, -'.html'.length)}/`;
  throw new Error(`Cannot derive a public page path from ${outputPath}`);
}

function scriptBudgetFor(outputPath: string, html: string): number {
  if (/^(?:meridian|alchemist)\/docs\//u.test(outputPath)) return performanceBudgets.docsInitialScriptBytes;
  if (outputPath === 'index.html' || outputPath === 'project-meridian/index.html') {
    return performanceBudgets.homeAndProjectInitialScriptBytes;
  }
  if (outputPath === 'meridian/index.html') return performanceBudgets.meridianInitialScriptBytes;
  if (html.includes('astro-view-transitions-enabled')) return performanceBudgets.transitionInitialScriptBytes;
  return performanceBudgets.simpleInitialScriptBytes;
}

function sha256(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function nestedStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(nestedStrings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(nestedStrings);
  return [];
}

function pngSize(buffer: Buffer): { width: number; height: number } | undefined {
  const signature = '89504e470d0a1a0a';
  if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== signature) return undefined;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const failures = new Set<string>();
const files = await walk(root);
const htmlFiles = files.filter((file) => file.endsWith('.html'));
const sourceFiles = (await walk(sourceRoot)).filter((file) => /\.(?:astro|css|md|mdx|ts|tsx)$/u.test(file));
const sourcePageFiles = (await walk(join(sourceRoot, 'pages'))).filter((file) => /\.(?:astro|ts)$/u.test(file));
const docsSourceRoot = join(sourceRoot, 'content', 'docs');
const docsSourceFiles = (await walk(docsSourceRoot)).filter((file) => /\.(?:md|mdx)$/u.test(file));
const alchemistDocsSourceRoot = join(sourceRoot, 'content', 'alchemist-docs');
const alchemistDocsSourceFiles = (await walk(alchemistDocsSourceRoot)).filter((file) => file.endsWith('.md'));
const updateSourceRoot = join(sourceRoot, 'content', 'updates');
const updateSourceFiles = (await walk(updateSourceRoot)).filter((file) => /\.md$/u.test(file));
const siteData = await readFile(join(sourceRoot, 'data', 'site.ts'), 'utf8');
const engineSourcePublic = /engineSourcePublic:\s*true/u.test(siteData);
const htmlCache = new Map<string, string>();
const discoveredHydrations = new Set<string>();

for (const file of sourceFiles) {
  const source = await readFile(file, 'utf8');
  const sourcePath = relative(repositoryRoot, file).split(sep).join('/');
  if (/text-transform:\s*uppercase/iu.test(source)) failures.add(`${sourcePath}: forced uppercase styling`);
  if (/dangerouslySetInnerHTML|\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML\s*\(|document\.write\s*\(|document\.writeln\s*\(|\beval\s*\(|new Function\s*\(/u.test(source)) {
    failures.add(`${sourcePath}: contains a prohibited browser injection or string-to-code sink`);
  }
  if (/\/Users\//u.test(source)) failures.add(`${sourcePath}: contains a personal absolute path`);
  for (const match of source.matchAll(/<([A-Z][\w]*)\b[^>]*\bclient:([\w-]+)\b[^>]*>/gsu)) {
    discoveredHydrations.add(`${sourcePath}:${match[1]}:${match[2]}`);
  }
}

for (const hydration of discoveredHydrations) {
  if (!allowedHydrations.has(hydration)) failures.add(`unapproved client hydration surface: ${hydration}`);
}
for (const hydration of allowedHydrations) {
  if (!discoveredHydrations.has(hydration)) failures.add(`expected client hydration surface is missing: ${hydration}`);
}

const remainingJavaScriptSources = (await walk(repositoryRoot)).filter((file) => (
  !file.includes(`${sep}node_modules${sep}`)
  && !file.includes(`${sep}dist${sep}`)
  && !file.includes(`${sep}.astro${sep}`)
  && !file.includes(`${sep}.git${sep}`)
  && !file.includes(`${sep}.wrangler${sep}`)
  && !file.includes(`${sep}playwright-report${sep}`)
  && !file.includes(`${sep}test-results${sep}`)
  && /\.(?:js|mjs|cjs)$/u.test(file)
));
for (const file of remainingJavaScriptSources) {
  failures.add(`${relative(repositoryRoot, file)}: source JavaScript remains; use TypeScript or an Astro script`);
}

const navIds = docsItems.map((item) => item.id);
const navHrefs = docsItems.map((item) => item.href);
if (new Set(navIds).size !== navIds.length) failures.add('documentation navigation contains duplicate IDs');
if (new Set(navHrefs).size !== navHrefs.length) failures.add('documentation navigation contains duplicate routes');

const docsSourceIds = docsSourceFiles.map((file) => relative(docsSourceRoot, file)
  .split(sep)
  .join('/')
  .replace(/\.(?:md|mdx)$/u, '')
  .replace(/\/index$/u, ''));
for (const id of navIds) if (!docsSourceIds.includes(id)) failures.add(`documentation navigation has no content entry for ${id}`);
for (const id of docsSourceIds) if (!navIds.includes(id)) failures.add(`documentation content is missing from navigation: ${id}`);

const alchemistNavIds = alchemistDocumentation.items.map((item) => item.id);
const alchemistNavHrefs = alchemistDocumentation.items.map((item) => item.href);
if (new Set(alchemistNavIds).size !== alchemistNavIds.length) failures.add('Alchemist documentation navigation contains duplicate IDs');
if (new Set(alchemistNavHrefs).size !== alchemistNavHrefs.length) failures.add('Alchemist documentation navigation contains duplicate routes');
const alchemistDocsSourceIds = alchemistDocsSourceFiles.map((file) => relative(alchemistDocsSourceRoot, file)
  .split(sep)
  .join('/')
  .replace(/\.md$/u, '')
  .replace(/\/index$/u, ''));
for (const id of alchemistNavIds) if (!alchemistDocsSourceIds.includes(id)) failures.add(`Alchemist documentation navigation has no content entry for ${id}`);
for (const id of alchemistDocsSourceIds) if (!alchemistNavIds.includes(id)) failures.add(`Alchemist documentation content is missing from navigation: ${id}`);

interface AlchemistSourceManifest {
  schemaVersion: number;
  sourceRepository: string;
  sourceRevision: string;
  sourceContentSha256: string;
  version: string;
  fileCount: number;
  files: Array<{ sourcePath: string; outputPath: string; sha256: string }>;
}

const alchemistManifestPath = join(repositoryRoot, 'public', 'alchemist', 'docs', 'source-manifest.json');
const alchemistManifest = JSON.parse(await readFile(alchemistManifestPath, 'utf8')) as AlchemistSourceManifest;
if (alchemistManifest.schemaVersion !== 1) failures.add(`Alchemist source manifest schema ${alchemistManifest.schemaVersion} is unsupported`);
if (alchemistManifest.sourceRepository !== alchemistDocumentation.sourceRepository) failures.add('Alchemist source manifest repository differs from the documentation product registry');
if (!/^[0-9a-f]{40}$/u.test(alchemistManifest.sourceRevision)) failures.add('Alchemist source manifest revision is not a full Git revision');
if (!/^[0-9a-f]{64}$/u.test(alchemistManifest.sourceContentSha256)) failures.add('Alchemist source manifest source digest is invalid');
if (alchemistManifest.fileCount !== alchemistDocsSourceFiles.length) failures.add(`Alchemist source manifest declares ${alchemistManifest.fileCount} pages but the mirror has ${alchemistDocsSourceFiles.length}`);
const alchemistManifestOutputs = new Map(alchemistManifest.files.map((record) => [record.outputPath, record]));
if (alchemistManifestOutputs.size !== alchemistManifest.files.length) failures.add('Alchemist source manifest contains duplicate output paths');
for (const file of alchemistDocsSourceFiles) {
  const outputPath = relative(repositoryRoot, file).split(sep).join('/');
  const source = await readFile(file, 'utf8');
  const record = alchemistManifestOutputs.get(outputPath);
  if (!record) {
    failures.add(`${outputPath}: generated Alchemist page is absent from the source manifest`);
    continue;
  }
  if (!/^generated:\s*true\s*$/mu.test(source)) failures.add(`${outputPath}: generated marker is missing`);
  const sourcePath = source.match(/^sourcePath:\s*["']?([^"'\n]+)["']?\s*$/mu)?.[1];
  const sourceRevision = source.match(/^sourceRevision:\s*([0-9a-f]+)\s*$/mu)?.[1];
  if (sourcePath !== record.sourcePath) failures.add(`${outputPath}: source path differs from the manifest`);
  if (sourceRevision !== alchemistManifest.sourceRevision) failures.add(`${outputPath}: source revision differs from the manifest`);
  if (sha256(source) !== record.sha256) failures.add(`${outputPath}: output SHA-256 differs from the manifest`);
}
for (const record of alchemistManifest.files) {
  const outputFile = join(repositoryRoot, record.outputPath);
  if (!(await exists(outputFile))) {
    failures.add(`Alchemist source manifest references missing ${record.outputPath}`);
    continue;
  }
  if (sha256(await readFile(outputFile)) !== record.sha256) failures.add(`${record.outputPath}: output SHA-256 differs from the manifest`);
}
for (const outputPath of [
  'public/alchemist/docs/openapi.yaml',
  'public/alchemist/social-card.png',
  ...alchemistDocsSourceFiles.map((file) => relative(repositoryRoot, file).split(sep).join('/')),
]) {
  if (!alchemistManifestOutputs.has(outputPath)) failures.add(`${outputPath}: generated Alchemist output is absent from the source manifest`);
}
const sourceBackedDocumentIds = new Set<string>(docsSnapshot.sourceBackedDocumentIds);
if (sourceBackedDocumentIds.size !== docsSnapshot.sourceBackedDocumentIds.length) {
  failures.add('approved docs snapshot contains duplicate source-backed document IDs');
}
if (sourceBackedDocumentIds.size !== 13) {
  failures.add(`approved docs snapshot declares ${sourceBackedDocumentIds.size} source-backed documents instead of 13`);
}
for (const id of sourceBackedDocumentIds) {
  if (!docsSourceIds.includes(id)) failures.add(`approved docs snapshot references missing document ${id}`);
}

for (const file of docsSourceFiles) {
  const source = await readFile(file, 'utf8');
  const id = relative(docsSourceRoot, file)
    .split(sep)
    .join('/')
    .replace(/\.(?:md|mdx)$/u, '')
    .replace(/\/index$/u, '');
  const item = docsItems.find((entry) => entry.id === id);
  const title = source.match(/^title:\s*(.+)$/mu)?.[1]?.replace(/^['"]|['"]$/gu, '');
  const hasUpdated = /^updated:/mu.test(source);
  const hasSourceRevision = /^sourceRevision:/mu.test(source);
  const isSourceBacked = sourceBackedDocumentIds.has(id);
  if (item && title !== item.label) failures.add(`${id}: content title and navigation label differ`);
  if (/^(?:group|order):/mu.test(source)) failures.add(`${id}: group/order duplicates the typed documentation registry`);
  if (isSourceBacked) {
    if (!new RegExp(`^updated:\\s*${escapeRegExp(docsSnapshot.updated)}\\s*$`, 'mu').test(source)) {
      failures.add(`${id}: updated date does not match the approved docs snapshot`);
    }
    if (!new RegExp(`^sourceRevision:\\s*${escapeRegExp(docsSnapshot.revision)}\\s*$`, 'mu').test(source)) {
      failures.add(`${id}: source revision does not match the approved docs snapshot`);
    }
    for (const match of source.matchAll(/https:\/\/github\.com\/bybrooklyn\/meridian\/(?:blob|tree)\/([0-9a-f]{7,40})(?:\/|$)/gu)) {
      if (match[1] !== docsSnapshot.revision) {
        failures.add(`${id}: source link revision ${match[1]} does not match the approved docs snapshot`);
      }
    }
  } else if (hasUpdated || hasSourceRevision) {
    failures.add(`${id}: planned/stub documentation must not carry source snapshot provenance`);
  }
}

const requiredRoutes = new Set<string>();
for (const file of sourcePageFiles) {
  const route = outputRouteFromSourcePage(file);
  if (route) requiredRoutes.add(route);
}
for (const item of docsItems) requiredRoutes.add(outputRouteFromUrl(item.href));
for (const item of alchemistDocumentation.items) requiredRoutes.add(outputRouteFromUrl(item.href));
for (const subsystem of subsystems) requiredRoutes.add(outputRouteFromUrl(`/meridian/${subsystem.slug}`));
for (const file of updateSourceFiles) {
  const id = relative(updateSourceRoot, file).split(sep).join('/').replace(/\.md$/u, '');
  requiredRoutes.add(outputRouteFromUrl(`/updates/${id}`));
}

for (const route of requiredRoutes) {
  if (!(await exists(join(root, route)))) failures.add(`missing generated route ${route}`);
}

const titles = new Map<string, string>();
const descriptions = new Map<string, string>();
const canonicals = new Map<string, string>();
const publicCanonicals = new Set<string>();
const currentStatusOutputPath = 'meridian/docs/learn/current-status/index.html';
const siteBuildTimestamps = new Set<string>();
let siteBuildPageCount = 0;
const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8');
  htmlCache.set(file, html);
  const outputPath = relative(root, file).split(sep).join('/');
  const title = html.match(/<title>([^<]+)<\/title>/iu)?.[1];
  const description = metaContent(html, 'name', 'description');
  const canonical = linkHref(html, 'canonical');
  const ogImage = metaContent(html, 'property', 'og:image');
  const expectedCanonical = new URL(publicPathFromOutputRoute(outputPath), site.url).toString();

  if (!/<html\s+lang="en">/iu.test(html)) failures.add(`${outputPath}: missing document language`);
  if (!title) failures.add(`${outputPath}: missing title`);
  if (!description) failures.add(`${outputPath}: missing description`);
  if (canonical !== expectedCanonical) failures.add(`${outputPath}: canonical URL ${canonical ?? '(missing)'} does not match ${expectedCanonical}`);
  if (metaContent(html, 'property', 'og:url') !== expectedCanonical) failures.add(`${outputPath}: Open Graph URL does not match its canonical URL`);
  if (!/<h1(?:\s|>)/iu.test(html)) failures.add(`${outputPath}: missing level-one heading`);
  const expectedSocialImage = outputPath.startsWith('alchemist/')
    ? `${site.url}/alchemist/social-card.png`
    : `${site.url}/social-card.png`;
  if (ogImage !== expectedSocialImage) failures.add(`${outputPath}: missing expected PNG social image`);
  if (metaContent(html, 'property', 'og:image:type') !== 'image/png') failures.add(`${outputPath}: missing social image type`);
  if (metaContent(html, 'property', 'og:image:width') !== '1200') failures.add(`${outputPath}: missing social image width`);
  if (metaContent(html, 'property', 'og:image:height') !== '630') failures.add(`${outputPath}: missing social image height`);
  if (!metaContent(html, 'property', 'og:image:alt')) failures.add(`${outputPath}: missing social image alt text`);
  if (!metaContent(html, 'name', 'twitter:image:alt')) failures.add(`${outputPath}: missing Twitter image alt text`);
  if (linkHref(html, 'alternate', 'application/rss+xml') !== '/rss.xml') failures.add(`${outputPath}: missing RSS discovery link`);
  if (linkHref(html, 'apple-touch-icon') !== '/apple-touch-icon.png') failures.add(`${outputPath}: missing Apple touch icon`);
  if (linkHref(html, 'manifest') !== '/site.webmanifest') failures.add(`${outputPath}: missing web manifest`);
  if (/^(?:meridian|alchemist)\/docs\//u.test(outputPath)) {
    if (linkHref(html, 'license') !== 'https://creativecommons.org/licenses/by-sa/4.0/') failures.add(`${outputPath}: missing CC BY-SA 4.0 license metadata`);
    if (!html.includes('CC BY-SA 4.0')) failures.add(`${outputPath}: missing visible CC BY-SA 4.0 notice`);
  }
  if (/\/journal(?:\/|&quot;|")/u.test(html)) failures.add(`${outputPath}: stale /journal link`);
  if (/\/meridian\/docs\/(?:subsystems|concepts|developers)(?:\/|&quot;|")/u.test(html)) failures.add(`${outputPath}: stale documentation route`);
  if (/href="#"/u.test(html)) failures.add(`${outputPath}: empty fragment link`);
  if (/text-transform:\s*uppercase/iu.test(html)) failures.add(`${outputPath}: forced uppercase styling`);
  if (/<(?:li|div)[^>]*tabindex="0"/iu.test(html)) failures.add(`${outputPath}: static content was added to the tab order`);
  if (/<[^>]+\son\w+="/iu.test(html)) failures.add(`${outputPath}: inline event-handler attribute`);
  if (!engineSourcePublic && /href="https:\/\/github\.com\/bybrooklyn\/meridian(?:\/|"|#|\?)/iu.test(html)) {
    failures.add(`${outputPath}: public link exposes the private Meridian source repository`);
  }
  const siteBuildMatches = [...html.matchAll(/<time\b(?=[^>]*\bdata-site-build(?:\s|=|>))[^>]*\bdatetime="([^"]+)"[^>]*>/giu)];
  if (/Last updated:/iu.test(html)) failures.add(`${outputPath}: stale global editorial build timestamp`);
  if (outputPath === currentStatusOutputPath) {
    siteBuildPageCount += 1;
    if (!html.includes(`data-docs-snapshot="${docsSnapshot.revision}"`)) {
      failures.add(`${outputPath}: missing approved docs snapshot provenance`);
    }
    if (siteBuildMatches.length !== 1) {
      failures.add(`${outputPath}: expected exactly one technical site-build timestamp`);
    } else {
      const timestamp = siteBuildMatches[0]![1];
      if (!isoTimestampPattern.test(timestamp) || Number.isNaN(Date.parse(timestamp))) {
        failures.add(`${outputPath}: site-build timestamp is not ISO-8601`);
      } else {
        siteBuildTimestamps.add(timestamp);
      }
    }
  } else if (siteBuildMatches.length > 0) {
    failures.add(`${outputPath}: technical site-build provenance belongs only on Current status`);
  }

  const ids = tags(html, '*').flatMap((tag) => tag.attributes.id ? [tag.attributes.id] : []);
  // The wildcard helper cannot match tag names, so collect IDs directly as well.
  const directIds = [...html.matchAll(/\sid="([^"]+)"/gu)].map((match) => match[1]);
  const allIds = ids.length > 0 ? ids : directIds;
  if (new Set(allIds).size !== allIds.length) failures.add(`${outputPath}: duplicate HTML id`);
  const idSet = new Set(allIds);
  for (const tag of [...tags(html, 'button'), ...tags(html, 'summary')]) {
    const controlledId = tag.attributes['aria-controls'];
    if (controlledId && !idSet.has(controlledId)) failures.add(`${outputPath}: aria-controls points to missing #${controlledId}`);
  }

  const jsonLdBlocks = [...html.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/giu)];
  if (jsonLdBlocks.length !== 1) failures.add(`${outputPath}: expected exactly one JSON-LD block`);
  for (const block of jsonLdBlocks) {
    try {
      const jsonLd = JSON.parse(block[1]) as unknown;
      for (const value of nestedStrings(jsonLd)) {
        let url: URL;
        try {
          url = new URL(value);
        } catch {
          continue;
        }
        if (
          url.origin === site.url
          && url.pathname !== '/'
          && !extname(url.pathname)
          && !url.pathname.endsWith('/')
        ) {
          failures.add(`${outputPath}: structured-data URL is not canonical: ${value}`);
        }
      }
    } catch {
      failures.add(`${outputPath}: invalid JSON-LD`);
    }
  }

  if (title) {
    const duplicate = titles.get(title);
    if (duplicate) failures.add(`${outputPath}: duplicate title also used by ${duplicate}`);
    titles.set(title, outputPath);
  }
  if (description) {
    const duplicate = descriptions.get(description);
    if (duplicate) failures.add(`${outputPath}: duplicate description also used by ${duplicate}`);
    descriptions.set(description, outputPath);
  }
  if (canonical) {
    const duplicate = canonicals.get(canonical);
    if (duplicate) failures.add(`${outputPath}: duplicate canonical also used by ${duplicate}`);
    canonicals.set(canonical, outputPath);
    if (metaContent(html, 'name', 'robots') !== 'noindex, nofollow') publicCanonicals.add(canonical);
  }

  for (const anchor of tags(html, 'a')) {
    const href = anchor.attributes.href;
    if (!href) {
      failures.add(`${outputPath}: anchor without href`);
      continue;
    }
    if (anchor.attributes.target === '_blank' && !/(?:^|\s)(?:noreferrer|noopener)(?:\s|$)/u.test(anchor.attributes.rel ?? '')) {
      failures.add(`${outputPath}: target=_blank link lacks rel=noreferrer or noopener`);
    }
    if (/^(?:mailto:|tel:)/u.test(href)) continue;

    let url: URL;
    try {
      url = new URL(href, canonical ?? site.url);
    } catch {
      failures.add(`${outputPath}: invalid link ${href}`);
      continue;
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      failures.add(`${outputPath}: disallowed link protocol ${url.protocol}`);
      continue;
    }
    if (url.origin !== site.url) {
      const isLocalDevelopmentUrl = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if (url.protocol !== 'https:' && !isLocalDevelopmentUrl) failures.add(`${outputPath}: external link is not HTTPS: ${href}`);
      continue;
    }
    if (url.pathname !== '/' && !extname(url.pathname) && !url.pathname.endsWith('/')) {
      failures.add(`${outputPath}: internal page link is not canonical: ${href}`);
    }

    const targetFile = await firstExisting(routeCandidates(url.pathname));
    if (!targetFile) {
      failures.add(`${outputPath}: broken internal link ${href}`);
      continue;
    }
    if (url.hash && targetFile.endsWith('.html')) {
      const targetHtml = htmlCache.get(targetFile) ?? await readFile(targetFile, 'utf8');
      htmlCache.set(targetFile, targetHtml);
      const targetId = decodeURIComponent(url.hash.slice(1));
      if (!new RegExp(`\\sid="${escapeRegExp(targetId)}"`, 'u').test(targetHtml)) {
        failures.add(`${outputPath}: broken fragment ${href}`);
      }
    }
  }

  const scriptPaths = tags(html, 'script').flatMap((tag) => tag.attributes.src?.startsWith('/') ? [tag.attributes.src] : []);
  const modulePreloads = tags(html, 'link').flatMap((tag) => (
    tag.attributes.rel === 'modulepreload' && tag.attributes.href?.startsWith('/') ? [tag.attributes.href] : []
  ));
  const islandScripts = tags(html, 'astro-island').flatMap((tag) => [
    tag.attributes['component-url'],
    tag.attributes['renderer-url'],
  ].filter((path): path is string => Boolean(path?.startsWith('/'))));
  const stylesheetPaths = tags(html, 'link').flatMap((tag) => (
    tag.attributes.rel === 'stylesheet' && tag.attributes.href?.startsWith('/') ? [tag.attributes.href] : []
  ));
  const initialScripts = new Set([...scriptPaths, ...modulePreloads, ...islandScripts]);
  const scriptGraph = await scriptGraphBytes(initialScripts);
  for (const asset of scriptGraph.missing) failures.add(`${outputPath}: missing script asset ${asset}`);
  const inlineScriptBytes = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/giu)]
    .reduce((total, match) => total + Buffer.byteLength(match[1]), 0);
  const initialScriptBytes = scriptGraph.bytes + inlineScriptBytes;
  const scriptBudget = scriptBudgetFor(outputPath, html);
  if (initialScriptBytes > scriptBudget) failures.add(`${outputPath}: initial script budget exceeded (${initialScriptBytes} > ${scriptBudget})`);

  let stylesheetBytes = 0;
  for (const asset of new Set(stylesheetPaths)) {
    const assetPath = join(root, asset.replace(/^\//u, ''));
    if (!(await exists(assetPath))) failures.add(`${outputPath}: missing stylesheet asset ${asset}`);
    else stylesheetBytes += (await stat(assetPath)).size;
  }
  if (stylesheetBytes > performanceBudgets.initialStylesheetBytes) {
    failures.add(`${outputPath}: stylesheet budget exceeded (${stylesheetBytes} > ${performanceBudgets.initialStylesheetBytes})`);
  }
}

if (siteBuildPageCount !== 1) {
  failures.add(`generated pages contain ${siteBuildPageCount} Current status provenance pages`);
}
if (siteBuildTimestamps.size !== 1) {
  failures.add(`generated output contains ${siteBuildTimestamps.size} technical site-build timestamps`);
}

const sitemapCanonicals = new Set<string>();
for (const file of files.filter((path) => /sitemap-\d+\.xml$/u.test(path))) {
  const sitemap = await readFile(file, 'utf8');
  for (const match of sitemap.matchAll(/<loc>([^<]+)<\/loc>/gu)) {
    const loc = match[1];
    if (sitemapCanonicals.has(loc)) failures.add(`sitemap contains duplicate URL ${loc}`);
    sitemapCanonicals.add(loc);
  }
}
for (const canonical of publicCanonicals) {
  if (!sitemapCanonicals.has(canonical)) failures.add(`sitemap is missing canonical URL ${canonical}`);
}
for (const loc of sitemapCanonicals) {
  if (!publicCanonicals.has(loc)) failures.add(`sitemap contains non-canonical URL ${loc}`);
}

const rssXml = await readFile(join(root, 'rss.xml'), 'utf8');
for (const match of rssXml.matchAll(/<(?:link|guid)(?:\s[^>]*)?>(https:\/\/deadsignal\.works\/[^<]*)<\/(?:link|guid)>/gu)) {
  const url = new URL(match[1]);
  if (url.pathname !== '/' && !extname(url.pathname) && !url.pathname.endsWith('/')) {
    failures.add(`RSS contains non-canonical page URL ${url.toString()}`);
  }
}

for (const file of files.filter((path) => path.endsWith('.map'))) failures.add(`${relative(root, file)}: public source map`);
for (const file of files.filter((path) => path.includes(`${sep}_astro${sep}`) && path.endsWith('.js'))) {
  const size = (await stat(file)).size;
  if (size > performanceBudgets.emittedApplicationScriptBytes) {
    failures.add(`${relative(root, file)}: emitted application script budget exceeded (${size} > ${performanceBudgets.emittedApplicationScriptBytes})`);
  }
}

for (const requiredAsset of [
  '_headers',
  'robots.txt',
  'auth.md',
  '.well-known/agent-skills/index.json',
  'agent-skills/dead-signal-works-site/SKILL.md',
  '.well-known/security.txt',
  'apple-touch-icon.png',
  'favicon-192.png',
  'favicon-512.png',
  'pagefind/pagefind.js',
  'rss.xml',
  'site.webmanifest',
  'sitemap-index.xml',
  'social-card.png',
  'alchemist/docs/openapi.yaml',
  'alchemist/docs/source-manifest.json',
  'alchemist/social-card.png',
]) {
  if (!(await exists(join(root, requiredAsset)))) failures.add(`missing generated asset ${requiredAsset}`);
}

const robotsText = await readFile(join(repositoryRoot, 'public', 'robots.txt'), 'utf8');
const expectedContentSignal = 'ai-train=no, search=yes, ai-input=yes';
if (robotsText.match(/^Content-Signal:\s*(.+)$/mu)?.[1] !== expectedContentSignal) {
  failures.add(`robots.txt must declare Content-Signal: ${expectedContentSignal}`);
}

const authMarkdown = await readFile(join(repositoryRoot, 'public', 'auth.md'), 'utf8');
if (!/^# .*auth\.md/mu.test(authMarkdown)) failures.add('auth.md is missing an auth.md heading');
for (const phrase of ['public static website', 'agent-registration flow']) {
  if (!authMarkdown.toLowerCase().includes(phrase.toLowerCase())) failures.add(`auth.md is missing the no-auth declaration: ${phrase}`);
}
if (!/does not expose a\s+protected API/iu.test(authMarkdown)) failures.add('auth.md is missing the no-auth declaration: protected API');

const agentSkillsIndexPath = join(repositoryRoot, 'public', '.well-known', 'agent-skills', 'index.json');
const agentSkillsIndex = JSON.parse(await readFile(agentSkillsIndexPath, 'utf8')) as {
  $schema?: string;
  skills?: Array<{ name?: string; type?: string; description?: string; url?: string; digest?: string }>;
};
if (agentSkillsIndex.$schema !== 'https://schemas.agentskills.io/discovery/0.2.0/schema.json') {
  failures.add('Agent Skills index has the wrong $schema');
}
if (!Array.isArray(agentSkillsIndex.skills) || agentSkillsIndex.skills.length === 0) {
  failures.add('Agent Skills index must contain at least one skill');
} else {
  for (const skill of agentSkillsIndex.skills) {
    if (!skill.name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(skill.name)) failures.add('Agent Skills index contains an invalid skill name');
    if (skill.type !== 'skill-md') failures.add(`Agent Skills index skill ${skill.name ?? '(unnamed)'} must use type skill-md`);
    if (!skill.description) failures.add(`Agent Skills index skill ${skill.name ?? '(unnamed)'} is missing a description`);
    if (!skill.url || !skill.digest?.startsWith('sha256:')) {
      failures.add(`Agent Skills index skill ${skill.name ?? '(unnamed)'} is missing a SHA-256 URL/digest`);
      continue;
    }
    const skillUrl = new URL(skill.url);
    const publicRoot = join(repositoryRoot, 'public');
    const skillPath = join(publicRoot, skillUrl.pathname.replace(/^\//u, ''));
    if (skillUrl.origin !== site.url || relative(publicRoot, skillPath).startsWith('..')) {
      failures.add(`Agent Skills index skill ${skill.name} must point to a same-site public artifact`);
      continue;
    }
    if (!(await exists(skillPath))) {
      failures.add(`Agent Skills index skill ${skill.name} points to a missing artifact`);
      continue;
    }
    const digest = skill.digest.slice('sha256:'.length);
    if (!/^[a-f0-9]{64}$/u.test(digest)) failures.add(`Agent Skills index skill ${skill.name} has an invalid SHA-256 digest`);
    else if (sha256(await readFile(skillPath)) !== digest) failures.add(`Agent Skills index skill ${skill.name} digest does not match its artifact`);
  }
}

const socialCard = pngSize(await readFile(join(repositoryRoot, 'public', 'social-card.png')));
if (socialCard?.width !== 1200 || socialCard.height !== 630) failures.add('social-card.png must be 1200x630');
const alchemistSocialCard = pngSize(await readFile(join(repositoryRoot, 'public', 'alchemist', 'social-card.png')));
if (alchemistSocialCard?.width !== 1200 || alchemistSocialCard.height !== 630) failures.add('alchemist/social-card.png must be 1200x630');
const appleIcon = pngSize(await readFile(join(repositoryRoot, 'public', 'apple-touch-icon.png')));
if (appleIcon?.width !== 180 || appleIcon.height !== 180) failures.add('apple-touch-icon.png must be 180x180');

const manifest = JSON.parse(await readFile(join(repositoryRoot, 'public', 'site.webmanifest'), 'utf8')) as {
  icons?: Array<{ sizes?: string; type?: string }>;
};
for (const size of ['192x192', '512x512']) {
  if (!manifest.icons?.some((icon) => icon.sizes === size && icon.type === 'image/png')) failures.add(`web manifest lacks ${size} PNG icon`);
}

const headers = await readFile(join(repositoryRoot, 'public', '_headers'), 'utf8');
const homepageHeaderBlock = headers.match(/^\/\n((?: {2}.*\n)*)/mu)?.[1] ?? '';
for (const linkHeader of [
  'Link: </alchemist/docs/openapi.yaml>; rel="service-desc"; type="application/vnd.oai.openapi"',
  'Link: </alchemist/docs/>; rel="service-doc"; title="Alchemist API documentation"',
  'Link: </meridian/docs/>; rel="service-doc"; title="Meridian engine documentation"',
]) {
  if (!homepageHeaderBlock.includes(linkHeader)) failures.add(`homepage _headers is missing ${linkHeader}`);
}
if (!headers.includes(`Content-Signal: ${expectedContentSignal}`)) failures.add(`_headers is missing Content-Signal: ${expectedContentSignal}`);
for (const header of [
  'Content-Security-Policy:',
  'Cross-Origin-Opener-Policy: same-origin',
  'Cross-Origin-Resource-Policy: same-origin',
  'Permissions-Policy:',
  'Referrer-Policy: strict-origin-when-cross-origin',
  'X-Content-Type-Options: nosniff',
  'X-Frame-Options: DENY',
]) {
  if (!headers.includes(header)) failures.add(`_headers is missing ${header}`);
}
for (const directive of ["default-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'"]) {
  if (!headers.includes(directive)) failures.add(`content security policy is missing ${directive}`);
}
const csp = headers.match(/^\s*Content-Security-Policy:\s*(.+)$/mu)?.[1];
if (!csp) {
  failures.add('content security policy header has no value');
} else {
  const directiveTokens = (name: string) => csp
    .split(';')
    .map((directive) => directive.trim().split(/\s+/u))
    .find(([directiveName]) => directiveName === name)
    ?.slice(1) ?? [];
  const expectedScriptSources = new Set([
    "'self'",
    "'unsafe-inline'",
    "'wasm-unsafe-eval'",
    'https://static.cloudflareinsights.com',
  ]);
  const scriptSources = new Set(directiveTokens('script-src'));
  for (const source of expectedScriptSources) {
    if (!scriptSources.has(source)) failures.add(`content security policy script-src is missing ${source}`);
  }
  for (const source of scriptSources) {
    if (!expectedScriptSources.has(source)) failures.add(`content security policy has an unapproved script source ${source}`);
  }
  if (directiveTokens('connect-src').join(' ') !== "'self'") failures.add("content security policy connect-src must be exactly 'self'");
  if (directiveTokens('worker-src').join(' ') !== "'self' blob:") failures.add("content security policy worker-src must be exactly 'self' blob:");
}
if (/(?:^|\s)'unsafe-eval'(?=\s|;|$)/u.test(headers)) failures.add('content security policy allows unsafe-eval');
if (/script-src[^\n;]*\*/u.test(headers)) failures.add('content security policy has a wildcard script source');

const securityText = await readFile(join(repositoryRoot, 'public', '.well-known', 'security.txt'), 'utf8');
const expires = securityText.match(/^Expires:\s*(.+)$/mu)?.[1];
if (!expires || Number.isNaN(Date.parse(expires)) || Date.parse(expires) <= Date.now()) failures.add('security.txt has no future expiry');
if (!securityText.includes(`Canonical: ${site.url}/.well-known/security.txt`)) failures.add('security.txt has the wrong canonical URL');

const wrangler = JSON.parse(await readFile(join(repositoryRoot, 'wrangler.jsonc'), 'utf8')) as {
  main?: string;
  assets?: { directory?: string; not_found_handling?: string };
};
if (wrangler.main) failures.add('static Wrangler configuration must not declare a Worker main entrypoint');
if (wrangler.assets?.directory !== './dist') failures.add('Wrangler static assets directory must be ./dist');
if (wrangler.assets?.not_found_handling !== '404-page') failures.add('Wrangler must use the generated 404 page');

if (failures.size > 0) {
  console.error([...failures].sort().join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Checked ${htmlFiles.length} HTML pages, ${docsSourceFiles.length} Meridian docs, ${alchemistDocsSourceFiles.length} Alchemist docs, metadata, links, manifests, headers, assets, and bundle budgets.`);
}
