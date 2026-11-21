/**
 * dsh-plan — one task list, two approvals, one stop rule.
 *
 * The plugin is deliberately small:
 *
 *   - a plan is a list of checkboxes in `.dsh-plan/<session>/plan.json`;
 *   - a turn cannot end while a required item is still `todo`;
 *   - `done` and `needs_user` both allow the end; `optional` never blocks;
 *   - only archiving a session and deleting existing files ask the user;
 *   - user stop (button, or a real user message) always wins.
 *
 * It never reads model prose to decide state: progress is the checkbox state,
 * and the status card is rendered from that state.
 *
 * @module dsh-plan
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { createRequire } from 'node:module'
import { createPlan, archiveDecision, pause, resume, rejectNeedsUser, nextItem, stopAllowed } from './model.js'
import { verifyEvidence } from './evidence.js'
import { classifyRejection, classifyUserText, messageText, DEFAULT_RUN_PHRASES, DEFAULT_STOP_PHRASES } from './phrases.js'
import { createTools } from './tools.js'
import { appendAction, appendLog, archivePlan, listArchives, loadPlan, loadSettings, savePlan, saveSettings, writeQuestions, writeStalled } from './store.js'
import { summaryLine, statusText, nextPrompt, statePayload } from './render.js'
import { normalizeSettings } from './settings.js'
import { gateDecision, DEFAULT_ARCHIVE_TOOLS } from './gates.js'
import { workGateDecision, toolGateDecision, DEFAULT_WORK_TOOLS } from './workgate.js'
import { createUserMessage } from './util.js'

export const name = 'dsh-plan'

/** The running host's own version, so the client can spot a host/client mismatch. */
export const PLUGIN_VERSION = (() => {
  try {
    return createRequire(import.meta.url)('../package.json').version
  } catch {
    return 'unknown'
  }
})()

/** Only the tool registry is mandatory; everything else is looked up by name. */
export const inject = ['tools']

const PROMPT_SECTION = `## Task plan rules (dsh-plan)

- With the session switch on, EVERY tool call is refused when there is no plan, the plan is paused, or no required item is open. Only \`plan_*\` and \`ask_user_question\` stay available. Call \`plan_create\` first; it needs at least 7 required items, each with an observable \`done_when\`.
- The turn may NOT end while a required item is still todo. If you cannot finish an item, mark it \`plan_needs_user\` with the exact question.
- Check an item only when it is truly done. \`check="evidence"\` items need \`sha256:<path>@<hex>\` or \`log:<path>@<text>\`; \`check="auto"\` items are verified by the plugin.
- Items that need the user's eyes go to \`plan_needs_user\`; they never block the turn and are collected into \`.dsh-plan/<session>/questions.md\`.
- If fewer than 3 things need the user, do other items first; do not stop to ask.
- Only two actions need the user's approval: archiving a session and deleting existing files. Everything else runs without asking.`

const DEFAULT_CONFIG = {
  minRequiredItems: 7,
  maxRequiredItems: 12,
  archiveGate: true,
  deleteGate: true,
  archiveTools: DEFAULT_ARCHIVE_TOOLS,
  maxForcedWithoutProgress: 12,
  requireOpenItemForWork: true,
  requirePlanForAllTools: true,
  workTools: DEFAULT_WORK_TOOLS,
  stopPhrases: DEFAULT_STOP_PHRASES,
  runPhrases: DEFAULT_RUN_PHRASES,
}

function normalizeConfig (raw) {
  const config = { ...DEFAULT_CONFIG }
  if (raw === null || typeof raw !== 'object') return config
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    if (raw[key] !== undefined) config[key] = raw[key]
  }
  if (!Array.isArray(config.stopPhrases) || config.stopPhrases.length === 0) config.stopPhrases = DEFAULT_STOP_PHRASES
  if (!Array.isArray(config.runPhrases) || config.runPhrases.length === 0) config.runPhrases = DEFAULT_RUN_PHRASES
  if (!Array.isArray(config.workTools) || config.workTools.length === 0) config.workTools = DEFAULT_WORK_TOOLS
  if (!Number.isFinite(config.maxForcedWithoutProgress) || config.maxForcedWithoutProgress < 1) config.maxForcedWithoutProgress = 12
  return config
}

function log (ctx, level, message) {
  try {
    ctx.logger?.[level]?.(`dsh-plan: ${message}`)
  } catch {
    /* logging must never break the agent turn */
  }
}

/** One in-memory slot per live session; the disk copy is authoritative on reload. */
class PlanManager {
  constructor (ctx, config) {
    this.ctx = ctx
    this.config = config
    this.states = new Map()
    this.settings = new Map()
  }

