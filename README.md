# Room310

Room310 is an HTML/CSS/JavaScript learning site. Version 0.9.0 introduces a colorful, searchable games library that expands automatically as games and collections are published. It retains assignment-aware Study AI help, linked and hosted games, interactive graphs, the deep learning and PyTorch course, assignment formatting and syntax highlighting, and the existing protected administration tools.

## Versioning

Room310 follows three-part semantic versions and stays below `1.0.0` until the owner explicitly approves the stable release. Run `npm run version:bump -- auto "summary of the update"` after a completed update. Fixes and small refinements increment the patch number (`0.5.0` to `0.5.1`); meaningful new features and larger changes increment the minor number (`0.5.1` to `0.6.0`). `npm run build` synchronizes the full version into the visible site badge and page asset references. Explicit `patch` and `minor` modes are also available when the significance is already known. After the owner specifically declares the site ready for 1.0, `npm run version:bump -- release --confirm-1.0` performs that one protected transition.

## Deep learning course

Open `/deep-learning-study` from Study or the Python course page. Original lessons teach a neuron, loss and gradients, tensors, autograd, a small XOR network, and a held-out evaluation/checkpoint project. They credit Karpathy's build-first progression and link to primary PyTorch references without copying his course.

Lessons 1–2 use existing browser Python cells and the assignment workspace. Lessons 3–6 require actual PyTorch: they provide syntax-colored examples, copy controls, downloadable scripts, and self-contained notebooks opened in Colab or local Python. Those pages deliberately do not mount the ordinary assignment runner, which does not include PyTorch. No new execution service or GPU backend is deployed. Colab is an external service; users save their own copies and are subject to its limits.

`curriculum/deep-learning.mjs` is the teaching source. `node scripts/build-deep-learning.mjs` (also part of `npm run build`) generates pages and scripts plus notebook inputs under `.runtime/`. With PyTorch, nbformat, nbclient, and ipykernel installed in a Python environment, run `python scripts/build-deep-learning-notebooks.py --execute` to regenerate and execute all six notebooks. Commit the resulting `room310files/notebooks/` files; Netlify does not install Python or PyTorch. Tests check code/notebook parity, links, runtime routing, and course coverage. The final synthetic-data classifier uses separate train/validation/test splits, reports measured metrics, and verifies that saved weights reload correctly.

### Local preview

In this checkout, run `npm ci` once and `npm run dev` to build and open a loopback-only server at `http://127.0.0.1:8127/deep-learning-study.html` (open that URL in a browser). Use Ctrl+C to stop it. The preview reuses the existing external sandbox for standard assignment runs; it does not execute arbitrary code on your computer. On localhost, PyTorch buttons use a notebook-download/upload guide so you can test local edits before publishing. On the live site, they open the published notebooks directly in Colab. Admin, games, and graph backend configuration is not part of this course preview.

## Code presentation

All six languages share a locally bundled Prism highlighter, a dark editor palette, and the same monospace font. Editable areas retain their native textareas: typing, selection, copying, undo, drafts, and execution continue to use the original source, not highlighted HTML. The decorative color layer is hidden from assistive technology. Colors update after edits, resets, and language changes, stay aligned while scrolling, and fall back to plain text if highlighting fails or a pasted file is unusually large. Forced-colors mode uses native system text colors.

`client-src/code-tools.js` and `client-src/syntax-utils.js` are the source; `npm run build` regenerates `room310files/code-tools.js` for both production and the optional local Python server. `room310files/code-tools.css` contains the palette and shared code typography. Prism's license is included beside the bundle.

Imported assignment panels now use labeled code blocks instead of tab-padded paragraphs. Starter code and sample output remain separate, with output intentionally uncolored. `scripts/format-assignments.mjs` is an idempotent migration for future legacy imports; its reviewed ASCII-art and outline repairs are in `scripts/assignment-layout-repairs.mjs`. It leaves existing runnable lesson examples intact. The tests cover all six grammars, source preservation and HTML escaping, editor reset/language synchronization, assignment layout, and all twelve original lessons' cell counts.

## Requirements

- Node.js 22 or newer for the Netlify production build
- A Supabase project and Netlify site for production
- Python 3.11 or newer for the optional local learning server
- Java, C++, Node, SQLite, and the project-local .NET runtime only if you use the local lesson compilers

