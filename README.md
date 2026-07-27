# Dead Signal Works website

Independent Astro + React site for [Dead Signal Works](https://deadsignal.works),
the solo studio behind Project Meridian, the Meridian engine, and Alchemist.

## Local development

This repository is intentionally nested under the Meridian engine checkout but
has its own Git history. The parent repository ignores `/website/`.

```sh
bun install
bun run dev
```

Run the production gates with:

```sh
bun install --frozen-lockfile --ignore-scripts
bunx playwright install chromium firefox webkit
export CHROME_PATH="$(bun -e 'import { chromium } from "@playwright/test"; process.stdout.write(chromium.executablePath())')"
bun run verify
bun run audit:lighthouse
bunx wrangler deploy --dry-run
git diff --check
```

`bun run verify` builds the static site, audits generated routes and bundle
budgets, checks dependencies, and runs the Chromium, Firefox, and WebKit
Playwright suites through local Wrangler routing and response headers.

`check:security` ignores `GHSA-mh99-v99m-4gvg` (brace-expansion). It is reached
only through `@lhci/cli › chrome-launcher › rimraf › glob › minimatch`, is a
devDependency that never ships, and its sole patched release (5.0.8) exports an
object instead of a callable from its CommonJS entry, which minimatch 3 cannot
consume. Drop the ignore once `@lhci/cli` updates that chain.

`audit:lighthouse` asserts SEO at 0.92 rather than 1.00. The only audit below
that ceiling is `robots-txt`, which reports the deliberate `Content-Signal`
directive in `public/robots.txt` as an unknown directive; Lighthouse's parser
predates the Content Signals Policy. Raise the threshold back to 1.00 once that
directive is recognized, and treat any other SEO drop as a real regression.

On a fresh Linux runner, install the browser system packages at the same time
with `bunx playwright install --with-deps chromium firefox webkit`.

## Content

- Updates live in `src/content/updates/` as Markdown.
- Meridian developer and curious-reader docs live under `src/content/docs/`
  and render through the custom Astro documentation layout.
- Alchemist Markdown remains authoritative in the Alchemist repository under
  `docs/content/`. The tracked `src/content/alchemist-docs/` mirror is generated
  and must not be edited directly.
- Public identity and navigation live in `src/data/site.ts`.
- Truthful subsystem summaries live in `src/data/subsystems.ts`.

Project Meridian is proprietary. Do not copy private routes, narrative, art,
assets, logos, or production documents into this repository. Public facts stay
at the approved fact-sheet level until additional material is cleared.

The animated Project Meridian composition is site artwork, not game footage.

Synchronize an explicit, reviewed Alchemist checkout with:

```sh
bun run sync:alchemist-docs -- /absolute/path/to/alchemist
bun run sync:alchemist-docs -- --check /absolute/path/to/alchemist
```

The sync validates the source repository, normalizes Docusaurus-era metadata,
rewrites root-relative documentation links, copies the social card and OpenAPI
contract, and writes `public/alchemist/docs/source-manifest.json`. The manifest
records the source revision and digest plus every source/output path and output
SHA-256. Site validation rejects stale or unrepresented generated files.

## License

Licensing follows the material, not the repository boundary:

| Material | License | Copyright owner |
| --- | --- | --- |
| Website implementation, layouts, components, styles, design, project pages, devlogs, artwork, and marketing copy | Dead Signal Works proprietary source-available license | Dead Signal Works LLC |
| Meridian technical documentation in `src/content/docs/**` | CC BY-SA 4.0 | Dead Signal Works LLC |
| Alchemist technical documentation in `src/content/alchemist-docs/**` | CC BY-SA 4.0 | Brooklyn Halmstad |
| Meridian engine | MPL-2.0 | See the Meridian repository |
| Alchemist software and generated OpenAPI contract | AGPL-3.0-or-later | Brooklyn Halmstad |
| Project Meridian game and production material | Proprietary | Dead Signal Works LLC |

The website license is in [`LICENSE`](LICENSE). The unmodified CC BY-SA 4.0
legal text used for both technical documentation trees is in
[`LICENSE-DOCUMENTATION-CC-BY-SA-4.0`](LICENSE-DOCUMENTATION-CC-BY-SA-4.0).
Neither software license applies to the proprietary website implementation.

## Stack

- Astro static output for pages, content, metadata, and routing
- React islands with Motion for purposeful interaction
- Astro MDX and product-isolated Pagefind search for `/meridian/docs/` and
  `/alchemist/docs/`
- Authored CSS with self-hosted Mona Sans and Hubot Sans variable fonts
- TypeScript 7 for project-wide checking, with the TypeScript 6 API retained
  only for Astro's embedded-language checker until its TypeScript 7 integration
  is available
- Bun for dependency management and all local commands

## Cloudflare Pages

Connect this repository to Cloudflare Pages with:

- Root directory: repository root (this standalone repository)
- Build command: `bun run build`
- Build output directory: `dist`

Attach `deadsignal.works` from the Cloudflare Pages custom-domain settings
after the first successful deployment. DNS and the Cloudflare project remain
operator-managed.

The repository also carries an explicit static-assets `wrangler.jsonc` for the
existing Workers Builds check. It points Wrangler at the already-built `dist/`
directory and prevents deploy-time framework detection from adding an SSR
adapter or changing the source tree. A direct Workers deployment can use:

```sh
bun run deploy
```

Both deployment paths serve the same fully static output. Security and cache
headers live in `public/_headers`, which Cloudflare reads from the built assets.
