/**
 * dsh-plugin-integration — host half.
 *
 * A persistent DSH web plugin, published as a DSH *bundle* (`dsh.bundle.patch`
 * → `./cordis.patch.yml`) so that one command installs and mounts it:
 *
 *   dsh plugin --profile <name> add dsh-plugin-integration
 *
 * It exposes one read-mostly HTTP route plus one model-visible tool:
 *
 *   GET  /plugin-integration/api?action=snapshot|skills|skill|mcp-snippet|mcp-detail
 *   POST /plugin-integration/api?action=mcp-apply|mcp-replace|mcp-remove|plugin-uninstall
 *
 * The route reports the live Cordis Loader plugin rows, every agent preset's
 * composition, the MCP servers currently mounted, and the skill catalog a
 * preset's standing composition sees. The write actions append a validated
 * mcp-client row to the profile patch layer (or remove one this plugin wrote),
 * always behind a YAML re-parse of the exact text about to be published and a
 * `.bak` copy of the previous content.
 *
 * Three properties this package needs in order to work on someone else's
 * machine, none of which hold by accident:
 *
 * 1. **The profile directory is discovered, never assumed.** `config.profileDir`
 *    wins, then `ctx.baseUrl` (app-boot anchors the root context at the profile
 *    directory, i.e. the directory holding `cordis.yml`), then the historical
 *    `<package>/../..` guess as a last resort — and every candidate is
 *    *validated* against the profile manifest before it is trusted. The guess
 *    alone breaks for a scoped install (`<profile>/node_modules/@scope/<pkg>`
 *    resolves to `<profile>/node_modules`) and for the shared
 *    `$DSH_HOME/profiles/node_modules` fallback (resolves to
 *    `$DSH_HOME/profiles`); in both cases the old code wrote a stray patch layer
 *    into a directory that is not a profile and reported success.
 * 2. **Every request is loopback-only** unless the operator sets
 *    `config.allowRemote`. The browser carrier has no authentication of its own
 *    and its `host` config may be `0.0.0.0`, while these endpoints return secret
 *    VALUES (`mcp-detail`) and rewrite configuration. A non-browser client sends
 *    no `Sec-Fetch-Site` header, so that check alone admitted `curl`.
 * 3. **The browser module id equals this package's name.** `SELF.name` is what
 *    the host looks up in the client graph; `lib/client.js` hardcodes it in its
 *    `__ModuleLoader__.load({ id })` registration. Renaming the package without
 *    editing that file silently unregisters the settings tab, so
 *    `test/contract.test.mjs` asserts the two agree.
 *
 * @module dsh-plugin-integration
 */

import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'plugin-integration'

/** The HTTP carrier is the only hard dependency; every other service is optional. */
export const inject = ['webServer']

/** Exact route this plugin owns. */
const ROUTE_PATH = '/plugin-integration/api'

/** Valid `serverName` for a mounted mcp-client row. */
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** Valid npm package name — the only shape this plugin forwards to the CLI. */
const PACKAGE_NAME_PATTERN = /^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/

/** The user patch layer inside a profile directory. */
const PROFILE_PATCH_FILENAME = 'cordis.patch.yml'

/** Cordis Fiber state numbers → the phase words the inventory projects. */
const PHASE_BY_STATE = { 0: 'pending', 1: 'loading', 2: 'active', 3: 'failed', 5: 'unloading' }

/** This package's directory: `<...>/dsh-plugin-integration`. */
const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** This package's own manifest; `name` is also the browser module id. */
const SELF = readSelfManifest()

/** Cached `js-yaml` module; loaded lazily so a missing dependency cannot fail activation. */
let yamlModule

/** Cached entry-list schema (JSON_SCHEMA + DSH's `!!js` expression tag). */
let yamlSchemaCache

/** Read this package's own name/version, tolerating a missing or malformed manifest. */
function readSelfManifest() {
  try {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8'))
    return {
      name: typeof manifest.name === 'string' && manifest.name.length > 0 ? manifest.name : 'dsh-plugin-integration',
      version: typeof manifest.version === 'string' ? manifest.version : null,
    }
  } catch (error) {
    return { name: 'dsh-plugin-integration', version: null }
  }
}

/**
 * The schema the profile patch layer is actually written in: app-boot parses it
 * as `JSON_SCHEMA` plus a `!!js` type whose value the Loader evaluates later.
 * Validating with anything else rejects every file that uses an expression.
 */
function entryListSchema(yaml) {
  if (yamlSchemaCache !== undefined) return yamlSchemaCache
  const jsExpression = new yaml.Type('tag:yaml.org,2002:js', {
    kind: 'scalar',
    resolve: (data) => typeof data === 'string',
    construct: (data) => ({ __jsExpr: data }),
  })
  yamlSchemaCache = yaml.JSON_SCHEMA.extend([jsExpression])
  return yamlSchemaCache
}

/** One-line message for any thrown value. */
function messageOf(error) {
  return String((error && error.message) || error)
}

/** Whether a loader row mounts the MCP client package. */
function isMcpModule(moduleName) {
  return typeof moduleName === 'string' && moduleName.indexOf('mcp-client') !== -1
}

/**
 * Project one MCP plugin config onto display fields, dropping every value that
 * could carry a secret (env values, header values) while keeping their names.
 */
function redactMcpConfig(config) {
  if (config === null || typeof config !== 'object') return null
  const out = {
    serverName: typeof config.serverName === 'string' ? config.serverName : null,
    transport: typeof config.transport === 'string' ? config.transport : null,
  }
  if (typeof config.command === 'string') out.command = config.command
  if (Array.isArray(config.args)) {
    const args = []
    for (const item of config.args) if (typeof item === 'string') args.push(item)
    out.args = args.slice(0, 12)
  }
  if (typeof config.url === 'string') out.url = config.url
  if (config.env !== null && typeof config.env === 'object' && !Array.isArray(config.env)) out.envKeys = Object.keys(config.env).slice(0, 12)
  if (config.headers !== null && typeof config.headers === 'object' && !Array.isArray(config.headers)) out.headerNames = Object.keys(config.headers).slice(0, 12)
  return out
}

/**
 * Whether a directory really is a DSH profile. Trusting a path without this
 * probe is how the old package-relative guess ended up writing into
 * `node_modules/` or `$DSH_HOME/profiles/`: both are directories, neither is a
 * profile, and `writeFileSync` happily created a `cordis.patch.yml` in them.
 * A profile carries either the `dsh.profile` manifest section or the patch
 * layer itself.
 */
function looksLikeProfile(dir) {
  try {
    const manifestPath = join(dir, 'package.json')
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      const profile = manifest !== null && typeof manifest === 'object' && manifest.dsh !== null && typeof manifest.dsh === 'object' ? manifest.dsh.profile : undefined
      if (profile !== null && typeof profile === 'object') return true
    }
  } catch (error) {
    /* a malformed manifest is not a profile manifest — fall through to the patch probe */
  }
  return existsSync(join(dir, PROFILE_PATCH_FILENAME))
}

