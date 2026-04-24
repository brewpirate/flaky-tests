import starlight from '@astrojs/starlight'
import catppuccin from '@catppuccin/starlight'
import { defineConfig } from 'astro/config'
import starlightChangelogs, {
  makeChangelogsSidebarLinks,
} from 'starlight-changelogs'
import starlightLinksValidator from 'starlight-links-validator'
import starlightLlmsTxt from 'starlight-llms-txt'
import starlightTypeDoc, { typeDocSidebarGroup } from 'starlight-typedoc'

export default defineConfig({
  site: 'https://brewpirate.github.io',
  base: '/flaky-tests',
  integrations: [
    starlight({
      title: 'flaky-tests',
      description:
        'Zero-friction flaky test detection for Bun and Vitest. Catches patterns, generates prompts, opens issues.',
      favicon: '/favicon.svg',
      lastUpdated: true,
      logo: {
        light: './src/assets/logo-light.svg',
        dark: './src/assets/logo-dark.svg',
        replacesTitle: false,
      },
      plugins: [
        catppuccin({
          dark: { flavor: 'mocha', accent: 'red' },
          light: { flavor: 'latte', accent: 'red' },
        }),
        starlightLinksValidator(),
        starlightLlmsTxt(),
        starlightTypeDoc({
          entryPoints: ['../packages/core/src/index.ts'],
          tsconfig: '../packages/core/tsconfig.json',
          output: 'api',
          sidebar: { label: 'API (generated)', collapsed: true },
        }),
        starlightChangelogs(),
      ],
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/brewpirate/flaky-tests',
        },
      ],
      editLink: {
        baseUrl: 'https://github.com/brewpirate/flaky-tests/edit/main/docs/',
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
            { label: 'Install', slug: 'getting-started/install' },
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
            {
              label: 'Migrating between stores',
              slug: 'guides/migrating-stores',
            },
            { label: 'HTML report', slug: 'guides/html-report' },
            { label: 'CI setup', slug: 'guides/ci-setup' },
            {
              label: 'Scheduled detection',
              slug: 'guides/scheduled-detection',
            },
            { label: 'Troubleshooting', slug: 'guides/troubleshooting' },
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
            { label: 'Data model & privacy', slug: 'reference/data-model' },
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
        typeDocSidebarGroup,
        {
          label: 'Changelogs',
          collapsed: true,
          items: makeChangelogsSidebarLinks([
            {
              type: 'recent',
              base: 'changelog/core',
              label: '@flaky-tests/core',
            },
            {
              type: 'recent',
              base: 'changelog/plugin-bun',
              label: '@flaky-tests/plugin-bun',
            },
            {
              type: 'recent',
              base: 'changelog/plugin-vitest',
              label: '@flaky-tests/plugin-vitest',
            },
            {
              type: 'recent',
              base: 'changelog/store-sqlite',
              label: '@flaky-tests/store-sqlite',
            },
            {
              type: 'recent',
              base: 'changelog/store-turso',
              label: '@flaky-tests/store-turso',
            },
            {
              type: 'recent',
              base: 'changelog/store-supabase',
              label: '@flaky-tests/store-supabase',
            },
            {
              type: 'recent',
              base: 'changelog/store-postgres',
              label: '@flaky-tests/store-postgres',
            },
          ]),
        },
      ],
    }),
  ],
})
