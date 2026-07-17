import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIRoute } from 'astro';
import { site } from '../data/site';

export const GET: APIRoute = async (context) => {
  const entries = (await getCollection('updates')).sort(
    (a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf(),
  );

  return rss({
    title: `${site.name} devlog`,
    description: 'Development notes from Dead Signal Works, Project Meridian, and the Meridian engine.',
    site: context.site ?? site.url,
    items: entries.map((entry) => ({
      title: entry.data.title,
      description: entry.data.description,
      pubDate: entry.data.pubDate,
      link: `/updates/${entry.id}`,
      categories: [entry.data.tag],
    })),
    customData: '<language>en-us</language>',
  });
};
