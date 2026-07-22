import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

interface SourceContract {
  schemaVersion: number;
  sourceRepository: string;
  sourceRevision: string;
  sourceContentSha256: string;
  version: string;
  fileCount: number;
}

interface OutputRecord {
  sourcePath: string;
  outputPath: string;
  sha256: string;
}

const websiteRoot = fileURLToPath(new URL('../', import.meta.url));
const defaultSource = resolve(websiteRoot, '../../data/alchemist');
const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const positional = args.filter((argument) => argument !== '--check');
const sourceRoot = resolve(positional[0] ?? process.env.ALCHEMIST_REPOSITORY ?? defaultSource);
const sourceContentRoot = join(sourceRoot, 'docs', 'content');
const outputContentRoot = join(websiteRoot, 'src', 'content', 'alchemist-docs');
const outputPublicRoot = join(websiteRoot, 'public', 'alchemist');
const publicDocsRoot = join(outputPublicRoot, 'docs');

function sha256(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files.sort();
}

function publicDocumentationTarget(rawTarget: string): string {
  const match = rawTarget.match(/^([^?#]*)(.*)$/u);
  if (!match) return rawTarget;
  const path = match[1] ?? '';
  const suffix = match[2] ?? '';
  if (path === '/openapi.yaml') return `/alchemist/docs/openapi.yaml${suffix}`;
  if (path === '/') return `/alchemist/docs/${suffix}`;
  const clean = path.replace(/^\/+|\/+$/gu, '');
  return `/alchemist/docs/${clean}/${suffix}`;
}

function transformMarkdown(source: string, sourcePath: string, revision: string): string {
  if (!source.startsWith('---\n')) throw new Error(`${sourcePath}: missing frontmatter`);
  const withoutDocusaurusSlug = source.replace(/^slug:\s*.*\n/mu, '');
  const metadata = [
    'generated: true',
    `sourcePath: ${JSON.stringify(sourcePath)}`,
    `sourceRevision: ${revision}`,
  ].join('\n');
  return withoutDocusaurusSlug
    .replace(/^---\n/u, `---\n${metadata}\n`)
    .replace(/\]\((\/[^)\s]+)\)/gu, (_match, target: string) => `](${publicDocumentationTarget(target)})`);
}

function sourceContract(): SourceContract {
  const result = spawnSync('python3', ['scripts/check_docs.py', '--json'], {
    cwd: sourceRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'Alchemist docs validation failed');
  return JSON.parse(result.stdout) as SourceContract;
}

async function writeOrCheck(path: string, content: string | Uint8Array): Promise<void> {
  if (checkOnly) {
    const existing = await readFile(path);
    const expected = typeof content === 'string' ? Buffer.from(content) : Buffer.from(content);
    if (!existing.equals(expected)) throw new Error(`${relative(websiteRoot, path)} is stale; run sync:alchemist-docs`);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

const contract = sourceContract();
const markdownFiles = (await walk(sourceContentRoot)).filter((path) => path.endsWith('.md'));
if (markdownFiles.length !== contract.fileCount) {
  throw new Error(`source validator reported ${contract.fileCount} pages but sync found ${markdownFiles.length}`);
}

if (!checkOnly) {
  await rm(outputContentRoot, { recursive: true, force: true });
  await mkdir(outputContentRoot, { recursive: true });
}

const records: OutputRecord[] = [];
for (const sourceFile of markdownFiles) {
  const relativeSource = relative(sourceRoot, sourceFile).split(sep).join('/');
  const relativeContent = relative(sourceContentRoot, sourceFile).split(sep).join('/');
  const outputFile = join(outputContentRoot, relativeContent);
  const transformed = transformMarkdown(await readFile(sourceFile, 'utf8'), relativeSource, contract.sourceRevision);
  await writeOrCheck(outputFile, transformed);
  records.push({
    sourcePath: relativeSource,
    outputPath: relative(websiteRoot, outputFile).split(sep).join('/'),
    sha256: sha256(transformed),
  });
}

const binaryInputs = [
  { source: join(sourceRoot, 'contracts', 'openapi.yaml'), output: join(publicDocsRoot, 'openapi.yaml') },
  { source: join(sourceRoot, 'docs', 'assets', 'social-card.png'), output: join(outputPublicRoot, 'social-card.png') },
];

for (const item of binaryInputs) {
  const content = await readFile(item.source);
  await writeOrCheck(item.output, content);
  records.push({
    sourcePath: relative(sourceRoot, item.source).split(sep).join('/'),
    outputPath: relative(websiteRoot, item.output).split(sep).join('/'),
    sha256: sha256(content),
  });
}

records.sort((left, right) => left.outputPath.localeCompare(right.outputPath));
const manifest = `${JSON.stringify({
  schemaVersion: 1,
  sourceRepository: contract.sourceRepository,
  sourceRevision: contract.sourceRevision,
  sourceContentSha256: contract.sourceContentSha256,
  version: contract.version,
  fileCount: contract.fileCount,
  files: records,
}, null, 2)}\n`;
await writeOrCheck(join(publicDocsRoot, 'source-manifest.json'), manifest);

console.log(`${checkOnly ? 'Checked' : 'Synced'} ${contract.fileCount} Alchemist documentation pages from ${basename(sourceRoot)}.`);
