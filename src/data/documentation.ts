export interface DocsNavItem {
  id: string;
  label: string;
  description: string;
  href: string;
}

export interface DocsNavGroup {
  id: string;
  label: string;
  description: string;
  items: DocsNavItem[];
}

export interface DocumentationProduct {
  id: 'meridian' | 'alchemist';
  name: string;
  docsTitle: string;
  docsRoot: string;
  groups: DocsNavGroup[];
  items: Array<DocsNavItem & { group: string; groupLabel: string }>;
  searchPlaceholder: string;
  licenseHolder: string;
  sourceRepository?: string;
  sourcePublic: boolean;
}

export function documentationProduct(
  product: Omit<DocumentationProduct, 'items'>,
): DocumentationProduct {
  return {
    ...product,
    items: product.groups.flatMap((group) => group.items.map((item) => ({
      ...item,
      group: group.id,
      groupLabel: group.label,
    }))),
  };
}
