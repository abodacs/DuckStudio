# Dev tooling quick reference

Agent/dev tooling used while working on DuckStudio. Not app dependencies.

## ripgrep (`rg`)

Fast, line-oriented search that respects `.gitignore`. Most search here goes through
`rtk grep`; use `rg` directly for ad-hoc digging.

```bash
rg "custody"                    # recursive search
rg zod -g '*.md'                # only markdown (-g '!vendor' to exclude)
rg "COOP" --type yaml -C 2      # type filter, context lines
rg -F "pnpm-lock.yaml"          # literal string, no regex
rg -c "AgDR-0001"               # count matches per file
rg --files                      # list searchable files
```

## See also

- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — workflow, tests, audit, browser setup