/**
 * Resolve the profile this plugin is mounted in, most trustworthy anchor first:
 * an explicit `config.profileDir`, then `ctx.baseUrl` (the config-tree base,
 * which `boot()` sets to the directory of the profile's `cordis.yml`), then the
 * historical `<package>/../..` guess. The first candidate that validates wins;
 * a candidate that does not is recorded so the refusal message can name it.
 *
 * `ctx.baseUrl` is deliberately *not* trusted blindly either: a plugin mounted
 * inside an agent-preset composition gets that composition's directory, which
 * has no profile manifest — validation rejects it and the guess takes over.
 */
function resolveProfile(config, ctx) {
  const candidates = []
  const configured = config !== null && typeof config === 'object' && typeof config.profileDir === 'string' ? config.profileDir.trim() : ''
  if (configured.length > 0) candidates.push({ dir: resolve(configured), source: 'config.profileDir' })
  if (ctx !== undefined && ctx !== null && typeof ctx.baseUrl === 'string' && ctx.baseUrl.length > 0) {
    try {
      candidates.push({ dir: fileURLToPath(ctx.baseUrl), source: 'ctx.baseUrl' })
    } catch (error) {
      /* not a file: URL (an embedder may set anything) — skip the candidate */
    }
  }
  candidates.push({ dir: resolve(PACKAGE_DIR, '..', '..'), source: 'package path' })

  const rejected = []
  for (const candidate of candidates) {
    if (looksLikeProfile(candidate.dir)) {
      return {
        dir: candidate.dir,
        source: candidate.source,
        patchPath: join(candidate.dir, PROFILE_PATCH_FILENAME),
        manifestPath: join(candidate.dir, 'package.json'),
        rejected,
      }
    }
    rejected.push(candidate.source + ' → ' + candidate.dir)
  }
  return { dir: null, source: null, patchPath: null, manifestPath: null, rejected }
}

/** The refusal message for a deployment whose profile could not be located. */
function describeProfileFailure(runtime) {
  const tried = runtime.profile.rejected.length > 0 ? runtime.profile.rejected.join('；') : '（没有候选）'
  return '未能定位 profile 目录，已拒绝写入。已尝试：' + tried
    + '。请在本插件的行里显式指定 config.profileDir（例如 $DSH_HOME/profiles/web）。'
}

/** Refuse a write before a single byte is touched when no profile was located. */
function profileWriteError(runtime) {
  return runtime.profile.dir === null ? describeProfileFailure(runtime) : null
}

/** Read every non-group Loader entry with its config, state and enablement. */
function readRuntime(ctx) {
  const rows = []
  let groups = 0
  try {
    const loader = ctx.get('loader')
    if (loader === undefined || typeof loader.entries !== 'function') {
      return { rows, groups, error: 'loader 服务不可用' }
    }
    for (const entry of loader.entries()) {
      const options = entry.options || {}
      if (options.group) {
        groups += 1
        continue
      }
      rows.push({
        id: String(entry.id),
        module: typeof options.name === 'string' ? options.name : String(options.name || ''),
        disabled: entry.disabled === true,
        configurable: options.config !== undefined && options.config !== null,
        config: options.config !== null && typeof options.config === 'object' ? options.config : null,
        fiberState: entry.fiber ? entry.fiber.state : null,
      })
    }
  } catch (error) {
    return { rows, groups, error: messageOf(error) }
  }
  return { rows, groups, error: null }
}

/** Every agent preset's composition as flattened plugin rows. */
async function readPresets(ctx) {
  const out = []
  const presets = ctx.get('agentPresets')
  if (presets === undefined || typeof presets.compositionInventory !== 'function') return out
  try {
    const compositions = await presets.compositionInventory()
    for (const composition of compositions) {
      const rows = []
      for (const row of composition.rows || []) {
        rows.push({
          entryId: row.entryId === null || row.entryId === undefined ? null : String(row.entryId),
          module: String(row.moduleName),
          enabled: row.enabled === true,
          conditional: row.enabled === 'conditional',
          phase: row.fiberState === undefined || row.fiberState === null ? null : (PHASE_BY_STATE[row.fiberState] || null),
        })
      }
      out.push({
        id: String(composition.id),
        name: typeof composition.name === 'string' ? composition.name : null,
        isDefault: composition.isDefault === true,
        broken: typeof composition.broken === 'string' ? composition.broken : null,
        rows,
      })
    }
  } catch (error) {
    /* a roster that cannot compose reports through the snapshot diagnostics elsewhere */
  }
  return out
}

/** The MCP servers mounted today, host plane and preset plane alike. */
function collectMcp(runtime, presets, patchText) {
  const servers = []
  for (const row of runtime.rows) {
    if (!isMcpModule(row.module)) continue
    servers.push({
      entryId: row.id,
      serverName: null,
      enabled: row.enabled,
      phase: row.phase,
      scope: 'host',
      config: row.config ? redactMcpConfig(row.config) : null,
      managed: false,
    })
  }
  for (const preset of presets) {
    for (const row of preset.rows) {
      if (!isMcpModule(row.module)) continue
      servers.push({
        entryId: row.entryId === null ? preset.id + ':mcp' : row.entryId,
        serverName: null,
        enabled: row.enabled,
        phase: row.phase,
        scope: 'preset:' + preset.id,
        config: null,
        managed: false,
      })
    }
  }
  for (const server of servers) {
    if (server.config && typeof server.config.serverName === 'string') server.serverName = server.config.serverName
    server.managed = server.serverName !== null && typeof patchText === 'string' && patchText.indexOf(markerFor(server.serverName)) !== -1
  }
  return servers
}

/** The skill catalog one preset's standing composition sees. */
async function readSkills(ctx, presetId) {
  const presets = ctx.get('agentPresets')
  const skills = ctx.get('skills')
  if (presets === undefined || skills === undefined) {
    return { presetId: presetId || null, count: 0, complete: false, rows: [], error: '技能服务不可用' }
  }
  let targetId = typeof presetId === 'string' && presetId.length > 0 ? presetId : null
  try {
    if (targetId === null) {
      const compositions = await presets.compositionInventory()
      let fallback = null
      for (const composition of compositions) if (composition.isDefault === true) fallback = composition
      if (fallback === null && compositions.length > 0) fallback = compositions[0]
      targetId = fallback === null ? null : String(fallback.id)
    }
    if (targetId === null) return { presetId: null, count: 0, complete: false, rows: [], error: '没有可用的 Agent 预设' }
    const scope = await presets.standingKeyFor(targetId)
    const snapshot = await skills.snapshot({ scope })
    const summaries = Array.isArray(snapshot && snapshot.skills) ? snapshot.skills : []
    const rows = []
    for (const item of summaries) {
      rows.push({
        name: String(item.name),
        description: typeof item.description === 'string' ? item.description : '',
        whenToUse: typeof item.whenToUse === 'string' ? item.whenToUse : null,
        source: String(item.source),
        provider: String(item.provider),
        modelInvocable: !!(item.invocation && item.invocation.modelInvocable),
        userInvocable: !!(item.invocation && item.invocation.userInvocable),
        resourceKind: item.resourceBase && typeof item.resourceBase.kind === 'string' ? item.resourceBase.kind : null,
        resourcePath: item.resourceBase && item.resourceBase.kind === 'directory' && typeof item.resourceBase.path === 'string' ? item.resourceBase.path : null,
      })
    }
    return { presetId: targetId, count: rows.length, complete: snapshot && snapshot.complete === true, rows }
  } catch (error) {
    return { presetId: targetId, count: 0, complete: false, rows: [], error: messageOf(error) }
  }
}

