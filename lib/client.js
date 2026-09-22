/**
 * 插件集成 — client bundle.
 *
 * Web plugin bundle in the `window.__ModuleLoader__` lazy-CJS form: executing
 * this file only registers the factory, and every side effect (stylesheet,
 * settings-tab registration) runs when the Cordis client loader materializes
 * the module and applies the plugin.
 *
 * Reads go through this package's own host route
 * (`/plugin-integration/api`); the write actions post the exact
 * `cordis.patch.yml` entry they preview.
 *
 * The `id` below IS the browser module id, and it MUST equal this package's name
 * in `package.json`: the host half looks the package up in the client graph and
 * the runtime serves it from the `/plugins/??<id>/client.js` combo route by
 * manifest name. Renaming the package without editing this literal makes the
 * settings tab disappear with no error anywhere, so `test/contract.test.mjs`
 * asserts that the two agree.
 */

window.__ModuleLoader__.load({
  id: 'dsh-plugin-integration',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    const API_PATH = '/plugin-integration/api'

    const CSS = [
      '.dpi-root{display:flex;flex-direction:column;gap:12px;width:100%;color:var(--dsw-alias-label-primary);font-size:13px}',
      '.dpi-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.dpi-tabs{display:inline-flex;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:2px;gap:2px}',
      '.dpi-tab{border:0;background:transparent;color:var(--dsw-alias-label-secondary);padding:6px 12px;border-radius:8px;cursor:pointer;font:inherit;display:inline-flex;align-items:center;gap:6px}',
      '.dpi-tab.is-active{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}',
      '.dpi-count{font-size:11px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-base);border-radius:999px;padding:1px 7px;border:1px solid var(--dsw-alias-border-l1)}',
      '.dpi-search{flex:1 1 160px;min-width:150px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:7px 11px;color:var(--dsw-alias-label-primary);font:inherit;outline:none}',
      '.dpi-btn{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:5px 10px;font-size:12.5px;cursor:pointer;font:inherit}',
      '.dpi-btn:hover{border-color:var(--dsw-alias-border-l2)}',
      '.dpi-btn:disabled{opacity:.55;cursor:default}',
      '.dpi-btn-primary{border-color:transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted);font-weight:500}',
      '.dpi-btn-primary:hover{opacity:.9;border-color:transparent}',
      '.dpi-btn-sm{padding:3px 8px;font-size:12px;border-radius:6px}',
      '.dpi-btn-warn{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary);font-weight:500}',
      '.dpi-btn-warn:hover{background:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-bg-base);border-color:var(--dsw-alias-state-warn-primary)}',
      '.dpi-btn-danger{color:var(--dsw-alias-state-error-primary)}',
      '.dpi-btn-danger:hover{border-color:var(--dsw-alias-state-error-primary)}',
      '.dpi-chips{display:flex;gap:6px;flex-wrap:wrap;align-items:center}',
      '.dpi-chip{border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:999px;padding:3px 10px;cursor:pointer;font:inherit;font-size:12px}',
      '.dpi-chip.is-active{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.dpi-list{display:flex;flex-direction:column;gap:6px}',
      '.dpi-row{display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:11px;background:var(--dsw-alias-bg-layer-1)}',
      '.dpi-row.is-click{cursor:pointer}',
      '.dpi-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-secondary);flex:0 0 auto}',
      '.dpi-dot.is-active{background:var(--dsw-alias-state-success-primary)}',
      '.dpi-dot.is-failed{background:var(--dsw-alias-state-error-primary)}',
      '.dpi-dot.is-pending{background:var(--dsw-alias-state-warn-primary)}',
      '.dpi-main{min-width:0;flex:1 1 auto}',
      '.dpi-name{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dpi-sub{color:var(--dsw-alias-label-secondary);font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dpi-right{display:flex;align-items:center;gap:8px;flex:0 0 auto}',
      '.dpi-state{font-size:11.5px;color:var(--dsw-alias-label-secondary)}',
      '.dpi-state.is-failed{color:var(--dsw-alias-state-error-primary)}',
      '.dpi-tag{font-size:11px;border-radius:6px;padding:2px 7px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}',
      '.dpi-tag-mcp{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.dpi-tag-managed{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}',
      '.dpi-group{border:1px solid var(--dsw-alias-border-l1);border-radius:11px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}',
      '.dpi-group-head{display:flex;align-items:center;gap:8px;padding:10px 12px;cursor:pointer;background:transparent;border:0;width:100%;font:inherit;color:inherit;text-align:left}',
      '.dpi-group-body{border-top:1px solid var(--dsw-alias-border-l1);padding:8px;display:flex;flex-direction:column;gap:6px;background:var(--dsw-alias-bg-base)}',
      '.dpi-card{border:1px dashed var(--dsw-alias-border-l2);border-radius:12px;padding:16px;color:var(--dsw-alias-label-secondary);display:flex;flex-direction:column;gap:10px}',
      '.dpi-field{display:flex;align-items:center;gap:8px}',
      '.dpi-fieldcol{display:flex;flex-direction:column;gap:6px}',
      '.dpi-flabel{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dpi-stack{display:flex;flex-direction:column;gap:8px}',
      '.dpi-form{display:flex;flex-direction:column;gap:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:16px;background:var(--dsw-alias-bg-layer-1)}',
      '.dpi-addrow{width:100%;border:1px dashed var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:8px;padding:7px 10px;cursor:pointer;font:inherit;font-size:12px;text-align:center}',
      '.dpi-addrow:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-secondary)}',
      '.dpi-icon-btn{flex:0 0 auto;width:30px;height:30px;line-height:1;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:8px;cursor:pointer;font:inherit}',
      '.dpi-icon-btn:hover{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}',
      '.dpi-input-key{flex:0 0 38%}',
      '.dpi-input,.dpi-select{flex:1 1 auto;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 10px;color:var(--dsw-alias-label-primary);font:inherit}',
      '.dpi-pre{margin:0;padding:12px;border-radius:10px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word;max-height:300px;overflow:auto;color:var(--dsw-alias-label-primary);width:100%;box-sizing:border-box;resize:vertical}',
      '.dpi-error{color:var(--dsw-alias-state-error-primary);border:1px solid var(--dsw-alias-state-error-primary);border-radius:10px;padding:10px 12px}',
      '.dpi-ok{color:var(--dsw-alias-state-success-primary);border:1px solid var(--dsw-alias-state-success-primary);border-radius:10px;padding:10px 12px}',
      '.dpi-muted{color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.dpi-hint{color:var(--dsw-alias-label-secondary);font-size:11.5px}',
    ].join('')

    const PHASE_TEXT = { active: '运行中', pending: '等待中', loading: '加载中', failed: '失败', unloading: '卸载中' }

    /** Call this package's host route; a non-2xx or `{error}` becomes a rejection. */
    function api(action, params, body) {
      const search = new URLSearchParams()
      search.set('action', action)
      if (params) {
        for (const key of Object.keys(params)) {
          const value = params[key]
          if (value === null || value === undefined) continue
          if (Array.isArray(value)) {
            for (const item of value) search.append(key, String(item))
          } else {
            search.set(key, String(value))
          }
        }
      }
      const options = { headers: { accept: 'application/json' } }
      if (body !== undefined) {
        options.method = 'POST'
        options.headers['content-type'] = 'application/json'
        options.body = JSON.stringify(body)
      }
      return fetch(API_PATH + '?' + search.toString(), options).then((response) => response.json().then((payload) => {
        if (!response.ok) throw new Error((payload && payload.error) || ('HTTP ' + response.status))
        if (payload && payload.error) throw new Error(payload.error)
        return payload
      }))
    }

    function phaseText(phase, enabled) {
      if (phase === null || phase === undefined) return enabled === false ? '已禁用' : '未启动'
      return PHASE_TEXT[phase] || phase
    }

    function dotClass(phase, enabled) {
      if (enabled === false || phase === null || phase === undefined) return 'dpi-dot is-off'
      if (phase === 'failed') return 'dpi-dot is-failed'
      if (phase === 'pending' || phase === 'loading' || phase === 'unloading') return 'dpi-dot is-pending'
      return 'dpi-dot is-active'
    }

    function shortModule(value) {
      if (typeof value !== 'string') return String(value || '')
      const prefix = '@deepseek-ai/'
      return value.indexOf(prefix) === 0 ? value.slice(prefix.length) : value
    }

    function match(text, query) {
      if (query.length === 0) return true
      return typeof text === 'string' && text.toLowerCase().indexOf(query) !== -1
    }

    /** Show outcomes, not machine layout: filesystem paths never reach the page. */
    function redactPaths(text) {
      return String(text === null || text === undefined ? '' : text)
        .replace(/[A-Za-z]:[\\/][^\s"']*/g, '<路径>')
        .replace(/\/(?:Users|home|var|tmp|opt|etc)\/[^\s"']*/g, '<路径>')
    }

    function IntegrationTab() {
      const [state, setState] = React.useState({ status: 'loading', data: null, error: null })
      const [tab, setTab] = React.useState('plugins')
      const [query, setQuery] = React.useState('')
      const [filter, setFilter] = React.useState('all')
      const [openPlugin, setOpenPlugin] = React.useState('')
      const [skills, setSkills] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [detail, setDetail] = React.useState(null)
      const [form, setForm] = React.useState({
        transport: 'stdio',
        serverName: '',
        command: '',
        args: [''],
        env: [{ name: '', value: '' }],
        url: '',
        headers: [{ name: '', value: '' }],
      })
      const [snippet, setSnippet] = React.useState(null)
      const [write, setWrite] = React.useState(null)
      const [formMode, setFormMode] = React.useState('')
      const [editing, setEditing] = React.useState('')
      const [confirmRemove, setConfirmRemove] = React.useState('')
      const [confirmUninstall, setConfirmUninstall] = React.useState('')
      const [notice, setNotice] = React.useState(null)

      const load = React.useCallback(() => {
        setState((previous) => ({ status: 'loading', data: previous.data, error: null }))
        api('snapshot').then(
          (data) => { setState({ status: 'ready', data, error: null }); setSkills(null) },
          (error) => setState({ status: 'error', data: null, error: String((error && error.message) || error) }),
        )
      }, [])

      React.useEffect(() => { load() }, [load])

      const data = state.data
      const needle = query.trim().toLowerCase()
      const catalog = skills || (data ? data.skills : null)

      const pickPreset = (presetId) => {
        setBusy(true)
        api('skills', { preset: presetId }).then(
          (value) => { setSkills(value); setBusy(false) },
          () => { setBusy(false) },
        )
      }

      const openSkill = (skillName) => {
        const presetId = catalog ? catalog.presetId : null
        setDetail({ status: 'loading', name: skillName })
        api('skill', { preset: presetId, name: skillName }).then(
          (value) => setDetail({ status: 'ready', value }),
          (error) => setDetail({ status: 'error', name: skillName, error: String((error && error.message) || error) }),
        )
      }

      const formBody = () => ({
        transport: form.transport,
        serverName: form.serverName,
        command: form.command,
        args: form.args,
        env: form.env,
        url: form.url,
        headers: form.headers,
      })

      const previewSnippet = () => {
        setWrite(null)
        const body = formBody()
        api('mcp-snippet', {
          transport: body.transport,
          serverName: body.serverName,
          command: body.command,
          url: body.url,
          arg: body.args,
          envName: body.env.map((row) => row.name),
          envValue: body.env.map((row) => row.value),
          headerName: body.headers.map((row) => row.name),
          headerValue: body.headers.map((row) => row.value),
        }).then(
          (value) => setSnippet(value),
          (error) => setSnippet({ ok: false, errors: [String((error && error.message) || error)], snippet: '' }),
        )
      }

      /** Close the inline form, keeping the last write outcome visible. */
      const closeForm = () => {
        setFormMode('')
        setEditing('')
        setSnippet(null)
      }

      /** Open the inline form with a blank server. */
      const openAdd = () => {
        setForm({ transport: 'stdio', serverName: '', command: '', args: [''], env: [{ name: '', value: '' }], url: '', headers: [{ name: '', value: '' }] })
        setEditing('')
        setFormMode('add')
        setSnippet(null)
        setWrite(null)
      }

      const writeEntry = () => {
        setWrite({ status: 'writing' })
        api('mcp-apply', undefined, formBody()).then(
          (value) => {
            if (value.ok) {
              setWrite({ status: 'done', message: '已写入，loader 热生效中' })
              closeForm()
              load()
            } else {
              setWrite({ status: 'error', message: (value.errors || []).join('；') })
            }
          },
          (error) => setWrite({ status: 'error', message: String((error && error.message) || error) }),
        )
      }

      const removeEntry = (serverName) => {
        setWrite({ status: 'writing' })
        api('mcp-remove', undefined, { serverName }).then(
          (value) => {
            if (value.ok) {
              setWrite({ status: 'done', message: '已从补丁层移除 ' + serverName })
              load()
            } else {
              setWrite({ status: 'error', message: (value.errors || []).join('；') })
            }
          },
          (error) => setWrite({ status: 'error', message: String((error && error.message) || error) }),
        )
      }

      /** Load one mounted server into the form for editing. */
      const startEdit = (serverName) => {
        setWrite(null)
        setSnippet(null)
        api('mcp-detail', { serverName }).then(
          (value) => {
            if (value.error !== undefined) {
              setWrite({ status: 'error', message: String(value.error) })
              return
            }
            setForm({
              transport: value.transport,
              serverName: value.serverName,
              command: value.command,
              args: value.args.length > 0 ? value.args : [''],
              env: value.env.length > 0 ? value.env : [{ name: '', value: '' }],
              url: value.url,
              headers: value.headers.length > 0 ? value.headers : [{ name: '', value: '' }],
            })
            setEditing(value.serverName)
            setFormMode('edit')
          },
          (error) => setWrite({ status: 'error', message: String((error && error.message) || error) }),
        )
      }

      const saveEdit = () => {
        setWrite({ status: 'writing' })
        api('mcp-replace', undefined, Object.assign({ original: editing }, formBody())).then(
          (value) => {
            if (value.ok) {
              setWrite({ status: 'done', message: '已更新 ' + value.serverName })
              closeForm()
              load()
            } else {
              setWrite({ status: 'error', message: (value.errors || []).join('；') })
            }
          },
          (error) => setWrite({ status: 'error', message: String((error && error.message) || error) }),
        )
      }

      const uninstall = (name) => {
        setConfirmUninstall('')
        setNotice({ status: 'running', message: '正在卸载 ' + name + '…' })
        api('plugin-uninstall', undefined, { name }).then(
          (value) => {
            if (value.ok) {
              setNotice({ status: 'done', message: '已卸载 ' + name + '，重启 dsh web 后不再加载', output: value.output })
              load()
            } else {
              setNotice({
                status: 'error',
                message: (value.errors || []).join('；') + (value.manual !== undefined ? '　可手动执行：' + value.manual : ''),
                output: value.output,
              })
            }
          },
          (error) => setNotice({ status: 'error', message: String((error && error.message) || error) }),
        )
      }

      if (state.status === 'error') {
        return h('div', { className: 'dpi-root' },
          h('div', { className: 'dpi-error' }, '读取插件集成状态失败：' + state.error),
          h('button', { className: 'dpi-btn', onClick: load }, '重试'),
        )
      }
      if (data === null) {
        return h('div', { className: 'dpi-root' }, h('div', { className: 'dpi-muted' }, '正在读取运行时插件状态…'))
      }

      const counts = data.plugins.counts
      const skillCount = catalog ? catalog.count : 0

      // 插件页只列本 profile 安装的插件（dsh plugin --profile web list 口径）。
      const installedRows = []
      for (const item of data.plugins.installed) {
        const failed = item.rows.some((row) => row.phase === 'failed')
        if (filter === 'mounted' && !item.mounted) continue
        if (filter === 'unmounted' && item.mounted) continue
        if (filter === 'failed' && !failed) continue
        if (!match(item.name, needle) && !match(item.description, needle)) continue
        const opened = openPlugin === item.name
        const tags = []
        if (item.bundle) tags.push(h('span', { className: 'dpi-tag', key: 'b' }, 'bundle 层'))
        if (item.client) tags.push(h('span', { className: 'dpi-tag', key: 'c' }, '客户端'))
        if (item.plain) tags.push(h('span', { className: 'dpi-tag', key: 'x' }, '普通依赖'))
        installedRows.push(h('div', { key: 'i-' + item.name },
          h('div', { className: 'dpi-row is-click', onClick: () => setOpenPlugin(opened ? '' : item.name) },
            h('span', { className: dotClass(item.mounted ? item.phase : null, item.mounted) }),
            h('div', { className: 'dpi-main' },
              h('div', { className: 'dpi-name' }, item.name + (item.version ? ' @' + item.version : '')),
              h('div', { className: 'dpi-sub' }, item.description || ''),
            ),
            h('div', { className: 'dpi-right' },
              tags,
              h('span', { className: failed ? 'dpi-state is-failed' : 'dpi-state' },
                item.error ? '未解析' : (item.mounted ? phaseText(item.phase, true) : '未挂载')),
            ),
          ),
          opened ? h('div', { className: 'dpi-card' },
            h('div', { className: 'dpi-hint' }, 'dsh 声明：' + (item.bundle ? 'bundle 层（自带 cordis 补丁）' : '无 bundle 层')
              + ' · ' + (item.client ? '有客户端半包' : '无客户端半包')
              + (item.inBundles ? ' · 已在 dsh.profile.bundles' : '')),
            item.error ? h('div', { className: 'dpi-error' }, String(item.error)) : null,
            item.rows.length > 0
              ? h('div', { className: 'dpi-list' }, item.rows.map((row) => h('div', { className: 'dpi-row', key: 'ir-' + row.id },
                  h('span', { className: dotClass(row.phase, row.enabled) }),
                  h('div', { className: 'dpi-main' },
                    h('div', { className: 'dpi-name' }, row.id),
                    h('div', { className: 'dpi-sub' }, shortModule(row.module)),
                  ),
                  h('div', { className: 'dpi-right' }, h('span', { className: 'dpi-state' }, phaseText(row.phase, row.enabled))),
                )))
              : h('div', { className: 'dpi-hint' }, item.inBundles ? '重启 dsh web 后生效（bundle 层未在本进程加载）' : '未挂载：没有 cordis 补丁引用它'),
            h('div', { className: 'dpi-bar' },
              confirmUninstall === item.name
                ? h('button', { className: 'dpi-btn dpi-btn-sm dpi-btn-danger', onClick: () => uninstall(item.name) }, '确认卸载')
                : h('button', { className: 'dpi-btn dpi-btn-sm dpi-btn-warn', onClick: () => setConfirmUninstall(item.name) }, '卸载'),
            ),
          ) : null,
        ))
      }

      const update = (patch) => setForm(Object.assign({}, form, patch))
      const setArg = (index, value) => {
        const list = form.args.slice()
        list[index] = value
        update({ args: list })
      }
      const addArg = () => update({ args: form.args.concat(['']) })
      const removeArg = (index) => update({ args: form.args.filter((item, position) => position !== index) })
      const setRow = (key, index, patch) => {
        const list = form[key].slice()
        list[index] = Object.assign({}, list[index], patch)
        update({ [key]: list })
      }
      const addRow = (key, empty) => update({ [key]: form[key].concat([empty]) })
      const removeRow = (key, index) => update({ [key]: form[key].filter((item, position) => position !== index) })

      /** The one inline form: under the edited row, or under the add button. */
      const formBlock = formMode === '' ? null : h('div', { className: 'dpi-form' },
        formMode === 'edit' ? h('div', { className: 'dpi-flabel' }, '编辑 ' + editing) : null,
        h('div', { className: 'dpi-fieldcol' },
          h('span', { className: 'dpi-flabel' }, '传输方式'),
          h('select', { className: 'dpi-select', value: form.transport, onChange: (event) => update({ transport: event.target.value }) },
            h('option', { value: 'stdio' }, 'stdio（本地进程）'),
            h('option', { value: 'streamable-http' }, 'streamable-http（远程服务）'),
          ),
        ),
        h('div', { className: 'dpi-fieldcol' },
          h('span', { className: 'dpi-flabel' }, 'serverName'),
          h('input', { className: 'dpi-input', value: form.serverName, placeholder: 'fastctx', onChange: (event) => update({ serverName: event.target.value }) }),
        ),
        form.transport === 'stdio' ? h('div', { className: 'dpi-fieldcol' },
          h('span', { className: 'dpi-flabel' }, '启动命令'),
          h('input', { className: 'dpi-input', value: form.command, placeholder: 'C:/path/to/server.exe 或 npx', onChange: (event) => update({ command: event.target.value }) }),
        ) : null,
        form.transport === 'stdio' ? h('div', { className: 'dpi-fieldcol' },
          h('span', { className: 'dpi-flabel' }, '参数'),
          form.args.map((value, index) => h('div', { className: 'dpi-field', key: 'arg-' + index },
            h('input', { className: 'dpi-input', value, onChange: (event) => setArg(index, event.target.value) }),
            h('button', { className: 'dpi-icon-btn', title: '删除', onClick: () => removeArg(index) }, '×'),
          )),
          h('button', { className: 'dpi-addrow', onClick: addArg }, '+ 添加参数'),
        ) : null,
        form.transport === 'stdio' ? h('div', { className: 'dpi-fieldcol' },
          h('span', { className: 'dpi-flabel' }, '环境变量'),
          form.env.map((row, index) => h('div', { className: 'dpi-field', key: 'env-' + index },
            h('input', { className: 'dpi-input dpi-input-key', value: row.name, placeholder: 'KEY', onChange: (event) => setRow('env', index, { name: event.target.value }) }),
            h('input', { className: 'dpi-input', value: row.value, placeholder: 'value', onChange: (event) => setRow('env', index, { value: event.target.value }) }),
            h('button', { className: 'dpi-icon-btn', title: '删除', onClick: () => removeRow('env', index) }, '×'),
          )),
          h('button', { className: 'dpi-addrow', onClick: () => addRow('env', { name: '', value: '' }) }, '+ 添加环境变量'),
        ) : null,
        form.transport === 'streamable-http' ? h('div', { className: 'dpi-fieldcol' },
          h('span', { className: 'dpi-flabel' }, '服务地址'),
          h('input', { className: 'dpi-input', value: form.url, placeholder: 'https://example.com/mcp', onChange: (event) => update({ url: event.target.value }) }),
        ) : null,
        form.transport === 'streamable-http' ? h('div', { className: 'dpi-fieldcol' },
          h('span', { className: 'dpi-flabel' }, '请求头'),
          form.headers.map((row, index) => h('div', { className: 'dpi-field', key: 'hdr-' + index },
            h('input', { className: 'dpi-input dpi-input-key', value: row.name, placeholder: 'Authorization', onChange: (event) => setRow('headers', index, { name: event.target.value }) }),
            h('input', { className: 'dpi-input', value: row.value, placeholder: 'Bearer …', onChange: (event) => setRow('headers', index, { value: event.target.value }) }),
            h('button', { className: 'dpi-icon-btn', title: '删除', onClick: () => removeRow('headers', index) }, '×'),
          )),
          h('button', { className: 'dpi-addrow', onClick: () => addRow('headers', { name: '', value: '' }) }, '+ 添加请求头'),
        ) : null,
        h('div', { className: 'dpi-bar' },
          h('button', {
            className: 'dpi-btn dpi-btn-sm dpi-btn-primary',
            onClick: formMode === 'edit' ? saveEdit : writeEntry,
            disabled: write !== null && write.status === 'writing',
          }, write !== null && write.status === 'writing' ? '处理中…' : (formMode === 'edit' ? '保存修改' : '写入补丁层')),
          h('button', { className: 'dpi-btn dpi-btn-sm', onClick: closeForm }, '取消'),
          h('button', { className: 'dpi-btn dpi-btn-sm', onClick: previewSnippet }, '预览片段'),
        ),
        snippet ? h('div', null,
          snippet.errors && snippet.errors.length > 0 ? h('div', { className: 'dpi-error' }, redactPaths(snippet.errors.join('；'))) : null,
          snippet.snippet && snippet.snippet.length > 0 ? h('textarea', { className: 'dpi-pre', readOnly: true, rows: 10, value: snippet.snippet, onClick: (event) => event.currentTarget.select() }) : null,
        ) : null,
      )

      const mcpRows = []
      for (const server of data.mcp) {
        if (!match(server.entryId, needle) && !match(server.serverName || '', needle)) continue
        const config = server.config || {}
        const target = config.url ? config.url : (config.command ? (config.command + ' ' + (config.args || []).join(' ')) : '—')
        mcpRows.push(h('div', { className: 'dpi-stack', key: 'm-' + server.entryId },
          h('div', { className: 'dpi-row' },
            h('span', { className: dotClass(server.phase, server.enabled) }),
            h('div', { className: 'dpi-main' },
              h('div', { className: 'dpi-name' }, server.serverName || server.entryId),
              h('div', { className: 'dpi-sub' }, (config.transport || 'unknown') + ' · ' + target + (server.scope === 'host' ? '' : ' · ' + server.scope)),
            ),
            h('div', { className: 'dpi-right' },
              h('span', { className: (server.phase === 'failed' ? 'dpi-state is-failed' : 'dpi-state') }, phaseText(server.phase, server.enabled)),
              server.managed
                ? h('button', {
                    className: 'dpi-btn dpi-btn-sm',
                    onClick: () => {
                      if (formMode === 'edit' && editing === server.serverName) closeForm()
                      else startEdit(server.serverName)
                    },
                  }, '编辑')
                : h('span', { className: 'dpi-tag' }, '手动配置'),
              server.managed
                ? (confirmRemove === server.serverName
                    ? h('button', { className: 'dpi-btn dpi-btn-sm dpi-btn-danger', onClick: () => { setConfirmRemove(''); removeEntry(server.serverName) } }, '确认移除')
                    : h('button', { className: 'dpi-btn dpi-btn-sm', onClick: () => setConfirmRemove(server.serverName) }, '移除'))
                : null,
            ),
          ),
          formMode === 'edit' && editing === server.serverName ? formBlock : null,
        ))
      }

      const skillRows = []
      if (catalog) {
        for (const item of catalog.rows) {
          if (!match(item.name, needle) && !match(item.description, needle)) continue
          skillRows.push(h('div', { className: 'dpi-row is-click', key: 's-' + item.name, onClick: () => openSkill(item.name) },
            h('span', { className: item.modelInvocable ? 'dpi-dot is-active' : 'dpi-dot' }),
            h('div', { className: 'dpi-main' },
              h('div', { className: 'dpi-name' }, item.name),
              h('div', { className: 'dpi-sub' }, item.description),
            ),
            h('div', { className: 'dpi-right' },
              h('span', { className: 'dpi-tag' }, item.source),
              item.userInvocable ? h('span', { className: 'dpi-tag' }, '可手动调用') : null,
            ),
          ))
        }
      }

      const presetChips = []
      for (const preset of data.presets) {
        const active = catalog && catalog.presetId === preset.id
        presetChips.push(h('button', { key: 'pc-' + preset.id, className: active ? 'dpi-chip is-active' : 'dpi-chip', onClick: () => pickPreset(preset.id) }, preset.name || preset.id))
      }

      const toolbar = h('div', { className: 'dpi-bar' },
        h('div', { className: 'dpi-tabs' },
          h('button', { className: tab === 'plugins' ? 'dpi-tab is-active' : 'dpi-tab', onClick: () => setTab('plugins') }, '插件', h('span', { className: 'dpi-count' }, counts.total)),
          h('button', { className: tab === 'mcp' ? 'dpi-tab is-active' : 'dpi-tab', onClick: () => setTab('mcp') }, 'MCP', h('span', { className: 'dpi-count' }, data.mcp.length)),
          h('button', { className: tab === 'skills' ? 'dpi-tab is-active' : 'dpi-tab', onClick: () => setTab('skills') }, '技能', h('span', { className: 'dpi-count' }, skillCount)),
        ),
        h('input', { className: 'dpi-search', placeholder: '搜索', value: query, onChange: (event) => setQuery(event.target.value) }),
        h('button', { className: 'dpi-btn', onClick: load }, state.status === 'loading' ? '刷新中…' : '刷新'),
      )

      let body = null
      if (tab === 'plugins') {
        body = h('div', { className: 'dpi-root' },
          h('div', { className: 'dpi-chips' },
            h('button', { className: filter === 'all' ? 'dpi-chip is-active' : 'dpi-chip', onClick: () => setFilter('all') }, '全部 ' + counts.total),
            h('button', { className: filter === 'mounted' ? 'dpi-chip is-active' : 'dpi-chip', onClick: () => setFilter('mounted') }, '已挂载 ' + counts.mounted),
            h('button', { className: filter === 'unmounted' ? 'dpi-chip is-active' : 'dpi-chip', onClick: () => setFilter('unmounted') }, '未挂载 ' + counts.unmounted),
            h('button', { className: filter === 'failed' ? 'dpi-chip is-active' : 'dpi-chip', onClick: () => setFilter('failed') }, '异常 ' + counts.failed),
          ),
          h('div', { className: 'dpi-list' }, installedRows.length > 0 ? installedRows : h('div', { className: 'dpi-muted' }, '没有匹配的已装插件')),
          notice ? h('div', null,
            h('div', { className: notice.status === 'done' ? 'dpi-ok' : (notice.status === 'error' ? 'dpi-error' : 'dpi-hint') }, redactPaths(notice.message)),
            notice.output ? h('pre', { className: 'dpi-pre' }, redactPaths(String(notice.output).trim().split('\n').slice(-8).join('\n'))) : null,
          ) : null,
          data.diagnostics && data.diagnostics.length > 0 ? h('div', { className: 'dpi-hint' }, '诊断：' + redactPaths(data.diagnostics.join(' / '))) : null,
        )
      } else if (tab === 'mcp') {
        body = h('div', { className: 'dpi-root' },
          mcpRows.length > 0 ? h('div', { className: 'dpi-list' }, mcpRows) : h('div', { className: 'dpi-muted' }, '尚未配置 MCP 服务器'),
          formMode === 'add'
            ? formBlock
            : h('button', { className: 'dpi-addrow', onClick: openAdd }, '+ 添加 MCP 服务器'),
          write ? h('div', { className: write.status === 'done' ? 'dpi-ok' : (write.status === 'error' ? 'dpi-error' : 'dpi-hint') },
            write.status === 'writing' ? '处理中…' : redactPaths(write.message),
          ) : null,
        )
      } else {
        body = h('div', { className: 'dpi-root' },
          h('div', { className: 'dpi-chips' },
            presetChips,
            busy ? h('span', { className: 'dpi-hint' }, '读取中…') : null,
          ),
          h('div', { className: 'dpi-list' }, skillRows.length > 0 ? skillRows : h('div', { className: 'dpi-muted' }, '没有匹配的技能')),
          detail ? h('div', { className: 'dpi-card' },
            detail.status === 'loading' ? h('div', { className: 'dpi-muted' }, '读取技能详情…') : null,
            detail.status === 'error' ? h('div', { className: 'dpi-error' }, redactPaths('读取失败：' + detail.error)) : null,
            detail.status === 'ready' ? h('div', null,
              h('div', { className: 'dpi-name' }, detail.value.name),
              h('div', { className: 'dpi-hint' }, (detail.value.source || '') + ' · ' + (detail.value.provider || '')),
              detail.value.whenToUse ? h('div', { className: 'dpi-hint' }, '何时使用：' + detail.value.whenToUse) : null,
              h('pre', { className: 'dpi-pre' }, detail.value.content),
            ) : null,
            h('div', { className: 'dpi-bar' }, h('button', { className: 'dpi-btn', onClick: () => setDetail(null) }, '收起')),
          ) : null,
        )
      }

      return h('div', { className: 'dpi-root' }, toolbar, body)
    }

    /** Register this plugin's stylesheet and the Plugins settings tab. */
    function apply(ctx) {
      ctx.effect(() => {
        const style = document.createElement('style')
        style.setAttribute('data-plugin', 'dsh-plugin-integration')
        style.textContent = CSS
        document.head.append(style)
        return () => style.remove()
      }, 'plugin-integration:stylesheet')

      ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
        name: 'settings.plugins.tab',
        id: 'plugin-integration',
        order: -1,
        label: '插件集成',
      }, IntegrationTab))
    }

    exports.name = 'plugin-integration'
    exports.inject = ['slots']
    exports.apply = apply
    return module.exports
  },
})
