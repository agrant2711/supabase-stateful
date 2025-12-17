# supabase-stateful

> Persistent local state for Supabase development

## The Problem

Local Supabase is **stateless by default**. Stop it, lose everything. Restart, get `duplicate key` errors from stale auth tokens.

## The Solution

```bash
npx supabase-stateful init    # One-time setup

npm run supabase:start        # Starts with previous session restored
# ... develop, create test users, add data ...
npm run supabase:stop         # Saves state, clears auth tokens, stops cleanly
```

Next time you start, **everything** is back - your test users, all the data you created, relationships intact. Migrations run first, then your data is restored.

## Why Not Just Use seed.sql?

| | seed.sql | supabase-stateful |
|---|---|---|
| **What it is** | Static baseline data | Your development session |
| **Committed to git** | Yes | No (gitignored) |
| **Shared with team** | Yes | No (each dev has their own) |
| **When it runs** | Every `supabase db reset` | Only when you start/stop |
| **Contains** | Default categories, settings | Users you created, Stripe test customers, orders you made |

**seed.sql is great for:**
- Default lookup data (countries, categories, roles)
- Sample products/content that everyone needs
- Baseline configuration

**supabase-stateful is for:**
- The test user you created with `password123`
- The Stripe customer you linked to that user
- The 5 orders you made to test the checkout flow
- The specific subscription state you need to test upgrades

They work together: `seed.sql` provides the foundation, `supabase-stateful` preserves your work on top of it.

## When to Use This

This tool is most valuable when:

**External Service Integration**
- Stripe test mode - you need consistent test customers, subscriptions, payment methods across sessions
- Email services (Resend, SendGrid) - test users with specific email states
- Webhook testing - need predictable user/order states to test different scenarios

**Complex Test Data**
- E-commerce: products linked to Stripe, carts, orders, fulfillment states
- SaaS: users with different subscription tiers, feature flags, usage limits
- Marketplaces: multiple user types (buyers, sellers), listings, transactions
- Data with foreign key relationships that's tedious to recreate

**Auth & Permissions Testing**
- Test users with specific roles (admin, user, moderator)
- Users at different onboarding stages
- OAuth connections, subscription states, verification statuses

**Team Development**
- Each developer has isolated test data
- No more "who deleted my test account?"
- Demo data stays consistent for stakeholder reviews

**When you probably don't need this:**
- Simple apps with auto-generated test data
- Projects that only need the baseline seed.sql data
- Already using Docker volumes to persist Supabase data (but watch out for auth token conflicts!)

## Prerequisites

This tool works with existing Supabase projects. You need:

