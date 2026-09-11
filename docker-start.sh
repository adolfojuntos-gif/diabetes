#!/bin/sh
# Bring the database up to the current schema, seed the content tables, and start the server.
# Both steps are idempotent, so a restart or a redeploy is safe.
set -e
echo "steady: pushing schema to $DATABASE_URL"
./node_modules/.bin/drizzle-kit push --force || echo "steady: schema push reported a problem, continuing"
echo "steady: seeding content tables"
./node_modules/.bin/tsx scripts/seed.ts || echo "steady: seed reported a problem, continuing"
echo "steady: seeding the carbohydrate reference"
./node_modules/.bin/tsx scripts/seedFoods.ts || echo "steady: food seed reported a problem, continuing"
if [ "$SEED_DEMO" = "1" ]; then
  echo "steady: writing fictional demo data"
  ./node_modules/.bin/tsx scripts/demo.ts || echo "steady: demo seed reported a problem, continuing"
fi
echo "steady: starting server on $PORT"
exec node server.js