/** One skill's full definition, body included. */
async function readSkillDetail(ctx, presetId, skillName) {
  const presets = ctx.get('agentPresets')
  const skills = ctx.get('skills')
  if (presets === undefined || skills === undefined) return { error: '技能服务不可用' }
  try {
    const scope = await presets.standingKeyFor(presetId)
    const definition = await skills.get(skillName, { scope })
    if (definition === undefined) return { error: '未找到技能 ' + String(skillName) }
    return {
      name: String(definition.name),
      description: typeof definition.description === 'string' ? definition.description : '',
      whenToUse: typeof definition.whenToUse === 'string' ? definition.whenToUse : null,
      path: typeof definition.path === 'string' ? definition.path : null,
      source: String(definition.source),
      provider: String(definition.provider),
      content: typeof definition.content === 'string' ? definition.content.slice(0, 20000) : '',
    }
  } catch (error) {
    return { error: messageOf(error) }
  }
}

/** Where plugin rows and MCP servers are configured, with the file's current text. */
function readProfile(runtime) {
  const profile = runtime.profile
  const out = {
    profileDir: profile.dir,
    profileName: profile.dir === null ? null : basename(profile.dir),
    resolvedVia: profile.source,
    patchPath: profile.patchPath,
    patchLines: 0,
    patchText: '',
    bundles: [],
    error: null,
  }
  if (profile.dir === null) {
    out.error = describeProfileFailure(runtime)
    return out
  }
  try {
    if (existsSync(profile.patchPath)) {
      const text = readFileSync(profile.patchPath, 'utf8')
      let lines = 0
      for (const line of text.split('\n')) lines += 1
      out.patchLines = lines
      out.patchText = text.length > 4000 ? text.slice(0, 4000) + '\n# …（已截断显示）' : text
    } else {
      out.error = '补丁层不存在'
    }
    if (existsSync(profile.manifestPath)) {
      const manifest = JSON.parse(readFileSync(profile.manifestPath, 'utf8'))
      const bundles = manifest && manifest.dsh && manifest.dsh.profile && manifest.dsh.profile.bundles
      if (Array.isArray(bundles)) for (const item of bundles) if (typeof item === 'string') out.bundles.push(item)
    }
  } catch (error) {
    out.error = messageOf(error)
  }
  return out
}

/**
 * Resolve the package a Loader row's module specifier belongs to: a bare
 * specifier names its package directly, while a path or `file:` URL (how a
 * plugin mounted by hand is referenced) resolves to the nearest manifest above
 * it.
 */
