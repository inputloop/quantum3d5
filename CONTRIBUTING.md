# Contributing

Thank you. Changes of every size are welcome: a clearer sentence in the help pages, a fix to a
force, a new lesson, or an accessibility improvement from the list in
[docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md).

## Before you start

Read [model/MODEL.md](model/MODEL.md). It explains where everything is, the promises the code
keeps, and the rules for changing it. The short version:

- **Nothing from the network.** Vendor what you need, with its licence.
- **No required build step.** `index.html` keeps working as it stands.
- **The scene format** changes only by optional keys, or by a new version.
- **Say what the physics fakes.** If you change a model, change the Realism help page and
  [docs/PHYSICS.md](docs/PHYSICS.md) with it.

## Check your change

```sh
pip install playwright && python3 -m playwright install chromium
npm install
npm run build        # regenerate dist/quantum3d5.html and model/FUNCTIONS.md
npm test
npm run prove-red    # when you change a test: it must still catch what it is for
```

If you add a check, give it a `--prove-red` plant: a fault it must catch. A check that has never
failed has not shown it can.

## Writing

The project's documents are written for the person using the simulator: plain words, short
sentences, and the reason before the rule. Say what is real and what is simplified.

## Licence

By contributing you agree that your code is released under the GNU General Public License,
version 3 or any later version, and your documentation under Creative Commons
Attribution-ShareAlike 4.0, as the rest of the project is.
