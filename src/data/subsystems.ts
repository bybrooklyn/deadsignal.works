export type SubsystemTone = 'red' | 'grass' | 'amber' | 'paper';

export interface Subsystem {
  slug: 'penumbra' | 'cairn' | 'wavefront' | 'alluvium';
  name: string;
  pronunciation: string;
  pronunciationLabel: string;
  role: string;
  tone: SubsystemTone;
  summary: string;
  introduction: string;
  purposeTitle: string;
  ambitionTitle: string;
  directionTitle: string;
  ambition: string[];
  direction: string[];
  specUrl: string;
}

export const subsystems: Subsystem[] = [
  {
    slug: 'penumbra',
    name: 'Penumbra',
    pronunciation: '/pəˈnʌm.brə/',
    pronunciationLabel: 'puh-NUM-bruh',
    role: 'Rendering',
    tone: 'red',
    summary: 'Meridian’s rendering engine, built to turn enormous worlds into visible, measurable frames.',
    introduction:
      'Penumbra owns rendering architecture above Meridian’s hardware boundary. Its production direction is a path-independent Forward+ renderer, but the current implementation is a smaller and deliberately measured foundation.',
    purposeTitle: 'Make ambitious worlds visible without giving away control.',
    ambitionTitle: 'A renderer that can scale with the world around it.',
    directionTitle: 'Build the production path without throwing away the foundation.',
    ambition: [
      'Large, dense worlds with measurable frame behavior',
      'A path-independent rendering foundation instead of one locked pipeline',
      'Lighting, atmosphere, materials, and environmental media that belong to the same world',
      'Evidence for performance and image quality instead of adjectives',
    ],
    direction: [
      'Production clustered Forward+',
      'Complete timing and image-quality evidence',
      'Specular IBL and broader environmental rendering',
      'Native backend work after evidence gates',
    ],
    specUrl: 'https://github.com/bybrooklyn/meridian/blob/main/specs/RENDERING_AND_GRAPHICS_SPEC.md',
  },
  {
    slug: 'cairn',
    name: 'Cairn',
    pronunciation: '/kɛrn/',
    pronunciationLabel: 'kairn',
    role: 'Physics',
    tone: 'grass',
    summary: 'A physics engine for responsive characters, heavy structures, and worlds that should behave consistently.',
    introduction:
      'Cairn is the long-term physics architecture for stable identity, deterministic modes, structural systems, and dedicated 2D and 3D paths. The current code is intentionally narrower.',
    purposeTitle: 'Make physical behavior stable enough to build a world on.',
    ambitionTitle: 'Physics that can be precise, destructive, and still understandable.',
    directionTitle: 'Move from a useful wrapper toward Cairn-owned behavior.',
    ambition: [
      'Responsive character movement and stable world interaction',
      'Deterministic modes where a workload actually needs them',
      'Structural systems and destruction as first-class physics work',
      'Dedicated 2D and 3D paths instead of treating one as a thin disguise for the other',
    ],
    direction: [
      'Cairn-native body, shape, query, and solver contracts',
      'Provenance-controlled fork and differential testing',
      'Structural destruction as a flagship workload',
      'Dedicated first-class 2D physics path',
    ],
    specUrl: 'https://github.com/bybrooklyn/meridian/blob/main/specs/CAIRN_PHYSICS_SPEC.md',
  },
  {
    slug: 'wavefront',
    name: 'Wavefront',
    pronunciation: '/ˈweɪv.frʌnt/',
    pronunciationLabel: 'WAVE-front',
    role: 'Audio',
    tone: 'amber',
    summary: 'An audio and acoustics engine built to make sound behave like part of the world.',
    introduction:
      'Wavefront is designed around real-time-safe audio behavior, sample-accurate timing, bounded streaming, explicit device recovery, and optional feature tiers that disappear when disabled.',
    purposeTitle: 'Make sound behave like part of the world.',
    ambitionTitle: 'Sound that travels, changes, and carries physical weight.',
    directionTitle: 'Build a signal path that can survive the real-time boundary.',
    ambition: [
      'Sample-accurate music and world timing',
      'Spatial playback and acoustics that respond to the environment',
      'A real-time-safe signal path with recoverable devices',
      'Optional voice and acoustics systems that disappear cleanly when disabled',
    ],
    direction: [
      'Device abstraction and real-time-safe callback',
      'Streaming decode and immutable DSP graphs',
      'Spatial playback, music timing, and diagnostics',
      'Optional acoustics and voice packs',
    ],
    specUrl: 'https://github.com/bybrooklyn/meridian/blob/main/specs/AUDIO_MUSIC_AND_ACOUSTICS_SPEC.md',
  },
  {
    slug: 'alluvium',
    name: 'Alluvium',
    pronunciation: '/əˈluː.vi.əm/',
    pronunciationLabel: 'uh-LOO-vee-um',
    role: 'Procedural authoring',
    tone: 'paper',
    summary: 'A procedural authoring system for plants, terrain, weathering, and the source work believable worlds demand.',
    introduction:
      'Alluvium treats recipes, fields, stable generated identity, overrides, provenance, and cooking as one inspectable source pipeline. Its first bounded source foundation is implemented; its production integrations remain ahead.',
    purposeTitle: 'Build large worlds without making their source mysterious.',
    ambitionTitle: 'Plants, terrain, and generated work that remain editable and explainable.',
    directionTitle: 'Grow from strict recipes into a complete authoring system.',
    ambition: [
      'Procedural plants and ecosystems with stable generated identity',
      'Terrain, materials, weathering, and environmental recipes in one traceable pipeline',
      'Hand-authored overrides that survive regeneration',
      'Cooked results that do not force the authoring system into shipped games',
    ],
    direction: [
      'Environmental proving recipes and public-safe corpus',
      'Terrain, vegetation, material, and weathering integrations',
      'Native visual authoring and runtime-safe recipes',
      'Measured execution expansion where evidence justifies it',
    ],
    specUrl: 'https://github.com/bybrooklyn/meridian/blob/main/specs/PROCEDURAL_AUTHORING_SPEC.md',
  },
];

export const subsystemBySlug = Object.fromEntries(
  subsystems.map((subsystem) => [subsystem.slug, subsystem]),
) as Record<Subsystem['slug'], Subsystem>;