function rowPackageName(rowName) {
  if (typeof rowName !== 'string' || rowName.length === 0) return null
  if (rowName.indexOf('cordis:') === 0) return rowName
  const pathLike = rowName.indexOf('.') === 0 || rowName.indexOf('file:') === 0 || /^[A-Za-z]:[\\/]/.test(rowName)
  if (!pathLike) {
    if (rowName.indexOf('@') === 0) {
      const parts = rowName.split('/')
      return parts.length >= 2 ? parts[0] + '/' + parts[1] : rowName
    }
    return rowName.split('/')[0]
  }
  try {
    const filePath = rowName.indexOf('file:') === 0 ? fileURLToPath(rowName) : rowName
    let dir = dirname(filePath)
    for (let depth = 0; depth < 12; depth += 1) {
      const candidate = join(dir, 'package.json')
      if (existsSync(candidate)) {
        const manifest = JSON.parse(readFileSync(candidate, 'utf8'))
        return typeof manifest.name === 'string' ? manifest.name : null
      }
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  } catch (error) {
    return null
  }
  return null
}

/**
 * The plugins this profile has installed: its declared dependencies, exactly
 * what `dsh plugin --profile <name> list` reports. Each entry is resolved on
 * disk for its version and `dsh` declarations and matched to its live Loader
 * rows. In-box bundle layers and every other system row stay out of this list.
 */
function readInstalledPlugins(runtime, loaderRows, bundles) {
  const profile = runtime.profile
  let manifest
  try {
    manifest = JSON.parse(readFileSync(profile.manifestPath, 'utf8'))
  } catch (error) {
    return [{
      name: '(profile package.json 读取失败)',
      spec: null,
      version: null,
      description: '',
      dir: null,
      error: profile.dir === null ? describeProfileFailure(runtime) : messageOf(error),
      bundle: false,
      client: false,
      plain: false,
      inBundles: false,
      mounted: false,
      phase: null,
      rows: [],
    }]
  }
  const dependencies = manifest && manifest.dependencies !== null && typeof manifest.dependencies === 'object' ? manifest.dependencies : {}
  const bundleList = Array.isArray(bundles) ? bundles : []
  const out = []
  for (const packageName of Object.keys(dependencies)) {
    const spec = typeof dependencies[packageName] === 'string' ? dependencies[packageName] : null
    const dir = join(profile.dir, 'node_modules', packageName)
    let version = null
    let description = ''
    let bundle = false
    let clientHalf = false
    let error = null
    try {
      const manifestPath = join(dir, 'package.json')
      if (!existsSync(manifestPath)) {
        error = '未在 profile 的 node_modules 里解析到该包（可能需要 pnpm install）'
      } else {
        const pkg = JSON.parse(readFileSync(manifestPath, 'utf8'))
        version = typeof pkg.version === 'string' ? pkg.version : null
        description = typeof pkg.description === 'string' ? pkg.description : ''
        bundle = !!(pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch)
        clientHalf = !!(pkg.dsh && pkg.dsh.client && typeof pkg.dsh.client.platform === 'string')
      }
    } catch (inner) {
      error = messageOf(inner)
    }
    const matched = []
    for (const row of loaderRows) {
      if (rowPackageName(row.module) === packageName) matched.push({ id: row.id, module: row.module, phase: row.phase, enabled: row.enabled })
    }
    let phase = null
    for (const row of matched) if (row.phase === 'active') phase = 'active'
    if (phase === null && matched.length > 0) phase = matched[0].phase
    out.push({
      name: packageName,
      spec,
      version,
      description,
      dir,
      error,
      bundle,
      client: clientHalf,
      plain: !bundle && !clientHalf,
      inBundles: bundleList.indexOf(packageName) !== -1,
      mounted: matched.length > 0,
      phase,
      rows: matched,
    })
  }
  return out
}

/**
 * One mounted MCP server's full config, for prefilling the edit form. Unlike the
 * list projection this keeps env and header VALUES, because editing them is the
 * point of the call — which is exactly why the route is loopback-only.
 */
function mcpDetail(ctx, serverName) {
  const loader = ctx.get('loader')
  if (loader === undefined || typeof loader.entries !== 'function') return { error: 'loader 服务不可用' }
  for (const entry of loader.entries()) {
    const options = entry.options || {}
    if (!isMcpModule(options.name)) continue
    const config = options.config !== null && typeof options.config === 'object' ? options.config : null
    if (config === null) continue
    if (config.serverName !== serverName) continue
    const pairs = []
    if (config.env !== null && typeof config.env === 'object' && !Array.isArray(config.env)) {
      for (const key of Object.keys(config.env)) pairs.push({ name: key, value: typeof config.env[key] === 'string' ? config.env[key] : String(config.env[key]) })
    }
    const headers = []
    if (config.headers !== null && typeof config.headers === 'object' && !Array.isArray(config.headers)) {
      for (const key of Object.keys(config.headers)) headers.push({ name: key, value: typeof config.headers[key] === 'string' ? config.headers[key] : String(config.headers[key]) })
    }
    const args = []
    if (Array.isArray(config.args)) for (const item of config.args) args.push(typeof item === 'string' ? item : String(item))
    return {
      serverName,
      transport: typeof config.transport === 'string' ? config.transport : 'stdio',
      command: typeof config.command === 'string' ? config.command : '',
      args,
      env: pairs,
      url: typeof config.url === 'string' ? config.url : '',
      headers,
      entryId: String(entry.id),
    }
  }
  return { error: '未找到 serverName 为 ' + serverName + ' 的 MCP 行' }
}

/**
 * Whether this package's own client bundle is registered in the page boot graph.
 * The id is the package name, so a rename that misses `lib/client.js` shows up
 * here instead of as a settings tab that silently never appears.
 */
function readClientGraph(ctx) {
  const modules = ctx.get('clientModules')
  if (modules === undefined || typeof modules.graph !== 'function') {
    return { found: false, expectedId: SELF.name, error: 'clientModules 服务不可用' }
  }
  try {
    const graph = modules.graph()
    const entries = Array.isArray(graph && graph.entries) ? graph.entries : []
    let mine = null
    for (const entry of entries) {
      if (entry.id === SELF.name) mine = { url: entry.url, rev: entry.rev }
    }
    const bundlePath = typeof modules.clientPath === 'function' ? (modules.clientPath(SELF.name) || null) : null
    return { found: mine !== null, expectedId: SELF.name, graphRev: graph ? graph.rev : null, entryCount: entries.length, mine, bundlePath }
  } catch (error) {
    return { found: false, expectedId: SELF.name, error: messageOf(error) }
  }
}

/** Assemble the whole page state for one preset view. */
async function buildSnapshot(runtime, presetId, options) {
  const ctx = runtime.ctx
  const runtimeRows = readRuntime(ctx)
  const diagnostics = []
  if (runtimeRows.error !== null) diagnostics.push('loader: ' + runtimeRows.error)

  const rows = []
  const loader = { total: 0, enabled: 0, disabled: 0, failed: 0 }
  for (const row of runtimeRows.rows) {
    const enabled = row.disabled !== true
    const phase = row.fiberState === null || row.fiberState === undefined ? null : (PHASE_BY_STATE[row.fiberState] || null)
    if (enabled) loader.enabled += 1
    else loader.disabled += 1
    if (phase === 'failed') loader.failed += 1
    loader.total += 1
    rows.push({ id: row.id, module: row.module, enabled, phase, configurable: row.configurable, mcp: isMcpModule(row.module) })
  }

  const profile = readProfile(runtime)
  const client = readClientGraph(ctx)
  const presets = await readPresets(ctx)
  const mcp = collectMcp(
    { rows: runtimeRows.rows.map((row, index) => Object.assign({}, row, { phase: rows[index].phase, enabled: rows[index].enabled })) },
    presets,
    profile.patchText,
  )

  // 插件列表只认 profile 已安装的依赖（dsh plugin --profile <name> list 口径）；
  // 系统内置插件行仅作为运行态上下文（loader 计数），不进列表。
  const installed = readInstalledPlugins(runtime, rows, profile.bundles)
  const counts = { total: installed.length, mounted: 0, unmounted: 0, failed: 0, plain: 0 }
  for (const item of installed) {
    if (item.plain) counts.plain += 1
    if (item.mounted) counts.mounted += 1
    else counts.unmounted += 1
    for (const row of item.rows) {
      if (row.phase === 'failed') {
        counts.failed += 1
        break
      }
    }
  }

  const presetRoster = []
  for (const preset of presets) {
    presetRoster.push({ id: preset.id, name: preset.name, isDefault: preset.isDefault, broken: preset.broken, rowCount: preset.rows.length })
  }

  const skills = await readSkills(ctx, typeof presetId === 'string' && presetId.length > 0 ? presetId : null)
  if (skills.error !== undefined) diagnostics.push('skills: ' + skills.error)
  if (profile.error !== null) diagnostics.push('profile: ' + profile.error)
  if (client.found !== true) diagnostics.push('client: ' + (client.error !== undefined ? client.error : '客户端包 ' + SELF.name + ' 未注册到页面图，刷新页面后重试'))

  const payload = {
    plugins: { counts, loader, installed },
    presets: presetRoster,
    mcp,
    skills,
    profile,
    client,
    diagnostics,
  }
  if (options !== undefined && options !== null && options.presets === true) payload.presetCompositions = presets
  return payload
}

/** Characters a plain (unquoted) scalar may contain in this dialect. */
const PLAIN_BODY = /^[A-Za-z0-9_.\/@:+-]+$/

/**
 * Characters a plain scalar may OPEN with. The character-set check alone let
 * `@scope/pkg` through bare, and `@` (like a backtick) is a reserved indicator
 * that may never open a plain scalar: the rendered row then failed to parse
 * ("bad indentation of a sequence entry") and the write was refused. `-`, `?`
 * and `:` are indicators in that position too, and a lone `-` or `?` silently
 * parsed as `[[null]]` / `[{null: null}]` instead of the submitted string.
 */
const PLAIN_OPEN = /^[A-Za-z0-9_.\/]/

/** Words this dialect reads back as a type other than string. */
const RESERVED_WORD = /^(?:true|false|yes|no|on|off|null|none|nan|inf)$/i

/** Number look-alikes; the mcp-client Config validates these fields as strings. */
const NUMERIC_LOOK = /^[+-]?(?:\d|\.\d)/

/**
 * Quote one YAML scalar. Text stays bare only when a YAML reader is guaranteed
 * to hand back the identical string: a plain scalar may not open with an
 * indicator, may not end with a colon (that makes it a mapping key), and may
 * not look like a number, boolean or null — the mcp-client Config validates
 * `args`, `env` and `headers` values as strings, so an unquoted `9000` arrives
 * as a number and fails the row at activation. Everything else is
 * double-quoted, which is valid YAML for every value this plugin can emit.
 */
function yamlScalar(value) {
  const text = String(value === null || value === undefined ? '' : value)
  if (text.length === 0) return "''"
  const mappingLook = text.endsWith(':')
  const documentMarker = text === '...' || text === '---'
  const plainSafe = PLAIN_BODY.test(text) && PLAIN_OPEN.test(text) && !mappingLook && !documentMarker
  if (plainSafe && !RESERVED_WORD.test(text) && !NUMERIC_LOOK.test(text)) return text
  return JSON.stringify(text)
}

/**
 * Render the exact `cordis.patch.yml` entry for one MCP server, validating the
 * same fields the mcp-client Config schema requires.
 */
function mcpSnippet(input) {
  const args = input !== null && typeof input === 'object' ? input : {}
  const errors = []
  const transport = typeof args.transport === 'string' ? args.transport : 'stdio'
  const serverName = typeof args.serverName === 'string' ? args.serverName.trim() : ''
  if (transport !== 'stdio' && transport !== 'streamable-http') errors.push('传输方式必须是 stdio 或 streamable-http')
  if (!SERVER_NAME_PATTERN.test(serverName)) errors.push('serverName 只能包含字母、数字、下划线与连字符，长度 1-32')

  /** Zip non-blank `{name, value}` rows, validating each name against one pattern. */
  const pairs = (value, label, pattern, hint) => {
    const out = []
    if (!Array.isArray(value)) return out
    for (const item of value) {
      if (item === null || typeof item !== 'object') continue
      const pairName = typeof item.name === 'string' ? item.name.trim() : ''
      if (pairName.length === 0) continue
      if (!pattern.test(pairName)) errors.push(label + '名 ' + pairName + ' 不合法：' + hint)
      const raw = item.value
      out.push({ name: pairName, value: typeof raw === 'string' ? raw : (raw === undefined || raw === null ? '' : String(raw)) })
    }
    return out
  }

  const lines = []
  lines.push('- insert:')
  lines.push('    - id: ' + yamlScalar(serverName.length > 0 ? serverName : 'server'))
  lines.push("      name: '@deepseek-ai/dsh-mcp-client'")
  lines.push('      config:')
  lines.push('        serverName: ' + yamlScalar(serverName.length > 0 ? serverName : 'server'))
  lines.push('        transport: ' + transport)
  if (transport === 'stdio') {
    const command = typeof args.command === 'string' ? args.command.trim() : ''
    if (command.length === 0) errors.push('stdio 传输需要启动命令')
    lines.push('        command: ' + yamlScalar(command))
    const argList = []
    if (Array.isArray(args.args)) for (const item of args.args) if (typeof item === 'string' && item.trim().length > 0) argList.push(item.trim())
    if (argList.length > 0) {
      lines.push('        args:')
      for (const item of argList) lines.push('          - ' + yamlScalar(item))
    }
    const envList = pairs(args.env, '环境变量', /^[A-Za-z_][A-Za-z0-9_]*$/, '字母或下划线开头，只含字母、数字、下划线')
    if (envList.length > 0) {
      lines.push('        env:')
      for (const item of envList) lines.push('          ' + yamlScalar(item.name) + ': ' + yamlScalar(item.value))
    }
  } else {
    const url = typeof args.url === 'string' ? args.url.trim() : ''
    if (url.length === 0) errors.push('streamable-http 传输需要 url')
    lines.push('        url: ' + yamlScalar(url))
    const headerList = pairs(args.headers, '请求头', /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/, '只能用 HTTP 头字段允许的字符')
    if (headerList.length > 0) {
      lines.push('        headers:')
      for (const item of headerList) lines.push('          ' + yamlScalar(item.name) + ': ' + yamlScalar(item.value))
    }
  }
  lines.push('        failOnStartupError: false')
  return { ok: errors.length === 0, errors, snippet: lines.join('\n') + '\n' }
}

/** A parser diagnostic's first line, without its multi-line source excerpt. */
function firstLineOf(error) {
  return messageOf(error).split('\n')[0]
}

/**
 * Render one MCP row and prove the rendered text is a single parseable patch
 * entry before it is previewed or written. Without this guard a defect in the
 * scalar quoting above surfaced as a raw parser error thrown from the middle of
 * the merge step, where it reads as though the user's own file were broken
 * rather than the row this plugin generated.
 */
async function renderCheckedSnippet(input) {
  const rendered = mcpSnippet(input)
  if (!rendered.ok) return rendered
  try {
    const yaml = await loadYaml()
    const parsed = yaml.load(rendered.snippet, { schema: entryListSchema(yaml) })
    if (!Array.isArray(parsed) || parsed.length !== 1) {
      return { ok: false, errors: ['生成的片段不是单条补丁条目（这是插件缺陷，请连同这条输入一起上报）'], snippet: rendered.snippet }
    }
  } catch (error) {
    return { ok: false, errors: ['生成的片段不是合法 YAML（这是插件缺陷，请连同这条输入一起上报）：' + firstLineOf(error)], snippet: rendered.snippet }
  }
  return rendered
}

/**
 * The comment this plugin writes above each entry it owns. The wording is part
 * of the on-disk contract: entries are only editable/removable when this exact
 * marker is found, so changing it orphans every row written by an older version
 * (they degrade to read-only "手动配置" instead of breaking).
 */
function markerFor(serverName) {
  return '# 插件集成 managed mcp server: ' + serverName
}

/** Load and cache `js-yaml`; a missing module surfaces as a clear write error. */
async function loadYaml() {
  if (yamlModule !== undefined) return yamlModule
  const loaded = await import('js-yaml')
  yamlModule = loaded.default !== undefined ? loaded.default : loaded
  return yamlModule
}

/** Replace the empty-array document with the new block, or append the block. */
function insertBlock(before, block) {
  const lines = before.split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].trim() === '[]') {
      lines[index] = block.replace(/\n$/, '')
      return lines.join('\n')
    }
  }
  return before.replace(/\s*$/, '') + '\n' + block
}

