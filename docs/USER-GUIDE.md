# User guide

Quantum 3D5 is a playground for the smallest pieces of matter. This guide walks through the screen,
then each panel, then the things people most often ask. The simulator's own help pages (press
**H**) explain the science; this guide explains the controls.

## The screen

- **The stage** fills the window: a dark 3D space with a faint grid and three coloured axes.
  Particles, atoms and molecules move here.
- **The sidebar** on the left holds every control, in folding sections. On a phone it slides in
  from the ☰ button.
- **The statistics line** at the top shows the frame rate, the counts of particles, nuclei and
  molecules, and the simulated time.
- **"What am I looking at?"**, just below it, opens the help pages.
- **The entity list** at the top right names every atom, ion and molecule on the stage.
- **The event log** at the bottom right reports bonds forming and breaking, decays and captures.
  The checkboxes above it choose which kinds of event it shows.
- **The readout** at the bottom left shows the totals, the field and gravity settings, and the
  average kinetic energy (the simulator's temperature).

## Looking around

| To | Mouse | Touch | Keyboard |
|---|---|---|---|
| Turn the view | drag | one-finger drag | |
| Zoom | scroll | pinch | |
| Slide the view | right-drag | two-finger drag | |
| Inspect a particle | right-click it | long-press it | |
| Reset the camera | | | **R** |

The inspector that opens on a particle shows its type, charge, speed and, for an atom, its full
electron configuration.

## The sidebar, top to bottom

### Things to do

- **Take the Tour:** the short guided walk-through that runs on your first visit.
- **Study Journal:** thirty chemistry and physics concepts. Each one is recorded the first time
  you make it happen on the stage, with a hint for the ones you have not found yet.
- **Guided Lessons:** twelve scripted lessons. Each builds a scene, explains it, and waits for you
  to try the next step. They are: Building an Atom from Scratch; Making Your First Molecule; The
  States of Matter; Ionic vs Covalent Bonding; Brownian Motion; Hydrogen Bonding (Why Ice Floats);
  Radioactive Decay; Why Noble Gases Don't React; Matter Meets Antimatter; Atomic Absorption &
  Emission; The Double-Slit Experiment; How Stars Burn — Fusion.
- **Graphs (G):** live temperature, energy, molecule and nucleus counts, and the distribution of
  particle speeds, drawn against the Maxwell–Boltzmann curve for the current temperature.
- **Double-Slit Demo:** light through two slits, with the wavelength, slit separation, slit width
  and screen distance under your control. The pattern is computed with Fraunhofer diffraction.
- **Discoveries:** unusual or unrecognised molecules the simulation has produced. These are
  pattern-matches against known chemistry, not real discoveries; click a row for its elements.
- **Glossary:** every particle, element and molecule in the simulator, searchable, filterable and
  sortable. Any word with a dotted underline elsewhere opens its entry.

### Add Particles

- **Single particles:** electron, proton, neutron and positron. A positron is the electron's
  antimatter partner, and the two annihilate when they meet.
- **Ions:** Na⁺ and Cl⁻.
- **Atom:** any of the 118 elements. **ΔN** adds neutrons beyond the most common isotope (or, if
  negative, removes them), which is the way to make an unstable nucleus.
- **Molecule:** water, salt, hydrogen, oxygen, nitrogen, carbon dioxide, methane, ammonia, ethane
  and ethene.
- **Random Fill:** a quick mixture to start from.
- **Light:** choose a wavelength (the λ slider shows it in its own colour) and **Shine Light**.
  **Mode** chooses a burst, a beam or a continuous stream; **Auto-emit** keeps shining.

### Presets

Ready-made scenes: H₂ Gas Cloud; Ionic Mix (Na + Cl); Water Cluster; Plasma (hot ions); NaCl
Crystal Lattice; Nucleon Soup (hot). The same six are in `examples/scenes/` as files you can load.

### Simulation

- **Pause (Space)** and **Step (N)**: stop the clock, then move it one tick at a time.
- **📷** resets the camera (**R**); **📸** saves a PNG picture of the stage (**P**). Floating labels
  are drawn over the stage, not in it, so the picture leaves them out.
- **Speed**, also **[** and **]**.
- **Unbreakable Bonds** keeps molecules together however hot they get.
- **Verlet Integration** uses a steadier way of moving particles each tick.
- **Containment Sphere** (on by default) keeps everything inside a sphere of radius 420 with
  springy walls. Without it, loose particles drift out of view and rarely meet.

### Physics

- **Electric field** and **magnetic field:** three components each.
- **Gravity (G):** almost nothing at the scale of atoms, but you can turn it up to see what it
  would do.
- **Target Temp:** the thermostat. High boils and breaks things apart; low lets bonds form and
  crystals hold.
- **Legacy force signs:** the original, incorrect force directions (like charges attract, gravity
  repels), kept so you can compare. Leave it off for physically correct signs.

### Display

The light or dark theme, floating labels, bonds, electron shells, velocity arrows, grid, trails,
colouring by phase, photons and their paths, the wiggle of light, lone pairs, a background tinted
by temperature, and **Color by** type, speed, kinetic energy or charge.

### Realism

Switches for the parts of the physics that can be made more or less real: quantum orbitals, bond
angles, the Morse potential for bonds, photon absorption, the fast path for very quick particles,
hydrogen bonding, radioactive decay, electron tunnelling, and true-scale atoms. The help pages'
Realism page, and [PHYSICS.md](PHYSICS.md), say what each one changes and what is still faked.

## Saving and sharing scenes

**💾 Save Scene** writes the whole stage (every particle, bond, nucleus, the temperature and the
physics settings) to a file named `quantum-scene-` with the date and time. **📂 Load Scene** reads
one back. A scene file is plain JSON, described in [SCENE-FORMAT.md](SCENE-FORMAT.md), so you can
send it to someone else, keep it with your notes, or make one by hand.

## Your settings

The simulator remembers two things in your browser: your theme, and whether you have taken the
tour. Nothing leaves your computer.

## Questions

**It runs slowly.** Thousands of particles are a lot of work. Clear the stage, choose a smaller
preset, or turn off trails and orbitals in Display and Realism.

**Nothing happens when I open the file.** Use a current browser. If your browser blocks local
pages, serve the folder (`python3 -m http.server`) and open the address it prints.

**Is this real physics?** Some of it. It is "cartoon physics": simple rules that capture the big
ideas. [PHYSICS.md](PHYSICS.md) says, rule by rule, how close each one comes.

---
Copyright (C) 2026 Bryant Frankford, Corwin Brust and Contributors. CC BY-SA 4.0.
Mentat (for Corwin, claude-opus-5-5)
