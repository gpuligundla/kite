# Build from the REPO ROOT: az acr build --registry <acr> --image kite-web:latest -f apps/web/Dockerfile .
#
# The web app imports the workspace packages (@kite/client, @kite/games, @kite/movie) as TypeScript source,
# so the build needs the npm workspace, not only apps/web. next.config.ts sets output: "standalone", which
# mirrors the workspace layout: the server ends up at apps/web/server.js.
# BRAIN_URL is read at request time, so one image works against any brain.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/client/package.json packages/client/
COPY packages/games/package.json packages/games/
COPY packages/movie/package.json packages/movie/
RUN npm ci --ignore-scripts
COPY packages ./packages
# The parent console names concepts from the brain's own catalog (components/parent/model.ts imports it).
COPY brain/kite_brain/concepts.json ./brain/kite_brain/concepts.json
COPY apps/web ./apps/web
RUN npm run build -w apps/web

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
