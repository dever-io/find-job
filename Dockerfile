# ── build stage ──────────────────────────────────────────
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
# оставляем только прод-зависимости для рантайма
RUN npm prune --omit=dev

# ── runtime stage ────────────────────────────────────────
FROM node:22-slim AS run
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# каталог для volume (персистентное хранилище пользователей/подписок)
RUN mkdir -p /data
CMD ["node", "dist/index.js"]