/** Publish new patch text atomically, keeping one `.bak` of the previous content. */
function publishPatch(patchPath, before, after) {
  try {
    if (existsSync(patchPath)) copyFileSync(patchPath, patchPath + '.bak')
  } catch (error) {
    /* a missing backup must not block a validated write */
  }
  const temporary = patchPath + '.tmp'
  writeFileSync(temporary, after, 'utf8')
  renameSync(temporary, patchPath)
  return before
}

/** Parse the patch layer and insist it is a top-level array (or empty). */
async function readPatchList(yaml, patchPath) {
  if (patchPath === null || !existsSync(patchPath)) return { list: [], text: '' }
  const text = readFileSync(patchPath, 'utf8')
  const parsed = yaml.load(text, { schema: entryListSchema(yaml) })
  if (parsed === undefined || parsed === null) return { list: [], text }
  if (!Array.isArray(parsed)) throw new Error('补丁层不是顶层 YAML 数组，已放弃写入')
  return { list: parsed, text }
}

/** Append one validated MCP row to the profile patch layer. */
async function applyMcpEntry(input, runtime) {
  const rendered = await renderCheckedSnippet(input)
  if (!rendered.ok) return { ok: false, errors: rendered.errors, snippet: rendered.snippet }
  const denied = profileWriteError(runtime)
  if (denied !== null) return { ok: false, errors: [denied], snippet: rendered.snippet }
  const patchPath = runtime.profile.patchPath
  const serverName = String(input.serverName).trim()
  try {
    const yaml = await loadYaml()
    const current = await readPatchList(yaml, patchPath)
    for (const entry of current.list) {
      const inserts = entry && Array.isArray(entry.insert) ? entry.insert : []
      for (const row of inserts) {
        if (row && row.config && row.config.serverName === serverName) {
          return { ok: false, errors: ['补丁层里已经有 serverName 为 ' + serverName + ' 的条目'], snippet: rendered.snippet }
        }
      }
    }
    // Line-exact, not a substring test: `... serverName: kaptain` is a prefix of
    // the marker for `kaptain-2`, so a substring test would refuse to re-add a
    // name that a rename had just freed.
    const markerLines = current.text.split('\n')
    if (markerLines.some((line) => line.trim() === markerFor(serverName).trim())) {
      return { ok: false, errors: ['该服务器已经由本页写入过'], snippet: rendered.snippet }
    }
    const after = insertBlock(current.text, markerFor(serverName) + '\n' + rendered.snippet)
    const reparsed = yaml.load(after, { schema: entryListSchema(yaml) })
    if (!Array.isArray(reparsed) || reparsed.length !== current.list.length + 1) {
      return { ok: false, errors: ['写入后的 YAML 校验未通过，文件未改动'], snippet: rendered.snippet }
    }
    publishPatch(patchPath, current.text, after)
    return { ok: true, errors: [], serverName, patchPath, snippet: rendered.snippet }
  } catch (error) {
    return { ok: false, errors: [messageOf(error)], snippet: rendered.snippet }
  }
}

