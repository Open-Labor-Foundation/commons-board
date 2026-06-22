FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
# Next.js monorepo standalone output nests under apps/web/
COPY --from=build /app/.next/standalone/apps/web ./
COPY --from=build /app/.next/standalone/node_modules ./node_modules
COPY --from=build /app/.next/static ./.next/static
USER app
EXPOSE 3000
CMD ["node", "server.js"]
