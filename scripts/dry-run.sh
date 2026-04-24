bun run build:types
bun run build

for p in packages/core packages/plugin-bun packages/plugin-vitest \
         packages/store-sqlite packages/store-postgres \
         packages/store-supabase packages/store-turso; do
  echo "=== $p ==="
  (cd "$p" && npm publish --dry-run --access public \
  && npx jsr publish --dry-run --allow-dirty --allow-slow-types)
done