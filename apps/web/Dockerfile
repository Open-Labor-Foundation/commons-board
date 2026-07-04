FROM node:22-alpine
WORKDIR /app

# Copy entrypoint before switching user
COPY apps/web/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh \
  && addgroup -S app \
  && adduser -S app -G app \
  && chown app:app /app

USER app

# Install dependencies from root workspace lock file
COPY --chown=app:app package.json package-lock.json ./
COPY --chown=app:app packages/shared/package.json packages/shared/
COPY --chown=app:app packages/connectors/package.json packages/connectors/
COPY --chown=app:app apps/web/package.json apps/web/
RUN npm ci

# Copy all source (kept in image for on-demand rebuilds)
COPY --chown=app:app packages/shared packages/shared
COPY --chown=app:app packages/connectors packages/connectors
COPY --chown=app:app apps/web apps/web

ENV NODE_ENV=production

# Initial production build; move static assets into standalone for serving
RUN cd /app/apps/web && npm run build \
  && cp -r .next/static .next/standalone/apps/web/.next/static \
  && cp -r public .next/standalone/apps/web/public 2>/dev/null || true \
  && mkdir -p /app/signals

WORKDIR /app/apps/web
EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