  /** Working directory for a session id, live or from the disk plan. */
  cwdForSession (sessionId) {
    const id = String(sessionId ?? '')
    const state = this.states.get(id)
    if (state?.cwd) return state.cwd
    const agent = this.ctx.get('agents')?.get?.(id)
    const cwd = agent?.session?.header?.cwd
    return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined
  }

  /** Per-session settings. Missing file means defaults (on, 7–12). */
  async settingsOf (sessionId) {
    const id = String(sessionId ?? '')
    if (this.settings.has(id)) return this.settings.get(id)
    const cwd = this.cwdForSession(id)
    const stored = cwd === undefined ? undefined : await loadSettings(cwd, id)
    const settings = normalizeSettings(stored, {
      minItems: this.config.minRequiredItems,
      maxItems: this.config.maxRequiredItems,
    })
    this.settings.set(id, settings)
    return settings
  }

  async setEnabled (sessionId, enabled) {
    return this.setSettings(sessionId, { enabled: enabled !== false })
  }

  /** Merge one patch into the session settings and persist it. */
  async setSettings (sessionId, patch) {
    const id = String(sessionId ?? '')
    const cwd = this.cwdForSession(id)
    if (cwd === undefined) throw new Error('dsh-plan: this session has no working directory; settings cannot be stored')
    const current = await this.settingsOf(id)
    const settings = normalizeSettings(
      { ...current, ...(patch ?? {}) },
      { minItems: this.config.minRequiredItems, maxItems: this.config.maxRequiredItems },
    )
    await saveSettings(cwd, id, settings)
    this.settings.set(id, settings)
    return settings
  }

  stateOf (agent) {
    const id = String(agent?.id ?? '')
    if (id.length === 0) throw new Error('dsh-plan: the call has no agent session')
    let state = this.states.get(id)
    if (state === undefined) {
      state = { id, cwd: '', plan: undefined, runIntent: false, steeredTurn: -1, rewriteHint: false }
      this.states.set(id, state)
    }
    return state
  }

  cwdOf (agent) {
    const cwd = agent?.session?.header?.cwd
    if (typeof cwd !== 'string' || cwd.length === 0) {
      throw new Error('dsh-plan: this session has no working directory; a plan cannot be stored')
    }
    return cwd
  }

  async ensure (agent) {
    const state = this.stateOf(agent)
    if (state.plan !== undefined) return state.plan
    if (state.cwd.length === 0) state.cwd = this.cwdOf(agent)
    const plan = await loadPlan(state.cwd, state.id)
    if (plan !== undefined) {
      state.plan = plan
      return plan
    }
    return undefined
  }

  async require (agent) {
    const plan = await this.ensure(agent)
    if (plan === undefined) throw new Error('no task plan in this session. Call plan_create first (at least 7 required items with observable done_when).')
    return plan
  }

  async requireWithCwd (agent) {
    const plan = await this.require(agent)
    const state = this.stateOf(agent)
    if (state.cwd.length === 0) state.cwd = this.cwdOf(agent)
    return { plan, cwd: state.cwd }
  }

  /**
   * The plan for one session id, live or re-read from disk. Used by the Web
   * dock, which only knows the id from its slot props.
   */
  async lookup (sessionId) {
    const id = String(sessionId ?? '')
    if (id.length === 0) return undefined
    const state = this.states.get(id)
    if (state?.plan !== undefined) return state.plan
    const agent = this.ctx.get('agents')?.get?.(id)
    const cwd = agent?.session?.header?.cwd ?? state?.cwd
    if (typeof cwd !== 'string' || cwd.length === 0) return undefined
    const plan = await loadPlan(cwd, id)
    if (plan !== undefined && state !== undefined) state.plan = plan
    return plan
  }

  async create (agent, { lines, mode }) {
    const state = this.stateOf(agent)
    if (state.cwd.length === 0) state.cwd = this.cwdOf(agent)
    const settings = await this.settingsOf(state.id)
    const plan = createPlan({
      sessionId: state.id,
      cwd: state.cwd,
      lines,
      mode: mode === 'run' || state.runIntent ? 'run' : 'task',
      minRequired: settings.minItems,
      maxRequired: settings.maxItems,
    })
    state.plan = plan
    state.runIntent = false
    state.rewriteHint = false
    await this.persist(plan, { action: 'create', items: plan.items.map((item) => item.id) })
    return plan
  }

