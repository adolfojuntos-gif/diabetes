# Steady on Fly.io. Multi-stage: build with dev deps, ship the standalone output only.
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:24-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The build does not touch the database. DATABASE_URL is read at runtime.
ENV NEXT_TELEMETRY_DISABLED=1
# A throwaway path, so a stray build-time query cannot write into the image layer.
ENV DATABASE_URL=file:/tmp/build.db
RUN npm run build

FROM node:24-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 HOSTNAME=0.0.0.0
# The SQLite file lives on a Fly volume mounted here, so it survives a redeploy.
ENV DATABASE_URL=file:/data/steady.db
RUN mkdir -p /data

# The standalone server, its traced node_modules, and the static assets.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# Schema push and seed need drizzle-kit and tsx, which the standalone trace leaves out.
COPY --from=build /app/node_modules/.bin ./node_modules/.bin
COPY --from=build /app/node_modules/drizzle-kit ./node_modules/drizzle-kit
COPY --from=build /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=build /app/node_modules/tsx ./node_modules/tsx
COPY --from=build /app/node_modules/esbuild ./node_modules/esbuild
COPY --from=build /app/node_modules/@esbuild ./node_modules/@esbuild
COPY --from=build /app/node_modules/@libsql ./node_modules/@libsql
COPY --from=build /app/node_modules/libsql ./node_modules/libsql
COPY --from=build /app/node_modules/dotenv ./node_modules/dotenv
COPY --from=build /app/node_modules/zod ./node_modules/zod
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY docker-start.sh ./docker-start.sh
RUN chmod +x ./docker-start.sh

EXPOSE 8080
CMD ["./docker-start.sh"]