## Netlify and Supabase production setup

The production site is built from `room310files/` into `dist/`. Supabase supplies authentication, the Games database, and private thumbnail/ZIP storage.

1. Install the pinned JavaScript dependencies with `npm ci`.
2. Apply the SQL migrations in `supabase/migrations/` to the Supabase project.
3. In Netlify, add these environment variables for all deploy contexts:

   | Variable | Value |
   | --- | --- |
   | `SUPABASE_URL` | The Supabase project URL |
   | `SUPABASE_PUBLISHABLE_KEY` | An active publishable key (preferred) or legacy anon key |

4. Run `npm run build`. Never put a Supabase secret or `service_role` key in Netlify's frontend build variables.
5. In Supabase Authentication, create the first user with `jacob.bradford.aleo@gmail.com`. The database trigger approves that address as the initial administrator; other new users remain unapproved editors.
6. Open `/admin/login`, sign in, and choose the Games or Graphs management tab. Only published records appear in the public catalogs.

## Room 310 Study AI

Open `/helper` to use Study AI. Helper appears directly between Study and Games in the main navigation, while `/study` remains the course catalog. Existing Supabase sessions are reused; a student without a session can sign in on the Helper page. Any non-anonymous authenticated Supabase user may use the tutor. Manager approval is still required for Games and Graphs administration, but is not required for Study AI.

The browser sends the selected subject and at most the latest 20 in-memory messages to `/api/study`. The Netlify Function verifies the bearer token with Supabase Auth, atomically consumes the user's hourly quota, and only then calls GPT-5 mini through Netlify AI Gateway. The browser cannot select a model and receives no provider or Gateway credential. Responses use streamed NDJSON and render as sanitized Markdown with local KaTeX math support. `store: false` is sent to OpenAI, and Room310 stores no prompts or answers in Supabase.

Production setup:

1. Apply `supabase/migrations/20260912161948_study_ai_rate_limit.sql` along with the other pending migrations. It stores only hourly user IDs and request counts in the private schema; it stores no chat content.
2. If the Supabase project's Data API settings require explicit exposure for new functions, enable `public.consume_study_ai_request` for the Data API. Its SQL privileges still permit only the `authenticated` role, and the function derives the user ID from the verified JWT.
3. Deploy the site to production once on a Netlify credit-based plan. Netlify AI Gateway activates after a production deploy and injects `NETLIFY_AI_GATEWAY_KEY` and `NETLIFY_AI_GATEWAY_URL` into the Function automatically. Keep Netlify AI Features enabled. No OpenAI API key should be added to this project.
4. Check the deploy log for the `/api/study` code-based rate-limit rule. The Function adds a coarse 40 requests per 180 seconds per domain/IP guard; Supabase enforces the primary 30 requests per authenticated user per UTC hour limit.
5. Sign in at `/helper` and send a short test question. A local live-AI test requires `netlify dev` with the directory linked to the already deployed Netlify site so the CLI can supply Gateway variables.

`STUDY_AI_MODEL` is an optional server-side-only override. Leave it unset to use `gpt-5-mini`. Before changing it, confirm that the exact model is supported by Netlify AI Gateway and the OpenAI Responses API. The response cap is 1,600 tokens; questions are limited to 4,000 characters and aggregate recent context to 40,000 characters.

### Assignment Help on coding lessons

Coding lesson pages with a supported Assignment Workspace now show an **Assignment Help** control directly above the workspace launcher. The two panels are mutually exclusive on desktop and mobile: opening either one closes the other. Assignment Help uses the same Supabase session, `/api/study` function, Netlify AI Gateway configuration, GPT-5 mini model, streamed sanitized Markdown renderer, and 30-request hourly user quota as the main Helper page.

`window.Room310AssignmentWorkspace.getContext()` constructs a versioned, text-only context object for the assignment nearest the student's current viewport position. It includes the assignment and lesson titles, instructions, relevant preceding lesson text, starter code, expected/sample output, bounded examples, language, assignment position, and the editor's current code/input/output. It never sends page HTML. The frontend calls this interface again for every question, so edits made in the workspace are included in the next request. Context fields are independently validated and length-limited again in the Netlify Function, leaving a clean interface that can support future assignment types.

