# Accessibility

**Target:** WCAG 2.1 level AA for everything around the 3D stage: the sidebar, panels, dialogs,
lessons, glossary and help, in both the dark and the light theme.

**Measured, on every test run:** `tests/accessibility.py` opens the simulator in both themes,
opens each panel in turn, and checks it with two independent readers. Their results today:

| Check | Result |
|---|---|
| A1 axe-core (Deque), every panel, both themes | no violations |
| A2 contrast of every visible run of text, against every colour stop of the background behind it | all at least 4.5:1 (3:1 for large text) |
| A3 every canvas (the stage and each graph) has a name | yes |
| A4 every form control has a label | yes |
| A5 the keyboard reaches the controls, and each focused control shows a visible ring | yes |

Each check has a planted fault it must catch (`python3 tests/accessibility.py --prove-red`), so a
pass means the check can fail.

## What you can expect

- **Keyboard.** Every button, slider, checkbox and menu is reachable with **Tab** and works with
  **Space** or **Enter**. Focus is always shown by a ring of at least two pixels. Shortcuts:
  **Space** pause, **N** step, **[** and **]** speed, **R** reset the camera, **P** picture,
  **G** graphs, **L** labels, **T** trails, **H** help, **Esc** close the inspector or a dialog.
  The help pages and the tour take **←** and **→** to move between pages.
- **Screen readers.**
  - The page has a title heading, and its regions are named landmarks: the controls, the stage,
    the readout, the entity list, the event log and each panel.
  - The stage is announced as an image with a description, and points to the live statistics
    line.
  - Each graph is named by its caption.
  - The event log, and new Study Journal entries, are announced as they arrive. The statistics
    line, which changes every frame, is not announced.
- **Contrast.** Both themes meet AA. A value whose colour is the information, such as a wavelength
  drawn in its own colour, keeps its colour and sits on a dark plate in the light theme so it
  still reads.
- **Motion.** If your system asks for reduced motion, the interface stops gliding: panels,
  transitions and animations are instant. The simulation itself keeps running; pause it with
  **Space**.
- **Your settings come first.** If you have not chosen a theme, the simulator follows your
  system's light or dark setting. A theme you choose is remembered, and either one is applied
  before the page is drawn, so the light theme never flashes dark.

## What is not yet accessible

- **The 3D stage is visual.** What happens on it is told in words only through the event log, the
  entity list, the statistics and the inspector. A screen-reader user can build scenes and follow
  the events, but cannot yet explore the space itself.
- **The camera needs a pointer.** Rotating, zooming and panning take a mouse or touch; the keyboard
  can only reset the view (**R**).
- **Colour carries meaning on the stage.** Particle types are told apart by colour and size.
  **Color by** offers speed, kinetic energy or charge instead, and floating labels (**L**) name
  every atom and molecule, but there is no pattern or shape coding yet.
- **The double-slit and graph canvases** are named, but their curves are not described in words.

These are the openings, in the order we would take them: keyboard camera control; a spoken
summary of the stage on request; shape coding for particle types; text alternatives for the
graphs.

## What changed to get here

All fixes are in `css/accessibility.css`, `js/accessibility.js` and a handful of attributes in
`index.html`; the simulation code is untouched apart from one heading level.

| Finding (as first measured) | Fix |
|---|---|
| Light theme: about 30 text styles under AA on the main view, some near 1:1 (panel close buttons, captions, the lesson step number, the λ value, preset and scene buttons with dark text on dark gradients) | darker text, or lighter gradients, theme by theme |
| Light theme: help-page headings, glossary section headings and glossary links in the dark theme's pale gold and ice blue, about 1.1:1 | re-coloured for the light theme |
| Both themes: glossary card captions, the tour step counter, buttons with white text on gradients, between 3.0:1 and 4.46:1 | raised to at least 4.5:1 |
| Atom and molecule pickers labelled only by a tooltip | real labels |
| Glossary search and sort unlabelled; glossary list not reachable by keyboard | labelled; list focusable |
| No page heading; content outside landmarks; dialogs not marked modal | a title heading, named regions, `aria-modal` on dialogs |
| Panel headings skipping levels | level 2 throughout |
| Canvases with no name | named as they are created |
| Focus ring only where the browser draws one | a visible ring on every control, in both themes |
| No reduced-motion support | added |

---
Copyright (C) 2026 Bryant Frankford, Corwin Brust and Contributors. CC BY-SA 4.0.
Mentat (for Corwin, claude-opus-5-5)