/** End index (exclusive) of the marker block that starts at `start`. */
function blockEnd(lines, start) {
  let end = start + 1
  while (end < lines.length) {
    const line = lines[end]
    if (line.trim().length === 0) { end += 1; continue }
    if (/^\s/.test(line)) { end += 1; continue }
    if (end === start + 1 && /^-\s/.test(line)) { end += 1; continue }
    break
  }
  return end
}

/** Replace the entry this plugin wrote for `original` with a freshly rendered one. */
async function replaceMcpEntry(input, runtime) {
  const source = input !== null && typeof input === 'object' ? input : {}
  const original = typeof source.original === 'string' ? source.original.trim() : ''
  if (original.length === 0) return { ok: false, errors: ['缺少 original'] }
  const rendered = await renderCheckedSnippet(source)
  if (!rendered.ok) return { ok: false, errors: rendered.errors, snippet: rendered.snippet }
  const denied = profileWriteError(runtime)
  if (denied !== null) return { ok: false, errors: [denied], snippet: rendered.snippet }
  const patchPath = runtime.profile.patchPath
  const nextName = typeof source.serverName === 'string' ? source.serverName.trim() : ''
  try {
    const yaml = await loadYaml()
    const current = await readPatchList(yaml, patchPath)
    const marker = markerFor(original)
    const lines = current.text.split('\n')
    const start = lines.findIndex((line) => line.trim() === marker.trim())
    if (start === -1) return { ok: false, errors: ['该条目不是本页写入的，无法在此编辑（请手动编辑补丁层）'] }
    if (nextName !== original) {
      for (const entry of current.list) {
        const inserts = entry && Array.isArray(entry.insert) ? entry.insert : []
        for (const row of inserts) {
          if (row && row.config && row.config.serverName === nextName) {
            return { ok: false, errors: ['已经有 serverName 为 ' + nextName + ' 的条目'], snippet: rendered.snippet }
          }
        }
      }
    }
    const end = blockEnd(lines, start)
    const block = (markerFor(nextName) + '\n' + rendered.snippet).replace(/\n$/, '').split('\n')
    const after = lines.slice(0, start).concat(block, lines.slice(end)).join('\n')
    const reparsed = yaml.load(after, { schema: entryListSchema(yaml) })
    if (!Array.isArray(reparsed) || reparsed.length !== current.list.length) {
      return { ok: false, errors: ['编辑后的 YAML 校验未通过，文件未改动'], snippet: rendered.snippet }
    }
    publishPatch(patchPath, current.text, after)
    return { ok: true, errors: [], serverName: nextName, original, patchPath, snippet: rendered.snippet }
  } catch (error) {
    return { ok: false, errors: [messageOf(error)], snippet: rendered.snippet }
  }
}

/**
 * Run one `dsh plugin --profile <name> …` invocation, capturing merged output.
 * The command is `config.dshCommand` (default `dsh` on PATH): a launcher may be
 * `npx dsh`, a wheel-provided runtime, or an absolute path, and none of those
 * are guaranteed to be on PATH just because this plugin is loaded.
 */
function runProfileCli(runtime, args, timeoutMs) {
  return new Promise((done) => {
    const profile = basename(runtime.profile.dir)
    const configured = typeof runtime.config.dshCommand === 'string' ? runtime.config.dshCommand.trim() : ''
    const command = configured.length > 0 ? configured : 'dsh'
    const child = spawn(command, ['plugin', '--profile', profile, ...args], {
      cwd: runtime.profile.dir,
      // A Windows CLI shim is a .cmd, which Node cannot spawn without a shell.
      shell: process.platform === 'win32',
      windowsHide: true,
    })
    let output = ''
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      done(result)
    }
    const timer = setTimeout(() => {
      try { child.kill() } catch (error) { /* the process is already gone */ }
      finish({ ok: false, code: null, output: output + '\n（超过 ' + Math.round(timeoutMs / 1000) + ' 秒未完成，已中止）' })
    }, timeoutMs)
    child.stdout.on('data', (chunk) => { output += chunk.toString('utf8') })
    child.stderr.on('data', (chunk) => { output += chunk.toString('utf8') })
    child.on('error', (error) => finish({ ok: false, code: null, output: output + '\n' + messageOf(error) }))
    child.on('close', (code) => finish({ ok: code === 0, code, output }))
  })
}

/**
 * Uninstall one profile plugin through the official CLI, so the dependency, the
 * lockfile and `dsh.profile.bundles` all move together the way
 * `dsh plugin --profile <name> remove` leaves them.
 */
async function uninstallPlugin(input, runtime) {
  const source = input !== null && typeof input === 'object' ? input : {}
  const target = typeof source.name === 'string' ? source.name.trim() : ''
  if (target.length === 0) return { ok: false, errors: ['缺少插件名'] }
  if (!PACKAGE_NAME_PATTERN.test(target)) return { ok: false, errors: [target + ' 不是合法的包名，已拒绝'] }
  if (target === SELF.name) return { ok: false, errors: ['不能卸载插件集成自身（它正提供这个页面）'] }
  const denied = profileWriteError(runtime)
  if (denied !== null) return { ok: false, errors: [denied] }
  let manifest
  try {
    manifest = JSON.parse(readFileSync(runtime.profile.manifestPath, 'utf8'))
  } catch (error) {
    return { ok: false, errors: ['读取 profile package.json 失败：' + messageOf(error)] }
  }
  const dependencies = manifest && manifest.dependencies !== null && typeof manifest.dependencies === 'object' ? manifest.dependencies : {}
  if (typeof dependencies[target] !== 'string') return { ok: false, errors: [target + ' 不是本 profile 的依赖，无法卸载'] }
  const profile = basename(runtime.profile.dir)
  if (source.dryRun === true) {
    const probe = await runProfileCli(runtime, ['list'], 60000)
    return { ok: probe.ok, errors: probe.ok ? [] : ['CLI 自检失败'], name: target, dryRun: true, output: probe.output }
  }
  const result = await runProfileCli(runtime, ['remove', target], 180000)
  if (!result.ok) {
    return {
      ok: false,
      errors: ['卸载失败（退出码 ' + String(result.code) + '）'],
      name: target,
      output: result.output,
      manual: 'dsh plugin --profile ' + profile + ' remove ' + target,
    }
  }
  return { ok: true, errors: [], name: target, output: result.output }
}

