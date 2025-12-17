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

Next time you start, **everything** is back - your test users, all the data you created, relationships intact.

---

## Setup Guide

### Prerequisites

1. **Supabase CLI** - [Install guide](https://supabase.com/docs/guides/cli)
2. **Docker** - [Install Docker Desktop](https://docs.docker.com/desktop)

### Step 1: Set Up Local Supabase

Choose your scenario:

<details>
<summary><b>I have an existing cloud Supabase project</b></summary>

```bash
# 1. Initialize local Supabase (creates supabase/ folder with config.toml)
supabase init

# 2. Login to Supabase
supabase login

# 3. Link to your cloud project
supabase link --project-ref YOUR_PROJECT_REF
# Find project ref: Supabase Dashboard → Project Settings → General

# 4. Pull your schema as a baseline migration
supabase db pull
# Creates: supabase/migrations/YYYYMMDD_remote_schema.sql

# 5. If you get "migration history does not match" errors:
supabase migration repair --status applied MIGRATION_TIMESTAMP
# Use the timestamp shown in the error message

# 6. Verify local and remote are in sync
supabase migration list
# Should show matching timestamps in Local and Remote columns
```

</details>

<details>
<summary><b>I'm starting a new project</b></summary>

```bash
# 1. Initialize local Supabase
supabase init

# 2. Start local Supabase
supabase start

# 3. Create your schema in Studio (localhost:54323)

# 4. Generate your initial migration
supabase db diff --file initial_schema
```

</details>

### Step 2: Initialize supabase-stateful

```bash
# In your project directory (where supabase/config.toml exists)
npx supabase-stateful init
```

This adds npm scripts to your package.json:
- `npm run supabase:start` - Start and restore saved state
- `npm run supabase:stop` - Save state and stop
- `npm run supabase:status` - Show current status

### Step 3: Set Up Local/Production Switching

Copy the files from [templates/supabase/](templates/supabase/) to your project (e.g., `src/utils/supabase/`):

```
templates/supabase/
├── config.js      # Environment detection (local vs production)
├── client.js      # Browser client
├── server.js      # Server component client
├── admin.js       # Admin client (bypasses RLS)
└── middleware.js  # Session handling
```

Then update your package.json:

```json
{
  "scripts": {
    "dev:local": "NEXT_PUBLIC_SUPABASE_LOCAL=true next dev",
    "dev": "next dev"
  }
}
```

Now:
- `npm run dev:local` → Uses local Supabase (localhost:54321)
- `npm run dev` → Uses cloud Supabase (from .env)

### Step 4: Set Up CI/CD for Migrations

Copy [templates/github-workflow/deploy.yml](templates/github-workflow/deploy.yml) to `.github/workflows/deploy.yml`.

Add these secrets to your GitHub repository:

| Secret | Where to find it |
|--------|------------------|
| `SUPABASE_ACCESS_TOKEN` | [Supabase Dashboard](https://supabase.com/dashboard/account/tokens) |
| `SUPABASE_PROJECT_REF` | Project Settings → General |
| `SUPABASE_DB_PASSWORD` | Project Settings → Database |
| `VERCEL_TOKEN` | [Vercel Account Settings](https://vercel.com/account/tokens) (if using Vercel) |
| `VERCEL_ORG_ID` | `.vercel/project.json` after `vercel link` |
| `VERCEL_PROJECT_ID` | `.vercel/project.json` after `vercel link` |

Now when you push to main:
1. Migrations run on production database
2. App deploys to Vercel

---

## Daily Workflow

### Start your day

```bash
npm run dev:local    # Starts local Supabase + app, restores your data
```

### Make schema changes

```bash
# 1. Make changes in Supabase Studio (localhost:54323)

# 2. Generate a migration
supabase db diff --file add_user_preferences

# 3. Commit the migration
git add supabase/migrations
git commit -m "Add user preferences table"
git push    # Triggers CI/CD to apply migration to production
```

### End your day

```bash
# Ctrl+C or:
npm run supabase:stop    # Saves your test data for next session
```

### When a teammate adds migrations

```bash
git pull                    # Get their migration files
npm run supabase:start      # Your data is restored, then their migrations run on top
```

---

## How It Works

**On stop:**
1. Export entire database state (schema + data for `public` and `auth` schemas)
2. Clear `auth.refresh_tokens` (prevents duplicate key errors)
3. Stop Supabase

**On start:**
1. Start Supabase
2. Restore saved state (schema + data from your last session)
3. Apply pending migrations **on top of your data** via `supabase migration up`

The key insight: migrations run ON TOP of your existing data, not on an empty database. When a teammate adds a migration that renames a column, it actually transforms YOUR data.

---

## Why Not Just Use seed.sql?

| | seed.sql | supabase-stateful |
|---|---|---|
| **What it is** | Static baseline data | Your development session |
| **Committed to git** | Yes | No (gitignored) |
| **Shared with team** | Yes | No (each dev has their own) |
| **When it runs** | Every `supabase db reset` | Only when you start/stop |
| **Contains** | Default categories, settings | Users you created, Stripe test customers, orders you made |

They work together: `seed.sql` provides the foundation, `supabase-stateful` preserves your work on top of it.

---

## When to Use This

**External Service Integration**
- Stripe test mode - consistent test customers, subscriptions across sessions
- Email services - test users with specific email states
- Webhook testing - predictable user/order states

**Complex Test Data**
- E-commerce: products linked to Stripe, carts, orders
- SaaS: users with different subscription tiers
- Data with foreign key relationships that's tedious to recreate

**Team Development**
- Each developer has isolated test data
- No more "who deleted my test account?"
- Demo data stays consistent for stakeholder reviews

---

## Commands

| Command | Description |
|---------|-------------|
| `init` | Initialize in your project |
| `start` | Start Supabase, restore state, apply migrations |
| `stop` | Save state, clear auth tokens, stop |
| `status` | Show running status and state info |
| `export` | Export cloud data to seed file |
| `sync` | Export cloud data and apply to local |

---

## Cloud Sync (Optional)

Pull data from production to seed local development:

```bash
export SUPABASE_URL=https://xxx.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=eyJ...

npx supabase-stateful sync --sample
```

Options:
- `--sample` - Limit to 100 rows per table
- `--tables users,products` - Export specific tables

---

## Troubleshooting

**"migration history does not match"**

Your remote database has migration records that don't match local files. Fix with:
```bash
supabase migration repair --status applied TIMESTAMP
# or
supabase migration repair --status reverted TIMESTAMP
```

**"Cannot find supabase/config.toml"**

Run `supabase init` first to create the local Supabase config.

**Docker errors**

Make sure Docker Desktop is running:
```bash
docker ps    # Should show output, not an error
```

---

## License

MIT
