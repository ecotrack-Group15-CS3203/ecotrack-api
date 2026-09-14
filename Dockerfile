# Production image. Configuration comes entirely from the environment (--env-file);
# nothing environment-specific is baked in.
#
#   docker build -t ecotrack-api .
#   docker run --rm --env-file .env ecotrack-api node dist/database/migrate.js
#   docker run -d --env-file .env -p 127.0.0.1:4000:4000 ecotrack-api

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.16.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# migrate.js reads migrations from this path, relative to the working directory.
COPY --from=build /app/src/database/drizzle/migrations ./src/database/drizzle/migrations
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
