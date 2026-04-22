import starlight from '@astrojs/starlight'
import catppuccin from '@catppuccin/starlight'
import { defineConfig } from 'astro/config'

export default defineConfig({
  site: 'https://brewpirate.github.io',
  base: '/flaky-tests',
  integrations: [
    starlight({
      title: 'flaky-tests',
      description:
        'Zero-friction flaky test detection for Bun and Vitest. Catches patterns, generates prompts, opens issues.',
      logo: {
        src: './src/assets/mrflaky.png',
        replacesTitle: false,
      },
      plugins: [
        catppuccin({
          dark: { flavor: 'mocha', accent: 'red' },
          light: { flavor: 'latte', accent: 'red' },
        }),
      ],
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/brewpirate/flaky-tests',
        },
      ],
      editLink: {
        baseUrl:
          'https://github.com/brewpirate/flaky-tests/edit/main/packages/docs/',
      },
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Introduction', slug: 'getting-started/introduction' },
            {
              label: 'What is a flaky test?',
              slug: 'getting-started/what-is-a-flaky-test',
            },
            { label: 'Quick Start', slug: 'getting-started/quick-start' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Setting up with Bun', slug: 'guides/bun' },
            { label: 'Setting up with Vitest', slug: 'guides/vitest' },
            { label: 'Choosing a store', slug: 'guides/choosing-a-store' },
            { label: 'Custom stores', slug: 'guides/custom-stores' },
            { label: 'HTML report', slug: 'guides/html-report' },
            { label: 'CI setup', slug: 'guides/ci-setup' },
            {
              label: 'Scheduled detection',
              slug: 'guides/scheduled-detection',
            },
          ],
        },
        {
          label: 'Stores',
          items: [
            { label: 'SQLite (local)', slug: 'stores/sqlite' },
            { label: 'Turso', slug: 'stores/turso' },
            { label: 'Supabase', slug: 'stores/supabase' },
            { label: 'Postgres / Neon', slug: 'stores/postgres' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Environment variables', slug: 'reference/env-vars' },
            { label: 'CLI commands', slug: 'reference/cli' },
            { label: 'IStore interface', slug: 'reference/istore' },
          ],
        },
        {
          label: 'GitHub Action',
          items: [
            { label: 'Inputs', slug: 'github-action/inputs' },
            {
              label: 'Example workflows',
              slug: 'github-action/example-workflows',
            },
          ],
        },
      ],
    }),
  ],
})
