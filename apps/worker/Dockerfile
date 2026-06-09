FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @qqueue/worker... build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app /app
CMD ["node", "apps/worker/dist/index.js"]
