/**
 * Regression tests for the generated `cordis.patch.yml` row.
 *
 * The reported failure: adding an MCP server whose args started with `@`
 * (`npx -y @qunhe/kaptain-mcp@latest`) produced a row the YAML reader could not
 * parse — "bad indentation of a sequence entry". `@` is a reserved indicator in
 * YAML and may never open a plain scalar, but the quoter only checked the
 * character set. The write itself was refused before the file changed, which is
 * why the file survived; the row was simply unusable.
 *
 * These tests pin the PROPERTY, not the case: every scalar this plugin renders —
 * values and mapping keys, both transports — must come back as the identical
 * string after a round trip through the profile's own YAML dialect.
 */

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { mcpSnippet, yamlScalar, applyMcpEntry, replaceMcpEntry, removeMcpEntry } = await import('../lib/index.js')

let yaml = null
try {
  const loaded = await import('js-yaml')
  yaml = loaded.default !== undefined ? loaded.default : loaded
} catch (error) {
  yaml = null
}

/** A checkout that has not run `npm install` still gets the packaging contract. */
const missingParser = yaml === null ? 'js-yaml is not installed — run `npm install`' : false

/** The dialect app-boot loads a profile patch layer with. */
function dshSchema() {
  const jsExpression = new yaml.Type('tag:yaml.org,2002:js', {
    kind: 'scalar',
    resolve: (data) => typeof data === 'string',
    construct: (data) => ({ __jsExpr: data }),
  })
  return yaml.JSON_SCHEMA.extend([jsExpression])
}

const parse = (text) => yaml.load(text, { schema: dshSchema() })
const configOf = (text) => parse(text)[0].insert[0].config

/** Scalars a YAML reader is free to reinterpret, plus ordinary ones. */
const TRICKY = [
  '@qunhe/kaptain-mcp@latest', '@scope/pkg', '-y', '--enable-shell', '-', '--', ':', ':foo', 'foo:', '?', '?foo', '-foo',
  '9000', '0900', '1e5', '0x1f', '.5', '-1', '+1', '1_000',
  'true', 'false', 'yes', 'no', 'on', 'off', 'null', '~', 'nan', 'inf',
  'serve', 'a/b', 'C:/Users/me/My File.exe', 'http://127.0.0.1:3000/mcp', '中文参数', 'a b', 'a#b',
  '*', '&x', '!x', '%TEMP%', '{a}', '[a]', 'a,b', '|', '>', "'q'", '"q"', '...', '---', 'v1.2.3', 'x-y_z', 'a@b', 'a:b',
]

test('an argument starting with @ renders (the reported case)', { skip: missingParser }, () => {
  const rendered = mcpSnippet({
    transport: 'stdio',
    serverName: 'kaptain',
    command: 'npx',
    args: ['-y', '@qunhe/kaptain-mcp@latest'],
    env: [{ name: 'npm_config_registry', value: 'https://registry.npmjs.org/' }],
    url: '',
    headers: [],
  })
  assert.equal(rendered.ok, true, rendered.errors.join('；'))
  const config = configOf(rendered.snippet)
  assert.deepEqual(config.args, ['-y', '@qunhe/kaptain-mcp@latest'])
  assert.equal(config.command, 'npx')
  assert.equal(config.env.npm_config_registry, 'https://registry.npmjs.org/')
})

test('every rendered stdio scalar round-trips as the identical string', { skip: missingParser }, () => {
  const env = TRICKY.map((value, index) => ({ name: 'V' + String(index), value }))
  const rendered = mcpSnippet({ transport: 'stdio', serverName: 'probe', command: TRICKY[0], args: TRICKY, env, url: '', headers: [] })
  assert.equal(rendered.ok, true, rendered.errors.join('；'))
  const config = configOf(rendered.snippet)

  assert.deepEqual(config.args, TRICKY)
  assert.equal(config.command, TRICKY[0])
  for (const row of env) {
    assert.equal(config.env[row.name], row.value, `env ${row.name} (${JSON.stringify(row.value)})`)
    assert.equal(typeof config.env[row.name], 'string', `env ${row.name} must stay a string`)
  }
  for (const value of config.args) assert.equal(typeof value, 'string', `arg ${JSON.stringify(value)} must stay a string`)
})

test('every rendered http scalar round-trips, keys included', { skip: missingParser }, () => {
  const headers = [
    { name: 'Authorization', value: 'Bearer eyJhbGciOi.abc-DEF_123' },
    { name: 'X-Api-Key', value: '@secret/value' },
    { name: 'X-Weird~Name', value: ': leading colon' },
  ]
  const rendered = mcpSnippet({
    transport: 'streamable-http',
    serverName: 'remote',
    command: '',
    args: [],
    env: [],
    url: 'https://example.com/mcp?tenant=a:b',
    headers,
  })
  assert.equal(rendered.ok, true, rendered.errors.join('；'))
  const config = configOf(rendered.snippet)
  assert.equal(config.url, 'https://example.com/mcp?tenant=a:b')
  for (const row of headers) assert.equal(config.headers[row.name], row.value, `header ${row.name}`)
})

test('yamlScalar quotes exactly what YAML would reinterpret', { skip: missingParser }, () => {
  // Bare: identical round trip is guaranteed.
  assert.equal(yamlScalar('serve'), 'serve')
  assert.equal(yamlScalar('C:/tools/server.exe'), 'C:/tools/server.exe')
  assert.equal(yamlScalar('a:b'), 'a:b')
  assert.equal(yamlScalar('--enable-shell') === '--enable-shell', false, 'a leading - is an indicator position')
  // Quoted: indicator position, mapping look, type look, empty.
  assert.equal(yamlScalar('@scope/pkg'), '"@scope/pkg"')
  assert.equal(yamlScalar('-y'), '"-y"')
  assert.equal(yamlScalar(':foo'), '":foo"')
  assert.equal(yamlScalar('foo:'), '"foo:"')
  assert.equal(yamlScalar('-'), '"-"')
  assert.equal(yamlScalar('9000'), '"9000"')
  assert.equal(yamlScalar('on'), '"on"')
  assert.equal(yamlScalar('~'), '"~"')
  assert.equal(yamlScalar('...'), '"..."')
  assert.equal(yamlScalar(''), "''")
})

