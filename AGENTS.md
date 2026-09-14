# Room310 project instructions

- Use semantic `0.0.0` versions with `package.json` as the source of truth.
- After each completed user-facing update, run `npm run version:bump -- auto "<plain-language summary of the update>"` exactly once. The tool selects a patch increment for fixes and small refinements, or a minor increment for meaningful new features and larger changes.
- Do not set or release `1.0.0` unless the user explicitly says Room310 is ready for version 1.0. Only after that approval, use `npm run version:bump -- release --confirm-1.0`.
- Keep the version visible in the Room310 interface. `npm run build` synchronizes the full three-part version into every page's `site-polish.js` URL.
- Never add a scrolling main game page or scrollbar-based game UI.
