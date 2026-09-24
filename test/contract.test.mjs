/**
 * The packaging invariants that break *silently* when this package is renamed,
 * repackaged or moved. Every assertion here corresponds to a real failure mode
 * of the DSH plugin system, not to style:
 *
 * - The browser module id IS the package name. `lib/client.js` registers itself
 *   with `window.__ModuleLoader__.load({ id })`, and the host half looks the
 *   package up in the client graph and in the `/plugins/??<id>/client.js` combo
 *   route by manifest name. Rename the package without touching the client half
 *   and the settings tab simply never appears — with no error anywhere.
 * - `dsh.bundle.patch` is what makes `dsh plugin add` mount the plugin. Without
 *   it the CLI installs a plain dependency and warns; the user then has to
 *   hand-edit their own cordis.patch.yml, which is exactly the setup this
 *   package exists to avoid.
 * - `exports["./client"]` and `exports["./package.json"]` are both required by
 *   the client-module scanner (the first is the bundle, the second is how the
 *   scanner locates the package at all).
 * - `js-yaml` is imported lazily by the host half. An undeclared import still
 *   resolves in practice, because `$DSH_HOME/profiles/node_modules` mirrors the
 *   dsh installation's dependency closure and `dsh` itself depends on js-yaml —
 *   which is exactly the problem: it works by accident, on a path this package
 *   does not control, and fails as a caught error inside every write the day
 *   that closure changes.
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const clientSource = readFileSync(join(ROOT, 'lib/client.js'), 'utf8')
const hostSource = readFileSync(join(ROOT, 'lib/index.js'), 'utf8')
const patchSource = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')

/** Read one path relative to the repository root. */
const at = (relative) => join(ROOT, relative)

test('the browser module id equals the package name', () => {
  const match = /\b__ModuleLoader__\.load\(\{\s*id:\s*'([^']+)'/.exec(clientSource)
  assert.ok(match, 'lib/client.js must register itself via window.__ModuleLoader__.load({ id })')
  assert.equal(match[1], manifest.name, 'lib/client.js id must equal package.json name (it is the browser module id)')
})

test('the host half derives the client id from its own manifest, not a literal', () => {
  assert.match(hostSource, /const SELF = readSelfManifest\(\)/, 'the host half must read its own manifest')
  assert.match(hostSource, /clientPath\(SELF\.name\)/, 'the client-graph lookup must use SELF.name')
})

test('the package is publishable', () => {
  assert.notEqual(manifest.private, true, 'private: true makes the package unpublishable')
  assert.match(manifest.version, /^\d+\.\d+\.\d+/, 'version must be semver')
  assert.equal(manifest.license, 'MIT')
})

test('the bundle declaration points at a real patch layer', () => {
  const patch = manifest.dsh?.bundle?.patch
  assert.ok(typeof patch === 'string', 'dsh.bundle.patch is what makes `dsh plugin add` mount the plugin')
  assert.ok(existsSync(at(patch)), `${String(patch)} must exist`)
  assert.match(patchSource, new RegExp(`name: '${manifest.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`), 'the inserted row must mount this package by name')
  assert.match(patchSource, /id: plugin-integration/, 'the row id must match the README and the duplicate-mount guard')
})

test('the client half is declared and exported', () => {
  assert.equal(manifest.dsh?.client?.platform, 'web', 'the client scanner keys off dsh.client.platform')
  const clientExport = manifest.exports?.['./client']
  const resolved = typeof clientExport === 'string' ? clientExport : clientExport?.default
  assert.ok(typeof resolved === 'string', 'exports["./client"] is how the scanner finds the browser bundle')
  assert.ok(existsSync(at(resolved)), `${String(resolved)} must exist`)
  assert.ok(manifest.exports['./package.json'] !== undefined, 'the scanner resolves <pkg>/package.json')
})

test('the published file list keeps both halves', () => {
  const files = manifest.files ?? []
  for (const required of ['lib/index.js', 'lib/client.js', 'cordis.patch.yml']) {
    assert.ok(files.includes(required), `${required} must be in package.json "files"`)
  }
})

test('every runtime import is a declared dependency', () => {
  const dependencies = manifest.dependencies ?? {}
  assert.ok(dependencies['js-yaml'], 'the host half imports js-yaml at write time')
  assert.match(hostSource, /import\('js-yaml'\)/, 'the check above must track the actual import')
})

test('no build step is required (keeps `dsh plugin add github:…` working)', () => {
  for (const lifecycle of ['preinstall', 'install', 'postinstall', 'prepare', 'prepack']) {
    assert.equal(manifest.scripts?.[lifecycle], undefined, `${lifecycle} would make pnpm gate the install behind allowBuilds`)
  }
})

test('the host half exports a Cordis plugin', async () => {
  const mod = await import('../lib/index.js')
  assert.equal(typeof mod.apply, 'function')
  assert.equal(mod.name, 'plugin-integration')
  assert.deepEqual(mod.inject, ['webServer'])
})

test('every screenshot a README embeds actually exists', () => {
  for (const readme of ['README.md', 'README.en.md']) {
    const source = readFileSync(at(readme), 'utf8')
    const links = [...source.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1])
    assert.ok(links.length > 0, `${readme} should show the UI`)
    for (const link of links) assert.ok(existsSync(at(link)), `${readme} embeds a missing image: ${link}`)
  }
})
