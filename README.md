# Kenwood internal platform

One website for Kenwood's internal leadership and mentee tools, with a single Google sign-in
(`@kenwoodusa.org` accounts only) and a separate Viewer / Editor / Admin role per tool.
The **org chart** is the first tool; mentee software comes next.

- **Backend:** Firebase project `kenwood-platform` (Firestore database + Google sign-in), free Spark plan.
- **Site:** static files in `public/`, published automatically to GitHub Pages on every push to `main`.
- **Security:** `firestore.rules` is what actually protects the data. See [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md).

```
public/
  index.html            home page: one tile per tool
  admin/index.html      People & access (platform admins only)
  orgchart/index.html   org chart (generated, see below)
  assets/platform.js    shared sign-in, roles, top bar; every page uses this
  assets/platform.css   shared look
firestore.rules         who can read/write what (per-tool roles)
docs/DATA_MODEL.md      collections, roles, and how future tools plug in
legacy/                 the original Claude-artifact version of the org chart
tools/migrate_orgchart.py  builds public/orgchart/index.html from the legacy file
tests/                  security-rule tests + browser tests
```

## Going live (one-time)

1. **Publish the security rules.** Firebase console → Firestore Database → **Rules** tab → replace everything
   with the contents of [`firestore.rules`](firestore.rules) → **Publish**.
2. **Allow sign-in from the site's address.** Firebase console → Authentication → **Settings** →
   **Authorized domains** → **Add domain** → `kenwooduniversity.github.io`.
3. Open the site and sign in as `connect@kenwoodusa.org`. The first sign-in by an owner sets up the tools
   and divisions automatically.
4. Open **Org Chart** → **Import from a backup file** → choose the export of the original chart.

## Who can do what

- Any verified `@kenwoodusa.org` account can sign in. By default everyone is a **Viewer** of the org chart.
- **People & access** (top bar → Admin) sets each person's role per tool, makes platform admins, or turns
  someone's access off. You can add people before they ever sign in.
- Owners are listed in two places that must match: `owners()` in `firestore.rules` and `OWNERS` in
  `public/assets/platform.js`.

## Changing the org chart page

`public/orgchart/index.html` is generated from `legacy/orgchart-claude-artifact.html` by
`python3 tools/migrate_orgchart.py`. Edit the page directly from now on if the legacy version is no longer
needed; otherwise make changes in the legacy file and re-run the script.

## Tests

```sh
cd tests && npm install
npm test                 # security rules against the Firestore emulator (needs Java 21)
npm run e2e              # browser test against the Auth + Firestore emulators
FAKE=1 node e2e.mjs      # same browser test against an in-memory stand-in (no Java needed)
```

Running the pages locally (`http://localhost:…`) automatically uses the emulators; add `?live=1` to use the
real project.
