/**
 * Test fixtures and contract-test runner for store adapters.
 *
 * Every `@flaky-tests/store-*` package runs `runContractTests()` against
 * its own `IStore` implementation to verify compliance with the core
 * contract — same test suite, different backends. Fixture builders
 * (`daysAgo`, `makeFailure`, `makeRun`) generate deterministic test data
 * shared across all store tests.
 *
 * @module
 */
export { runContractTests } from './contract'
export { daysAgo, makeFailure, makeRun } from './fixtures'
