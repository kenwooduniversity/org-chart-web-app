# Kenwood platform: data model

One Firebase project (`kenwood-platform`), one Firestore database, one Google sign-in.
Every tool ("module") lives in the same database and shares the same people and roles.

## Platform collections (shared by every module)

| Collection | Doc id | What it holds | Who can write |
|---|---|---|---|
| `members/{email}` | lowercase email | `roles: { <moduleId>: "none"\|"viewer"\|"editor"\|"admin" }`, `platformAdmin`, `disabled`, profile (`displayName`, `photoURL`, `lastSignInAt`) | platform admins; a person may only refresh their own profile fields |
| `modules/{moduleId}` | e.g. `orgchart` | `name`, `description`, `icon`, `path`, `status` (`live`/`planned`/`hidden`), `order`, `defaultRole` | platform admins |
| `divisions/{divisionId}` | e.g. `grants` | `name`, `order`: Kenwood's 11 business functions, as organized in Notion | platform admins |

**Access rules (enforced in `firestore.rules`):**
1. Only verified `@kenwoodusa.org` Google accounts get anything.
2. A person's role in a module is `members/{email}.roles[moduleId]` if set, otherwise the module's `defaultRole`.
3. Platform admins (`platformAdmin: true`, or an owner listed in `owners()` in the rules) are admin on every module.
4. `disabled: true` locks a person out of everything.

The UI mirrors this in `public/assets/platform.js` (`roleFor`), but the rules are what actually protect data.

## Module: org chart (`moduleId: orgchart`)

```
orgchart/main                      { orgTitle }
orgchart/main/positions/{id}       { title, personId, department, reportsTo, responsibilities[], kpis[], manual, x, y }
orgchart/main/people/{id}          { name, affiliation, headshotId }
orgchart/main/departments/{id}     { name, color }
orgchart/main/headshots/{id}       { dataUrl }   ← ≤320px JPEG thumbnail (free plan: no Storage bucket)
orgchart/main/versions/{id}        { label, createdAt, positions[], departments[], people[] }
```

Viewers read; editors change; admins can also import a backup (which replaces the chart).

## How a task-tracker module would fit (not built yet)

Kenwood's Notion shape is **org milestones → division pages → projects → tasks → subtasks**,
with roll-up so finishing a subtask moves progress up the chain. The platform is laid out
so that module can be added without reworking anything:

```
milestones/{id}   { title, targetDate, status, order, progress }                       ← org-wide, top level
projects/{id}     { divisionId, milestoneIds[], title, ownerEmail, status, dueDate,
                    taskCount, doneCount, progress }                                    ← divisionId → divisions/{id}
tasks/{id}        { projectId, divisionId, parentTaskId|null, title, assigneeEmail,
                    status, dueDate, order, done, subtaskCount, subtaskDoneCount }      ← subtasks = tasks with parentTaskId
```

- **Top-level collections, not nested.** "Everything assigned to me across all divisions" and "all Grants tasks" are single queries.
- **Roll-up** = counters on the parent (`doneCount/taskCount`, `subtaskDoneCount/subtaskCount`) updated in the same batched write as the child. A Cloud Function can take this over later if needed (Functions need the Blaze plan).
- **Division pages** = queries filtered by `divisionId`; the division list already exists in `divisions/`.
- **Access**: add `modules/tracker`, then guard the three collections with `canRead('tracker')` / `canWrite('tracker')` in `firestore.rules`. If per-division editing is ever needed, extend the member's roles map (e.g. `roles["tracker:grants"] = "editor"`) and check it in the rules.
- **Links to the org chart**: tasks/projects can reference people by `ownerEmail`/`assigneeEmail` (the same key as `members/`).

## Adding any new module

1. Add a folder under `public/` (e.g. `public/mentoring/index.html`) whose script calls
   `startPage({ moduleId: "mentoring", title: "Mentee Software" })` from `../assets/platform.js`.
2. Store its data in its own top-level collection(s), and add a `match` block to `firestore.rules`
   using `canRead('<moduleId>')` / `canWrite('<moduleId>')`. Add tests to `tests/rules.test.mjs`.
3. On the People & access page, set the tool to **Live** and choose its default role. Set its
   `path` field (e.g. `mentoring/`) in `modules/<moduleId>` so the home-page tile links to it.
