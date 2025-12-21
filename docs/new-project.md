# New Project Setup

Starting a new Next.js + Supabase project from scratch.

## Step 1: Create Next.js App

```bash
npx create-next-app@latest my-app
cd my-app
```

## Step 2: Initialize Supabase

```bash
supabase init
supabase start
```

This creates `supabase/config.toml` and starts the local Supabase instance.

## Step 3: Run Setup

```bash
npx supabase-stateful setup
```

The wizard will prompt you to:
1. Install `@supabase/ssr` and `@supabase/supabase-js`
2. Create Supabase client files in `src/utils/supabase/`
3. Install `concurrently` for graceful shutdown
4. Create `scripts/dev-local.sh`

## Step 4: Start Developing

```bash
npm run dev:local
```

This runs all services with graceful shutdown. Press Ctrl+C to save state and exit.

Access Supabase Studio at http://localhost:54323 to create tables and add data.

## Step 5: Create Your First Migration

After making schema changes in Studio:

```bash
supabase db diff --file initial_schema
```

This creates a migration file in `supabase/migrations/`.

## What You Get

| Script | Description |
|--------|-------------|
| `npm run dev:local` | Run all services with graceful shutdown |
| `npm run supabase:start` | Start Supabase with state restore |
| `npm run supabase:stop` | Save state and stop |

## Switching Between Local and Production

```bash
npm run dev:local   # Uses localhost:54321
npm run dev         # Uses cloud Supabase from .env
```

The client files automatically switch based on `NEXT_PUBLIC_SUPABASE_LOCAL` environment variable.
