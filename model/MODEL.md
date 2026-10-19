# MODEL: how Quantum 3D5 is arranged, for agents and maintainers

Read this before changing anything. It says where each thing lives, which promises the code keeps,
how to check that you kept them, and where the open questions are. `FUNCTIONS.md` beside it is the
generated map of every function by section, with line numbers. `INTERFACE.md` describes the
interface as a person meets it.

## In one paragraph

A static web page with no build step and no server. `index.html` holds the markup.
`css/quantum3d5.css` holds the look, with the light theme as overrides under
`html[data-theme="light"]`, and `css/accessibility.css` is a layer on top for contrast, focus and
motion. `js/quantum3d5.js` is the simulator: one classic script in **p5.js global mode**, so its
top-level `let`, `const` and `function` declarations are globals, and p5 calls its `setup()` and
`draw()`. `js/accessibility.js` names the canvases p5 creates. `vendor/p5/p5.min.js` (1.9.0) is
loaded before the simulator. Nothing is fetched from the network.

## The parts of js/quantum3d5.js

The script is in banner-marked sections (see `FUNCTIONS.md`). The ones a change most often
touches:

| Concern | Where (names, not lines: lines move) |
|---|---|
| World state | globals at the top: `particles`, `nuclei`, `molecules`, `photons`, `simTime`, `simTick`, `isPaused`, `targetTemperature`, the feature flags (`useVerletIntegration`, `useMorsePotential`, `useRealOrbitals`, `useNuclearDecay`, ...) |
| One particle | `class Particle` |
| Start-up and the frame loop | `setup()`, `draw()`, `windowResized()` |
| One tick of physics | `advanceSimulation()`, which calls `applyForces()`; `stepOnce()` when paused |
| Nuclei, reactions, molecules | `updateNuclei()`, `handleReactions()`, `updateMolecules()`, run every `NUCLEI_UPDATE_INTERVAL` ticks or when `forceNucleiRefresh` is set |
| Electron shells | the AUFBAU SHELL FILLING section: `shellCountsFor()`, `shellForNextElectron()` |
| Bonds | `getEquilibriumDist()`, `getBondOrder()`, `canFormCovalentBond()`, `getPreferredBondAngle()` |
| Presets | `loadPreset(name)`; the buttons carry `data-preset` |
| Scenes | `serializeSceneToObject()`, `deserializeSceneFromObject()`, `saveSceneToFile()`, `loadSceneFromFile()`; `SCENE_FILE_VERSION` |
| The interface | `initKeyboardShortcuts()`, the tour, `helpPages`, `ACHIEVEMENTS` (the Study Journal), `LESSONS` |
| The event log | `logEvent(message, category)`, `refreshLogBox()`; `logFilters` |

## Promises the code keeps (and the check that holds each one)

| Promise | Held by |
|---|---|
| Runs from disk, offline, with no request to any host | `tests/smoke.py` S2 refuses every http(s) request and counts them |
| Loads with no script error, and the clock runs, pauses and steps | smoke S1, S3, S4 |
| A scene written and read back keeps every particle | smoke S5; `tests/scene_format.py` F2 |
| The scene format is what `docs/SCENE-FORMAT.md` says | `tests/scene_format.py`, a second reader in Python written from the document |
| A loaded scene is untrusted: finite numbers, in-range indexes, element symbols recomputed (they reach `innerHTML`) | `deserializeSceneFromObject()`; `scene_format.py --prove-red` |
| The saved theme, or else the system's, is applied before first paint | smoke S6, S8 |
| WCAG 2.1 AA, both themes, every panel | `tests/accessibility.py` A1 to A5 |
| The one-file build is current and self-contained | `tools/build-single-file.py --check`; smoke run on `dist/quantum3d5.html` |
| This map is current | `tools/function-index.py --check` |

Every check has `--prove-red`: it plants faults in a copy and must catch each one. A check that
cannot fail is not a check.

## Rules for changing it

1. **No network.** Do not add a CDN script, web font, analytics or remote image. Vendor what you
   need into `vendor/` with its licence beside it.
2. **No required build step.** `index.html` must keep running as it stands.
   `dist/quantum3d5.html` is generated; rebuild it, never edit it.
3. **Keep the scene format.** Add only optional keys that older readers ignore (as `cb` was
   added). Anything else is a new `SCENE_FILE_VERSION`, with the reader taught both, and the format
   document and its second reader updated in the same change.
4. **Colour and contrast** belong in the stylesheets. If you add text or a panel, run
   `tests/accessibility.py` in both themes. New panels get `role="region"`, an `aria-label` and a
   level-2 heading; new dialogs get `role="dialog"` and `aria-modal="true"`.
5. **Say what the physics fakes.** If you change a force or a model, update the in-app Realism page
   (`helpPages`) and `docs/PHYSICS.md` together.
6. **Write the change at the change.** The code's habit is a comment where behaviour changed,
   saying what it used to do and why it changed; keep it.
7. **Regenerate** `model/FUNCTIONS.md` and `dist/quantum3d5.html` before you commit.

## Open questions, with what would settle each

- **A scene saved before the first frame.** An earlier reading found that a scene saved before the
  first drawn frame lost its bound electrons on load: the loader trusts the nucleus groups over
  the stored `b` flags. *Settle by:* saving from a fresh page in the test, before any frame, and
  comparing the electron groups.
- **Keyboard camera control** (see `docs/ACCESSIBILITY.md`). *Settle by:* arrow keys to orbit and
  +/− to zoom when the stage has focus, with a smoke check that the camera moved.
- **A spoken summary of the stage.** *Settle by:* a key that announces the counts and the newest
  events through a live region.
- **Light-theme stage.** The 3D stage stays dark in both themes on purpose: particle colours are
  calibrated against black. Any change has to recheck those colours.

---
Copyright (C) 2026 Bryant Frankford, Corwin Brust and Contributors. CC BY-SA 4.0.
Mentat (for Corwin, claude-opus-5-5)
