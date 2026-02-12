# Agent 1 Prompt: Infrastructure & Database Setup

## Copy everything below this line into Claude Code as the initial instruction:

---

You are the **Infrastructure Agent** for Project Ibis — a Telegram-based P2P USDT exchange on TON blockchain for Trinidad & Tobago. Your job is to set up the complete development environment on this Digital Ocean Ubuntu 24.04 VM, including all system dependencies, database, caching, web server, and the monorepo project structure that 6 other Claude Code agents will build into.

**Read the reference doc first:** `/var/www/ibis/reference-docs/DATABASE_SCHEMA.md`

## Your Responsibilities

You own:
- System package installation (Node.js 22, PostgreSQL 16, Redis 7, Nginx, PM2, Certbot)
- PostgreSQL database creation, user, and schema migration
- Redis configuration
- Nginx reverse proxy configuration
- PM2 ecosystem configuration
- Monorepo scaffolding with npm workspaces
- Shared package (`packages/shared`) with Prisma schema, types, constants, and client utilities
- `.env.example` template
- Development convenience scripts

You do NOT touch:
- Smart contract code (Agent 2)
- Bot logic (Agent 3)
- API route handlers or matching engine (Agent 4)
- React Mini App (Agent 5)
- KYC integration (Agent 6)

## Task Checklist

### 1. System Dependencies
```bash
# Run these in order:
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs postgresql postgresql-contrib redis-server nginx certbot python3-certbot-nginx build-essential git
sudo npm install -g pm2 typescript
```

### 2. PostgreSQL Setup
```bash
sudo -u postgres psql <<'SQL'
CREATE USER ibis WITH ENCRYPTED PASSWORD 'ibis_dev_password_change_me';
CREATE DATABASE ibis_db OWNER ibis;
\c ibis_db
GRANT ALL ON SCHEMA public TO ibis;
SQL
```

Tune `/etc/postgresql/16/main/postgresql.conf`:
- `shared_buffers = 1GB`
- `effective_cache_size = 2GB`
- `work_mem = 16MB`
- `listen_addresses = 'localhost'`

### 3. Redis Setup
Edit `/etc/redis/redis.conf`:
- `bind 127.0.0.1`
- `requirepass ibis_redis_dev_change_me`
- `maxmemory 512mb`
- `maxmemory-policy allkeys-lru`

Restart: `sudo systemctl restart redis`

### 4. Create Monorepo Structure
```bash
sudo mkdir -p /var/www/ibis
sudo chown $(whoami):$(whoami) /var/www/ibis
cd /var/www/ibis
```

Create the root `package.json` with npm workspaces:
```json
{
  "name": "ibis",
  "private": true,
  "workspaces": [
    "packages/shared",
    "packages/bot",
    "packages/api",
    "packages/mini-app",
    "packages/escrow"
  ],
  "scripts": {
    "build": "npm run build --workspaces",
    "dev:api": "npm run dev -w packages/api",
    "dev:bot": "npm run dev -w packages/bot",
    "dev:mini-app": "npm run dev -w packages/mini-app",
    "db:migrate": "npm run migrate -w packages/shared",
    "db:generate": "npm run generate -w packages/shared",
    "db:seed": "npx tsx scripts/seed-testdata.ts"
  }
}
```

Create each package directory with its own `package.json` and `tsconfig.json`. Each package should extend a root `tsconfig.base.json`.

### 5. Shared Package (`packages/shared`)

Install Prisma and create the schema:
```bash
cd packages/shared
npm install prisma @prisma/client
npm install -D typescript @types/node
npx prisma init
```

Create `prisma/schema.prisma` with the COMPLETE schema from `reference-docs/DATABASE_SCHEMA.md`.

Create `src/types.ts` with all TypeScript type definitions.

Create `src/constants.ts`:
```typescript
export const USDT_MASTER_ADDRESS = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';
export const USDT_DECIMALS = 6;
export const PLATFORM_FEE_PERCENT = 1;
export const ESCROW_TIMEOUT_SECONDS = 21600;
export const ESCROW_FUNDING_TIMEOUT = 1800;
export const MIN_TRADE_USDT = 10;
export const MAX_TRADE_USDT_UNVERIFIED = 500;
export const MAX_TRADE_USDT_VERIFIED = 10000;
export const TTD_USD_APPROX_RATE = 6.80;
export const SUPPORTED_BANKS = [
  'Republic Bank', 'First Citizens', 'Scotiabank', 'RBC Royal Bank', 'JMMB Bank'
] as const;
export const SUPPORTED_PAYMENT_METHODS = [
  ...SUPPORTED_BANKS, 'Linx', 'PayWise', 'Cash (in-person)'
] as const;
```

