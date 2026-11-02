# patcms documentation

patcms is a headless, git-backed CMS SDK. Content is plain JSON committed to your own GitHub
repository; the client talks directly to `api.github.com` with a fine-grained personal access
token. No database, no server, no bundled UI — `createCMS()` is the backend, you build the admin.

This folder is the usage documentation. The architecture and its invariants live in `specs/`
(start at `specs/CMS.md`); a complete working admin that exercises every feature lives in
`playground/src/panel/` and is the reference implementation.

## Start here

| Doc | Read it when |
|---|---|
| [getting-started.md](./getting-started.md) | First contact: the mental model, install, first config, first save |
| [configuration.md](./configuration.md) | Describing content: collections, the 12 field types, media folders, validation |
| [authentication.md](./authentication.md) | Tokens, scopes, the capability probe, sign-in lifecycle, rate budget |

## Daily tasks

| Doc | Read it when |
|---|---|
| [reading-content.md](./reading-content.md) | Listing and loading entries; how the snapshot cache behaves |
| [writing-content.md](./writing-content.md) | Saving, creating, deleting; commit messages; the `noop` case |
| [conflicts-and-drafts.md](./conflicts-and-drafts.md) | Someone else pushed first; autosave drafts; stale-draft detection |
| [media.md](./media.md) | Uploading images, the public⇄repo path bijection, trash and restore |
| [deploy-status.md](./deploy-status.md) | Showing "is it live yet" from check-runs and commit statuses |

## Reference

| Doc | Read it when |
|---|---|
| [errors.md](./errors.md) | Every `CMSError` code, every `ParseIssue` code, what throws vs what returns |
| [advanced.md](./advanced.md) | `patcms/advanced`: save driver, coordinator, rebase, boot adjudication |
| [web-stores.md](./web-stores.md) | `patcms/web`: IndexedDB draft and token stores |
| [building-an-admin.md](./building-an-admin.md) | Turning the SDK into a UI; the example panel as an adoption template |
| [testing.md](./testing.md) | Testing an integration without a real PAT: the fake GitHub harness |
| [pitfalls.md](./pitfalls.md) | The standing vetoes and the gotchas that cost real time |

## Conventions in these docs

Every TypeScript snippet in this folder is machine-checked against the published type surface
(`pnpm docs:check`, which runs in CI). The fence markers carry meaning:

| Fence | Meaning |
|---|---|
| ` ```ts file="name.ts" ` | A module registered under that name; later blocks in the **same file** may import it |
| ` ```ts ` | A standalone module — includes its own imports, compiles on its own |
| ` ```ts continue ` | Appended to the previous standalone block in the same file (a multi-step example) |
| any other language | Not typechecked (`bash`, `json`, …) |

Snippets that need a value only available at runtime (a token from a form, bytes from a file
picker) declare it with `declare const` — that is the slot your UI fills in. Task-focused snippets
assume an already-constructed client and declare it the same way (`declare const cms: CMS`); only
the setup docs ([getting-started.md](./getting-started.md), [configuration.md](./configuration.md))
show full construction.

## Versions

patcms is 0.x: a minor release may break the API until the surface freezes. Each doc states the
behaviour of the current `main`; the shipped tarball is the truth for published types
(`packages/core/dist-types` after `pnpm -r build`).