Normal Assignment Help responses are forced into a hints-first tutoring mode. When the latest request explicitly asks for the completed current-assignment answer or code, the server returns a confirmation choice before consuming quota or calling the model. The choice token is short-lived, HMAC-signed, tied to the authenticated user, assignment, current code, and exact question, and permits a full solution for only that response. Choosing another hint keeps the no-solution tutor rules. Changing the code or question invalidates the old token.

Assignment Help needs no additional database migration, environment variable, provider key, or model setting beyond the existing Study AI setup. It intentionally does not mount on external-PyTorch lessons because those pages do not use the supported in-browser Assignment Workspace. Chats remain in memory only and disappear when the page closes or reloads.

Hosted ZIPs can be stored privately, but cannot be published until a separate restricted game origin is deployed. This prevents untrusted uploaded JavaScript from sharing the website or admin origin.

The production `/api/run` route is a Netlify Function that validates requests and sends code to Wandbox's sandboxed compilers with snippet saving disabled. If Wandbox has an infrastructure failure, Compiler Explorer executes the request with code-debug storage disabled. Student compile/runtime errors do not trigger a second execution. Each service request is time-limited, and malformed responses always produce JSON errors. This automatic fallback also protects the non-Python lesson cells that share the endpoint.

The backup uses Python 3.12, Java 21, GCC 13.2, .NET 8, V8 JavaScript, and SQLite (via a Python driver in the remote sandbox). V8 backup mode supports ordinary JavaScript and `readline()` input, but not Node.js-specific modules such as `fs` or `require()`. The workspace names the backup runtime in its output. SQL retains the lesson practice tables; query output is capped at 1,000 rows. Free external services do not provide guaranteed availability.

Python lesson cells still run locally in the browser through Pyodide. Do not submit passwords, API keys, or private information to any compiler cell. The workspace's Stop button cancels waiting locally and immediately allows another run; remote execution still ends at the sandbox's time limit. Existing drafts keep the same browser storage keys.

Run `npm test` for unit and regression checks. After `npm run build`, `node tests/browser/workspace.mjs` tests all six languages against real compilers, input, errors, retries, draft persistence, cancellation, and mobile layout. Supply `PLAYWRIGHT_MODULE` if Playwright is not installed locally, and `BASE_URL=https://projectroom310.com` to repeat the checks against production.

## Adding Desmos graphs

1. Sign in at `/admin/login`, then choose the **Graphs** management tab.
2. Open the **How to add a Desmos graph** tutorial, or click **Add graph**.
3. Paste a saved Desmos Graphing Calculator share link (or iframe embed code) and choose **Import graph**. No JavaScript or API key is needed.
4. Review the title, year, description and automatic cover. To replace the cover, select **Custom image** and upload a PNG, JPEG, GIF or WebP up to 5 MB.
5. Save as a draft, or choose **Published** to show the card on `/graphs`. The graph opens at `/graphs/your-graph-slug` on Room310.

The page is hosted by Room310; the interactive calculator is embedded from Desmos and requires an internet connection to Desmos. It is not an offline, self-hosted copy of the Desmos calculator. Student exploration does not overwrite the published graph. The cover is stored privately in Supabase, with public read access only for published graph covers. Re-import and save after editing the original Desmos graph to update its cover.

`/api/graphs/import` requires an authenticated, approved manager. It only fetches saved Desmos calculator links and Desmos preview PNGs, rejects redirects, and enforces download limits. Database RLS separately protects drafts and writes. Graph migrations are in `supabase/migrations/`; the rollback-only database regression test is `supabase/tests/graphs_rls.sql`.

## Optional local Python server

The earlier SQLite backend remains available for local development and for lesson compilers that require installed language runtimes. It is separate from the production Supabase data.

1. Optionally copy `.env.example` to `.env` and edit its non-secret settings.
2. If using `.env`, load it into the current shell before each command:

   ```sh
   set -a
   source .env
   set +a
   ```

3. Create the first approved administrator:

   ```sh
   python3 run_server.py create-admin your-username
   ```

   The password is entered through a hidden terminal prompt and must be at least 12 characters. Passwords are stored as salted scrypt hashes, never as plaintext.