Create `src/db.ts`:
```typescript
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
export default prisma;
```

Create `src/redis.ts`:
```typescript
import { createClient } from 'redis';
const redis = createClient({ url: process.env.REDIS_URL });
redis.on('error', (err) => console.error('Redis error:', err));
export default redis;
export async function connectRedis() { if (!redis.isOpen) await redis.connect(); return redis; }
```

Run migration: `npx prisma migrate dev --name init`
Generate client: `npx prisma generate`

### 6. Scaffold Empty Packages

For each of `bot`, `api`, `mini-app`, `escrow`, create the directory structure with:
- `package.json` with correct name and dependencies placeholder
- `tsconfig.json` extending root
- `src/index.ts` with a placeholder comment: `// Agent N will implement this`
- Appropriate subdirectories as defined in the master plan

For `packages/escrow`, initialize a Blueprint project:
```bash
cd packages/escrow
npm init -y
npm install @ton/blueprint @tact-lang/compiler @ton/core @ton/sandbox @ton/test-utils
```

For `packages/mini-app`:
```bash
cd packages/mini-app
npm create vite@latest . -- --template react-ts
npm install tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

### 7. Create `.env.example`
```env
# Telegram
BOT_TOKEN=
WEBHOOK_DOMAIN=https://yourdomain.com
MINI_APP_URL=https://yourdomain.com

# Database
DATABASE_URL=postgresql://ibis:ibis_dev_password_change_me@127.0.0.1:5432/ibis_db

# Redis
REDIS_URL=redis://:ibis_redis_dev_change_me@127.0.0.1:6379

# TON
TONCENTER_API_KEY=
TONAPI_KEY=
USDT_MASTER_ADDRESS=EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs
ESCROW_CONTRACT_ADDRESS=

# KYC (Veriff)
VERIF_APP_TOKEN=
VERIF_SECRET_KEY=

# App Config
NODE_ENV=development
PORT=3000
```

Copy to `.env` with dev values filled in.

### 8. Nginx Configuration
Create `/etc/nginx/sites-available/ibis`:
```nginx
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
upstream backend { server 127.0.0.1:3000; keepalive 64; }

server {
    listen 80;
    server_name _;

    # Mini App static files
    root /var/www/ibis/packages/mini-app/dist;
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API proxy
    location /api/ {
        limit_req zone=api burst=20 nodelay;
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Bot webhook
    location /webhook/ {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # TON Connect manifest
    location /tonconnect-manifest.json {
        root /var/www/ibis/packages/mini-app/public;
        add_header Access-Control-Allow-Origin "*";
    }

    # CSP for Telegram WebView
    add_header Content-Security-Policy "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org;" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
}
```

Enable: `sudo ln -s /etc/nginx/sites-available/ibis /etc/nginx/sites-enabled/`
Remove default: `sudo rm /etc/nginx/sites-enabled/default`
Test and reload: `sudo nginx -t && sudo systemctl reload nginx`

### 9. PM2 Ecosystem File
Create `/var/www/ibis/ecosystem.config.js`:
```javascript
module.exports = {
  apps: [
    {
      name: 'ibis-api',
      script: './packages/api/dist/index.js',
      cwd: '/var/www/ibis',
      instances: 2,
      exec_mode: 'cluster',
      env: { NODE_ENV: 'production', PORT: 3000 },
      max_memory_restart: '500M',
    },
    {
      name: 'ibis-bot',
      script: './packages/bot/dist/index.js',
      cwd: '/var/www/ibis',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '300M',
    },
  ],
};
```

## Acceptance Criteria

When you're done, verify:
- [ ] `node --version` returns v22.x
- [ ] `psql -U ibis -d ibis_db -c "SELECT 1"` works
- [ ] `redis-cli -a ibis_redis_dev_change_me ping` returns PONG
- [ ] `cd /var/www/ibis && npm install` completes without errors
- [ ] `npx prisma migrate dev` runs successfully in packages/shared
- [ ] `npm run db:generate` generates Prisma client
- [ ] `curl http://localhost` returns HTML (nginx serving mini-app placeholder)
- [ ] All package directories exist with correct structure
- [ ] `.env` file exists with development values

## Signal Completion

When done, create a file at `/var/www/ibis/.agent-1-complete` containing:
```
AGENT_1_COMPLETE=true
TIMESTAMP=<current ISO timestamp>
DB_URL=postgresql://ibis:ibis_dev_password_change_me@127.0.0.1:5432/ibis_db
REDIS_URL=redis://:ibis_redis_dev_change_me@127.0.0.1:6379
NGINX_PORT=80
NOTES=<any issues or decisions you made>
```
