# Payroll — Railway deploy (Vercel → Railway consolidation, 2026-06-24).
# Multi-stage; emits Next.js standalone output. Secrets come from Railway's env panel at
# runtime — only the PUBLIC NEXT_PUBLIC_* client config is needed at build time (Next inlines
# every NEXT_PUBLIC_* at `next build`). Base is debian-slim (not alpine) because the PDF route
# (/api/payroll/pdf) ships @sparticuz/chromium, which needs glibc, not musl.

# ---- deps ---------------------------------------------------------------------------------------
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder ------------------------------------------------------------------------------------
FROM node:20-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# PUBLIC client config, inlined into the browser bundle at build time. All public-safe (the
# project URL + publishable/anon keys); no secret is ever baked in. Railway passes the service's
# Variables to the Docker build as args automatically.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ---- runner -------------------------------------------------------------------------------------
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Next's standalone server.js binds to process.env.HOSTNAME; Docker defaults HOSTNAME to the
# container ID, so without this it listens on an interface Railway's proxy can't reach → 502.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

# `output: 'standalone'` produces a self-contained server + the minimal node_modules it needs.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
