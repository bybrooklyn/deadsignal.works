import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

const siteBuildTimestamp = new Date().toISOString();

export default defineConfig({
  site: 'https://deadsignal.works',
  output: 'static',
  trailingSlash: 'always',
  integrations: [mdx(), react(), sitemap()],
  vite: {
    define: {
      __DEAD_SIGNAL_SITE_BUILD_TIMESTAMP__: JSON.stringify(siteBuildTimestamp),
    },
    build: {
      sourcemap: false,
    },
  },
});