  /**
   * Move the current plan to the archive and empty the slot. A user message
   * that starts a new round does this automatically; the archived copy keeps
   * its items and evidence for the viewer.
   */
  async archive (agent, plan, reason) {
    const state = this.stateOf(agent)
    if (state.cwd.length === 0) state.cwd = this.cwdOf(agent)
    await archivePlan(state.cwd, state.id, plan, reason)
    state.plan = undefined
    try {
      await appendLog(state.cwd, state.id, { action: 'archive', reason })
    } catch {
      /* log is best effort */
    }
  }

  async persist (plan, entry) {
    const state = this.states.get(plan.sessionId)
    const cwd = state?.cwd ?? plan.cwd
    await savePlan(cwd, plan)
    await writeQuestions(cwd, plan)
    try {
      await appendLog(cwd, plan.sessionId, entry ?? { action: 'update' })
    } catch {
      /* the log is a convenience; never fail a tool call on it */
    }
  }

  async pause (agent, reason) {
    const plan = await this.ensure(agent)
    if (plan === undefined) return
    pause(plan, reason)
    await this.persist(plan, { action: 'pause', reason })
  }

  /**
   * The plan that governs this agent's work: its own, or its parent's when the
   * caller is a delegated child (a child inherits the parent's checklist).
   */
  async planForAgent (agent) {
    const own = await this.ensure(agent)
    if (own !== undefined) return own
    const parentId = agent?.session?.header?.parentSession
    if (typeof parentId !== 'string' || parentId.length === 0) return undefined
    const parent = this.ctx.get('agents')?.get?.(parentId)
    if (parent === undefined) return undefined
    return this.ensure(parent)
  }

  async resume (agent) {
    const plan = await this.ensure(agent)
    if (plan === undefined) return
    resume(plan)
    await this.persist(plan, { action: 'resume' })
  }

  async onUserMessage (agent, text) {
    const state = this.stateOf(agent)
    const plan = await this.ensure(agent)
    const verdict = classifyUserText(text, {
      paused: plan?.paused === true,
      stopPhrases: this.config.stopPhrases,
      runPhrases: this.config.runPhrases,
    })
    if (verdict.kind === 'run') {
      state.runIntent = true
      return
    }
    if (verdict.kind === 'stop') {
      state.runIntent = false
      if (plan !== undefined) await this.pause(agent, `user: ${verdict.phrase}`)
      return
    }
    if (verdict.kind === 'resume') {
      if (plan !== undefined && plan.paused === true) await this.resume(agent)
      return
    }

    // A parked acceptance the user rejected ("不行", "不像", "P3 不对"):
    // keep it parked for the next review and add one required fix item.
    if (plan !== undefined && plan.paused !== true) {
      const parked = plan.items.filter((item) => item.status === 'needs_user')
      if (parked.length > 0) {
        const rejection = classifyRejection(text, { hasNeedsUser: true })
        if (rejection.reject === true) {
          try {
            const { target, item } = rejectNeedsUser(plan, { id: rejection.itemId, reason: rejection.reason })
            await this.persist(plan, {
              action: 'reject',
              id: target.id,
              newItem: item.id,
              reason: rejection.reason,
            })
          } catch (error) {
            await appendLog(this.stateOf(agent).cwd || this.cwdOf(agent), agent.id, {
              action: 'reject-ambiguous',
              reason: rejection.reason,
              error: String(error?.message ?? error),
            }).catch(() => {})
          }
        }
      }
    }

    // New round: a plain user message retires the previous plan. A paused
    // plan is retired too — otherwise it would sit in the slot forever and
    // every round would show the same checklist. Run mode and parked
    // questions are the two exceptions (see archiveDecision).
    if (plan !== undefined) {
      const decision = archiveDecision(plan)
      if (decision !== null) {
        await this.archive(agent, plan, decision.reason)
        if (decision.interrupted) state.rewriteHint = true
      }
    }
  }
}

/**
 * Expose the current plan to the Web dock. Read-only, same-origin, no paths:
 * the client half only needs checkbox state and the enforcement flag.
 */
