# INTERFACE: Quantum 3D5 as a person meets it

A model of the human interface, for anyone designing a change to it, and for agents who need the
whole interface in one place before touching a part. Counts were taken from the running page;
`docs/USER-GUIDE.md` is the same interface explained for the people who use it.

## Layout

A full-window 3D stage (WebGL, through p5.js) with HTML laid over it:

| Where | What |
|---|---|
| left | the controls: seven feature buttons, then six folding sections (Add Particles, Presets, Simulation, Display, Physics, Realism); a slide-out drawer on phones |
| top centre | the statistics line, and the "What am I looking at?" button below it |
| top right | the entity list |
| bottom left | the readout |
| bottom right | the event log and its four filters |
| floating | the inspector (right-click a particle); panels for the Journal, Lessons, Graphs, Double-Slit, Discoveries and Unknown molecules; dialogs for Help, Glossary, entity information and the tour |

Breakpoints: phones at 720 px and narrower, short landscape screens (900 × 480), touch pointers.

## What a person can operate

- 65 buttons, 31 checkboxes, 8 sliders, 7 number fields and 5 menus.
- 4 dialogs, all modal, all closable with **Esc**.
- 12 named regions.
- Keyboard shortcuts are listed in `docs/ACCESSIBILITY.md`; they are ignored while typing in a
  field, and while a dialog or the tour has the keyboard.
- Pointer and touch: orbit, zoom, pan, inspect, and drag a particle.

## What it teaches with

- **Help:** 13 pages, from "Welcome" to "Realism" and "Try this".
- **Lessons:** 12 scripted lessons that wait for the person to do each step.
- **Study Journal:** 30 concepts, recorded as the person discovers them.
- **Glossary:** every particle, element and molecule. Underlined terms anywhere open it.
- **The page is honest about itself:** the Realism page says what is real, what can be switched,
  and what is still faked.

## Looks

52 design tokens (CSS custom properties) carry the palette. There are two themes. **Dark** is the
default. **Light** is chosen by the Light Mode switch, or follows the system when the person has
not chosen. The 3D stage stays dark in both themes, because particle colours are calibrated
against black. `css/accessibility.css` is the contrast, focus and reduced-motion layer over both
themes.

## Memory

Two things are kept in the browser between visits: the chosen theme (`quantum_theme`) and whether
the tour was taken (`quantum_tour_completed`). Anything else that should last goes in a scene file
the person saves (`docs/SCENE-FORMAT.md`).

## Tensions worth knowing before a change

- **Its own voice.** The page explains itself, in the help pages, the tour, the Realism page and
  comments at the changes. A change that alters behaviour without changing those words leaves the
  page saying something untrue.
- **Visual first.** The stage is visual and pointer-driven; `docs/ACCESSIBILITY.md` lists what that
  leaves out and the order to close it in.
- **Kept on purpose.** Some old behaviours are one switch away (Legacy force signs, Euler
  integration) so a person can compare. Keep them, and keep them labelled.

---
Copyright (C) 2026 Bryant Frankford, Corwin Brust and Contributors. CC BY-SA 4.0.
Mentat (for Corwin, claude-opus-5-5)
