# pnpm sürümü package.json'daki `packageManager` alanından geliyor; corepack onu
# kendisi okuyor, buraya ikinci bir yere yazmıyoruz ki ayrışamasınlar.
FROM node:24-alpine AS dependencies
WORKDIR /app
RUN corepack enable
# `pnpm-workspace.yaml` şart: `allowBuilds` kararlarını o taşıyor ve o dosya
# olmadan pnpm 12 `ERR_PNPM_IGNORED_BUILDS` ile duruyor.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:24-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
# `src/instrumentation.ts` sunucu açılışında ortamı doğruluyor ve `next build`
# sayfa verisi toplarken o yolu da çalıştırıyor: değişkenler olmadan build
# düşüyor. Buradaki değerler yalnızca doğrulamayı geçmek için var ve imaja
# **gömülmüyorlar** — panelin bütün rotaları `force-dynamic`, tek statik çıktı
# `/_not-found` ve o da ortamdan hiçbir şey okumuyor. Gerçek değerler çalışma
# anında veriliyor.
ENV KOALA_API_BASE_URL=http://build.invalid
ENV ADMIN_PUBLIC_ORIGIN=http://localhost:3000
RUN pnpm build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
# `public/` yok; kopyalanırsa build kırılır.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
# `/api/health` bilerek oturum kapısının dışında ve backend'e hiçbir şey sormuyor:
# panelin kendi ayakta olup olmadığını söylüyor, backend'in değil.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