function registerStateRoute (ctx, manager) {
  try {
    // webServer is optional: in a headless composition there is no HTTP face,
    // and the plugin must still provide its tools. `ctx.inject` starts the
    // child scope only once the service exists, instead of reading `get()`
    // during apply when the HTTP service may not be mounted yet.
    ctx.inject(['webServer'], (child) => {
      try {
        const web = child.webServer
        if (web === undefined || typeof web.register !== 'function') return
        const sendJson = (res, status, value) => {
          res.statusCode = status
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.setHeader('cache-control', 'no-store')
          res.end(JSON.stringify(value))
        }
        const readBody = (req) => new Promise((resolve) => {
          let body = ''
          req.setEncoding('utf8')
          req.on('data', (chunk) => {
            body += chunk
            if (body.length > 4096) req.destroy()
          })
          req.on('end', () => resolve(body))
          req.on('error', () => resolve(body))
        })
        const disposers = []
        disposers.push(web.register({
          kind: 'exact',
          path: '/_dsh-plan/state',
          handler: async (req, res) => {
            try {
              if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method not allowed' })
              const url = new URL(req.url ?? '/', 'http://localhost')
              const sessionId = url.searchParams.get('sessionId') ?? ''
              const plan = await manager.lookup(sessionId)
              const settings = await manager.settingsOf(sessionId)
              sendJson(res, 200, statePayload(plan, settings.enabled, PLUGIN_VERSION))
            } catch (error) {
              sendJson(res, 500, { error: String(error?.message ?? error) })
            }
          },
        }))
        disposers.push(web.register({
          kind: 'exact',
          path: '/_dsh-plan/history',
          handler: async (req, res) => {
            try {
              if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method not allowed' })
              const url = new URL(req.url ?? '/', 'http://localhost')
              const sessionId = url.searchParams.get('sessionId') ?? ''
              const cwd = manager.cwdForSession(sessionId)
              const archives = cwd === undefined ? [] : await listArchives(cwd, sessionId)
              sendJson(res, 200, { archives })
            } catch (error) {
              sendJson(res, 500, { error: String(error?.message ?? error) })
            }
          },
        }))
        disposers.push(web.register({
          kind: 'exact',
          path: '/_dsh-plan/settings',
          handler: async (req, res) => {
            try {
              if (req.method === 'GET' || req.method === 'HEAD') {
                const url = new URL(req.url ?? '/', 'http://localhost')
                const settings = await manager.settingsOf(url.searchParams.get('sessionId') ?? '')
                return sendJson(res, 200, settings)
              }
              if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
              const raw = await readBody(req)
              const body = raw.trim().length === 0 ? {} : JSON.parse(raw)
              const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
              const patch = {}
              if (body.enabled !== undefined) patch.enabled = body.enabled !== false
              if (body.minItems !== undefined) patch.minItems = body.minItems
              if (body.maxItems !== undefined) patch.maxItems = body.maxItems
              const settings = await manager.setSettings(sessionId, patch)
              sendJson(res, 200, settings)
            } catch (error) {
              sendJson(res, 400, { error: String(error?.message ?? error) })
            }
          },
        }))
        if (typeof child.effect === 'function') {
          try { child.effect(() => () => { for (const dispose of disposers) { try { dispose?.() } catch {} } }) } catch { /* routes may already be owned */ }
        }
      } catch (error) {
        log(ctx, 'error', `state route registration failed: ${error?.message ?? error}`)
      }
    })
  } catch (error) {
    log(ctx, 'error', `webServer injection failed: ${error?.message ?? error}`)
  }
}

/**
 * Install the plugin.
 *
 * @param {any} ctx plugin context.
 * @param {unknown} rawConfig the `config` block from the profile patch.
 */
