# Adding Services to dev:local

The `dev:local` command runs Supabase and Next.js together with graceful shutdown. You can add additional services like Inngest, ngrok, Stripe CLI, etc.

## Adding Services

### During Setup

When running `npx supabase-stateful setup`, you'll be prompted to add services:

```
Would you like to add additional services to run with dev:local? (e.g., Inngest, ngrok)
[Y/n]
```

For each service, you'll specify:
1. **Name** - Display name (e.g., `inngest`)
2. **Command** - The command to run (e.g., `npx inngest-cli dev`)
3. **Color** - Terminal color for the output

### After Setup

Add services anytime with:

```bash
npx supabase-stateful add
```

Or non-interactively:

```bash
npx supabase-stateful add inngest "npx inngest-cli dev"
```

### Managing Services

```bash
# List all configured services
npx supabase-stateful services

# Remove a service
npx supabase-stateful remove inngest
```

## Common Service Examples

### Inngest (Background Jobs)

Inngest provides serverless background functions and event-driven workflows.

```bash
npx supabase-stateful add
# Name: inngest
# Command: npx inngest-cli dev
# Color: Magenta
```

Or if you have it as an npm script:

```bash
npx supabase-stateful add
# Name: inngest
# Command: npm run inngest
# Color: Magenta
```

### ngrok (Webhook Tunnels)

ngrok exposes your local server to the internet, useful for testing webhooks.

```bash
npx supabase-stateful add
# Name: ngrok
# Command: ngrok http 3000
# Color: Yellow
```

With a custom domain:

```bash
npx supabase-stateful add
# Name: ngrok
# Command: ngrok http --domain=your-domain.ngrok-free.app 3000
# Color: Yellow
```

### Stripe CLI (Payment Webhooks)

Forward Stripe webhooks to your local server:

```bash
npx supabase-stateful add
# Name: stripe
# Command: stripe listen --forward-to localhost:3000/api/webhooks/stripe
# Color: Blue
```

### LocalStack (AWS Services)

Run AWS services locally:

```bash
npx supabase-stateful add
# Name: localstack
# Command: localstack start
# Color: Red
```

### Mailpit (Email Testing)

Local email testing:

```bash
npx supabase-stateful add
# Name: mailpit
# Command: mailpit
# Color: White
```

## How It Works

Services are stored in `.supabase-stateful.json`:

```json
{
  "stateFile": "supabase/local-state.sql",
  "containerName": "supabase_db_myproject",
  "devServices": [
    {
      "name": "inngest",
      "command": "npx inngest-cli dev",
      "color": "magenta"
    },
    {
      "name": "ngrok",
      "command": "ngrok http 3000",
      "color": "yellow"
    }
  ]
}
```

The `scripts/dev-local.sh` script is regenerated whenever you add or remove services.

## Graceful Shutdown

When you press Ctrl+C:

1. All services receive the shutdown signal
2. Supabase state is saved automatically
3. All processes exit cleanly

This ensures your local database state is always preserved, even when running multiple services.
