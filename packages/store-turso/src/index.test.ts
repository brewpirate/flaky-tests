import { describe, expect, test } from 'bun:test'
import { StoreError } from '@flaky-tests/core'
import { TursoStore } from './index'

// Unit-tier: verifies the error-wrapping contract without requiring a
// remote libSQL service. `file::memory:` runs fully in-process.

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
