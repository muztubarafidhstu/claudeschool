# All-in-one image (license API + admin panel) for a VPS: serves https://scool.rafid5.com
FROM node:22-alpine AS admin
WORKDIR /app/admin
COPY admin/package*.json ./
RUN npm ci
COPY admin/ ./
RUN npm run build

FROM node:22-alpine AS server
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production ADMIN_STATIC_DIR=/app/admin/out
WORKDIR /app/server
COPY --from=server /app/server/node_modules ./node_modules
COPY --from=server /app/server/dist ./dist
COPY --from=server /app/server/db ./db
COPY --from=server /app/server/package.json ./
COPY --from=admin /app/admin/out /app/admin/out
RUN mkdir -p releases && chown -R node:node /app
USER node
EXPOSE 8080
CMD ["node", "dist/src/index.js"]
