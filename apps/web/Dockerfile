FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS build
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci --no-audit --no-fund
COPY apps/web apps/web
ENV NEXT_TELEMETRY_DISABLED=1 API_INTERNAL_URL=http://api:8000
RUN npm run build -w apps/web
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914
WORKDIR /workspace
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -g 10001 synqra && adduser -D -u 10001 -G synqra synqra
COPY --from=build --chown=synqra:synqra /workspace/apps/web/.next/standalone ./
COPY --from=build --chown=synqra:synqra /workspace/apps/web/.next/static ./apps/web/.next/static
USER synqra
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
