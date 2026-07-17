import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://deadsignal.works',
  output: 'static',
  trailingSlash: 'always',
  integrations: [mdx(), react(), sitemap()],
  vite: {
    build: {
      sourcemap: false,
    },
  },
});
