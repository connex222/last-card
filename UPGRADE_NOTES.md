# Last Card interface and resilience upgrade

- Shared `experience.js` provides accessible How to Play and settings on menu, TV and phone, with keyboard Escape/Tab handling.
- 16 cartoon/anime-inspired SVG avatars use new IDs shared by phone, TV and server. Old emoji IDs are replaced. Previously chosen avatars from older browser sessions will use a new default until the player reselects; active rooms should be restarted at deployment.
- Local Manrope and Bodoni Moda fonts plus charcoal, emerald and gold Tailwind theme tokens. `src/input.css` is the source; `public/css/app.css` includes the new overrides for immediate offline use. Run `npm run build:css` when dependencies are available.
- Phone seat resumption now requires a private `resumeToken` returned on join/solo create. Existing previously saved sessions without the token must rejoin after this deployment; live room state is still in memory.
- Preferences are saved per browser in localStorage; optional audio uses Web Audio following user interaction.
- The existing responsive fanned hand and TV animations are retained.

## Limitations

Rooms are still stored in process memory. Server restarts or running multiple instances without a shared Socket.IO adapter/state store will invalidate rooms and connections. Multiplayer across separate homes still requires an accessible hosted server and real devices for final acceptance testing.

## Follow-up phase: accessibility and reconnection

- Screen-reader labels now describe a card colour, value and whether it is playable. The phone clears stale loading state on socket disconnect.
- The end-to-end reconnect test now presents its issued `resumeToken`, matching the server-side ownership check.
- Run `node test/avatars.js` for a zero-dependency avatar integration check.
- The SVGs are generated locally and remain usable without a CDN.
- `npm test` needs installed dependencies for its live-server section; production acceptance still requires real phones and TV.


## Reliability pass — October 2026

- Reconnection join acknowledgements now use an eight-second Socket.IO timeout. Temporary network/server non-responses no longer clear a saved seat. Explicit expired credentials or missing rooms still return players to the join screen.
- Fixed winner-team avatar grouping so the client-side presentation observer retains the group identity after rendering portraits.
- Introduced `npm run test:ui` (dependency-free) for 16-avatar artwork data, server allowlist and entry-page script-order checks. `npm test` runs these before the existing gameplay simulation.
- Syntax validation passed for all server/client JavaScript files. Full dependency-backed simulations and device/browser testing still required before production approval.
- Active game rooms remain in-memory and are not recoverable across server restarts.

## Follow-up hardening — October 2026

- A connected phone socket cannot silently join another room or acquire a second seat. The server rejects the request; leaving and rejoining is required. Existing reconnections use a new socket with the private resume token.
- The phone card fan recalculates when its visible container changes size (device rotation, split-screen resizing, text scaling).
- Keyboard users can move between focused cards with the left and right arrow keys.
- Dependency-free regression checks now cover these safeguards. Live browser and multi-device acceptance still outstanding.

## October 2026 — optional disk-backed room recovery

- Set `STATE_DIR` to a **private, durable filesystem directory** to enable atomic JSON snapshots for each active room. Never set it inside `public/`. For Render, attach a persistent disk and use its mount path. Without `STATE_DIR`, the existing in-memory operation is unchanged.
- Snapshots include private hands, seat recovery tokens and TV host tokens: treat the directory as secret and ensure it is not web-served or checked into source control. It is not encrypted at rest.
- The server restores rooms and re-creates their game engine objects after a restart. Participants must reconnect to resume; timers are restarted on subsequent broadcasts, so special timed modes may resume with revised timing rather than their exact pre-crash deadline.
- This is intended for a **single Node.js instance**, not distributed hosting or zero-downtime rolling handover. Recovery on ephemeral/cleared disks is not possible.
- Live device acceptance testing, timer recovery in Hot Potato/Frenzy, crash-mid-action scenarios and TV rejoin remain **deferred to November**. Do not promise complete seamless recovery until those tests pass.
