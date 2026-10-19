# p5.js 1.9.0, kept here

The simulator draws with [p5.js](https://p5js.org/), which is free software under the GNU Lesser
General Public License 2.1 ([LICENSE](LICENSE)). This copy is kept in the project so the simulator
runs with no network connection.

| File | From | sha256 |
|---|---|---|
| `p5.min.js` | the `p5@1.9.0` package on npm, `lib/p5.min.js` | `726ac96626b93f5bcaff83a910b6c60d3a9728f063e0eb73b5d0819ffc356915` |
| `LICENSE` | the same package, `license.txt` | |

The minified build is used on purpose: it leaves out p5's Friendly Error System, which checks the
arguments of every p5 call in the render loop and costs a great deal of time with thousands of
particles.

To update it, replace both files from the new package, update this table, and run `npm test`.
