# Dead Signal Works website

Independent Astro + React site for [Dead Signal Works](https://deadsignal.works),
the solo studio behind the Meridian engine and Project Meridian.

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

On a fresh Linux runner, install the browser system packages at the same time
with `bunx playwright install --with-deps chromium firefox webkit`.

## Content

- Updates live in `src/content/updates/` as Markdown.
- Meridian developer and curious-reader docs live under `src/content/docs/`
  and render through the custom Astro documentation layout.
- Public identity and navigation live in `src/data/site.ts`.
- Truthful subsystem summaries live in `src/data/subsystems.ts`.

Project Meridian is proprietary. Do not copy private routes, narrative, art,
assets, logos, or production documents into this repository. Public facts stay
at the approved fact-sheet level until additional material is cleared.

The animated Project Meridian composition is site artwork, not game footage.

## License

This website repository is **source-available and proprietary**, not open
source. Its public source may be inspected and an unmodified copy may be run
locally for limited non-commercial evaluation, education, or security research.
Modification, redistribution, deployment, commercial use, and use of Dead
Signal Works branding are not permitted without prior written permission. See
[`LICENSE`](LICENSE) for the full terms.

The Meridian engine is a separate project governed by MPL-2.0 when its source
is released under that license. Project Meridian’s game source and private
production materials remain proprietary and are not included here.

## Stack

- Astro static output for pages, content, metadata, and routing
- React islands with Motion for purposeful interaction
- Astro MDX and Pagefind for `/meridian/docs/`
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
