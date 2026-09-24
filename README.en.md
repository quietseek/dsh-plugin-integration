# dsh-plugin-integration

**English** · [简体中文](README.md)

A [DSH](https://github.com/deepseek-ai/deepseek-harness) web plugin that puts one page in
**Settings → Plugins → Integration** for the three things a profile is actually made of:
its **plugins**, its **MCP servers**, and its **skills**.

It is a *persistent* plugin (a normal package loaded by `dsh web`), not an in-memory Cordis
experiment: it comes back after a restart.

> The Web UI of this plugin is currently Chinese-only. The host API, configuration and all
> messages on this page are stable; see [Translating the UI](#translating-the-ui).

## Screenshots

**Plugins** — every dependency installed in the profile, with its version, its `dsh`
declarations and each matched Loader row's phase. Uninstall runs the official CLI.

![The Plugins tab](docs/screenshots/01-plugins.png)

**MCP** — mounted servers on top; below, the add/edit form. An entry is validated and
previewed as the exact `cordis.patch.yml` text before anything is written.

![The MCP tab](docs/screenshots/02-mcp.png)

**Skills** — the catalog one agent preset's standing composition sees, with each skill's
source, model/user invocability and body.

![The Skills tab](docs/screenshots/03-skills.png)

## What it does

| Tab | Read | Write |
|---|---|---|
| **Plugins** | Every dependency installed in the profile — the same list `dsh plugin --profile <name> list` prints — with its version, whether it declares `dsh.bundle` / a client half, its matched Loader rows and each row's phase (`pending` / `loading` / `active` / `failed` / `unloading`) | **Uninstall** one, through the official CLI (`dsh plugin --profile <name> remove <pkg>`) so the dependency, the lockfile and `dsh.profile.bundles` all move together |
| **MCP** | Every mounted `mcp-client` row, host plane and preset plane, with transport and target | **Add / edit / remove** an MCP server: the entry is validated, previewed as the exact `cordis.patch.yml` text, then written |
| **Skills** | The skill catalog a given agent preset's standing composition sees, with per-skill source and full body | read-only by design |

Plus one model-visible tool, `plugin_integration_status`, which answers "what's installed /
why isn't this plugin mounted" without opening the UI.

## Requirements

- DSH with a `web` profile (`dsh web`).
- Node.js ≥ 20.
- `dsh` on `PATH` **only** for the uninstall button; everything else works without it
  (see [`dshCommand`](#configuration)).

## Install

```bash
# straight from GitHub
dsh plugin --profile web add github:quietseek/dsh-plugin-integration
```

Then **restart `dsh web`**. A bundle layer joins the plugin tree at startup, so a reload of
the page is not enough for the first install. Open **Settings → Plugins → Integration**.

That is the whole installation: the package declares `dsh.bundle.patch`, so the CLI appends
it to `dsh.profile.bundles` and profile boot merges its own patch layer. No profile file is
edited by hand.

### Already mounting it manually?

Delete the `file:///…/dsh-plugin-integration/lib/index.js?v=N` row from your profile's own
`cordis.patch.yml` **before** installing the bundle. Two enabled rows would both register
the route `/plugin-integration/api`, and a duplicate exact route makes the webserver reject
the entry — which fails the whole plugin tree at boot. The bundled patch carries a guard for
the case where the duplicate exists anyway, and the plugin now skips its own registration
with a warning instead of throwing, but the leftover row is still dead weight.

### Without the CLI (offline / development)

```bash
git clone https://github.com/quietseek/dsh-plugin-integration ~/dsh-plugin-integration
dsh plugin --profile web add file:$HOME/dsh-plugin-integration
```

`file:` / `link:` specs work the same way: the bundle declaration is what puts the package
into `dsh.profile.bundles`.

## Configuration

Add a row with the **same id** to the profile's own `cordis.patch.yml` (it is applied after
every bundle layer, so it overrides the bundled row):

```yaml
- id: plugin-integration
  config:
    profileDir: /home/you/.dsh/profiles/web   # default: auto-detected
    dshCommand: /usr/local/bin/dsh            # default: `dsh` from PATH
    allowRemote: false                        # default: loopback only
```

| Key | Default | Meaning |
|---|---|---|
| `profileDir` | auto-detected | Profile whose patch layer the page may write. Auto-detection tries `ctx.baseUrl`, then the package's own location, and **validates** each candidate against the profile manifest before trusting it. Set this explicitly if the log says the profile could not be located. |
| `dshCommand` | `dsh` | Executable used for `dsh plugin --profile <name> …`. Set it when `dsh` is not on `PATH` (a wheel runtime, a local install, an absolute path). |
| `allowRemote` | `false` | Lifts the loopback-only admission rule. Read the warning below before using it. |

## Security

The page reads and writes the configuration of your Harness, so it is deliberately narrow:

- **Loopback only.** Every request must come from a loopback peer *and* the carrier must not
  be bound to `0.0.0.0`, unless `allowRemote: true`. This matters because the DSH browser
  carrier has **no authentication of its own** (`webServer.host` may be `0.0.0.0`), and a
  non-browser client sends no `Sec-Fetch-Site` header — so a same-origin check alone admits
  `curl`. `GET /plugin-integration/api?action=mcp-detail` returns environment and header
  **values** in clear text (that is the point of the edit form), and `POST …plugin-uninstall`
  runs the package manager.
- **Same-origin only**, in addition (browsers on the same machine are still loopback).
- **Writes are surgical.** The patch layer keeps its comments and existing content; the
  exact text about to be published is re-parsed and the entry count must change by exactly
  one before anything is written; a `.bak` copy precedes an atomic
  temp-file-plus-rename.
- **Only entries this plugin wrote are editable.** Each managed entry carries a
  `# 插件集成 managed mcp server: <name>` marker; hand-written rows are read-only from the
  page and are never touched.
- **Secrets are not rendered** in the list view (`headers` / `env` show key names only).
- **The plugin refuses to uninstall itself**, and refuses any name that is not a dependency
  of the profile.

If you expose the Harness port beyond loopback, put authentication in front of it and treat
this page as a privileged admin surface.

## HTTP contract

Single route, JSON, loopback-only. Generated rows use the `serverName` as their Loader `id`.

| Method | `action` | Purpose |
|---|---|---|
| GET | `snapshot` | Whole page state: plugin rows + counts, preset compositions, MCP list, skill catalog for `preset`, the patch-layer text, client-bundle self-check |
| GET | `skills` | Skill catalog for one preset (`preset=<id>`) |
| GET | `skill` | One skill's body (`preset`, `name`) |
| GET | `mcp-snippet` | Render a `cordis.patch.yml` fragment (repeatable `arg`, `envName`/`envValue`, `headerName`/`headerValue`) |
| GET | `mcp-detail` | One mounted server's full config, **values included**, to prefill the edit form |
| POST | `mcp-apply` | Validate and append a fragment to the patch layer |
| POST | `mcp-replace` | Edit an entry this page wrote (`original` names it; renaming is allowed) |
| POST | `mcp-remove` | Remove an entry this page wrote |
| POST | `plugin-uninstall` | `{"name": "..."}`; `{"name": "...", "dryRun": true}` only checks the CLI channel |

## Local development

```yaml
# the profile's own cordis.patch.yml — hand-written mount, dev only
- insert:
    - id: plugin-integration
      name: 'file:///abs/path/to/dsh-plugin-integration/lib/index.js?v=1'
```

- **`lib/client.js` only** → refresh the browser page (the client scan re-hashes the file).
- **`lib/index.js`** → bump `?v=N` (the Node ESM cache keys on the full URL, so a changed
  query string is a new module) or restart `dsh web`.

`npm test` runs the packaging contract (module id vs package name, bundle declaration,
exports, declared dependencies, "no build step"). `npm run check` syntax-checks both halves.

## Troubleshooting

**The tab doesn't appear.** The client bundle is registered under the *package name*. Check
the page diagnostics (`客户端包 … 未注册到页面图`) and that `package.json` has not been renamed
without editing the `id` in `lib/client.js` — `npm test` asserts they agree.

**"未能定位 profile 目录" / writes are refused.** Auto-detection did not find a directory that
looks like a profile. Set `config.profileDir` explicitly. This guard exists because the old
package-relative guess silently wrote a `cordis.patch.yml` into `node_modules/` (scoped
installs) or `$DSH_HOME/profiles/` (the shared fallback) instead of failing.

**Boot fails with "duplicate exact route".** Two rows mount this plugin; remove the manual
one (see [Already mounting it manually?](#already-mounting-it-manually)).

**Uninstall button reports a spawn failure.** `dsh` is not on `PATH`; set `config.dshCommand`.

**A `dsh.bundle` plugin stays unloaded after uninstalling it.** Bundle layers are composed at
startup — restart `dsh web`. The page tells you this and echoes the CLI output.

## Known limits

- Web profile only (`dsh.client.platform: "web"`, and the host half needs `webServer`).
- Only the patch layer is managed. `dsh.profile.bundles` is not rewritten from the page —
  that changes at startup and belongs to the CLI.
- Skills are a read-only view (catalog and bodies, no add/remove).
- The UI is Chinese-only for now.

### Translating the UI

`lib/client.js` holds every user-facing string in a handful of literals (`PHASE_TEXT`, the
tab labels, the buttons and section titles). DSH ships `@deepseek-ai/dsh-client-locale` for
this; adopting it means adding the package to `dsh.client.inject` and wrapping the literals.
Contributions welcome.

## License

MIT — see [LICENSE](LICENSE).
