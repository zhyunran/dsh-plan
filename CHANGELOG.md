# Changelog

## 0.5.4 — 2026-11-21

- Chinese README is now the default `README.md` (GitHub renders it first);
  English moved to `README.en.md`, and `README.zh.md` is a redirect stub so
  there are not three drifting copies. `package.json` ships `README.en.md`.

## 0.5.3 — 2026-11-21

- Removed the turn-tail "Plan" button added in 0.5.2: it rendered as a separate
  centred row and duplicated the action-row button. Only the assistant-message
  action row keeps the button.

## 0.5.2 — 2026-11-21

- The plan button now also sits in the turn tail (`conversation.chat.turnTail`,
  id `dsh-plan-turn-tail`), i.e. next to the `Stopped` / closing row, not only
  in the assistant-message action row. Both open the same read-only viewer.

## 0.5.1 — 2026-11-21

- **Bug**: a plan paused by a runtime abort was never retired, so every round
  kept showing the same checklist. `archiveDecision()` now retires paused
  plans on a new user message as well (reason `stopped`), keeping only the two
  intended exceptions: run mode while unpaused, and parked questions.
- The state payload reports `hostVersion`, and the plan viewer shows it, so a
  host/client version mismatch is visible instead of guessed.
- Tests: 48 (new archive-decision cases).

## 0.5.0 — 2026-11-21

- **New round retires the old plan**: a plain user message archives the
  current plan under `.dsh-plan/<session>/plans/` and empties the slot. Run
  mode (while unpaused) and plans with parked questions are kept.
- **One rewrite after an interruption**: if the retired plan still had open
  required items, the model gets a single rewrite hint (`plan_create` or
  `plan_update add`) before it may work again.
- **"Plan" button in the assistant-message action row** (next to like /
  dislike): opens a read-only panel with the current plan and the recent
  archives (time, reason, item count).
- New `GET /_dsh-plan/history?sessionId=…` endpoint for that panel.
- The plan dock now starts collapsed.
- Tests: 45.

## 0.4.1 — 2026-11-21

- Found live: a 0.4.0 client half can load while the host is still 0.3.0 (so
  the settings endpoint does not exist and the switch snaps back). The switch now
  reports `任务单 · 未就绪` with a "restart DSH" title instead of silently
  reverting, and stops pretending to be on.
- README install example no longer pins a stale version.

## 0.4.0 — 2026-11-21

- **Per-session switch in the composer** (`conversation.input.right`, id
  `dsh-plan-toggle`): `Plan · on / off`. Turning it off disables the work gate
  and the stop rule for that session; the dock hides while off.
- The switch value persists in `.dsh-plan/<session>/settings.json` and is read
  by both gates; a missing file means on.
- New endpoints: `GET /_dsh-plan/settings?sessionId=…` and
  `POST /_dsh-plan/settings` (same-origin, session-scoped).
- `statePayload` now reports `enabled`; `enforced` is false while switched off.

## 0.3.0 — 2026-11-21

- **Enforce plan creation, not just completion.** State-changing tools
  (`write`, `edit`, `pwsh`, `bash`, `app_launch`, `subagent`, `subagent_fork`,
  `workflow`, `cross_session_create`) are refused when the session has no plan,
  the plan is paused, or the plan has no open required item. Reads, searches,
  questions and the `plan_*` tools stay ungated.
- A delegated child uses its parent's plan, so a subagent cannot work off the
  books.
- New config `requireOpenItemForWork` (default `true`) and `workTools`.
- Prompt rules updated: state-changing work requires an open item.

## 0.2.3 — 2026-11-20

- A completed item keeps its plain text and shows only the green check — no
  strikethrough, no dimming.

## 0.2.2 — 2026-11-20

- **Bug**: the Web dock's state route was never registered. `apply` read
  `ctx.get('webServer')` before the HTTP service was mounted in this
  composition, so `GET /_dsh-plan/state` returned 404 and the dock stayed
  invisible. Registration now runs inside `ctx.inject(['webServer'], …)`, so it
  starts when the service exists. Found by the post-restart live test.
- The dock now shows a small inline error instead of staying silent when the
  state endpoint is unreachable.

## 0.2.1 — 2026-11-20

- The dock's item list is capped at 260px with its own scroll, so a 20-item
  plan cannot push the composer off screen.

## 0.2.0 — 2026-11-20

- Web UI: a dock above the composer shows whether the plugin is holding the
  turn, the plan's progress, every item's status, the evidence of each checked
  item and the next item the model is being pushed toward.
- Host exposes read-only `GET /_dsh-plan/state?sessionId=…` for that dock; the
  payload is computed from `plan.json`, never from model prose.
- `statePayload()` reports three answers directly: `enforced` (turn held),
  `canEnd` (checklist clear), `paused` / `stalled`.
- Client half registers on `conversation.input.dock` with id `dsh-plan-dock`.

## 0.1.4 — 2026-11-20

- README.zh.md replaced with the user's rewrite; English README mirrors it.
- README documents `actions.jsonl` and scopes "只留记录" to the two
  no-prompt actions this plugin actually records.
- Add `npm run check:desensitize` (a check with a non-zero exit code, not a
  sentence in the README) and point DESENSITIZE.md at it.
- No runtime behaviour change from 0.1.3.

## 0.1.3 — 2026-11-20

- A rejected acceptance ("不行 / 不像 / P3 不对") reopens the plan: the parked
  item stays parked for the next review and one new required fix item is
  added. Ambiguous rejections fail instead of guessing.
- The two no-prompt actions (game launch, new peer session) are recorded in
  `.dsh-plan/<session>/actions.jsonl`, as the README promises.
- The delete gate's scratch exemption now resolves against the session working
  directory instead of the host process cwd.

## 0.1.2 — 2026-11-20

- `plan_status` no longer returns an `undefined` field; DSH's lossless-JSON
  output contract rejected the payload and the tool failed.
- The tool-view builder is now exported and covered by the model tests.

## 0.1.1 — 2026-11-20

- Delete gate no longer fires on a delete word that appears inside a quoted
  string (documentation, log messages, variable values). Live-fire finding
  from the first install: a verification command that merely *mentioned*
  `Remove-Item` in a quoted log line was blocked.
- Regression test added for the quoted-mention case.

## 0.1.0 — 2026-11-20

First working version.

- Task plan with `required` / `optional` items, observable `done_when`, and a
  minimum of 7 required items at creation.
- Stop rule: a turn cannot end while a required item is still `todo`;
  `done` and `needs_user` both allow the end; `optional` never blocks.
- Evidence gate on checking: `sha256:<path>@<hex>` or `log:<path>@<text>` for
  `check: "evidence"`; declared witness for `check: "auto"`.
- `needs_user` items never block; they are rendered into
  `.dsh-plan/<session>/questions.md` for the user to read later.
- Plan state is persisted to `.dsh-plan/<session>/` and survives restart,
  resume, fork and compaction.
- Two approvals only: archiving a session and deleting existing files.
  Everything else runs without a prompt.
- User stop always wins: the runtime stop button is never intercepted; chat
  stop phrases pause the plan and it does not auto-resume.
- Stall protection: after `maxForcedWithoutProgress` continuations with no
  plan change, enforcement stops and `stalled.md` is written.
- Unit tests for the state machine, phrase classification, evidence formats
  and the two gates (`npm test`).
