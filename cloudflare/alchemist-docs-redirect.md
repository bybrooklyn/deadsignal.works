# Alchemist documentation apex redirect

This operator-reviewed redirect remains inactive until the Dead Signal Works
Alchemist routes have been deployed and accepted in production.

Create one Cloudflare wildcard redirect for the exact apex hostname:

| Setting | Value |
| --- | --- |
| Source URL | `http*://alchemist-project.org/*` |
| Target URL | `https://deadsignal.works/alchemist/docs/${2}` |
| Status | `301` |
| Preserve query string | enabled |
| Include subdomains | disabled |

The source pattern deliberately does not include `*.alchemist-project.org`, so
`alembic.alchemist-project.org` is outside the rule. This is the path-preserving
wildcard form documented by Cloudflare. Do not retire the previous GitHub Pages
deployment until the new routes, manifest, application links, redirect behavior,
and search indexing have been confirmed.

## Pre-activation acceptance

Verify these new routes first:

```sh
curl --fail --silent --show-error --head https://deadsignal.works/alchemist/
curl --fail --silent --show-error --head https://deadsignal.works/alchemist/docs/
curl --fail --silent --show-error --head https://deadsignal.works/alchemist/docs/hardware/nvidia/
curl --fail --silent --show-error https://deadsignal.works/alchemist/docs/source-manifest.json
curl --fail --silent --show-error https://deadsignal.works/alchemist/docs/openapi.yaml
```

## Post-activation acceptance

Each old URL must make one request and return one permanent redirect to the
corresponding HTTPS route:

```sh
curl --silent --show-error --head http://alchemist-project.org/
curl --silent --show-error --head https://alchemist-project.org/hardware/nvidia/
curl --silent --show-error --head 'https://alchemist-project.org/errors/?from=app'
curl --silent --show-error --head https://alchemist-project.org/docker
curl --silent --show-error --head https://alchemist-project.org/docker/
curl --silent --show-error --head https://alembic.alchemist-project.org/
```

Expected apex locations are respectively:

- `https://deadsignal.works/alchemist/docs/`
- `https://deadsignal.works/alchemist/docs/hardware/nvidia/`
- `https://deadsignal.works/alchemist/docs/errors/?from=app`
- `https://deadsignal.works/alchemist/docs/docker`
- `https://deadsignal.works/alchemist/docs/docker/`

The Alembic request must not be redirected by this rule. URL fragments are not
sent in HTTP requests; verify an application error URL such as
`https://alchemist-project.org/errors/#E1234` in a browser and confirm the
fragment survives navigation to the new error reference.

## Rollback

Disable this one redirect rule and restore the previous documentation origin.
Keep that origin deployable until application links and external indexing have
been confirmed against the new canonical routes.