4. Start both the main site and isolated hosted-game server:

   ```sh
   python3 run_server.py
   ```

5. Open:

   - Public site: `http://127.0.0.1:8000/games.html`
   - Games admin: `http://127.0.0.1:8000/admin/games`
   - Isolated game assets: `http://127.0.0.1:8001`

The SQLite schema and private storage folders are created automatically inside `ROOM310_DATA_DIR` (default: `./data`). The `data/` directory and `.env` are ignored by Git.

## Users and approval

Create another account as unapproved by default:

```sh
python3 run_server.py create-user teammate-username
```

Approve it after confirming who owns the account:

```sh
python3 run_server.py approve-user teammate-username
```

Review or revoke access:

```sh
python3 run_server.py list-users
python3 run_server.py revoke-user teammate-username
```

Revoking a user immediately removes their active sessions. Both `admin` and `editor` roles can manage games once approved. Accounts, approvals, and all write authorization are checked server-side.

## Managing games

Sign in at `/admin/games`, then select **Add game**.

### External game

1. Enter the title, description, year, and optional thumbnail.
2. Choose **External URL** and provide an `http://` or `https://` URL.
3. Save as a draft or publish it.

Embedded credentials, non-HTTP protocols, control characters, and malformed URLs are rejected.

### Embedded HTML game

1. Choose **Embedded HTML**.
2. Paste an iframe snippet or a self-contained HTML document containing HTML, CSS, and JavaScript (512 KB maximum).
3. Choose **Preview safely** to run it in the same restricted sandbox used by the public player.
4. Save it as a draft, or choose **Published** to add it to the public Games catalog.

Published embedded games open on the normal Room310 player page at `/games/play/[slug]/`. The saved source is assigned only to a sandboxed iframe's `srcdoc`; it is never assigned to Room310's DOM with `innerHTML`. The frame receives `allow-scripts` and `allow-pointer-lock`, plus the `fullscreen` and `gamepad` feature policy. It does not receive same-origin, top-navigation, popup, download, form-submission, or modal permissions, so the embedded document gets an opaque origin and cannot read Room310 authentication or page state. Published embed source is public data; never include secrets or private information in it.

### Hosted static game

1. Choose **Hosted ZIP bundle**.
2. Upload a ZIP whose root contains `index.html`. A ZIP containing one enclosing folder is also accepted.
3. Add the thumbnail and save. A hosted game cannot be published until its bundle passes validation.

Hosted uploads are limited to 20 MB compressed, 80 MB expanded, and 1,000 files. Only static web asset types are accepted. Absolute paths, `..` traversal, duplicate paths, symlinks, encrypted files, unsupported extensions, and missing entry pages are rejected. Files are stored under `data/game-bundles/[slug]`, never in `room310files`, so an upload cannot overwrite the website.

Replacing a bundle installs the new validated bundle atomically. Deleting a game requires browser confirmation and removes its private thumbnail and bundle.

### Standalone HTML game and native collections

Use **Standalone HTML Game** for a self-contained UTF-8 `.html`/`.htm` file, or a ZIP containing exactly one self-contained HTML file and no other files. The administrator previews the exact file in Room310's opaque-origin sandbox, reviews the static capability scan, and acknowledges that hash before publishing. Files are limited to 30 MB and uploaded resumably to the private `game-standalone` Supabase bucket. Replacing a file changes its SHA-256 hash, clears the review acknowledgement, and returns the game to draft.

The `100+ Games` collection is seeded as a draft by `supabase/migrations/20260914190035_directly_hosted_game_collections.sql`. Its native route is `/games/collections/100-games/`. Public RLS hides both draft collections and their member games; the old external Google Sites game remains published until the collection has at least 15 reviewed, published members. The Collections control in `/admin/games` performs the final cutover transaction and changes external game `55` to draft without deleting it.

The pilot import manifest is `game-imports/100-games-pilot.json`. Add the authorizing member and permission note, place the 15 source files and covers beside the manifest (or pass a separate asset directory), then validate without writing:

```sh
npm run games:import -- game-imports/100-games-pilot.json /path/to/pilot-assets
```

