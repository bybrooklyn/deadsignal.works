import { access, readFile, readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';

const root = new URL('../dist/', import.meta.url);
const sourceRoot = new URL('../src/', import.meta.url);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }
  return files;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function candidates(pathname) {
  if (pathname === '/') return [join(root.pathname, 'index.html')];
  if (extname(pathname)) return [join(root.pathname, pathname)];
  return [
    join(root.pathname, `${pathname}.html`),
    join(root.pathname, pathname, 'index.html'),
  ];
}

const files = await walk(root.pathname);
const htmlFiles = files.filter((file) => file.endsWith('.html'));
const failures = [];
const sourceFiles = (await walk(sourceRoot.pathname)).filter((file) => /\.(?:astro|css|md|mdx|ts|tsx)$/.test(file));

for (const file of sourceFiles) {
  const source = await readFile(file, 'utf8');
  const relative = file.slice(sourceRoot.pathname.length);
  if (/text-transform:\s*uppercase/i.test(source)) failures.push(`${relative}: forced uppercase styling`);
}
const requiredRoutes = [
  'index.html',
  'studio/index.html',
  'project-meridian/index.html',
  'meridian/index.html',
  'meridian/penumbra/index.html',
  'meridian/cairn/index.html',
  'meridian/wavefront/index.html',
  'meridian/alluvium/index.html',
  'meridian/docs/index.html',
  'meridian/docs/learn/what-is-meridian/index.html',
  'meridian/docs/learn/architecture-boundaries/index.html',
  'meridian/docs/learn/maturity-and-evidence/index.html',
  'meridian/docs/learn/current-status/index.html',
  'meridian/docs/build/from-source/index.html',
  'meridian/docs/build/repository-tour/index.html',
  'meridian/docs/build/contributing/index.html',
  'meridian/docs/systems/index.html',
  'meridian/docs/systems/penumbra/index.html',
  'meridian/docs/systems/cairn/index.html',
  'meridian/docs/systems/wavefront/index.html',
  'meridian/docs/systems/alluvium/index.html',
  'meridian/docs/reference/specifications/index.html',
  'press/index.html',
  'contact/index.html',
  'updates/index.html',
  '404.html',
];

for (const route of requiredRoutes) {
  if (!(await exists(join(root.pathname, route)))) failures.push(`missing required route ${route}`);
}

for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8');
  const relative = file.slice(root.pathname.length);

  for (const [label, pattern] of [
    ['title', /<title>[^<]+<\/title>/i],
    ['description', /<meta\s+name="description"\s+content="[^"]+"/i],
    ['canonical URL', /<link\s+rel="canonical"\s+href="https:\/\/deadsignal\.works\//i],
    ['level-one heading', /<h1(?:\s|>)/i],
  ]) {
    if (!pattern.test(html)) failures.push(`${relative}: missing ${label}`);
  }

  if (/\/journal(?:\/|&quot;|")/.test(html)) failures.push(`${relative}: stale /journal link`);
  if (/\/meridian\/docs\/(?:subsystems|concepts|developers)(?:\/|&quot;|")/.test(html)) failures.push(`${relative}: stale documentation route`);
  if (/href="#"/.test(html)) failures.push(`${relative}: empty fragment link`);
  if (/text-transform:\s*uppercase/i.test(html)) failures.push(`${relative}: forced uppercase styling`);

  const links = [...html.matchAll(/href="(\/[^"]*)"/g)].map((match) => match[1]);
  for (const href of links) {
    const pathname = href.split('#')[0].split('?')[0];
    if (!pathname || pathname.startsWith('//')) continue;
    const targetExists = await Promise.any(
      candidates(pathname).map(async (candidate) => {
        if (await exists(candidate)) return true;
        throw new Error('missing');
      }),
    ).catch(() => false);
    if (!targetExists) failures.push(`${relative}: broken internal link ${href}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Checked ${htmlFiles.length} HTML pages: metadata and internal links look good.`);
}