export function apply (ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const manager = new PlanManager(ctx, config)
  registerStateRoute(ctx, manager)

  // --- user stop / run intent / abort ------------------------------------
  ctx.on('session/event', (session, event) => {
    if (event?.type === 'user/message' && event.data?.source?.kind === 'user') {
      const agent = ctx.get('agents')?.get?.(session.id)
      if (agent === undefined) return
      const text = messageText(event.data)
      if (text.trim().length === 0) return
      manager.onUserMessage(agent, text).catch((error) => log(ctx, 'error', `user message handling failed: ${error?.message ?? error}`))
      return
    }
    if (event?.type === 'turn/end' && event.data?.reason?.kind === 'aborted') {
      const agent = ctx.get('agents')?.get?.(session.id)
      if (agent === undefined) return
      manager.pause(agent, 'runtime abort').catch((error) => log(ctx, 'error', `abort pause failed: ${error?.message ?? error}`))
    }
  })

  // --- no tools (or no state-changing work) without an open item ----------
  ctx.on('tools/pre-execute', async (exec, next) => {
    try {
      const agent = exec?.agent
      if (agent !== undefined && config.requireOpenItemForWork !== false) {
        const settings = await manager.settingsOf(agent.id)
        if (settings.enabled === true) {
          const plan = await manager.planForAgent(agent)
          const allTools = config.requirePlanForAllTools === true
          const gateDecision = allTools
            ? toolGateDecision(exec?.name, plan, config)
            : workGateDecision(exec?.name, plan, config)
          if (gateDecision !== undefined) return gateDecision
        }
      }
    } catch (error) {
      // A broken work gate must not block the session: fall through.
      log(ctx, 'error', `work gate failed: ${error?.message ?? error}`)
    }
    const decision = gateDecision(exec, config)
    if (decision !== undefined) return decision
    return next()
  }, { prepend: true })

  // --- record the no-prompt actions (game launch, new peer session) -------
  ctx.on('tools/result', (exec) => {
    try {
      const toolName = String(exec?.name ?? '')
      if (toolName !== 'app_launch' && toolName !== 'cross_session_create') return
      const agent = exec?.agent
      const cwd = agent?.session?.header?.cwd
      if (agent === undefined || typeof cwd !== 'string' || cwd.length === 0) return
      const target = toolName === 'app_launch'
        ? String(exec?.arguments?.name ?? '')
        : String(exec?.arguments?.title ?? exec?.arguments?.cwd ?? '')
      appendAction(cwd, agent.id, { action: 'no-prompt-action', tool: toolName, target }).catch(() => {})
    } catch {
      /* recording must never break the call */
    }
  })

  // --- the stop rule ------------------------------------------------------
  ctx.on('agent/turn-stopping', async ({ agent, signal }) => {
    try {
      if (signal?.aborted) return
      const state = manager.stateOf(agent)
      if (state.cwd.length === 0) state.cwd = manager.cwdOf(agent)
      const settings = await manager.settingsOf(agent.id)
      if (settings.enabled !== true) return
      const plan = await manager.ensure(agent)

      if (plan === undefined) {
        if (state.rewriteHint === true) {
          agent.steer(createUserMessage({
            content: [{ type: 'text', text: '【任务单】上一单已被你的新输入打断并归档，你只有一次重写机会：plan_create（至少 7 个必需项，每项写可观察的 done_when），或 plan_update add 把新的目标写进单子，然后再继续。' }],
            source: { kind: 'dsh-plan' },
          }))
          state.rewriteHint = false
          return
        }
        if (state.runIntent === true) {
          agent.steer(createUserMessage({
            content: [{ type: 'text', text: '【任务单】先建单再开工：plan_create，至少 7 个必需项，每项写清可观察的完成标准（done_when）。' }],
            source: { kind: 'dsh-plan' },
          }))
          state.runIntent = false
        }
        return
      }

      if (plan.paused === true || plan.stalled === true) return
      if (stopAllowed(plan)) {
        await writeQuestions(state.cwd, plan)
        return
      }
      if (signal?.aborted) return

      const forced = Number(plan.forced ?? 0) + 1
      plan.forced = forced
      if (forced > config.maxForcedWithoutProgress) {
        plan.stalled = true
        await savePlan(state.cwd, plan)
        await writeStalled(state.cwd, plan, `连续 ${forced} 次续行没有推进（没有勾选、加项、挂起或改单）`)
        log(ctx, 'info', `plan stalled after ${forced} forced continuations (${plan.sessionId})`)
        return
      }
      await savePlan(state.cwd, plan)
      const item = nextItem(plan)
      const text = nextPrompt(plan)
      if (text.length === 0 || item === undefined) return
      agent.steer(createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'dsh-plan' },
      }))
      log(ctx, 'info', `continued plan ${plan.sessionId}: next ${item.id}`)
    } catch (error) {
      // A broken guard must never trap the session: log and let the turn end.
      log(ctx, 'error', `turn-stopping failed: ${error?.message ?? error}`)
    }
  })

  // --- the rules the model reads every step -------------------------------
  try {
    const systemPrompt = ctx.get('systemPrompt')
    if (systemPrompt && typeof systemPrompt.section === 'function') {
      systemPrompt.section({ name: 'dsh-plan:rules', order: 45, text: PROMPT_SECTION })
    }
  } catch (error) {
    log(ctx, 'error', `prompt section registration failed: ${error?.message ?? error}`)
  }

  // --- tools --------------------------------------------------------------
  try {
    for (const tool of createTools({ defineTool, manager })) {
      try {
        ctx.tools.register(tool)
      } catch (error) {
        log(ctx, 'error', `could not register ${tool?.name}: ${error?.message ?? error}`)
      }
    }
  } catch (error) {
    log(ctx, 'error', `tool construction failed: ${error?.message ?? error}`)
  }

  log(ctx, 'info', `ready (minRequiredItems=${config.minRequiredItems}, archiveGate=${config.archiveGate}, deleteGate=${config.deleteGate})`)
}

// Exported for tests.
export { normalizeConfig, summaryLine, statusText }
