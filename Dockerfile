FROM node:24.18.0-bookworm-slim AS base
WORKDIR /app
ENV TZ=Asia/Seoul NEXT_TELEMETRY_DISABLED=1

FROM base AS dependencies
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

FROM dependencies AS api-build
COPY tsconfig.base.json ./
COPY packages/shared/src packages/shared/src
COPY apps/api apps/api
RUN npm run build --workspace apps/api

FROM dependencies AS web-build
COPY tsconfig.base.json ./
COPY packages/shared/src packages/shared/src
COPY apps/web apps/web
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=${API_INTERNAL_URL}
RUN npm run build --workspace apps/web

# API 실행 이미지에는 개발·테스트 도구를 설치하지 않는다.
FROM base AS api-dependencies
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci --omit=dev --workspace apps/api --include-workspace-root=false

FROM api-dependencies AS api
ENV NODE_ENV=production
COPY --from=api-build /app/apps/api/dist apps/api/dist
USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]

# Next.js가 추출한 실행 파일과 정적 파일만 웹 이미지로 가져온다.
FROM base AS web
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=web-build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /app/apps/web/.next/static apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
