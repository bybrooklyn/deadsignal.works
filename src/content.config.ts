import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const updates = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/updates' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    tag: z.string(),
  }),
});

const docs = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/docs' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    updated: z.coerce.date().optional(),
    sourceRevision: z.string().optional(),
    sources: z.array(z.object({ label: z.string(), href: z.url() })).optional(),
  }),
});

const alchemistDocs = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/alchemist-docs' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    keywords: z.array(z.string()).optional(),
    generated: z.literal(true),
    sourcePath: z.string(),
    sourceRevision: z.string(),
  }),
});

export const collections = { updates, docs, alchemistDocs };