/** Remove one entry this plugin wrote, verified by its marker and by a re-parse. */
async function removeMcpEntry(input, runtime) {
  const serverName = input !== null && typeof input === 'object' && typeof input.serverName === 'string' ? input.serverName.trim() : ''
  if (serverName.length === 0) return { ok: false, errors: ['缺少 serverName'] }
  const denied = profileWriteError(runtime)
  if (denied !== null) return { ok: false, errors: [denied] }
  const patchPath = runtime.profile.patchPath
  try {
    const yaml = await loadYaml()
    const current = await readPatchList(yaml, patchPath)
    const marker = markerFor(serverName)
    const lines = current.text.split('\n')
    const start = lines.findIndex((line) => line.trim() === marker.trim())
    if (start === -1) return { ok: false, errors: ['该条目不是本页写入的，未做改动（请手动编辑补丁层）'] }
    const end = blockEnd(lines, start)
    const after = lines.slice(0, start).concat(lines.slice(end)).join('\n')
    const reparsed = yaml.load(after, { schema: entryListSchema(yaml) })
    if (!Array.isArray(reparsed) || reparsed.length !== current.list.length - 1) {
      return { ok: false, errors: ['删除后的 YAML 校验未通过，文件未改动'] }
    }
    publishPatch(patchPath, current.text, after)
    return { ok: true, errors: [], serverName, patchPath }
  } catch (error) {
    return { ok: false, errors: [messageOf(error)] }
  }
}

/** Whether a peer address is loopback (IPv4, IPv6, or IPv4-mapped IPv6). */
function isLoopback(address) {
  if (typeof address !== 'string' || address.length === 0) return false
  return address === '::1' || address === '127.0.0.1' || address.indexOf('127.') === 0 || address.indexOf('::ffff:127.') === 0
}

/**
 * Admission for one request. `Sec-Fetch-Site` alone is not enough: it is absent
 * on every non-browser client (so `curl` was admitted) and it says nothing about
 * who else can reach the port. The browser carrier has no authentication of its
 * own and its `host` may be `0.0.0.0`, while these endpoints return secret
 * VALUES and rewrite configuration, so the peer must be loopback and the carrier
 * must not be bound to every interface — unless the operator opts in with
 * `config.allowRemote: true`.
 */
function admissionError(runtime, req) {
  if (runtime.config.allowRemote === true) return null
  const remote = req.socket !== null && req.socket !== undefined ? req.socket.remoteAddress : undefined
  if (!isLoopback(remote)) return '仅允许来自本机的请求（对端 ' + String(remote) + '）'
  const webServer = runtime.ctx.webServer
  const host = webServer !== undefined && webServer !== null ? webServer.host : undefined
  if (typeof host === 'string' && host !== '127.0.0.1') {
    return 'Web 服务绑定在 ' + host + '，本插件只服务回环地址。确实需要远程访问时，请显式设置 config.allowRemote: true'
  }
  return null
}

/** Read a JSON request body under a hard size cap. */
async function readJsonBody(req, limit = 65536) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim().length === 0) return {}
  return JSON.parse(text)
}

/** Write one JSON response and end it. */
function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

/** Turn query parameters into the snippet generator's input, zipping row arrays. */
function snippetInputFrom(searchParams) {
  const zip = (names, values) => {
    const out = []
    for (let index = 0; index < names.length; index += 1) {
      out.push({ name: names[index], value: values[index] === undefined ? '' : values[index] })
    }
    return out
  }
  return {
    transport: searchParams.get('transport') || 'stdio',
    serverName: searchParams.get('serverName') || '',
    command: searchParams.get('command') || '',
    args: searchParams.getAll('arg'),
    env: zip(searchParams.getAll('envName'), searchParams.getAll('envValue')),
    url: searchParams.get('url') || '',
    headers: zip(searchParams.getAll('headerName'), searchParams.getAll('headerValue')),
  }
}

/** Dispatch one request against the route contract. */
async function handleRequest(runtime, req, res) {
  const ctx = runtime.ctx
  const site = req.headers['sec-fetch-site']
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') {
    return sendJson(res, 403, { error: '仅允许同源请求' })
  }
  const denied = admissionError(runtime, req)
  if (denied !== null) return sendJson(res, 403, { error: denied })
  const url = new URL(req.url !== undefined && req.url !== null ? req.url : '/', 'http://127.0.0.1')
  const action = url.searchParams.get('action') !== null ? url.searchParams.get('action') : 'snapshot'
  try {
    if (req.method === 'GET') {
      if (action === 'snapshot') return sendJson(res, 200, await buildSnapshot(runtime, url.searchParams.get('preset')))
      if (action === 'skills') return sendJson(res, 200, await readSkills(ctx, url.searchParams.get('preset')))
      if (action === 'skill') return sendJson(res, 200, await readSkillDetail(ctx, url.searchParams.get('preset'), url.searchParams.get('name') || ''))
      if (action === 'mcp-snippet') return sendJson(res, 200, await renderCheckedSnippet(snippetInputFrom(url.searchParams)))
      if (action === 'mcp-detail') return sendJson(res, 200, mcpDetail(ctx, url.searchParams.get('serverName') || ''))
      return sendJson(res, 405, { error: '该操作需要 POST：' + action })
    }
    if (req.method === 'POST') {
      const body = await readJsonBody(req)
      if (action === 'mcp-apply') return sendJson(res, 200, await applyMcpEntry(body, runtime))
      if (action === 'mcp-replace') return sendJson(res, 200, await replaceMcpEntry(body, runtime))
      if (action === 'mcp-remove') return sendJson(res, 200, await removeMcpEntry(body, runtime))
      if (action === 'plugin-uninstall') return sendJson(res, 200, await uninstallPlugin(body, runtime))
      return sendJson(res, 405, { error: '未知的写操作：' + action })
    }
    return sendJson(res, 405, { error: '仅支持 GET / POST' })
  } catch (error) {
    return sendJson(res, 500, { error: messageOf(error) })
  }
}

