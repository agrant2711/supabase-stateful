# CI/CD with GitHub Actions

Automatically apply database migrations when you push to main.

## Setup

The setup wizard offers to install a GitHub Actions workflow when it detects a linked remote Supabase project.

If you skipped it during setup, you can manually copy the template:

```bash
mkdir -p .github/workflows
cp node_modules/supabase-stateful/templates/github-workflow/deploy.yml .github/workflows/
```

Or use the migrations-only version (no Vercel deploy):

```bash
cp node_modules/supabase-stateful/templates/github-workflow/migrations-only.yml .github/workflows/deploy.yml
```

## Required GitHub Secrets

Add these in your GitHub repository → Settings → Secrets and variables → Actions:

### For Migrations

| Secret | Where to Find It |
|--------|------------------|
| `SUPABASE_ACCESS_TOKEN` | [Supabase Dashboard → Account → Access Tokens](https://supabase.com/dashboard/account/tokens) |
| `SUPABASE_PROJECT_REF` | Project Settings → General |
| `SUPABASE_DB_PASSWORD` | Project Settings → Database |

### For Vercel Deploy (optional)

| Secret | Where to Find It |
|--------|------------------|
| `VERCEL_TOKEN` | [Vercel Account Settings](https://vercel.com/account/tokens) |
| `VERCEL_ORG_ID` | `.vercel/project.json` after `vercel link` |
| `VERCEL_PROJECT_ID` | `.vercel/project.json` after `vercel link` |

**Getting Vercel IDs:**

The easiest way to get `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` is to link your project:

```bash
npx vercel link
```

This creates a `.vercel/project.json` file with both values:

```json
{
  "orgId": "team_xxxxx",      ← VERCEL_ORG_ID
  "projectId": "prj_xxxxx"    ← VERCEL_PROJECT_ID
}
```

Copy these values to your GitHub secrets.

**Disabling Vercel Auto-Deploy:**

When you choose "Migrations + Vercel deploy", the setup automatically adds a `vercel.json` file with:

```json
{
  "git": {
    "deploymentEnabled": false
  }
}
```

This ensures Vercel only deploys via GitHub Actions (after migrations succeed). Without this, Vercel would auto-deploy on every push, even if migrations fail.

If you set up manually or need to add this yourself, create `vercel.json` with the config above.

## How It Works

On push to main:
1. **Migrations job** runs `supabase db push` to apply new migrations
2. **Deploy job** (if configured) builds and deploys to Vercel

Pull requests skip migrations and only run the deploy preview.

## Important: Writing Safe Migrations

**What happens if deployment fails after migrations run?**

The workflow runs migrations first, then deploys. If the deploy fails, your production database has the new schema but old code is still running. This can break your app.

**The solution: Always write backwards-compatible migrations.**

### Safe Migration Patterns

| Do This | Not This |
|---------|----------|
| Add columns as nullable | Add required columns |
| Add new tables | Rename existing tables |
| Add new columns, then remove old ones later | Rename columns directly |
| Keep old columns until code stops using them | Drop columns immediately |

### Example: Renaming a Column Safely

Instead of:
```sql
-- DANGEROUS: breaks old code immediately
ALTER TABLE users RENAME COLUMN name TO full_name;
```

Do it in 3 separate deploys:

**Deploy 1:** Add new column
```sql
ALTER TABLE users ADD COLUMN full_name TEXT;
UPDATE users SET full_name = name;
```

**Deploy 2:** Update code to use `full_name` instead of `name`

**Deploy 3:** Remove old column (after verifying no code uses it)
```sql
ALTER TABLE users DROP COLUMN name;
```

### Example: Adding a Required Field

Instead of:
```sql
-- DANGEROUS: old code can't insert without this field
ALTER TABLE users ADD COLUMN email TEXT NOT NULL;
```

Do:
```sql
-- SAFE: old code still works
ALTER TABLE users ADD COLUMN email TEXT;
```

Then add the `NOT NULL` constraint in a later migration after all code provides the field.

## Workflow Options

### Migrations Only

Use when you deploy elsewhere (Netlify, Railway, etc.):

```yaml
# .github/workflows/deploy.yml
name: Database Migrations

on:
  push:
    branches: [main]

jobs:
  migrate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
      - run: supabase login --token ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      - run: supabase link --project-ref ${{ secrets.SUPABASE_PROJECT_REF }} --password "${{ secrets.SUPABASE_DB_PASSWORD }}"
      - run: supabase db push --linked
```

### Migrations + Vercel

Full workflow in `templates/github-workflow/deploy.yml`.
