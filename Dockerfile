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
RUN find packages services -name '*.tsbuildinfo' -delete \
  && rm -rf packages/shared/dist packages/connectors/dist services/api/dist \
  && npm run build -w @commons-board/shared \
  && npm run build -w @commons-board/connectors \
  && npm run build -w @commons-board/api

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# DOCKER_GID should match the host docker group GID (default 999 on most Linux systems).
# Override at build time: docker build --build-arg DOCKER_GID=$(stat -c %g /var/run/docker.sock) .
ARG DOCKER_GID=999
RUN addgroup -S app && adduser -S app -G app \
  && mkdir -p /app/.data && chown app:app /app/.data \
  && addgroup -g ${DOCKER_GID} dockersock 2>/dev/null || true \
  && adduser app dockersock 2>/dev/null || true
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/packages/connectors ./packages/connectors
COPY --from=build /app/services/api ./services/api
RUN mkdir -p /app/addins /app/signals
USER app
EXPOSE 4000
CMD ["node", "services/api/dist/index.js"]
