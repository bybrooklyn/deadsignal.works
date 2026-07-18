export const docsSnapshot = {
  revision: '9e8f80b0ae3432f10501472598ea19c11a1894ed',
  updated: '2026-07-17',
  sourceBackedDocumentIds: [
    'build/contributing',
    'build/from-source',
    'build/repository-tour',
    'learn/architecture-boundaries',
    'learn/current-status',
    'learn/maturity-and-evidence',
    'learn/what-is-meridian',
    'reference/specifications',
    'systems',
    'systems/alluvium',
    'systems/cairn',
    'systems/penumbra',
    'systems/wavefront',
  ],
} as const;

export const docsSnapshotShortRevision = docsSnapshot.revision.slice(0, 7);
