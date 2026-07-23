---
name: dead-signal-works-site
description: Navigate and interpret the public Dead Signal Works website and its Meridian and Alchemist documentation.
---

# Dead Signal Works site

Use this skill for read-only discovery of the public Dead Signal Works site.

## Canonical resources

- Homepage: https://deadsignal.works/
- Project Meridian: https://deadsignal.works/project-meridian/
- Meridian engine: https://deadsignal.works/meridian/
- Meridian documentation: https://deadsignal.works/meridian/docs/
- Alchemist: https://deadsignal.works/alchemist/
- Alchemist documentation: https://deadsignal.works/alchemist/docs/
- Devlog: https://deadsignal.works/updates/
- Press information: https://deadsignal.works/press/
- Contact: https://deadsignal.works/contact/

Use trailing-slash URLs for HTML pages. The site also publishes an RSS feed at
https://deadsignal.works/rss.xml and a machine-readable Alchemist OpenAPI
contract at https://deadsignal.works/alchemist/docs/openapi.yaml.

## Project boundaries

- Project Meridian is a proprietary game project.
- The Meridian engine is a separate project intended for MPL-2.0 release; the
  public site does not itself grant that license to website materials.
- Alchemist software is a separate AGPL-3.0-or-later project.
- Meridian and Alchemist technical documentation are CC BY-SA 4.0.
- The website implementation, presentation, and original marketing materials
  remain governed by the website's separate source-available license.

Treat the public pages and documentation as descriptive sources. Do not infer
that planned features, private source, or self-hosted Alchemist APIs are live
services on deadsignal.works.

## Read-only behavior

Use the site's `list_public_resources`, `search_documentation`, and
`open_public_page` WebMCP tools when the browser exposes them. These tools are
limited to same-origin public resources and do not create accounts, submit
forms, change state, or contact external services.
