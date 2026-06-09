FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN ./node_modules/.bin/prisma generate --schema apps/api/prisma/schema.prisma
RUN pnpm --filter @qqueue/api... build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app /app
CMD ["node", "apps/api/dist/index.js"]
