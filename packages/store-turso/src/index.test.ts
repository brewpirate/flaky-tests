import { describe, expect, test } from 'bun:test'
import { SQLITE_MIGRATIONS, StoreError } from '@flaky-tests/core'
import { TursoStore } from './index'

// Unit-tier: uses `file::memory:` so nothing touches a remote libSQL service.

describe('TursoStore — wraps driver errors in StoreError', () => {
  test('operations on a closed client throw StoreError, not the raw libSQL error', async () => {
    const store = new TursoStore({ url: 'file::memory:' })
    await store.migrate()
    await store.close()

    try {
      await store.insertRun({
        runId: 'r1',
        startedAt: new Date().toISOString(),
      })
      throw new Error('expected insertRun to reject')
    } catch (error) {
      expect(error).toBeInstanceOf(StoreError)
      expect((error as StoreError).package).toBe('@flaky-tests/store-turso')
      expect((error as StoreError).method).toBe('insertRun')
      // `cause` preserved so stacks stay inspectable.
      expect((error as StoreError).cause).toBeDefined()
    }
  })
})

describe('TursoStore — fresh-database path', () => {
  test('migrate() on an empty store creates the schema so insertRun works', async () => {
    // Guards the #42 fix: a fresh remote-store DB must not fail with
    // `no such table: failures` once the CLI has run migrate().
    const store = new TursoStore({ url: 'file::memory:' })
    try {
      await store.migrate()
      await store.insertRun({
        runId: 'r1',
        startedAt: new Date().toISOString(),
      })
      const patterns = await store.getNewPatterns()
      expect(patterns).toEqual([])
    } finally {
      await store.close()
    }
  })
})

describe('TursoStore — schema_version migrations', () => {
  test('fresh DB records every migration in schema_version', async () => {
    const store = new TursoStore({ url: 'file::memory:' })
    try {
      await store.migrate()
      const applied = await store.getAppliedMigrations()
      expect(applied.map((row) => row.version)).toEqual(
        SQLITE_MIGRATIONS.map((migration) => migration.version),
      )
    } finally {
      await store.close()
    }
  })

  test('migrate() is idempotent — a second call adds no new rows', async () => {
    const store = new TursoStore({ url: 'file::memory:' })
    try {
      await store.migrate()
      const first = await store.getAppliedMigrations()
      await store.migrate()
      const second = await store.getAppliedMigrations()
      expect(second).toEqual(first)
    } finally {
      await store.close()
    }
  })
})
