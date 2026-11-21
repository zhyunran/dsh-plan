# Desensitize checklist (before publishing to GitHub / npm)

This repository is written to be publishable, but publishing is a separate,
deliberate step. Run this list first.

Run the mechanical part before anything else:

```sh
npm run check:desensitize   # must exit 0
```

The exit code is the evidence. Do not write "this repo contains no private
data" into a README — a self-certification inside the artifact is not a check,
and it silently expires with the next commit.

## Code

- [ ] No absolute machine paths (`C:\Users\…`, `/home/…`, drive letters). Verify with a grep for `Users`, `Desktop`, `AppData`, `D:\\`.
- [ ] No account names, e-mail addresses, machine names, internal hostnames.
- [ ] No session ids, tokens, API keys, cookies. Verify with a grep for `token`, `secret`, `Bearer `.
- [ ] No dependency on files outside the package. The plugin only reads the session's own working directory.
- [ ] `test/` fixtures use OS temp directories only. Verify with a grep for `C:\\` and `C:/`.

## README / docs

- [ ] The "blood pressure" quotes are paraphrases, not verbatim user messages; keep them anonymized.
- [ ] No internal project names beyond the generic story, if the user prefers to keep them private.
- [ ] No absolute paths to the user's workspace, mod packs, game instances or backups.
- [ ] No screenshots containing account names, e-mails, tokens, server addresses.

## Repository

- [ ] `git config user.name` / `user.email` point at the public identity, not a private one.
- [ ] `.gitignore` keeps out `node_modules/`, `*.tgz`, `.dsh-plan/`.
- [ ] No `.tgz` committed; release assets use ASCII file names.
- [ ] `package.json` has no `repository` field pointing at a private remote until it is public.
- [ ] License and `README.md` (Chinese, default) / `README.en.md` (English) are both present and cross-linked; `README.zh.md` is only a redirect stub.

## History

- [ ] The publishable copy is created from a clean directory tree (no local git history that contains private paths or logs).
- [ ] `git log -p` reviewed once for private strings before the first push.
