FROM node:22-alpine AS workspace

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.12.1 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:22-alpine AS api

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.12.1 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY --from=workspace /app/packages/api/package.json packages/api/package.json
COPY --from=workspace /app/packages/api/dist packages/api/dist
COPY --from=workspace /app/packages/api/migrations packages/api/migrations
COPY --from=workspace /app/packages/ai/package.json packages/ai/package.json
COPY --from=workspace /app/packages/ai/dist packages/ai/dist
COPY --from=workspace /app/packages/engine/package.json packages/engine/package.json
COPY --from=workspace /app/packages/engine/dist packages/engine/dist
COPY --from=workspace /app/packages/grounding/package.json packages/grounding/package.json
COPY --from=workspace /app/packages/grounding/dist packages/grounding/dist
COPY --from=workspace /app/packages/insights/package.json packages/insights/package.json
COPY --from=workspace /app/packages/insights/dist packages/insights/dist
COPY --from=workspace /app/packages/jobs/package.json packages/jobs/package.json
COPY --from=workspace /app/packages/jobs/dist packages/jobs/dist
COPY --from=workspace /app/packages/sms/package.json packages/sms/package.json
COPY --from=workspace /app/packages/sms/dist packages/sms/dist
COPY --from=workspace /app/packages/telegram/package.json packages/telegram/package.json
COPY --from=workspace /app/packages/telegram/dist packages/telegram/dist
COPY --from=workspace /app/packages/voice/package.json packages/voice/package.json
COPY --from=workspace /app/packages/voice/dist packages/voice/dist
COPY --from=workspace /app/packages/locales-tools/package.json packages/locales-tools/package.json
COPY --from=workspace /app/packages/locales-tools/dist packages/locales-tools/dist
COPY --from=workspace /app/packages/lti/package.json packages/lti/package.json
COPY --from=workspace /app/packages/lti/dist packages/lti/dist
COPY --from=workspace /app/locales locales
COPY --from=workspace /app/content content
COPY --from=workspace /app/scripts/seed.mjs scripts/seed.mjs
COPY --from=workspace /app/scripts/local-scheduler.mjs scripts/local-scheduler.mjs
RUN pnpm install --prod --frozen-lockfile --filter @dimts/api...

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "packages/api/dist/server.js"]

FROM nginx:alpine AS web

COPY packages/widget/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=workspace /app/packages/widget/dist /usr/share/nginx/html
EXPOSE 80
