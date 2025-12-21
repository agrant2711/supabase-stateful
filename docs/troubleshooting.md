# Troubleshooting

## Common Issues

### "Cannot find supabase/config.toml"

Run `supabase init` first to create the local Supabase configuration.

```bash
supabase init
```

### "Migration history does not match" / "Remote migration versions not found"

This happens when your remote database has migration records that don't exist in your local `supabase/migrations/` folder. Common causes:

- **Existing project**: You ran migrations via Supabase Dashboard or another method before setting up local development
- **Team member pushed migrations**: Someone else applied migrations that you don't have locally
- **GitHub Actions failing**: The CI workflow can't find local files matching remote history

**Solution:**

1. First, check what's different:
   ```bash
   supabase migration list
   ```

   You'll see which migrations exist locally vs remotely:
   ```
   Local          | Remote         | Time (UTC)
   ----------------|----------------|---------------------
                   | 20251221033444 | 2025-12-21 03:34:44   ← Only on remote (problem!)
   20251221033716 | 20251221033716 | 2025-12-21 03:37:16   ← Both (good)
   ```

2. For migrations that exist only on remote, mark them as reverted:
   ```bash
   supabase migration repair --status reverted 20251221033444
   ```

3. Pull your current schema to ensure local matches remote:
   ```bash
   supabase db pull
   ```

4. Verify the fix:
   ```bash
   supabase migration list
   # Should show all migrations in both Local and Remote columns
   ```

5. Commit and push - your GitHub Actions should now pass.

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

### GitHub Actions Workflow Fails on First Run

For existing projects, the first GitHub Actions run often fails with "Remote migration versions not found". This is expected - see ["Migration history does not match"](#migration-history-does-not-match--remote-migration-versions-not-found) above.

**Before enabling the workflow**, run these commands locally:

```bash
# 1. Link to your remote project
supabase link --project-ref YOUR_PROJECT_REF

# 2. Pull current schema and sync migration history
supabase db pull

# 3. Check for mismatches
supabase migration list

# 4. Fix any remote-only migrations
supabase migration repair --status reverted TIMESTAMP

# 5. Commit and push
git add supabase/
git commit -m "Sync migration history"
git push
```

## Getting Help

- [GitHub Issues](https://github.com/agrant2711/supabase-stateful/issues)
- [Supabase Discord](https://discord.supabase.com)
