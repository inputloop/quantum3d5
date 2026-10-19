# Changelog

## 1.0.0 (2026-10-19): the project

The simulator as a project of its own, with the same physics and the same scene format.

- **Runs offline.** p5.js 1.9.0 is kept in `vendor/p5/`; nothing is fetched from the network.
- **Arranged for reading.** The page, its two stylesheets and its two scripts are separate files.
  `tools/build-single-file.py` puts them back together as one self-contained file,
  `dist/quantum3d5.html`, for anyone who wants to ship a single page.
- **Accessible.**
  - WCAG 2.1 AA contrast in both themes, on every panel.
  - Labels for every control, names for the stage and the graphs, landmarks and modal dialogs.
  - A visible focus ring everywhere, and reduced motion when the system asks for it.
  - The theme follows the system's light or dark setting until you choose one.
  - The measurements are in `docs/ACCESSIBILITY.md`.
- **Documented.** A user guide, the physics and how far to trust it, the scene format, and a model
  of the code and the interface for maintainers and agents.
- **Tested.** Smoke, accessibility and scene-format checks in a real browser with the network
  refused. Each has a `--prove-red` mode that plants faults it must catch.
- **Examples.** The six presets as scene files in `examples/scenes/`.

## Revision 2 (2026-09-28)

A review pass: bug fixes and a few features. The scene format is unchanged; revision 2 reads and
writes the same files and adds two optional keys that older readers ignore: `cb` (containment on or
off) and, on an excited electron, `xs` and `xw`.

- A containment sphere switch.
- The saved theme is applied before the page is drawn, so the dark interface no longer flashes for
  light-theme users.
- More keyboard shortcuts.
- A comment at each change saying what the code used to do and why it changed.

## Revision 1

The simulator by Bryant Frankford: particles, atoms, ions and molecules in 3D, the Realism
switches, guided lessons, the Study Journal, the glossary, live graphs, the double-slit
demonstration, and scene files.
