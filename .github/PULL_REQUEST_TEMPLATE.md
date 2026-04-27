## Summary

What does this PR change and why? Link the related issue if any (`Closes #N`).

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor (no behaviour change)
- [ ] Documentation
- [ ] Build / CI / chore

## Test plan

How did you verify the change? List the commands you ran or the manual steps you took.

```bash
# e.g.
pnpm test
pnpm --filter @sanson/admin e2e
```

## Checklist

- [ ] Code, comments and commit messages are in English
- [ ] Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`)
- [ ] `pnpm test` passes locally
- [ ] `pnpm lint` and `pnpm typecheck` pass locally
- [ ] Relevant docs updated (`README.md`, `SPECS.md`, `CLAUDE.md`, `docs/`)
- [ ] Tests added or updated for behaviour changes (no DB mocks — use Testcontainers)

## Screenshots / output

If the change is user-facing (admin UI, API response, CLI output), include before/after screenshots or sample output.
