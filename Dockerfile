# API container. Exists because of Playwright: concept generation screenshots
# prospects' live sites and renders generated pages to PNG, and Railway's
# nixpacks autodetection installs Node but none of Chromium's system libraries
# (libnss3, libatk, libgbm, fonts...). This base image ships the browser and
# every shared object it needs, version-matched to the `playwright` dependency
# in apps/api/package.json — bump BOTH together or the browser download and the
# client will disagree at runtime.
FROM mcr.microsoft.com/playwright:v1.62.1-jammy

WORKDIR /app

# The base image preinstalls browsers here as root; the app must look in the
# same place rather than re-downloading into a home dir that may not exist.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN corepack enable

# Manifests first so the dependency layer survives source-only edits. The
# workspace root, both apps, and the shared package all need their package.json
# present before pnpm can resolve the workspace graph.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/

# Dev dependencies are required at this stage: the build runs `tsc`, and the
# CMD below runs `tsx` at runtime. NODE_ENV=production is deliberately NOT set
# yet — pnpm honors it during install and silently skips devDependencies,
# which is where both of those live. Setting it only after the build (below)
# keeps runtime behavior correct without breaking the build that produces it.
RUN pnpm install --frozen-lockfile --filter api...

COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

# Not an artifact step — nothing here ships `dist`. This runs so a type error
# fails the image build instead of the deploy.
RUN pnpm --filter api build

ENV NODE_ENV=production

EXPOSE 3001

# Runs the TypeScript source through tsx rather than `node dist/index.js`,
# because @agent-platform/shared's package.json "main" points at src/index.ts —
# plain node hits `SyntaxError: Unexpected token 'export'` on the workspace
# import. tsx is therefore a runtime dependency here, which is also why this
# image never prunes dev dependencies.
CMD ["pnpm", "--filter", "api", "exec", "tsx", "src/index.ts"]