/** The compact status projection handed to the model. */
async function buildStatus(runtime, presetId) {
  const snapshot = await buildSnapshot(runtime, presetId, { presets: true })
  const installed = []
  for (const item of snapshot.plugins.installed) {
    installed.push({
      name: item.name,
      version: item.version,
      spec: item.spec,
      bundle: item.bundle,
      client: item.client,
      plain: item.plain,
      mounted: item.mounted,
      phase: item.phase,
      rows: item.rows.map((row) => row.id + '（' + (row.phase !== null ? row.phase : (row.enabled ? '未启动' : '已禁用')) + '）'),
      error: item.error,
    })
  }
  const presets = []
  for (const preset of snapshot.presetCompositions) {
    let enabled = 0
    let disabled = 0
    let failed = 0
    for (const row of preset.rows) {
      if (row.enabled === false) disabled += 1
      else enabled += 1
      if (row.phase === 'failed') failed += 1
    }
    presets.push({ id: preset.id, name: preset.name, isDefault: preset.isDefault, broken: preset.broken, rows: preset.rows.length, enabled, disabled, failed })
  }
  const bySource = []
  const counts = {}
  for (const row of snapshot.skills.rows) counts[row.source] = (counts[row.source] || 0) + 1
  for (const source of Object.keys(counts)) bySource.push({ source, count: counts[source] })
  const mcp = []
  for (const server of snapshot.mcp) {
    mcp.push({
      entryId: server.entryId,
      serverName: server.serverName,
      scope: server.scope,
      enabled: server.enabled,
      phase: server.phase,
      transport: server.config ? server.config.transport : null,
      managed: server.managed,
    })
  }
  return {
    installed,
    pluginCounts: snapshot.plugins.counts,
    loader: snapshot.plugins.loader,
    presets,
    mcp,
    skills: { presetId: snapshot.skills.presetId, count: snapshot.skills.count, complete: snapshot.skills.complete, bySource },
    profileName: snapshot.profile.profileName,
    patchPath: snapshot.profile.patchPath,
    patchLines: snapshot.profile.patchLines,
    bundles: snapshot.profile.bundles,
    diagnostics: snapshot.diagnostics,
  }
}

/** Human-readable status text for the tool card. */
function renderStatus(value) {
  const lines = []
  const profileLabel = value.profileName === null || value.profileName === undefined ? '当前 profile' : 'profile ' + value.profileName
  lines.push('插件集成状态（' + profileLabel + '）')
  if (value.installed.length === 0) {
    lines.push('已装插件（profile 依赖）：无')
  } else {
    lines.push('已装插件（profile 依赖，共 ' + value.installed.length + '，等价于 dsh plugin --profile ' + String(value.profileName) + ' list）：')
    for (const item of value.installed) {
      const tags = []
      if (item.bundle) tags.push('bundle 层')
      if (item.client) tags.push('客户端半包')
      if (item.plain) tags.push('无 dsh 声明（普通依赖）')
      const state = item.error !== null && item.error !== undefined
        ? '未解析（' + item.error + '）'
        : (item.mounted ? '已挂载 ' + (item.phase !== null ? item.phase : '未启动') : '未挂载')
      lines.push('  · ' + item.name + (item.version ? '@' + item.version : '') + '：' + (tags.length > 0 ? tags.join(' + ') : '—') + '，' + state
        + (item.rows.length > 0 ? '；行 ' + item.rows.join('、') : ''))
    }
  }
  if (value.mcp.length === 0) lines.push('MCP 服务器：未配置')
  else {
    lines.push('MCP 服务器：' + value.mcp.length + ' 台')
    for (const server of value.mcp) {
      lines.push('  · ' + (server.serverName || server.entryId) + '（' + server.scope + '，' + (server.transport || '未知传输') + '，'
        + (server.phase || '未启动') + (server.managed ? '，本页管理' : '') + '）')
    }
  }
  lines.push('技能目录（预设 ' + String(value.skills.presetId) + ' 视角）：' + value.skills.count + ' 个' + (value.skills.complete ? '' : '（发现未完成）'))
  for (const entry of value.skills.bySource) lines.push('  · ' + entry.source + '：' + entry.count)
  if (value.presets.length > 0) {
    lines.push('Agent 预设组成（系统运行态）：')
    for (const preset of value.presets) {
      lines.push('  · ' + preset.id + (preset.name ? '（' + preset.name + '）' : '') + '：' + preset.rows + ' 行，启用 ' + preset.enabled + '，禁用 ' + preset.disabled
        + (preset.failed > 0 ? '，失败 ' + preset.failed : '') + (preset.broken ? '，读取失败' : ''))
    }
  }
  lines.push('系统运行态（不计入插件列表）：loader ' + value.loader.total + ' 行 / 启用 ' + value.loader.enabled + ' / 禁用 ' + value.loader.disabled + ' / 失败 ' + value.loader.failed)
  lines.push('补丁层：' + value.patchLines + ' 行')
  if (value.diagnostics.length > 0) lines.push('诊断：' + value.diagnostics.join(' / '))
  return lines.join('\n')
}

/** The model-visible read-only status tool. */
function statusTool(runtime) {
  return {
    name: 'plugin_integration_status',
    description: 'Read-only status of this deployment\'s plugin integration: the plugins installed in the current profile (exactly what `dsh plugin --profile <name> list` reports), the MCP servers, the skill catalog a preset sees, and system-plane loader counts for diagnosis. Use when asked what plugins/MCP/skills are installed, or why an installed plugin is not mounted.',
    parameters: {
      type: 'object',
      properties: {
        preset: { type: 'string', description: 'Optional agent preset id whose skill catalog view to report (default: the deployment default preset).' },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (args, value) => [{ type: 'text', text: renderStatus(value) }],
    },
    async execute(args) {
      const input = args !== null && typeof args === 'object' ? args : {}
      return buildStatus(runtime, typeof input.preset === 'string' ? input.preset : null)
    },
  }
}

/** Report one activation-time diagnostic through the optional logger. */
function logAt(ctx, level, message) {
  const logger = ctx.logger
  if (logger === undefined || logger === null || typeof logger[level] !== 'function') return
  try {
    logger[level]('plugin-integration: ' + message)
  } catch (error) {
    /* logging must never fail activation */
  }
}

/**
 * Register the route and the status tool on this plugin's fiber.
 *
 * Both registrations degrade instead of throwing: this package is also reachable
 * through a hand-written `file:` mount, and a user migrating to the bundle
 * channel may briefly have BOTH rows active. A duplicate exact route throws in
 * `webServer.register`, and an unhandled throw there fails the entry — which
 * fails the whole boot. Skipping the second registration keeps the tree
 * bootable and lets the first row serve the page.
 *
 * @param ctx - plugin context carrying the web server.
 * @param config - optional `{ profileDir, dshCommand, allowRemote }` row config.
 */
export function apply(ctx, config) {
  const settings = config !== null && typeof config === 'object' ? config : {}
  const runtime = { ctx, config: settings, profile: resolveProfile(settings, ctx) }

  if (runtime.profile.dir === null) logAt(ctx, 'warn', describeProfileFailure(runtime))
  else logAt(ctx, 'info', 'profile ' + runtime.profile.dir + '（来源：' + runtime.profile.source + '）')

  try {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: ROUTE_PATH,
      handler: (req, res) => handleRequest(runtime, req, res),
    }), 'plugin-integration:route')
  } catch (error) {
    logAt(ctx, 'warn', '路由 ' + ROUTE_PATH + ' 已被占用，本行不再注册（多行挂载了同一个插件？）— ' + messageOf(error))
  }

  const tools = ctx.get('tools')
  if (tools !== undefined && typeof tools.register === 'function') {
    try {
      ctx.effect(() => tools.register(statusTool(runtime)), 'plugin-integration:status-tool')
    } catch (error) {
      logAt(ctx, 'warn', 'status tool not registered — ' + messageOf(error))
    }
  }
}

/**
 * The tested surface. The Loader reads only `name`, `inject` and `apply`;
 * everything exported here is an implementation detail the snippet round-trip,
 * patch-write and packaging tests drive directly.
 */
export { mcpSnippet, yamlScalar, applyMcpEntry, replaceMcpEntry, removeMcpEntry }
