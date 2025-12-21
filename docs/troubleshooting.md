# Troubleshooting

## Common Issues

### "Cannot find supabase/config.toml"

Run `supabase init` first to create the local Supabase configuration.

```bash
supabase init
```

### "Migration history does not match"

Your remote database has migration records that don't match local files.

```bash
# Mark a migration as applied (it exists in remote but not locally)
supabase migration repair --status applied TIMESTAMP

# Mark a migration as reverted (it exists locally but shouldn't run)
supabase migration repair --status reverted TIMESTAMP
```

Use the timestamp shown in the error message.

### Docker Errors

Make sure Docker Desktop is running:

```bash
docker ps    # Should show output, not an error
```

If Supabase containers are stuck:

```bash
supabase stop --no-backup
supabase start
```

### "duplicate key" Errors on Start

This usually means auth tokens weren't cleared on last stop. The stateful stop command clears `auth.refresh_tokens` to prevent this.

If you stopped Supabase without using `supabase-stateful stop`:

```bash
supabase start
# Then manually clear tokens:
docker exec supabase_db_YOUR_PROJECT psql -U postgres -c "DELETE FROM auth.refresh_tokens;"
```

### Health Check Failures

If `supabase start` fails with health check errors:

```bash
# Try without analytics (logflare often causes issues)
supabase start --exclude logflare

# Or ignore health checks entirely
supabase start --ignore-health-check
```

The `supabase-stateful start` command tries these automatically.

### State File Not Found

The state file is saved to `supabase/local-state.sql` by default. If it's missing:

```bash
npx supabase-stateful status    # Check status and file location
```

The first time you run, there's no saved state - this is normal. Create some test data, then run `npm run supabase:stop` to save it.

### Next.js Not Detected

The Supabase client files are Next.js App Router specific. If you're using a different framework, the setup will skip client file creation.

For other frameworks, you'll need to create your own Supabase client configuration that switches between local and production URLs.

## Getting Help

- [GitHub Issues](https://github.com/agrant2711/supabase-stateful/issues)
- [Supabase Discord](https://discord.supabase.com)
