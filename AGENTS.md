# AGENTS.md

Instructions for AI agents working in this repository. People are welcome to read it too.

1. **Read first:**
   - [model/MODEL.md](model/MODEL.md): the arrangement, the promises the code keeps, the rules
     for changing it, and the open questions.
   - [model/FUNCTIONS.md](model/FUNCTIONS.md): every function, by section, with line numbers.
   - [model/INTERFACE.md](model/INTERFACE.md): the interface as a person meets it.
2. **Locate by name, not by line.** `js/quantum3d5.js` is one long script in p5.js global mode.
   Find code by function name in `FUNCTIONS.md`, then read the section it sits in.
3. **Keep the promises.** `npm test` checks every one of them in a real browser with the network
   refused. Run it before you say a change works, and report its output, not your expectation of
   it.
4. **Regenerate, never hand-edit:** `dist/quantum3d5.html` and `model/FUNCTIONS.md`
   (`npm run build`).
5. **Accessibility is not optional.** New text, panels or controls must keep
   `tests/accessibility.py` at 5 of 5 in both themes.
6. **Be honest about the physics.** Any change to a force or a model updates the in-app Realism
   page and `docs/PHYSICS.md` in the same change.
7. **Commit messages** describe the change for a person. Add no tool or vendor advertising
   trailers. If you are crediting an agent's part in the work, use one plain closing line,
   `PERSONA (for PERSON, MODEL)`, for example `Mentat (for Corwin, claude-opus-5-5)`.
