/**
 * dsh-plan — client half.
 *
 * Adds one dock above the composer showing, for the current session:
 *
 *   - whether the plugin is currently holding the turn ("接管中 / 不许提前结束"),
 *   - the plan's checkbox state (done / todo / needs the user),
 *   - the evidence recorded for each checked item,
 *   - the next item the model is being pushed toward.
 *
 * The dock is a pure projection of `/_dsh-plan/state`; it never infers state
 * from model prose. Registration is wrapped so a failed slot injection can
 * never break the composer.
 */

window.__ModuleLoader__.load({
  id: 'dsh-plan',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var h = React.createElement

    var ROUTE = '/_dsh-plan/state'
    var POLL_MS = 1500

    function isZh () {
      try {
        return String((typeof navigator !== 'undefined' && navigator.language) || '').toLowerCase().startsWith('zh')
      } catch {
        return false
      }
    }

    function usePlan (sessionId) {
      var dataState = React.useState(null)
      var data = dataState[0]
      var setData = dataState[1]
      var errorState = React.useState('')
      var error = errorState[0]
      var setError = errorState[1]

      React.useEffect(function () {
        if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined
        var alive = true
        var timer = null
        function tick () {
          fetch(ROUTE + '?sessionId=' + encodeURIComponent(sessionId), {
            credentials: 'same-origin',
            headers: { accept: 'application/json' },
          }).then(function (response) {
            if (!response.ok) throw new Error('HTTP ' + response.status)
            return response.json()
          }).then(function (payload) {
            if (!alive) return
            setData(payload)
            setError('')
          }).catch(function (failure) {
            if (alive) setError(String(failure && failure.message ? failure.message : failure))
          }).finally(function () {
            if (alive) timer = setTimeout(tick, POLL_MS)
          })
        }
        tick()
        return function () {
          alive = false
          if (timer !== null) clearTimeout(timer)
        }
      }, [sessionId])

      return { data: data, error: error }
    }

    function statusGlyph (status) {
      if (status === 'done') return '✓'
      if (status === 'needs_user') return '?'
      return '·'
    }

    function statusColor (status) {
      if (status === 'done') return '#2f855a'
      if (status === 'needs_user') return '#b7791f'
      return 'rgba(127,127,127,.65)'
    }

    function Dock (props) {
      var zh = isZh()
      var sessionId = props && props.sessionId
      var plan = usePlan(sessionId)
      var openState = React.useState(false)
      var open = openState[0]
      var setOpen = openState[1]

      if (typeof sessionId !== 'string' || sessionId.length === 0) return null
      if (plan.data === null) {
        if (!plan.error) return null
        return h('div', {
          role: 'status',
          style: {
            border: '1px dashed rgba(197,48,48,.5)',
            borderRadius: '8px',
            margin: '0 0 8px',
            padding: '6px 10px',
            fontSize: '12px',
            color: '#c53030',
            opacity: 0.85,
          },
        }, (isZh() ? 'dsh-plan 状态接口不可用：' : 'dsh-plan state unavailable: ') + plan.error)
      }
      if (plan.data.active !== true) return null
      if (plan.data.enabled === false) return null

      var data = plan.data
      var counts = data.stats || { required: 0, requiredDone: 0, done: 0, needsUser: 0 }
      var pct = counts.required > 0 ? Math.round((counts.requiredDone / counts.required) * 100) : 0
      var stateText
      var stateColor
      if (data.paused === true) {
        stateText = zh ? '已暂停（你说停）' : 'Paused by you'
        stateColor = '#b7791f'
      } else if (data.stalled === true) {
        stateText = zh ? '卡住，已停止强制续行' : 'Stalled, enforcement stopped'
        stateColor = '#c53030'
      } else if (data.enforced === true) {
        stateText = zh ? '接管中 · 清单没清空不许结束回合' : 'Holding the turn until the checklist is clear'
        stateColor = '#2f855a'
      } else if (data.canEnd === true) {
        stateText = zh ? '清单已清空，允许结束' : 'Checklist clear, the turn may end'
        stateColor = 'rgba(127,127,127,.8)'
      } else {
        stateText = zh ? '进行中' : 'In progress'
        stateColor = 'rgba(127,127,127,.8)'
      }

      var items = Array.isArray(data.items) ? data.items : []
      var modeTag = data.mode === 'run' ? (zh ? 'run 模式' : 'run mode') : (zh ? '本轮' : 'this turn')

      return h('div', {
        role: 'region',
        'aria-label': zh ? 'dsh-plan 任务单' : 'dsh-plan task list',
        style: {
          border: '1px solid rgba(127,127,127,.32)',
          borderRadius: '10px',
          background: 'rgba(127,127,127,.08)',
          margin: '0 0 8px',
          padding: '10px 12px',
          fontSize: '13px',
          lineHeight: 1.45,
          color: 'inherit',
        },
      },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
        h('button', {
          type: 'button',
          onClick: function () { setOpen(!open) },
          'aria-expanded': open ? 'true' : 'false',
          style: {
            border: 0,
            background: 'transparent',
            color: 'inherit',
            cursor: 'pointer',
            padding: '0 2px',
            fontSize: '13px',
            opacity: 0.7,
          },
        }, open ? '▾' : '▸'),
        h('span', { style: { fontWeight: 600 } }, zh ? '任务单' : 'Plan'),
        h('span', { style: { fontVariantNumeric: 'tabular-nums' } },
          String(counts.requiredDone) + '/' + String(counts.required)),
        h('span', { style: { opacity: 0.55 } }, modeTag),
        h('span', { style: { color: stateColor, fontWeight: 500 } }, stateText),
        counts.needsUser > 0
          ? h('span', { style: { color: '#b7791f' } }, (zh ? '待你 ' : 'waiting on you ') + String(counts.needsUser))
          : null,
        plan.error ? h('span', { style: { color: '#c53030', opacity: 0.8 } }, plan.error) : null,
      ),
      h('div', {
        'aria-hidden': 'true',
        style: {
          height: '4px',
          borderRadius: '2px',
          background: 'rgba(127,127,127,.22)',
          margin: '8px 0 0',
          overflow: 'hidden',
        },
      }, h('div', {
        style: {
          width: String(pct) + '%',
          height: '100%',
          background: data.paused === true || data.stalled === true ? '#b7791f' : '#2f855a',
          transition: 'width .3s ease',
        },
      })),
      open
        ? h('div', { style: { marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '5px', maxHeight: '260px', overflowY: 'auto' } },
            items.map(function (item) {
              var isNext = data.next !== null && data.next !== undefined && data.next.id === item.id
              return h('div', {
                key: item.id,
                style: {
                  display: 'grid',
                  gridTemplateColumns: '18px 52px 1fr',
                  columnGap: '6px',
                  alignItems: 'baseline',
                  padding: '3px 6px',
                  borderRadius: '6px',
                  background: isNext ? 'rgba(47,133,90,.12)' : 'transparent',
                  borderLeft: isNext ? '2px solid #2f855a' : '2px solid transparent',
                  opacity: 1,
                },
              },
              h('span', { style: { color: statusColor(item.status), fontWeight: 700 } }, statusGlyph(item.status)),
              h('span', { style: { opacity: 0.6, fontVariantNumeric: 'tabular-nums' } }, item.id),
              h('span', { style: { minWidth: 0 } },
                h('span', null, item.text),
                item.type === 'optional' ? h('span', { style: { opacity: 0.5 } }, zh ? '（可选）' : ' (optional)') : null,
                h('div', { style: { opacity: 0.55, fontSize: '12px' } },
                  (zh ? '验收：' : 'done when: ') + item.done_when),
                item.evidence
                  ? h('div', { style: { opacity: 0.6, fontSize: '12px', fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' } }, item.evidence)
                  : null,
                item.question
                  ? h('div', { style: { color: '#b7791f', fontSize: '12px' } }, (zh ? '待你回答：' : 'waiting on you: ') + item.question)
                  : null,
              ))
            }),
          )
        : null,
      )
    }

    /** Per-session switch: read once, write on click. */
    function useSettings (sessionId) {
      var enabledState = React.useState(null)
      var enabled = enabledState[0]
      var setEnabled = enabledState[1]
      var errorState = React.useState('')
      var error = errorState[0]
      var setError = errorState[1]
      var busyState = React.useState(false)
      var busy = busyState[0]
      var setBusy = busyState[1]

      React.useEffect(function () {
        if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined
        var alive = true
        fetch('/_dsh-plan/settings?sessionId=' + encodeURIComponent(sessionId), {
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
        }).then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status)
          return response.json()
        }).then(function (payload) {
          if (alive) setEnabled(payload && payload.enabled !== false)
        }).catch(function (failure) {
          if (alive) setError(String(failure && failure.message ? failure.message : failure))
        })
        return function () { alive = false }
      }, [sessionId])

      function toggle () {
        if (busy) return
        var next = enabled === false
        setEnabled(next)
        setBusy(true)
        fetch('/_dsh-plan/settings', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ sessionId: sessionId, enabled: next }),
        }).then(function (response) {
          return response.json().then(function (payload) {
            if (!response.ok) throw new Error(payload && payload.error ? payload.error : 'HTTP ' + response.status)
            return payload
          })
        }).then(function (payload) {
          setEnabled(payload && payload.enabled !== false)
          setError('')
        }).catch(function (failure) {
          setEnabled(!next)
          setError(String(failure && failure.message ? failure.message : failure))
        }).finally(function () {
          setBusy(false)
        })
      }

      return { enabled: enabled, error: error, busy: busy, toggle: toggle }
    }

    /** The composer toggle: 任务单 开 / 关. */
    function PlanSwitch (props) {
      var zh = isZh()
      var sessionId = props && props.sessionId
      var settings = useSettings(sessionId)
      if (typeof sessionId !== 'string' || sessionId.length === 0) return null
      var enabled = settings.enabled !== false
      var unavailable = settings.error.length > 0
      var needsRestart = unavailable && /404|405/.test(settings.error)
      var label = unavailable
        ? (zh ? '任务单 · 未就绪' : 'Plan · not ready')
        : enabled ? (zh ? '任务单 · 开' : 'Plan · on') : (zh ? '任务单 · 关' : 'Plan · off')
      var title = unavailable
        ? (needsRestart
            ? (zh ? '开关接口不存在：宿主仍是旧版本，重启 DSH 后 0.4.x 的开关才可用。' : 'Switch endpoint missing: the host is still the old build. Restart DSH to load 0.4.x.')
            : (zh ? 'dsh-plan 开关不可用：' : 'dsh-plan switch unavailable: ') + settings.error)
        : (enabled
            ? (zh ? '已开启：没有开放任务项时不许动状态，单子没清空不许结束' : 'On: no work without an open item; a turn is held until the checklist is clear')
            : (zh ? '已关闭：插件不介入本会话' : 'Off: the plugin does not enforce anything in this session'))
      return h('button', {
        type: 'button',
        'aria-pressed': enabled && !unavailable,
        'aria-label': title,
        title: title,
        onClick: unavailable ? undefined : settings.toggle,
        disabled: settings.busy || unavailable,
        style: {
          height: '24px',
          padding: '0 8px',
          marginRight: '6px',
          borderRadius: '999px',
          border: '1px solid ' + (unavailable ? 'rgba(197,48,48,.5)' : enabled ? 'rgba(47,133,90,.6)' : 'rgba(127,127,127,.45)'),
          background: unavailable ? 'rgba(197,48,48,.10)' : enabled ? 'rgba(47,133,90,.14)' : 'transparent',
          color: 'inherit',
          fontSize: '12px',
          lineHeight: '22px',
          cursor: settings.busy || unavailable ? 'default' : 'pointer',
          opacity: settings.busy ? 0.6 : 1,
          whiteSpace: 'nowrap',
        },
      }, label)
    }

    // --- "view this conversation's plan" ---------------------------------
    // The assistant-actions button and the frame-wide overlay are separate
    // slot trees, so they coordinate through one module-level store.
    var viewer = { open: false, sessionId: '', listeners: [] }

    function emitViewer () {
      for (var i = 0; i < viewer.listeners.length; i += 1) {
        try { viewer.listeners[i]() } catch {}
      }
    }

    function openViewer (sessionId) {
      viewer.open = true
      viewer.sessionId = typeof sessionId === 'string' ? sessionId : ''
      emitViewer()
    }

    function closeViewer () {
      viewer.open = false
      emitViewer()
    }

    function useViewer () {
      var state = React.useState({ open: viewer.open, sessionId: viewer.sessionId })
      var value = state[0]
      var setValue = state[1]
      React.useEffect(function () {
        function sync () { setValue({ open: viewer.open, sessionId: viewer.sessionId }) }
        viewer.listeners.push(sync)
        return function () {
          var index = viewer.listeners.indexOf(sync)
          if (index >= 0) viewer.listeners.splice(index, 1)
        }
      }, [])
      return value
    }

    function PlanViewButton (props) {
      var zh = isZh()
      var sessionId = props && props.sessionId
      if (typeof sessionId !== 'string' || sessionId.length === 0) return null
      return h('button', {
        type: 'button',
        title: zh ? '查看本对话任务单' : 'View this conversation plan',
        onClick: function () { openViewer(sessionId) },
        style: {
          border: 0,
          background: 'transparent',
          color: 'inherit',
          cursor: 'pointer',
          fontSize: '12px',
          opacity: 0.7,
          padding: '0 4px',
        },
      }, zh ? '任务单' : 'Plan')
    }

    function PlanViewer () {
      var zh = isZh()
      var current = useViewer()
      var dataState = React.useState(null)
      var data = dataState[0]
      var setData = dataState[1]
      var errorState = React.useState('')
      var error = errorState[0]
      var setError = errorState[1]
      var historyState = React.useState([])
      var history = historyState[0]
      var setHistory = historyState[1]

      React.useEffect(function () {
        if (current.open !== true) return undefined
        setData(null)
        setError('')
        setHistory([])
        var alive = true
        fetch('/_dsh-plan/state?sessionId=' + encodeURIComponent(current.sessionId), {
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
        }).then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status)
          return response.json()
        }).then(function (payload) {
          if (alive) setData(payload)
        }).catch(function (failure) {
          if (alive) setError(String(failure && failure.message ? failure.message : failure))
        })
        fetch('/_dsh-plan/history?sessionId=' + encodeURIComponent(current.sessionId), {
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
        }).then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status)
          return response.json()
        }).then(function (payload) {
          if (alive && payload && Array.isArray(payload.archives)) setHistory(payload.archives)
        }).catch(function () {
          /* history is optional; the current plan still renders */
        })
        return function () { alive = false }
      }, [current.open, current.sessionId])

      if (current.open !== true) return null

      var body
      if (error.length > 0) {
        body = h('div', { style: { color: '#c53030', fontSize: '13px' } }, error)
      } else if (data === null) {
        body = h('div', { style: { opacity: 0.6, fontSize: '13px' } }, zh ? '读取中…' : 'Loading…')
      } else if (data.active !== true) {
        body = h('div', { style: { opacity: 0.7, fontSize: '13px' } }, zh ? '本对话当前没有任务单。' : 'No plan in this conversation.')
      } else {
        body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '55vh', overflowY: 'auto' } },
          (data.items || []).map(function (item) {
            var glyph = item.status === 'done' ? '✓' : item.status === 'needs_user' ? '?' : '·'
            var color = item.status === 'done' ? '#2f855a' : item.status === 'needs_user' ? '#b7791f' : 'rgba(127,127,127,.7)'
            return h('div', { key: item.id, style: { display: 'grid', gridTemplateColumns: '18px 48px 1fr', columnGap: '6px', alignItems: 'baseline' } },
              h('span', { style: { color: color, fontWeight: 700 } }, glyph),
              h('span', { style: { opacity: 0.55 } }, item.id),
              h('div', { style: { minWidth: 0 } },
                h('div', null, item.text),
                h('div', { style: { opacity: 0.55, fontSize: '12px' } }, (zh ? '验收：' : 'done when: ') + item.done_when),
                item.evidence ? h('div', { style: { opacity: 0.55, fontSize: '12px', fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' } }, item.evidence) : null,
                item.question ? h('div', { style: { color: '#b7791f', fontSize: '12px' } }, (zh ? '待你：' : 'waiting on you: ') + item.question) : null,
              ))
          }))
      }

      return h('div', {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': zh ? '本对话任务单' : 'Conversation plan',
        onClick: closeViewer,
        style: {
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,.35)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 80,
        },
      }, h('div', {
        onClick: function (event) { event.stopPropagation() },
        style: {
          width: 'min(560px, 86vw)',
          maxHeight: '72vh',
          overflow: 'hidden',
          borderRadius: '12px',
          border: '1px solid rgba(127,127,127,.4)',
          background: 'var(--dsw-surface, Canvas)',
          color: 'inherit',
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          boxShadow: '0 18px 60px rgba(0,0,0,.35)',
        },
      },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
        h('div', { style: { fontWeight: 600, flex: 1 } }, zh ? '本对话任务单' : 'Conversation plan'),
        data && data.active === true && data.stats
          ? h('span', { style: { opacity: 0.6, fontSize: '12px' } }, data.stats.requiredDone + '/' + data.stats.required)
          : null,
        h('button', {
          type: 'button',
          onClick: closeViewer,
          'aria-label': zh ? '关闭' : 'Close',
          style: { border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: '16px', padding: '0 4px', opacity: 0.65 },
        }, '×'),
      ),
      body,
      history.length > 0
        ? h('div', { style: { borderTop: '1px solid rgba(127,127,127,.25)', paddingTop: '8px', fontSize: '12px', opacity: 0.8 } },
            h('div', { style: { fontWeight: 600, marginBottom: '4px' } }, (zh ? '历史单（' : 'Archived plans (') + history.length + '）'),
            ...history.slice(0, 5).map(function (entry, index) {
              var when = entry.archivedAt ? new Date(entry.archivedAt).toLocaleString() : ''
              var reason = entry.reason === 'interrupted' ? (zh ? '被打断' : 'interrupted') : (zh ? '已完成' : 'completed')
              return h('div', { key: 'h' + index, style: { opacity: 0.7 } },
                reason + ' · ' + when + ' · ' + (Array.isArray(entry.items) ? entry.items.length : 0) + (zh ? ' 项' : ' items'))
            }))
        : null,
      data && data.hostVersion
        ? h('div', { style: { borderTop: '1px solid rgba(127,127,127,.18)', paddingTop: '6px', fontSize: '11px', opacity: 0.5 } }, 'host dsh-plan ' + data.hostVersion)
        : null,
      ))
    }

    function apply (ctx) {
      try {
        ctx.slots.inject('conversation.input.dock', function () {
          return ctx.slots.register({
            name: 'conversation.input.dock',
            id: 'dsh-plan-dock',
            order: 3,
          }, Dock)
        })
      } catch (error) {
        try { console.error('[dsh-plan] dock registration failed:', error) } catch {}
      }
      try {
        ctx.slots.inject('conversation.input.right', function () {
          return ctx.slots.register({
            name: 'conversation.input.right',
            id: 'dsh-plan-toggle',
            order: 41,
          }, PlanSwitch)
        })
      } catch (error) {
        try { console.error('[dsh-plan] switch registration failed:', error) } catch {}
      }
      try {
        ctx.slots.inject('conversation.chat.assistant-actions', function () {
          return ctx.slots.register({
            name: 'conversation.chat.assistant-actions',
            id: 'dsh-plan-view',
            order: 60,
          }, PlanViewButton)
        })
      } catch (error) {
        try { console.error('[dsh-plan] view button registration failed:', error) } catch {}
      }
      try {
        ctx.slots.inject('shell.overlay', function () {
          return ctx.slots.register({
            name: 'shell.overlay',
            id: 'dsh-plan-viewer',
            order: 80,
          }, PlanViewer)
        })
      } catch (error) {
        try { console.error('[dsh-plan] viewer registration failed:', error) } catch {}
      }
    }

    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})
