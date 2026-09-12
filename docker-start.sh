#!/bin/sh
# Bring the deployment up to the current schema, then start the server.
#
# One step now, not four. The old script pushed a schema to a single database and then ran three
# seed scripts that each need an account named on the command line, so on the new architecture every
# one of them exited immediately. Each failure was swallowed by a `|| echo`, which meant the machine
# started anyway with no control database and served an error page for every request.
#
# `bootstrapDeploy.ts` does the whole job and is idempotent, so a restart, a suspend and resume, or
# a redeploy are all safe. It exits non-zero if the control plane cannot be prepared, and that
# SHOULD stop the boot: a server whose control database has no tables has nothing useful to serve,
# and a machine that refuses to start is a problem visible in the deploy output.
set -e

echo "steady: bootstrapping"
./node_modules/.bin/tsx scripts/bootstrapDeploy.ts

echo "steady: starting server on $PORT"
exec node server.js
