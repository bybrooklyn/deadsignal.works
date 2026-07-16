export const site = {
  name: 'Dead Signal Works',
  legalName: 'Dead Signal Works LLC',
  domain: 'deadsignal.works',
  url: 'https://deadsignal.works',
  description: 'An eccentric solo game and software studio focused on realistic, highly performant games and the technology behind them.',
  engineRepository: 'https://github.com/bybrooklyn/meridian',
  discord: 'https://discord.gg/3NckH4Xtrn',
  tiktok: 'https://www.tiktok.com/@deadsignalworks',
  pressEmail: 'press@deadsignal.works',
  contactEmail: 'contact@deadsignal.works',
} as const;

export const footerNavigation = [
  { label: 'Press information', href: '/press', external: false },
  { label: 'Contact', href: '/contact', external: false },
  { label: 'Engine repository', href: site.engineRepository, external: true },
  { label: 'Discord', href: site.discord, external: true },
  { label: 'TikTok', href: site.tiktok, external: true },
] as const;
