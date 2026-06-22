# commons-board API — production image
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/connectors/package.json packages/connectors/
COPY services/api/package.json services/api/
RUN npm ci
COPY packages/shared packages/shared
COPY packages/connectors packages/connectors
COPY services/api services/api
RUN npm run build -w @commons-board/shared \
 && npm run build -w @commons-board/connectors \
 && npm run build -w @commons-board/api

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app && mkdir -p /app/.data && chown app:app /app/.data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/packages/connectors ./packages/connectors
COPY --from=build /app/services/api ./services/api
USER app
EXPOSE 4000
CMD ["node", "services/api/dist/index.js"]
