# The physics, and how far to trust it

Quantum 3D5 runs **cartoon physics**: simple rules that capture the big ideas of how atoms behave
and leave out the deep details. This page lists the rules, says how each one is computed, and says
plainly where the simulator cheats. The same account, in friendlier words, is on the in-app help
pages (press **H**, then go to the Realism page).

If a chemistry teacher tells you something that disagrees with this simulator, trust the teacher.

## How time moves

Every frame, the simulator adds up the forces on every free particle and moves it one small step.

- **Velocity Verlet integration** is the default (Simulation → Verlet Integration). Each step
  gives a half-kick from the old acceleration, moves the particle, computes the new forces, and
  gives the second half-kick. It conserves energy far better than the older method.
- **Semi-implicit Euler integration**, the simpler path, is what you get with Verlet turned off.
- **Clusters, reactions and molecules** are worked out every few ticks rather than every tick, or
  at once when something changes (an atom added, a decay). This keeps large scenes quick.
- **The clock** shown at the top counts simulated time. It is slow motion, as explained below.

## The forces

| Force | Acts between | What it does here |
|---|---|---|
| Coulomb (electric) | any two charged particles | opposite charges attract, like charges repel; inverse square with distance |
| Strong nuclear | protons and neutrons almost touching | very short reach, very strong: it holds a nucleus together against the protons' repulsion |
| Lennard-Jones (van der Waals) | neutral atoms | a gentle pull at middle distances and a hard push when too close; why gases condense |
| Shell-overlap repulsion | atoms whose electron shells overlap | pushes them apart: why your hand does not go through a table |
| Pauli exclusion (simplified) | electrons in the same shell of one atom | spreads them around the nucleus instead of letting them clump |
| Bonds (Morse potential) | bonded atoms | a hard push when squeezed, a strong pull when slightly stretched, and a pull that fades to nothing when stretched too far, so bonds really break |
| Bond angles (VSEPR) | the bonds of one atom | bends them toward the right angle: water 104.5°, ammonia 107°, methane 109.5°, ethene 120°, CO₂ 180° |
| Hydrogen bonding | an H bonded to O, N or F, and another nearby O, N or F | a weak, directional pull, strongest in a straight O–H···O line; why ice floats |
| Gravity | every particle | off by default; turn it up to see what a strong gravity would do |
| Electric and magnetic fields | charged particles | your own outside push, set in Physics |

Double and triple bonds (O=O, N≡N, O=C=O, C=C in ethene) are shorter and stiffer than single
bonds, and are drawn as two or three lines.

## Temperature

The simulator's temperature is the average kinetic energy of the free particles. A **thermostat**
nudges every particle's speed toward the **Target Temp** every few ticks. High temperatures stretch
and break bonds and knock loose electrons off; low temperatures let bonds form and crystals hold.
The Graphs panel draws the speed distribution against the **Maxwell–Boltzmann** curve for the
current temperature, so you can see how close the gas comes.

## Light

**Shine Light** sends photons of the wavelength you choose. With Photon Absorption on, an electron
lifted to a higher shell falls back and gives off light again. The **Double-Slit Demo** is computed
separately, with Fraunhofer diffraction, from the wavelength, slit separation, slit width and
screen distance you set.

## Nuclei

Which nuclei are stable comes from the real list of stable isotopes, up to bismuth. With
Radioactive Decay on, unstable nuclei fall apart: alpha decay past bismuth (Z > 83), beta-minus
for too many neutrons, and beta-plus for too few (with a positron that annihilates when it meets an
electron). Half-lives are sped up enormously, so uranium-238, whose real half-life is 4.5 billion
years, decays in seconds.

## The Realism switches

| Switch | Default | When it is on |
|---|---|---|
| Quantum Orbitals | on | electrons are placed by sampling s, p and d orbital shapes instead of circling like planets |
| Bond Angle Forces | on | the bending forces above |
| Morse Potential | on | bonds can break as real bonds do, instead of acting as endless springs |
| Photon Absorption | on | light can excite electrons |
| Ballistic Fast-Path | on | an isolated particle (nothing within short range) skips the short-range force loop; long-range Coulomb force and gravity still act on it |
| Hydrogen Bonding | on | the weak N, O, F pull |
| Radioactive Decay | off | unstable nuclei decay |
| Electron Tunneling | off | about 0.2% of the time a bound electron jumps to a place the classical rules forbid |
| True-Scale Atoms | off | nuclei drawn at something nearer their real size, so you see how empty an atom is; the physics is unchanged |

## Still faked

- **Slow motion.** Real electrons move at a large fraction of the speed of light, and molecules
  vibrate trillions of times a second. Even the fastest setting is billions of times slower than
  reality.
- **Force ratios.** The Coulomb force is about 10³⁹ times stronger than gravity. At the real ratio
  gravity would vanish into rounding, so the simulator cheats, which is what makes the gravity
  slider interesting.
- **Electrons as balls.** Electrons are probability waves. The simulator draws balls, and moves
  each one between sampled points to suggest its orbital cloud.
- **No full quantum mechanics.** There is no superposition, entanglement or interference on the
  stage. The tunnelling switch is a cartoon of one effect.
- **Simplified chemistry.** Lone pairs are drawn and shape the bond angles, but are not simulated
  as electrons. There are no hybrid orbitals, resonance, aromaticity, or rotation about single
  bonds.

---
Copyright (C) 2026 Bryant Frankford, Corwin Brust and Contributors. CC BY-SA 4.0.
Mentat (for Corwin, claude-opus-5-5)
