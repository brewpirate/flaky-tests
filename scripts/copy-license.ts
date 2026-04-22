#!/usr/bin/env bun
import { copyFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const repoRoot = join(import.meta.dir, '..')
const licensePath = join(repoRoot, 'LICENSE')
const packagesDir = join(repoRoot, 'packages')

const skipPackages = new Set(['docs'])

const entries = readdirSync(packagesDir)
for (const entry of entries) {
  if (skipPackages.has(entry)) continue
  const packageDir = join(packagesDir, entry)
  if (!statSync(packageDir).isDirectory()) continue
  const destination = join(packageDir, 'LICENSE')
  copyFileSync(licensePath, destination)
  console.log(`copied LICENSE -> ${destination}`)
}
