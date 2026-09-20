# Room310 authorized game expansion report

Review date: 2026-09-20

## Outcome

- Published 41 new standalone games into the existing `100+ Games` collection.
- Preserved all 15 previously published games, for 56 public games total.
- Imported 341.83 MiB of reviewed game HTML through authenticated Supabase Storage uploads.
- Verified all 41 database rows against their recorded byte size and SHA-256 hash after publication. There were zero mismatches and zero import skips.
- Restored the original 2048 game's missing cover object after the public smoke test found it. All 56 covers then resolved from private Storage.

## Source and selection

- Authorized source: `single-file.html`, supplied by Shea O'Neil.
- Permission: “I am Shea O'Neil. I authorize Room310 to download and use my game files.”
- Launcher SHA-256: `71f1718326031097adeb8fbe1beb574e64d25fa68e699287b1e9383dd51959d5`.
- The launcher referenced 71 remote ZIP packages. The importer read ZIP directories with range requests and extracted only selected HTML entries, avoiding multi-gigabyte package downloads.
- The first pass considered 150 small, single-player-leaning candidates no larger than 18 MiB. It prepared 116 and rejected 34 before browser review.
- The browser review approved 41 and rejected 75. The exact approved/rejected partition and reasons are recorded in `100-games-expansion-review.json`.

## Published games

Sand Game, Trap the Cat, Opposite Day, Doodle Jump, Bit Planes, Minesweeper, 2048 Cupcakes, Pac-Man, Flappy Bird, Iron Snout, Chess, Bubble Shooter, We Become What We Behold, Run 2, Space Is Key, Duck Life, Run, Flood Runner 2, This Is the Only Level Too, Duck Life 2, Bloxorz, Vex 6, Space Is Key 2, Vex X3M, Time Shooter 3, Papa's Burgeria, Earn to Die, Vex X3M 2, Time Shooter 2, Wheely, Flood Runner 4, Duck Life 5, Angry Birds, Red Ball 4 Vol. 3, Red Ball 4 Vol. 2, Wheely 8, Earn to Die 2, Retro Highway, Stick Merge, Fruit Ninja, and Geometry Dash.

## Rejections

- 34 files failed the static gate: 23 used external scripts, 7 registered service workers, 3 combined cookie access with external scripts, and 1 combined a service worker with an external script.
- 52 browser candidates required blocked same-origin features or missing runtime assets.
- 17 candidates stayed blank or did not reach a usable start screen within the bounded review window.
- 6 candidates were excluded for multiplayer orientation or substantially greater complexity.
- No sandbox permission was relaxed to make a rejected game run.

## Security boundary

- Games execute in an iframe with exactly `sandbox="allow-scripts allow-pointer-lock"` and `allow="fullscreen; gamepad"`.
- The frame does not receive `allow-same-origin`, forms, popups, downloads, or top-level navigation.
- Supplied game HTML is assigned to iframe `srcdoc`; it is never inserted into the Room310 DOM with `innerHTML`.
- Game files remain in the private `game-standalone` bucket. Public players receive a five-minute signed URL only for published, hash-reviewed games in published collections.
- Publishing binds `standalone_reviewed_sha256` to the exact uploaded `source_sha256`; changing the file invalidates the publication gate.
- The malicious-browser probe confirmed that a game could not read or mutate the parent DOM/session, set a Room310 cookie, or navigate the parent page.

Some approved legacy games still attempt ad, save, or telemetry requests. Those requests cannot carry Room310 credentials from the opaque-origin frame. Review accepted only games that reached a usable screen under the production sandbox; save data or legacy ad panels may remain unavailable in some titles.

## Verification

- Import dry run validated every approved file and cover before upload.
- Live import: 41 imported, 0 skipped.
- Anonymous database view: 56 published collection games.
- Anonymous private-Storage test: signed game document returned 200 with the exact recorded byte count.
- Browser checks: collection count and search, normal game route, production sandbox attributes, successful fullscreen entry, desktop and 390x844 mobile layouts, and no game-page scrollbar.
- Node test suite passed before publication; the added expansion-partition test also passed.
- Supabase security advisors reported two pre-existing project warnings unrelated to games: authenticated execution of `consume_study_ai_request()` and disabled leaked-password protection.

## Rollback

The original 15 games were not changed or removed. The rejected candidates were never published. The existing collection architecture and per-game status controls can unpublish any imported game without deleting its source file.
