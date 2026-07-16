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

Run the production checks with:

```sh
bun run check
bun run build
bun run check:site
bun run preview
```

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

This website and its original source, artwork, and content are proprietary to
Dead Signal Works LLC. No permission to use, copy, modify, or distribute them
is granted. Third-party dependencies remain subject to their own licenses. See
[`LICENSE`](LICENSE) for the full terms.

## Stack

- Astro static output for pages, content, metadata, and routing
- React islands with Motion for purposeful interaction
- Astro MDX and Pagefind for `/meridian/docs/`
- Authored CSS with self-hosted Mona Sans and Hubot Sans variable fonts
- Bun for dependency management and all local commands

## Cloudflare Pages

Connect this repository to Cloudflare Pages with:

- Root directory: repository root (this standalone repository)
- Build command: `bun run build`
- Build output directory: `dist`

Attach `deadsignal.works` from the Cloudflare Pages custom-domain settings
after the first successful deployment. DNS and the Cloudflare project remain
operator-managed.
