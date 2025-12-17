# Templates

Copy these files into your project to get started quickly.

## GitHub Workflow

**[github-workflow/deploy.yml](github-workflow/deploy.yml)**

Complete CI/CD workflow that:
1. Runs database migrations on push to main
2. Deploys to Vercel

Copy to `.github/workflows/deploy.yml` in your project.

**Required GitHub Secrets:**

| Secret | Description |
|--------|-------------|
| `SUPABASE_ACCESS_TOKEN` | From [Supabase Dashboard](https://supabase.com/dashboard/account/tokens) |
| `SUPABASE_PROJECT_REF` | Your project ID (from project settings) |
| `SUPABASE_DB_PASSWORD` | Your database password |
| `VERCEL_TOKEN` | From [Vercel Account Settings](https://vercel.com/account/tokens) |
| `VERCEL_ORG_ID` | From `.vercel/project.json` after `vercel link` |
| `VERCEL_PROJECT_ID` | From `.vercel/project.json` after `vercel link` |

**Not using Vercel?** Remove the `deploy` job and the `env` block. The `migrate` job works standalone.

---

## Supabase Client Setup (Next.js)

**[supabase/](supabase/)**

Environment-aware Supabase client configuration for Next.js. Automatically switches between local and production Supabase based on `NEXT_PUBLIC_SUPABASE_LOCAL` env var.

Copy the entire `supabase/` folder to `src/utils/supabase/` (or your preferred location).

**Files:**
- `config.js` - Environment detection and configuration
- `client.js` - Browser client (React components)
- `server.js` - Server client (Server Components, Route Handlers)
- `admin.js` - Admin client with service role (bypasses RLS)
- `middleware.js` - Session handling for Next.js middleware

**Usage:**

```javascript
// In a React component
import { createClient } from '@/utils/supabase/client'
const supabase = createClient()

// In a Server Component or Route Handler
import { createClient } from '@/utils/supabase/server'
const supabase = await createClient()

// For admin operations (server-side only)
import { createAdminClient } from '@/utils/supabase/admin'
const supabase = createAdminClient()
```

**Package scripts to control environment:**

```json
{
  "scripts": {
    "dev:local": "NEXT_PUBLIC_SUPABASE_LOCAL=true next dev",
    "dev": "next dev"
  }
}
```

- `npm run dev:local` → Uses local Supabase (localhost:54321)
- `npm run dev` → Uses cloud Supabase (from env vars)

**Note:** The local keys in `config.js` are Supabase's default demo keys - same for everyone running `supabase start`. Your production keys come from environment variables.