After reviewing the hashes and scan findings, import all records as drafts with an approved manager account. Credentials are read only from the current process environment and are never written to browser code or the repository:

```sh
SUPABASE_URL=https://your-project.supabase.co \
SUPABASE_PUBLISHABLE_KEY=your-publishable-key \
ROOM310_MANAGER_EMAIL=manager@example.com \
ROOM310_MANAGER_PASSWORD='use-a-secure-local-value' \
npm run games:import -- game-imports/100-games-pilot.json /path/to/pilot-assets --apply
```

The import is idempotent by collection/game slug and content hash. It always leaves the collection and games as drafts. Preview, acknowledge, and publish each game from `/admin/games`; publish the collection only after the full pilot passes manual playtesting.

## Hosted-game isolation and limitations

Uploaded ZIP HTML and JavaScript are untrusted. They are served from `ROOM310_ASSET_ORIGIN`, which must be a different origin from `ROOM310_PUBLIC_ORIGIN`, and displayed in a restricted iframe at `/games/play/[slug]/`. Embedded HTML uses an opaque-origin `srcdoc` frame in production; the optional Python server also serves its published embedded document from the existing isolated asset origin. Neither frame receives `allow-same-origin`, top-navigation, downloads, or popup permissions. The asset server has no admin/API routes and sets no cookies.

This hosted option is intentionally for self-contained static games. Its content security policy allows scripts, styles, media, fonts, WebAssembly, and same-asset-origin fetches, but blocks connections to other origins. Games requiring accounts, remote APIs, popups, downloads, server code, or looser browser permissions should be reviewed and hosted externally instead.

Draft bundles and thumbnails are not exposed by public routes. The asset server checks the database publication status on every request.

## Database and backups

SQLite creates `data/room310.sqlite3` plus temporary WAL files while the server runs. Stop the server before copying the database and the `data/game-thumbnails` and `data/game-bundles` folders for a simple consistent backup. Do not publish or serve the `data/` directory as static files.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `ROOM310_HOST` / `ROOM310_PORT` | Main server bind address and port |
| `ROOM310_PUBLIC_ORIGIN` | Exact browser-facing main origin used for origin and frame checks |
| `ROOM310_DATA_DIR` | Private SQLite, thumbnail, and game-bundle storage |
| `ROOM310_ASSET_HOST` / `ROOM310_ASSET_PORT` | Isolated game asset server bind address and port |
| `ROOM310_ASSET_ORIGIN` | Browser-facing asset origin used by sandboxed game frames |
| `ROOM310_SESSION_HOURS` | Login lifetime, clamped to 1-168 hours |
| `ROOM310_SECURE_COOKIES` | Set to `1` behind HTTPS so authentication cookies are Secure |

The Supabase publishable key is intentionally browser-visible and limited by Row Level Security. There are no frontend database passwords, secret keys, default passwords, or hard-coded password credentials.

## Tests

Run the JavaScript unit tests and production build:

```sh
npm test
npm run build
```

Run the legacy local-backend suite:

```sh
python3 -m unittest discover -s tests -v
```

The tests use a temporary database and storage directory. They cover anonymous and unapproved-user rejection, approved-admin CRUD, draft visibility, external URL validation, slug collisions, thumbnail validation, ZIP traversal rejection, hosted upload publication, and published asset access.

## Legacy local-server deployment notes

- Put the main server behind HTTPS and set `ROOM310_SECURE_COOKIES=1`.
- Set `ROOM310_PUBLIC_ORIGIN` to the exact HTTPS site origin.
- Expose the asset server through a separate origin such as `https://games-assets.example.org`; do not proxy it below the main site's domain/path. Set `ROOM310_ASSET_ORIGIN` to that origin.
- Keep `ROOM310_DATA_DIR` on persistent private storage, outside the web root, with backups.
- Run the service as a low-privilege OS account and place upload/storage quotas around the data directory.
- A single Python process is appropriate for a small school/team deployment. For multiple app processes or high traffic, move sessions/metadata to a shared database and bundles to dedicated object storage before scaling out.
- The built-in server does not terminate TLS. Use a maintained reverse proxy for HTTPS, request-size limits, access logs, and rate limiting in an Internet-facing deployment.