1. **Supabase CLI** installed ([install guide](https://supabase.com/docs/guides/cli))
2. **Docker** running (required for local Supabase)
3. **A Supabase project** set up locally (see below)

### First-Time Setup

If you have an existing cloud Supabase project and want to set up local development:

```bash
# 1. Initialize Supabase in your project (creates supabase/ folder)
supabase init

# 2. Login to Supabase
supabase login

# 3. Link to your cloud project
supabase link --project-ref YOUR_PROJECT_REF
# Find your project ref in: Supabase Dashboard → Project Settings → General

# 4. Pull the remote schema as your baseline migration
supabase db pull
# This creates supabase/migrations/YYYYMMDD_remote_schema.sql

# 5. Start local Supabase to verify it works
supabase start
```

If you're starting a **new project** (no cloud database yet):

```bash
supabase init
supabase start
# Create your schema in Studio (localhost:54323), then:
supabase db diff --file initial_schema
```

## Quick Start

```bash
# In your Supabase project directory (where supabase/config.toml exists)
npx supabase-stateful init

# This adds npm scripts to your package.json:
npm run supabase:start   # Start with state restoration
npm run supabase:stop    # Save state and stop
npm run supabase:status  # Show current status
```

## How It Works

**On stop:**
1. Export entire database state (schema + data for `public` and `auth` schemas)
2. Add `ON CONFLICT DO NOTHING` to all inserts for safe restoration
3. Clear `auth.refresh_tokens` (prevents duplicate key errors)
4. Stop Supabase

**On start:**
1. Start Supabase
2. Restore saved state (schema + data from your last session)
3. Apply pending migrations **on top of your data** via `supabase migration up`

The key insight: migrations run ON TOP of your existing data, not on an empty database. When a teammate adds a migration that renames a column, it actually transforms YOUR data.

## What Gets Saved

**Everything you create during development:**
- Auth users (your test accounts)
- All public schema tables (products, orders, profiles, whatever your app uses)
- Foreign key relationships stay intact
- JSONB columns, arrays, all data types

**What's excluded:**
- System tables (`supabase_%`, `schema_migrations`, etc.)
- Auth refresh tokens (cleared to prevent conflicts)

## Commands

| Command | Description |
|---------|-------------|
| `init` | Initialize in your project (requires `supabase/config.toml`) |
| `start` | Start Supabase, apply migrations, restore state |
| `stop` | Save state, clear auth tokens, stop Supabase |
| `status` | Show running status and state info |
| `export` | Export cloud data to seed file |
| `sync` | Export cloud data and apply to local |

## Recommended Development Workflow

### Setup: Combined Dev Script

Create a single command that starts everything with graceful shutdown:

```json
// package.json
{
  "scripts": {
    "dev:local": "concurrently \"npm run supabase:start\" \"npm run dev\"",
    "dev:production": "npm run dev"
  }
}
```

For graceful state saving on Ctrl+C, create a wrapper script:

```bash
#!/bin/bash
# scripts/dev-local.sh

cleanup() {
  echo "Shutting down..."
  npm run supabase:stop
  exit 0
}
trap cleanup SIGINT SIGTERM

npx concurrently \
  "npm run supabase:start" \
  "npm run dev" \
  "ngrok http 3000"  # optional: for webhooks

wait
```

Then: `npm run dev:local` starts everything, Ctrl+C saves state and stops cleanly.

### Daily Development

```bash
# Option 1: Combined script (recommended)
npm run dev:local         # Starts Supabase + app, restores previous session
# ... develop, create test users, add data ...
# Ctrl+C                  # Saves state, stops everything

# Option 2: Separate commands
npm run supabase:start    # Start Supabase, restore state
npm run dev               # Start your app
# ... develop ...
npm run supabase:stop     # Save state and stop
```

### Making Database Changes

**1. Develop locally:**
```bash
# Make changes in Supabase Studio (localhost:54323)
# Or edit SQL files directly
```

**2. Generate migration:**
```bash
supabase db diff --file add_user_preferences
# Creates: supabase/migrations/YYYYMMDD_add_user_preferences.sql
```

**3. Test locally:**
```bash
npm run supabase:stop     # Save current state
npm run supabase:start    # Re-applies migrations + restores data
# Verify your changes work with existing data
```

**4. Commit and deploy:**
```bash
git add supabase/migrations
git commit -m "Add user preferences table"
git push                   # Triggers CI/CD
```

### CI/CD: Auto-Deploy Migrations

See [templates/github-workflow/deploy.yml](templates/github-workflow/deploy.yml) for a complete workflow that:
1. Runs database migrations on push to main
2. Deploys to Vercel (optional)

Copy it to `.github/workflows/deploy.yml` in your project.

### Local vs Production Development

To switch between local and production Supabase, use environment-aware client configuration.

See [templates/supabase/](templates/supabase/) for a complete Next.js setup that automatically switches based on `NEXT_PUBLIC_SUPABASE_LOCAL`.

**Quick setup:**

```json
// package.json
{
  "scripts": {
    "dev:local": "NEXT_PUBLIC_SUPABASE_LOCAL=true npm run dev",
    "dev": "npm run dev"
  }
}
```

- `npm run dev:local` → Uses local Supabase (localhost:54321)
- `npm run dev` → Uses cloud Supabase (from env vars)

### Team Workflow

**When you pull changes:**
```bash
git pull                    # Get new migration files
npm run supabase:start      # Auto-applies new migrations, restores your data
```

**Key points:**
- Migrations are committed to git
- Local state files are gitignored (each dev has their own test data)
- Production migrations deploy via CI/CD
- Everyone's local data survives schema changes

## Cloud Sync (Optional)

Pull data from your production/staging Supabase to seed local development:

```bash
# Set environment variables
export SUPABASE_URL=https://xxx.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Export cloud data
npx supabase-stateful export --sample

# Or sync directly to local
npx supabase-stateful sync --sample
```

**Options:**
- `--sample` - Limit to 100 rows per table
- `--tables coaches,products` - Export specific tables
- `--output path/to/file.sql` - Custom output path

## Configuration

After `init`, a `.supabase-stateful.json` file is created:

```json
{
  "stateFile": "supabase/local-state.sql",
  "containerName": "supabase_db_myproject"
}
```

The state file is automatically added to `.gitignore`.

## FAQ

**Why not just use `seed.sql`?**

`seed.sql` runs on every reset and contains static data. This tool preserves your *session* state - all the data you created during development, including test users, sample records, everything.

**Does this work with migrations?**

Yes! Your state is restored first, then migrations run ON TOP of your data. This means if a teammate adds a migration that renames a column, it actually transforms your data (not an empty database).

**What about auth token conflicts?**

The `stop` command clears `auth.refresh_tokens` before saving. This prevents the "duplicate key" errors that happen when stale tokens conflict on restart.

**Can I share state with my team?**

The state file is gitignored by default (it may contain sensitive data). For team seeding, use the `export`/`sync` commands to pull from a shared cloud instance.

**A teammate added migrations, how do I get them?**

```bash
git pull                    # Get the new migration files
npm run supabase:start      # Your data is restored, then migrations run on top
```

The migrations transform your existing data - e.g., a `RENAME COLUMN` migration will actually rename the column in your saved data.

## License

MIT
