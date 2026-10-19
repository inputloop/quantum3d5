# Scene files (format version 1)

A scene file holds everything on the stage, so it can be saved, loaded, shared or written by hand.
It is one JSON object. The simulator writes it with **💾 Save Scene** and reads it with
**📂 Load Scene**; `tests/scene_format.py` is a second reader, written from this page alone, and
holds the two to agreement.

## An example

```json
{
 "v": 1,
 "p": [["p", 0, 0, 0, 0, 0, 0, {"e": "H"}],
       ["e", 24.5, -3.1, 8, 0.41, 0.02, -0.3, {"b": 1, "ol": 1}]],
 "b": [],
 "n": [[0]],
 "e": [[0, 1]],
 "s": {"T": 0.3, "G": 0, "ef": [0, 0, 0], "bf": [0, 0, 0], "ub": 0, "cb": 1},
 "t": 120,
 "meta": {"savedAt": "2026-10-19T15:00:00.000Z", "particleCount": 2}
}
```

## The keys

| Key | Required | What it holds |
|---|---|---|
| `v` | yes | the format version: `1` |
| `p` | yes | the particles, a list; a particle's index in this list is how the other lists name it |
| `b` | no | bonds |
| `n` | no | nuclei |
| `e` | no | bound-electron groups |
| `s` | no | settings |
| `t` | no | simulated time, in attoseconds (each tick is 0.5 as), rounded |
| `meta` | no | information for people: when it was saved, how many particles; ignored when loading |

### A particle

`[type, x, y, z, vx, vy, vz]`, optionally followed by an `extras` object.

- `type` is `"e"` (electron), `"p"` (proton), `"n"` (neutron) or `"q"` (positron).
- `x`, `y`, `z` are its position and `vx`, `vy`, `vz` its velocity: finite numbers, written to two
  decimal places.
- `extras`, when present, may hold:
  - `e`: the element symbol, at a nucleus' centre (written for people; recomputed on loading
    from the proton count, never trusted);
  - `b`: `1` if the particle is bound;
  - `ol`: its shell, from 1;
  - `x`: `1` if it is an excited electron, with optional `xs` (the shell it was lifted to) and `xw`
    (the wavelength of the photon that lifted it, in nm).

### A bond

`[i, j]` for a single bond between particles `i` and `j` (with `i < j`), `[i, j, 2]` or `[i, j, 3]`
for a double or triple bond, and `[i, j, 0]` for an ionic bond.

### A nucleus, and its electrons

A nucleus is `[centre, member, member, ...]`: the index of the particle at its centre, then the
indexes of the protons and neutrons in it. A bound-electron group is `[centre, electron, ...]`: a
nucleus' centre, then the electrons bound to it.

### Settings

| Key | Meaning | Value |
|---|---|---|
| `T` | target temperature | a number |
| `G` | gravity | a number |
| `ef` | electric field | `[x, y, z]` |
| `bf` | magnetic field | `[x, y, z]` |
| `ub` | unbreakable bonds | `0` or `1` |
| `cb` | containment sphere | `0` or `1`; readers that do not know it ignore it |

## Reading a scene safely

Scene files are shared, so the simulator treats every field as untrusted.

- Numbers must be finite.
- Indexes must be whole numbers that name a particle.
- An invalid particle keeps its place as an empty slot, so the indexes after it still line up.
- Element symbols are recomputed rather than read, because they are shown on the page.

A file of any other version is refused with a message saying which version it holds.

## Examples

`examples/scenes/` holds the six presets as scene files. Load any of them with **📂 Load Scene**.

---
Copyright (C) 2026 Bryant Frankford, Corwin Brust and Contributors. CC BY-SA 4.0.
Mentat (for Corwin, claude-opus-5-5)
