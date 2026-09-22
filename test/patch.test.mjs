/**
 * The bundle patch layer is not free-form YAML: profile boot parses it with
 * `JSON_SCHEMA` plus a `!!js` scalar tag whose text the Loader evaluates later.
 * A patch that uses an expression the harness dialect cannot carry is rejected
 * or silently mis-evaluated at boot — a failure this repository cannot see
 * otherwise, because the file only ever runs inside somebody else's profile.
 *
 * The second test evaluates the duplicate-mount guard against stub entry lists,
 * which is what protects a user who still has the old hand-written
 * `file:` mount line: without it, two enabled rows register the same exact
 * route and the webserver rejects the entry at boot.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PATCH_SOURCE = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

/** `js-yaml` is the same parser the host half uses for its surgical writes. */
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

/** The single row this bundle patch inserts. */
function insertedRow() {
  const parsed = yaml.load(PATCH_SOURCE, { schema: dshSchema() })
  assert.ok(Array.isArray(parsed), 'a profile patch layer must be a top-level YAML array')
  const inserted = []
  for (const entry of parsed) if (entry !== null && typeof entry === 'object' && Array.isArray(entry.insert)) inserted.push(...entry.insert)
  assert.equal(inserted.length, 1, 'this patch layer inserts exactly one row')
  return inserted[0]
}

test('the bundle patch parses under the profile dialect', { skip: missingParser }, () => {
  const row = insertedRow()
  assert.equal(row.id, 'plugin-integration')
  assert.equal(row.name, MANIFEST.name, 'the row must mount this package by its manifest name')
  assert.equal(typeof row.disabled?.__jsExpr, 'string', 'the guard must survive as a `!!js` expression, not a plain string')
})

test('the duplicate-mount guard fires only for another ENABLED row', { skip: missingParser }, () => {
  const row = insertedRow()
  const evaluate = new Function('ctx', 'return (' + row.disabled.__jsExpr + ')')
  const withEntries = (entries) => ({ loader: { entries: () => entries } })
  const entry = (id, name, disabled = false) => ({ options: { id, name }, disabled })

  assert.equal(evaluate(withEntries([])), false, 'alone: the row must stay enabled')

  assert.equal(
    evaluate(withEntries([entry('legacy', 'file:///tmp/dsh-plugin-integration/lib/index.js?v=3')])),
    true,
    'a leftover hand-written file: mount must disable the bundled row',
  )
  assert.equal(
    evaluate(withEntries([entry('aggregate-sidebar', MANIFEST.name)])),
    true,
    'an aggregate bundle mounting the same package by name must disable this row',
  )

  assert.equal(
    evaluate(withEntries([entry('plugin-integration', MANIFEST.name)])),
    false,
    'this row must not disable itself',
  )
  assert.equal(
    evaluate(withEntries([entry('legacy', MANIFEST.name, true)])),
    false,
    'a DISABLED duplicate must not back this row off — it would leave no provider',
  )
})
