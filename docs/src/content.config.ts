import { defineCollection } from 'astro:content'
import { docsLoader } from '@astrojs/starlight/loaders'
import { docsSchema } from '@astrojs/starlight/schema'
import { changelogsLoader } from 'starlight-changelogs/loader'

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
  changelogs: defineCollection({
    loader: changelogsLoader([
      {
        provider: 'changeset',
        base: 'changelog/core',
        changelog: '../packages/core/CHANGELOG.md',
      },
      {
        provider: 'changeset',
        base: 'changelog/plugin-bun',
        changelog: '../packages/plugin-bun/CHANGELOG.md',
      },
      {
        provider: 'changeset',
        base: 'changelog/plugin-vitest',
        changelog: '../packages/plugin-vitest/CHANGELOG.md',
      },
      {
        provider: 'changeset',
        base: 'changelog/store-sqlite',
        changelog: '../packages/store-sqlite/CHANGELOG.md',
      },
      {
        provider: 'changeset',
        base: 'changelog/store-turso',
        changelog: '../packages/store-turso/CHANGELOG.md',
      },
      {
        provider: 'changeset',
        base: 'changelog/store-supabase',
        changelog: '../packages/store-supabase/CHANGELOG.md',
      },
      {
        provider: 'changeset',
        base: 'changelog/store-postgres',
        changelog: '../packages/store-postgres/CHANGELOG.md',
      },
    ]),
  }),
}
