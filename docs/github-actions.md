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

## How It Works

On push to main:
1. **Migrations job** runs `supabase db push` to apply new migrations
2. **Deploy job** (if configured) builds and deploys to Vercel

Pull requests skip migrations and only run the deploy preview.

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