/** The shape a real profile carries: header comments plus one managed entry. */
const SEED = [
  '# Your patch layer for this dsh profile, applied after every bundle layer:',
  '# a top-level YAML array of loader patch entries (id-targeted config',
  '# overrides, disables, and insert lists; `!!js` expressions allowed).',
  '# 插件集成 managed mcp server: fastctx',
  '- insert:',
  '    - id: fastctx',
  "      name: '@deepseek-ai/dsh-mcp-client'",
  '      config:',
  '        serverName: fastctx',
  '        transport: stdio',
  '        command: fastctx',
  '        args:',
  '          - serve',
  '          - --enable-shell',
  '        env:',
  '          FASTCTX_TOKEN_BUDGET: "9000"',
  '        failOnStartupError: false',
  '',
].join('\n')

/** A throwaway profile directory, so a write test never touches a real one. */
function tempProfile(seed) {
  const dir = mkdtempSync(join(tmpdir(), 'dpi-test-'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-profile-test', private: true, dsh: { profile: { bundles: [], patchReload: 'live' } } }, null, 2) + '\n')
  writeFileSync(join(dir, 'cordis.patch.yml'), seed)
  return {
    dir,
    runtime: {
      ctx: null,
      config: {},
      profile: { dir, source: 'test', patchPath: join(dir, 'cordis.patch.yml'), manifestPath: join(dir, 'package.json'), rejected: [] },
    },
  }
}

test('applying keeps the file parseable and the existing content intact', { skip: missingParser }, async () => {
  const { dir, runtime } = tempProfile(SEED)
  try {
    const before = readFileSync(runtime.profile.patchPath, 'utf8')
    const input = {
      transport: 'stdio',
      serverName: 'kaptain',
      command: 'npx',
      args: ['-y', '@qunhe/kaptain-mcp@latest'],
      env: [{ name: 'npm_config_registry', value: 'https://registry.npmjs.org/' }],
      url: '',
      headers: [],
    }

    const applied = await applyMcpEntry(input, runtime)
    assert.equal(applied.ok, true, JSON.stringify(applied.errors))
    const after = readFileSync(runtime.profile.patchPath, 'utf8')
    assert.ok(after.includes('# Your patch layer for this dsh profile'), 'the header comment survives')
    assert.ok(after.includes('# 插件集成 managed mcp server: fastctx'), 'the earlier managed entry survives')
    assert.ok(existsSync(runtime.profile.patchPath + '.bak'), 'the previous content is backed up')
    assert.equal(parse(after).length, parse(before).length + 1)
    const row = parse(after).flatMap((entry) => entry.insert ?? []).find((item) => item.config?.serverName === 'kaptain')
    assert.deepEqual(row.config.args, ['-y', '@qunhe/kaptain-mcp@latest'])
    assert.equal(row.config.env.npm_config_registry, 'https://registry.npmjs.org/')

    const edited = await replaceMcpEntry(
      { ...input, original: 'kaptain', serverName: 'kaptain-2', args: ['@qunhe/kaptain-mcp@latest', '--stdio'] },
      runtime,
    )
    assert.equal(edited.ok, true, JSON.stringify(edited.errors))
    const editedText = readFileSync(runtime.profile.patchPath, 'utf8')
    assert.equal(parse(editedText).length, parse(before).length + 1, 'an edit must not change the entry count')
    assert.ok(editedText.includes('# 插件集成 managed mcp server: kaptain-2'), 'the marker follows the rename')
    assert.deepEqual(
      parse(editedText).flatMap((entry) => entry.insert ?? []).find((item) => item.config?.serverName === 'kaptain-2').config.args,
      ['@qunhe/kaptain-mcp@latest', '--stdio'],
    )

    // A rename frees the old name: a substring marker test would refuse this.
    const reused = await applyMcpEntry(input, runtime)
    assert.equal(reused.ok, true, JSON.stringify(reused.errors))
    assert.equal(parse(readFileSync(runtime.profile.patchPath, 'utf8')).length, parse(before).length + 2)

    // The same serverName twice is refused, by config rather than by marker text.
    const duplicate = await applyMcpEntry(input, runtime)
    assert.equal(duplicate.ok, false)
    assert.match(duplicate.errors[0], /已经有 serverName/)
    assert.equal(parse(readFileSync(runtime.profile.patchPath, 'utf8')).length, parse(before).length + 2)

    for (const name of ['kaptain-2', 'kaptain']) {
      const removed = await removeMcpEntry({ serverName: name }, runtime)
      assert.equal(removed.ok, true, JSON.stringify(removed.errors))
    }
    assert.equal(parse(readFileSync(runtime.profile.patchPath, 'utf8')).length, parse(before).length)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a refused render leaves the file byte-identical', { skip: missingParser }, async () => {
  const { dir, runtime } = tempProfile(SEED)
  try {
    const before = readFileSync(runtime.profile.patchPath, 'utf8')
    const refused = await applyMcpEntry({ transport: 'stdio', serverName: 'bad name', command: 'npx', args: [], env: [], url: '', headers: [] }, runtime)
    assert.equal(refused.ok, false)
    assert.equal(readFileSync(runtime.profile.patchPath, 'utf8'), before)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
