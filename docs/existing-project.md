# Existing Project Setup

Adding supabase-stateful to an existing Next.js project with a cloud Supabase database.

## Step 1: Initialize Local Supabase

```bash
supabase init
```

## Step 2: Link to Your Cloud Project

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

Find your project ref in Supabase Dashboard → Project Settings → General.

## Step 3: Pull Your Schema

```bash
supabase db pull
```

This creates a migration file with your current production schema.

### If You Get "Migration History Does Not Match"

```bash
supabase migration repair --status applied MIGRATION_TIMESTAMP
```

Use the timestamp shown in the error message.

### Verify Sync

```bash
supabase migration list
```

Local and Remote columns should show matching timestamps.

## Step 4: Run Setup

```bash
npx supabase-stateful setup
```

The wizard will:
1. Check for missing dependencies
2. Ask about creating/overwriting Supabase client files
3. Offer to install `concurrently` for graceful shutdown
4. Offer to install GitHub Actions workflow (since you have a remote project)
5. Create the graceful shutdown script

## Step 5: Start Developing

```bash
npm run dev:local
```

## Handling Existing Supabase Client Files

If you already have Supabase client files, the setup will ask:

```
⚠ Some Supabase client files already exist: client.js, server.js
Overwrite existing files? [y/N]
```

Choose **N** to keep your existing files. You can manually add the local/production switching:

```javascript
// Add to your existing config
const isLocalDev = process.env.NEXT_PUBLIC_SUPABASE_LOCAL === 'true'

const config = isLocalDev ? {
  url: 'http://127.0.0.1:54321',
  anonKey: 'eyJ...' // Default local key from supabase start
} : {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
}
```

## When Teammates Add Migrations

```bash
git pull                    # Get their migration files
npm run supabase:start      # Your data is restored, then migrations run on top
```

The key insight: migrations transform YOUR existing data, they don't run on an empty database.
