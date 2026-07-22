import { documentationProduct, type DocsNavGroup as BaseDocsNavGroup } from './documentation';

export type DocsGroupId = 'learn' | 'build' | 'systems' | 'reference';

export interface DocsNavGroup extends BaseDocsNavGroup {
  id: DocsGroupId;
}

const docsRoot = '/meridian/docs';

export const docsGroups: DocsNavGroup[] = [
  {
    id: 'learn',
    label: 'Learn',
    description: 'Understand what Meridian is, how it is shaped, and what exists today.',
    items: [
      { id: 'learn/what-is-meridian', label: 'What Meridian is', description: 'The engine, creator application, license, and project boundary.', href: `${docsRoot}/learn/what-is-meridian/` },
      { id: 'learn/architecture-boundaries', label: 'Architecture boundaries', description: 'Ownership, identifiers, commands, snapshots, and adapters.', href: `${docsRoot}/learn/architecture-boundaries/` },
      { id: 'learn/maturity-and-evidence', label: 'Maturity and evidence', description: 'How to read implementation and validation language accurately.', href: `${docsRoot}/learn/maturity-and-evidence/` },
      { id: 'learn/current-status', label: 'Current status', description: 'A dated, public-source snapshot of implemented foundations and gaps.', href: `${docsRoot}/learn/current-status/` },
      { id: 'learn/examples', label: 'Examples', description: 'Runnable examples will collect here as their public contracts stabilize.', href: `${docsRoot}/learn/examples/` },
      { id: 'learn/diagrams', label: 'Architecture diagrams', description: 'A growing visual map of engine boundaries and data flow.', href: `${docsRoot}/learn/diagrams/` },
    ],
  },
  {
    id: 'build',
    label: 'Build',
    description: 'Understand the planned source workflow, repository map, and contribution rules before release.',
    items: [
      { id: 'build/from-source', label: 'Build from source', description: 'Preview the public source workflow planned for release.', href: `${docsRoot}/build/from-source/` },
      { id: 'build/repository-tour', label: 'Repository tour', description: 'Find engine crates, creator tools, specifications, and evidence.', href: `${docsRoot}/build/repository-tour/` },
      { id: 'build/contributing', label: 'Contributing', description: 'Choose a bounded change and prove exactly what it does.', href: `${docsRoot}/build/contributing/` },
    ],
  },
  {
    id: 'systems',
    label: 'Systems',
    description: 'Detailed, non-normative guides to Meridian’s named architecture.',
    items: [
      { id: 'systems', label: 'System map', description: 'A map of ownership, current state, and authoritative sources.', href: `${docsRoot}/systems/` },
      { id: 'systems/penumbra', label: 'Penumbra', description: 'Rendering ownership, frame flow, current foundations, and direction.', href: `${docsRoot}/systems/penumbra/` },
      { id: 'systems/cairn', label: 'Cairn', description: 'Physics ownership, fixed-step behavior, determinism, and current wrapper.', href: `${docsRoot}/systems/cairn/` },
      { id: 'systems/wavefront', label: 'Wavefront', description: 'Audio devices, streaming, DSP, timing, mixing, and acoustics.', href: `${docsRoot}/systems/wavefront/` },
      { id: 'systems/alluvium', label: 'Alluvium', description: 'Recipes, fields, evaluation, identity, overrides, provenance, and cooking.', href: `${docsRoot}/systems/alluvium/` },
    ],
  },
  {
    id: 'reference',
    label: 'Reference',
    description: 'Find the repository source that owns each kind of decision.',
    items: [
      { id: 'reference/specifications', label: 'Specifications and authority', description: 'A question-based map of specifications, registries, decisions, and evidence.', href: `${docsRoot}/reference/specifications/` },
      { id: 'reference/api', label: 'API reference', description: 'Generated API documentation will be linked here when the public surface is ready.', href: `${docsRoot}/reference/api/` },
      { id: 'reference/versions', label: 'Versions', description: 'Versioned documentation begins when Meridian has a public release line.', href: `${docsRoot}/reference/versions/` },
    ],
  },
];

export const docsItems = docsGroups.flatMap((group) =>
  group.items.map((item) => ({ ...item, group: group.id, groupLabel: group.label })),
);

export const docsItemById: Readonly<Record<string, (typeof docsItems)[number]>> = Object.fromEntries(
  docsItems.map((item) => [item.id, item]),
);

export const meridianDocumentation = documentationProduct({
  id: 'meridian',
  name: 'Meridian',
  docsTitle: 'Meridian docs',
  docsRoot: `${docsRoot}/`,
  groups: docsGroups,
  searchPlaceholder: 'Render graph, build from source, Alluvium…',
  licenseHolder: 'Dead Signal Works LLC',
  sourcePublic: false,
});
