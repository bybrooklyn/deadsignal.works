import { site } from '../data/site';

interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
}

interface ModelContextTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, boolean>;
  execute: (input: unknown) => Promise<ToolResult>;
}

interface ModelContext {
  registerTool?: (tool: ModelContextTool, options?: { signal?: AbortSignal }) => Promise<void>;
  provideContext?: (context: { tools: ModelContextTool[] }) => void;
}

interface PagefindResult {
  url: string;
  excerpt: string;
  meta?: { title?: string };
}

interface PagefindModule {
  options: (options: { excerptLength: number }) => Promise<void>;
  search: (query: string) => Promise<{ results: Array<{ data: () => Promise<PagefindResult> }> }>;
}

interface AgentToolState {
  controller: AbortController | null;
  context: ModelContext | null;
  mode: 'registerTool' | 'provideContext' | null;
  registration: Promise<void> | null;
}

declare global {
  interface Document {
    modelContext?: ModelContext;
  }

  interface Navigator {
    modelContext?: ModelContext;
  }
}

const stateKey = '__deadSignalAgentTools';
const globalState = globalThis as typeof globalThis & { [stateKey]?: AgentToolState };
if (globalState[stateKey]) {
  // Astro can execute page scripts again during client navigation.
} else {
  const state: AgentToolState = {
    controller: null,
    context: null,
    mode: null,
    registration: null,
  };
  globalState[stateKey] = state;

  const docsRoots = ['/meridian/docs/', '/alchemist/docs/'];
  const publicPaths = new Set([
    '/',
    '/project-meridian/',
    '/meridian/',
    '/meridian/docs/',
    '/alchemist/',
    '/alchemist/docs/',
    '/updates/',
    '/press/',
    '/contact/',
    '/studio/',
  ]);
  const documentationPath = /^\/(?:meridian|alchemist)\/docs\/(?:[a-z0-9-]+\/)+$/u;
  const resources = [
    {
      id: 'project-meridian',
      name: 'Project Meridian',
      kind: 'game',
      url: `${site.url}/project-meridian/`,
      description: 'A single-player, first-person liminal horror game in development.',
    },
    {
      id: 'meridian',
      name: 'Meridian',
      kind: 'engine',
      url: `${site.url}/meridian/`,
      documentation: `${site.url}/meridian/docs/`,
      description: 'A Rust engine and integrated creator application being prepared for an open-source release.',
    },
    {
      id: 'alchemist',
      name: 'Alchemist',
      kind: 'software',
      url: `${site.url}/alchemist/`,
      documentation: `${site.url}/alchemist/docs/`,
      openapi: `${site.url}/alchemist/docs/openapi.yaml`,
      description: 'Self-hosted media transcoding automation with mirrored technical documentation.',
    },
    {
      id: 'devlog',
      name: 'Dead Signal Works devlog',
      kind: 'updates',
      url: `${site.url}/updates/`,
      feed: `${site.url}/rss.xml`,
      description: 'Public development updates from the studio.',
    },
  ];

  const result = (value: unknown): ToolResult => ({
    content: [{ type: 'text', text: JSON.stringify(value) }],
  });

  const tools: ModelContextTool[] = [
    {
      name: 'list_public_resources',
      description: 'List the public Dead Signal Works projects, documentation, and devlog resources.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: async () => result({ resources }),
    },
    {
      name: 'search_documentation',
      description: 'Search the public Meridian and Alchemist documentation index.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', minLength: 2, description: 'Search terms.' } },
        required: ['query'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input) => {
        const query = (input as { query?: unknown }).query;
        const cleanQuery = typeof query === 'string' ? query.trim() : '';
        if (cleanQuery.length < 2) throw new Error('query must contain at least two characters');

        const pagefindPath = '/pagefind/pagefind.js';
        const pagefind = await import(/* @vite-ignore */ pagefindPath) as PagefindModule;
        await pagefind.options({ excerptLength: 24 });
        const response = await pagefind.search(cleanQuery);
        const loaded = await Promise.all(response.results.slice(0, 10).map((entry) => entry.data()));
        const matches = loaded.flatMap((entry) => {
          const url = new URL(entry.url, window.location.origin);
          if (url.origin !== window.location.origin || !docsRoots.some((root) => url.pathname.startsWith(root))) return [];
          return [{
            title: entry.meta?.title ?? url.pathname,
            url: `${url.pathname}${url.search}${url.hash}`,
            excerpt: entry.excerpt.replace(/<[^>]*>/gu, ''),
          }];
        });
        return result({ query: cleanQuery, matches });
      },
    },
    {
      name: 'open_public_page',
      description: 'Open one canonical public page on deadsignal.works.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string', description: 'A canonical trailing-slash path from the public site.' } },
        required: ['path'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: async (input) => {
        const path = (input as { path?: unknown }).path;
        if (typeof path !== 'string') throw new Error('path must be a string');
        const url = new URL(path, window.location.origin);
        const isDocumentationPath = documentationPath.test(url.pathname);
        if (url.origin !== window.location.origin || url.search || url.hash || (!publicPaths.has(url.pathname) && !isDocumentationPath)) {
          throw new Error('path must be an allowlisted canonical public page');
        }
        if (isDocumentationPath && !(await fetch(url.pathname, { method: 'HEAD', credentials: 'same-origin' })).ok) {
          throw new Error('path is not an available public page');
        }
        if (url.pathname !== window.location.pathname) window.location.assign(url.pathname);
        return result({ opened: url.pathname });
      },
    },
  ];

  const getContext = (): ModelContext | undefined => document.modelContext ?? navigator.modelContext;

  const clearTools = () => {
    state.controller?.abort();
    state.controller = null;
    if (state.mode === 'provideContext') state.context?.provideContext?.({ tools: [] });
    state.context = null;
    state.mode = null;
    state.registration = null;
  };

  const registerTools = async () => {
    clearTools();
    const context = getContext();
    if (!context) return;

    state.context = context;
    state.controller = new AbortController();
    if (context.registerTool) {
      state.mode = 'registerTool';
      const registration = Promise.all(tools.map((tool) => context.registerTool!(tool, { signal: state.controller!.signal })))
        .then(() => undefined)
        .catch(() => undefined);
      state.registration = registration;
      await registration;
    } else if (context.provideContext) {
      state.mode = 'provideContext';
      context.provideContext({ tools });
    }
  };

  const requestRegistration = () => {
    if (state.registration || state.mode) return;
    void registerTools();
  };

  document.addEventListener('astro:before-swap', clearTools);
  document.addEventListener('astro:page-load', requestRegistration);
}
