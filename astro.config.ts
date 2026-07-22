import mdx from '@astrojs/mdx';
import { unified } from '@astrojs/markdown-remark';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

const siteBuildTimestamp = new Date().toISOString();

interface MarkdownNode {
  type?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: MarkdownNode[];
}

function accessibleMarkdownTables() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (node.type === 'element' && node.tagName === 'table') {
        node.properties = {
          ...node.properties,
          tabIndex: 0,
          ariaLabel: 'Scrollable data table',
        };
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

export default defineConfig({
  site: 'https://deadsignal.works',
  output: 'static',
  trailingSlash: 'always',
  integrations: [mdx(), react(), sitemap()],
  markdown: {
    processor: unified({ rehypePlugins: [accessibleMarkdownTables] }),
  },
  vite: {
    define: {
      __DEAD_SIGNAL_SITE_BUILD_TIMESTAMP__: JSON.stringify(siteBuildTimestamp),
    },
    build: {
      sourcemap: false,
    },
  },
});
