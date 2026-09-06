# Room310

Room310 is an HTML/CSS/JavaScript learning site. Version 1.2 cleans up Python and Java assignment layouts and adds consistent syntax highlighting to every course's notebook cells and assignment workspace. It retains the v1.1 Extended Archives notice and v0.9 compiler fixes, and excludes the unpublished admin-request form.

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
2. Apply the SQL migrations in `supabase/migrations/` to the Supabase project. The current Room310 project has already been migrated.
3. In Netlify, add these environment variables for all deploy contexts:

   | Variable | Value |
   | --- | --- |
   | `SUPABASE_URL` | The Supabase project URL |
   | `SUPABASE_PUBLISHABLE_KEY` | An active publishable key (preferred) or legacy anon key |

4. Run `npm run build`. Never put a Supabase secret or `service_role` key in Netlify's frontend build variables.
5. In Supabase Authentication, create the first user with `jacob.bradford.aleo@gmail.com`. The database trigger approves that address as the initial administrator; other new users remain unapproved editors.
6. Open `/admin/login`, sign in, and choose the Games or Graphs management tab. Only published records appear in the public catalogs.

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

### Hosted static game

1. Choose **Hosted ZIP bundle**.
2. Upload a ZIP whose root contains `index.html`. A ZIP containing one enclosing folder is also accepted.
3. Add the thumbnail and save. A hosted game cannot be published until its bundle passes validation.

Hosted uploads are limited to 20 MB compressed, 80 MB expanded, and 1,000 files. Only static web asset types are accepted. Absolute paths, `..` traversal, duplicate paths, symlinks, encrypted files, unsupported extensions, and missing entry pages are rejected. Files are stored under `data/game-bundles/[slug]`, never in `room310files`, so an upload cannot overwrite the website.

Replacing a bundle installs the new validated bundle atomically. Deleting a game requires browser confirmation and removes its private thumbnail and bundle.

## Hosted-game isolation and limitations

Uploaded HTML and JavaScript are untrusted. They are served from `ROOM310_ASSET_ORIGIN`, which must be a different origin from `ROOM310_PUBLIC_ORIGIN`, and displayed in a restricted iframe at `/games/play/[slug]/`. The iframe does not receive `allow-same-origin`, top-navigation, downloads, or popup permissions. The asset server has no admin/API routes and sets no cookies.

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
