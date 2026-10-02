FROM node:24-bookworm-slim AS build

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM node:24-bookworm-slim AS runtime

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --prod --frozen-lockfile

# Bake the in-process embedding model into the image (kept above the dist copy
# so code changes reuse this layer). Set to "off" to skip.
ARG NITPICKR_EMBEDDING_MODEL=nomic-ai/nomic-embed-text-v1.5
ENV NITPICKR_EMBEDDING_CACHE_DIR=/app/models
COPY scripts/fetch-embedding-model.mjs ./scripts/
RUN node scripts/fetch-embedding-model.mjs "$NITPICKR_EMBEDDING_MODEL" "$NITPICKR_EMBEDDING_CACHE_DIR"

COPY --from=build /app/dist ./dist

CMD ["pnpm", "start:api"]
