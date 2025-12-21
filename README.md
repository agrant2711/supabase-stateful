# supabase-stateful

> Persistent local state for Supabase development

**Note:** Currently supports Next.js (App Router) only. The core state persistence works with any framework, but the generated client files are Next.js specific.

## The Problem

Local Supabase is **stateless by default**. Stop it, lose everything. Restart, get `duplicate key` errors.

## The Solution

```bash
npx supabase-stateful setup   # Interactive setup

npm run supabase:start        # Restores your previous session
# ... develop, create test users, add data ...
npm run supabase:stop         # Saves state for next time
```

Next time you start, **everything is back** - test users, data, relationships intact.

## Quick Start

**Prerequisites:** [Supabase CLI](https://supabase.com/docs/guides/cli) and [Docker](https://docs.docker.com/desktop)

```bash
# 1. Have a Supabase project (run `supabase init` if you don't)

# 2. Run interactive setup
npx supabase-stateful setup

# 3. Start developing
npm run dev:local             # or ./scripts/dev-local.sh for graceful shutdown
```

The setup wizard will:
- Install required dependencies (`@supabase/ssr`, `@supabase/supabase-js`, `concurrently`)
- Create Supabase client files with local/production switching (Next.js only)
- Add npm scripts for stateful start/stop
- Generate a graceful shutdown script (Ctrl+C saves state automatically)
- Optionally install GitHub Actions for CI/CD migrations

## Daily Workflow

```bash
npm run dev:local           # Start with local Supabase (restores your data)
npm run supabase:stop       # Save state and stop (or Ctrl+C with dev-local.sh)
```

## How It Works

| On Stop | On Start |
|---------|----------|
| Export database state | Start Supabase |
| Clear auth tokens | Restore saved state |
| Stop Supabase | Apply pending migrations on top |

Migrations run **on top of your existing data**, not on an empty database.

## Commands

| Command | Description |
|---------|-------------|
| `setup` | Interactive setup wizard |
| `init` | Basic init (just npm scripts, no client files) |
| `start` | Start Supabase and restore saved state |
| `stop` | Save state and stop Supabase |
| `status` | Show current status |
| `add` | Add a service to dev:local (e.g., Inngest, ngrok) |
| `remove` | Remove a service from dev:local |
| `services` | List configured services |
| `sync` | Sync cloud data to local database |
| `export` | Export cloud data to seed file |

Run `npx supabase-stateful --help` for all options.

## Deployment

The setup wizard can install a GitHub Actions workflow for CI/CD:

```
Push to main → Run migrations on production → Deploy app
```

1. **Migrations job** - Applies your local `supabase/migrations/*.sql` files to your production Supabase database
2. **Deploy job** - Builds and deploys your app to Vercel (optional)

See [CI/CD with GitHub Actions](docs/github-actions.md) for setup details and required secrets.

## Documentation

- [New Project Setup](docs/new-project.md)
- [Existing Project Setup](docs/existing-project.md)
- [Adding Services to dev:local](docs/dev-services.md) (Inngest, ngrok, Stripe, etc.)
- [CI/CD with GitHub Actions](docs/github-actions.md)
- [Troubleshooting](docs/troubleshooting.md)

## License

MIT
