import { documentationProduct, type DocsNavGroup } from './documentation';

const docsRoot = '/alchemist/docs';
const item = (id: string, label: string, description: string, route = id) => ({
  id,
  label,
  description,
  href: route ? `${docsRoot}/${route.replace(/\/index$/u, '')}/` : `${docsRoot}/`,
});

export const alchemistDocsGroups: DocsNavGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'What Alchemist does, how it is licensed, and where to begin.',
    items: [
      item('overview', 'Alchemist', 'What the application does and where to start.', ''),
      item('open-source', 'Open Source', 'AGPLv3 software, CC BY-SA documentation, and project policy.'),
    ],
  },
  {
    id: 'get-started',
    label: 'Get Started',
    description: 'Install Alchemist and process a library safely.',
    items: [
      item('installation', 'Install', 'Docker, native binary, and source installation paths.'),
      item('first-run', 'First Run', 'Complete setup and create the first account.'),
      item('quick-start', 'Quick Start', 'Start the engine and understand the first decisions.'),
      item('docker', 'Docker', 'Compose, volumes, updates, and container behavior.'),
    ],
  },
  {
    id: 'use-cases',
    label: 'Use Cases',
    description: 'Apply Alchemist to common media-library goals.',
    items: [
      item('jellyfin', 'Jellyfin', 'Pre-transcode a Jellyfin library and refresh it safely.'),
      item('av1', 'AV1', 'Choose and operate AV1 hardware or software encoding.'),
    ],
  },
  {
    id: 'comparisons',
    label: 'Comparisons',
    description: 'Understand Alchemist’s deliberately narrow product shape.',
    items: [
      item('alternatives', 'Alternatives', 'Choose between Alchemist and flow-oriented tools.'),
      item('alternatives/tdarr', 'Alchemist vs Tdarr', 'Compare deterministic profiles with node flows.'),
      item('alternatives/fileflows', 'Alchemist vs FileFlows', 'Compare deployment, licensing, and configuration.'),
      item('migrate-from-tdarr', 'Migrate from Tdarr', 'Run side by side and cut over deliberately.'),
    ],
  },
  {
    id: 'guides',
    label: 'Guides',
    description: 'Configure libraries, streams, schedules, and operations.',
    items: [
      item('hardware', 'Hardware Acceleration', 'How encoder detection and selection work.'),
      item('gpu-passthrough', 'GPU Passthrough', 'Expose supported GPUs to Docker safely.'),
      item('library-setup', 'Library Setup', 'Add watch directories and organize media.'),
      item('profiles', 'Profiles', 'Set per-library transcoding behavior.'),
      item('stream-rules', 'Stream Rules', 'Control retained audio streams.'),
      item('scheduling', 'Scheduling', 'Restrict new jobs to chosen windows.'),
      item('notifications', 'Notifications', 'Configure supported notification targets.'),
      item('library-doctor', 'Library Doctor', 'Identify corrupt and unreadable files.'),
      item('web-interface', 'Web Interface', 'Understand each dashboard section.'),
    ],
  },
  {
    id: 'hardware',
    label: 'Hardware',
    description: 'Vendor-specific drivers, encoders, and fallback behavior.',
    items: [
      item('hardware/nvidia', 'NVIDIA', 'Configure and diagnose NVENC.'),
      item('hardware/intel', 'Intel', 'Configure VAAPI and Quick Sync.'),
      item('hardware/amd', 'AMD', 'Configure VAAPI on Linux and AMF on Windows.'),
      item('hardware/apple', 'Apple', 'Use VideoToolbox on macOS.'),
      item('hardware/cpu', 'CPU Encoding', 'Use SVT-AV1, x265, or x264 fallback.'),
    ],
  },
  {
    id: 'reference',
    label: 'Reference',
    description: 'Detailed application, API, engine, and troubleshooting contracts.',
    items: [
      item('configuration-reference', 'Configuration Reference', 'Every supported configuration field.'),
      item('api', 'API Reference', 'REST and SSE routes, authentication, and integrations.'),
      item('mcp', 'MCP Server', 'Read-only local assistant integration.'),
      item('codecs', 'Codecs', 'AV1, HEVC, and H.264 tradeoffs.'),
      item('analyzer', 'Media Analyzer', 'How FFprobe facts enter planning.'),
      item('planner', 'Planner', 'Deterministic transcode, remux, and skip decisions.'),
      item('skip-decisions', 'Skip Decisions', 'Every structured reason Alchemist skips work.'),
      item('engine-lifecycle', 'Engine Lifecycle', 'States, transitions, cancellation, and recovery.'),
      item('engine-modes', 'Engine Modes & States', 'Background, balanced, and throughput behavior.'),
      item('environment-variables', 'Environment Variables', 'Runtime environment configuration.'),
      item('observability', 'Observability', 'Prometheus metrics and structured logs.'),
      item('database-schema', 'Database Schema', 'SQLite schema and migration policy.'),
      item('architecture', 'Architecture', 'Application pipeline and source layout.'),
      item('errors', 'Error Reference', 'Stable error and decision anchors.'),
      item('troubleshooting', 'Troubleshooting', 'Common operational failures and recovery.'),
      item('troubleshooting/nvenc-not-detected', 'NVENC Not Detected', 'Diagnose NVIDIA device and FFmpeg access.'),
      item('troubleshooting/vaapi-not-detected', 'VAAPI Not Detected', 'Diagnose Linux render devices and drivers.'),
      item('troubleshooting/jellyfin-direct-play-failing', 'Jellyfin Direct Play Fails', 'Diagnose client compatibility after processing.'),
      item('faq', 'FAQ', 'Common deployment and licensing questions.'),
      item('changelog', 'Changelog', 'Alchemist release history.'),
    ],
  },
  {
    id: 'contributing',
    label: 'Contributing',
    description: 'Report issues and work on Alchemist locally.',
    items: [
      item('contributing/overview', 'Contributing Overview', 'Issue, feature, and licensing guidance.'),
      item('contributing/development', 'Development Setup', 'Bootstrap and validate a contributor checkout.'),
    ],
  },
];

export const alchemistDocumentation = documentationProduct({
  id: 'alchemist',
  name: 'Alchemist',
  docsTitle: 'Alchemist docs',
  docsRoot: `${docsRoot}/`,
  groups: alchemistDocsGroups,
  searchPlaceholder: 'NVENC, Docker, profiles, skip decisions…',
  licenseHolder: 'Brooklyn Halmstad',
  sourceRepository: 'https://github.com/bybrooklyn/alchemist',
  sourcePublic: true,
});

export const alchemistDocsItemById: Readonly<Record<string, (typeof alchemistDocumentation.items)[number]>> = Object.fromEntries(
  alchemistDocumentation.items.map((entry) => [entry.id, entry]),
);
