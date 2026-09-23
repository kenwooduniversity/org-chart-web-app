# Kenwood Org Chart (web app)

`orgchart.html` is the source of the Kenwood org chart editor as it currently runs as a
Claude artifact.

**Note:** this version depends on Claude's artifact runtime (`claude.use("db")`,
`claude.use("assets")`, `claude.use("downloads")`). Opened directly or served from GitHub
Pages, it will not load or save data — it is a source backup. The live app is still the
Claude artifact until the Firebase version (first module of the Kenwood internal
platform) replaces it.
