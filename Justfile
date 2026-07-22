# Justfile for Dead Signal Works website project

# Default recipe: list all available commands
default:
    @just --list

# Install all project dependencies using bun
install:
    bun install

# Start the local development server
dev:
    bun dev

# Build the production static site and generate search indices
build:
    bun run build

# Preview the built production site locally (automatically builds first)
preview: build
    bun preview

# Run code check and type safety verification
check:
    bun run check

# Verify the output build for broken links, CSP headers, and asset budgets
check-site:
    bun run check:site

# Run dependency security audits (fails on moderate or higher vulnerabilities)
check-security:
    bun run check:security

# Run Playwright E2E layout, accessibility, and functional tests
test:
    bun run test:e2e:built

# Run Playwright E2E tests in live reload/dev mode
test-dev:
    bun run test:e2e:dev

# Run Lighthouse performance, accessibility, best practices, and SEO audits
audit:
    bun run audit:lighthouse

# Re-generate the Playwright visual regression snapshots
update-snapshots:
    bunx playwright test -u

# Clean up build and test artifacts
clean:
    rm -rf dist/
    rm -rf .astro/
    rm -rf .wrangler/
    rm -rf playwright-report/
    rm -rf test-results/
    rm -rf .lighthouseci/
    @echo "All build, cache, and test artifacts have been cleaned."

# Deep clean including node_modules dependencies
clean-all: clean
    rm -rf node_modules/
    @echo "All node_modules dependencies and build/test artifacts have been cleaned."
