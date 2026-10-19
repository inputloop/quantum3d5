# Quantum 3D5

**A 3D particle, atom and molecule simulator for learning chemistry and physics in the browser.**

Drop protons, neutrons and electrons into a 3D space and watch what they do. Build any element on
the periodic table, make molecules such as water and methane, heat a salt crystal until it shakes
apart, shine light of a chosen wavelength and see atoms absorb it, or follow a guided lesson that
waits for you to try each step. Everything runs on your own computer: no account, no server and no
network connection.

- **Build:** single particles, whole atoms from the periodic table (with any isotope), ions such
  as Na⁺ and Cl⁻, and ready-made molecules.
- **Experiment:** set the temperature, gravity, and electric and magnetic fields. Bonds form and
  break, nuclei decay, and electrons are excited by light and fall back.
- **Learn:** guided lessons, a Study Journal of the concepts you have tried, a searchable glossary
  of every particle, element and molecule, live graphs (temperature, energy, the speed
  distribution against Maxwell–Boltzmann), and a double-slit wave-optics demonstration.
- **Keep:** save any scene to a file and load it again later, or share it with someone else.
- **Honest:** the simulator says which parts are real physics, which are simplified, and which are
  faked. The in-app Realism page and [docs/PHYSICS.md](docs/PHYSICS.md) list them.

## Start

Open `index.html` in a current browser (Firefox, Chromium, Chrome, Edge or Safari). That is all.

If your browser keeps local pages from saving settings, serve the folder instead:

```sh
python3 -m http.server 8000      # then open http://localhost:8000/
```

On your first visit a short tour shows the main controls. Press **H** at any time for the help
pages.

## Use it

| To | Do |
|---|---|
| Turn the view | drag with the mouse, or one finger |
| Zoom | scroll wheel, or pinch |
| Slide the view | right-drag, or two fingers |
| Look closely at a particle | right-click it, or long-press |
| Pause or run | **Space** |
| Step one tick while paused | **N** or **.** |
| Slow down or speed up | **[** and **]** |
| Reset the camera | **R** |
| Show the graphs, labels, trails | **G**, **L**, **T** |
| Help | **H** or **?** |

The [user guide](docs/USER-GUIDE.md) covers every panel, preset and setting.

## Accessibility

The interface meets **WCAG 2.1 level AA** contrast in both the dark and the light theme. Every
control has a name, keyboard focus is always visible, and the event log and new journal entries
are announced to screen readers. Motion in the interface is reduced when your system asks for it.
The 3D stage itself is visual; [docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md) says what that means,
what was measured, and what is still open.

## Documentation

| For | Read |
|---|---|
| Using the simulator | [docs/USER-GUIDE.md](docs/USER-GUIDE.md) |
| What the physics is, and is not | [docs/PHYSICS.md](docs/PHYSICS.md) |
| Accessibility: the measurements and the limits | [docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md) |
| The scene file format | [docs/SCENE-FORMAT.md](docs/SCENE-FORMAT.md) |
| Contributing | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Working on it with an AI agent | [AGENTS.md](AGENTS.md), [model/](model/) |

## The project

```
index.html            the page
css/quantum3d5.css    the look, dark and light themes
css/accessibility.css contrast, focus and reduced-motion rules
js/quantum3d5.js      the simulator
js/accessibility.js   names for the 3D stage and the graphs
vendor/p5/            p5.js 1.9.0 (LGPL-2.1), kept here so the simulator runs offline
examples/scenes/      the six presets as scene files
docs/                 for people
model/                for agents and maintainers: how the code is arranged and why
tests/                smoke, accessibility and scene-format checks, each with --prove-red
```

## Test

```sh
pip install playwright && python3 -m playwright install chromium
npm install                     # axe-core, for the accessibility check
npm test                        # smoke, accessibility, scene format
npm run prove-red               # each check must catch the faults planted for it
```

Every check opens the page with the network refused, so a passing run also shows the simulator
works offline.

## Licence and credits

The simulator was written by **Bryant Frankford**. The project, its documentation and its tests
are kept by Bryant Frankford and Corwin Brust.

- Code: GNU General Public License, version 3 or (at your option) any later version. See
  [COPYING](COPYING).
- Documentation: Creative Commons Attribution-ShareAlike 4.0.
- p5.js: GNU Lesser General Public License 2.1, see [vendor/p5/LICENSE](vendor/p5/LICENSE).

Part of the collection Corwin Brust and Bryant Frankford keep together at
<https://github.com/inputloop>. See [AUTHORS](AUTHORS) and [CHANGELOG.md](CHANGELOG.md).
