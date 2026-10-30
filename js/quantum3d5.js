/* quantum3d5.js -- the simulator: particles, nuclei, molecules and light, drawn with p5.js.
 *
 * Written by Bryant Frankford.
 * Copyright (C) 2026 Bryant Frankford and Contributors.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
        // p5.min.js already omits the Friendly Error System; this keeps it off
        // if someone swaps the unminified build back in for debugging.
        if (typeof p5 !== 'undefined') p5.disableFriendlyErrors = true;

        // --- Global State ---
        let particles = []; let nuclei = []; let molecules = []; let photons = [];
        // The p5 WEBGL canvas. Set in setup(). Input handlers must bind to THIS
        // element: document.querySelector('canvas') returns the first canvas in
        // the DOM, which is the hidden #graphTemp graph, not the 3D view.
        let mainCanvasEl = null;
        // Physics tick counter. Everything that happens "every N ticks" keys off
        // this instead of frameCount, so cadence no longer depends on the speed
        // slider (several ticks per frame at 2-3x) or on Step while paused.
        let simTick = 0;
        // Containment sphere: elastic wall that keeps matter in view.
        let useContainment = true;
        const CONTAINMENT_RADIUS = 420;
        let recentLogsHtml = []; const maxLogLinesHtml = 5;
        let isPaused = false; let unbreakableBonds = false;
        let hoveredEntityType = null;
        // Diagnostic state: when set, the next few calls to updateNuclei() dump
        // cluster info to the console. addMolecule() arms it only when
        // window.QSIM_DEBUG is true (it used to arm on every molecule add, which
        // spammed the console for ~2 s each time). From DevTools, call
        // diagnoseClusters(120). Assigning window._diagnoseNextMoleculeAdd, as
        // this comment used to suggest, never worked: a top-level `let` is not a
        // window property.
        let _diagnoseNextMoleculeAdd = null;
        if (typeof window !== 'undefined') {
            window.diagnoseClusters = function (frames = 120) {
                _diagnoseNextMoleculeAdd = { key: 'manual', framesRemaining: frames,
                    startFrame: (typeof frameCount !== 'undefined' ? frameCount : 0), logEveryNFrames: 10 };
                return 'Cluster diagnostics armed for ' + frames + ' updates.';
            };
        }
        // Track molecule labels that have already been flagged as missing from
        // the info database, along with their element composition. Map<label, {H:1, O:1}>
        // so we warn only once per unique label per page load, and so the
        // unknown-panel UI can display composition alongside the label.
        const reportedUnknownLabels = new Map();
        // Panel visibility state. Hidden until the first unknown label shows up
        // (an empty warning panel was clutter on top of the stats bubble area).
        // If the user closes it, it stays closed until they reopen it.
        let unknownPanelVisible = false;
        let unknownPanelUserHidden = false;
        // Console helper: call listUnknownMolecules() in DevTools to see every
        // label that's been flagged this session.
        if (typeof window !== 'undefined') {
            window.listUnknownMolecules = function () {
                if (reportedUnknownLabels.size === 0) {
                    console.log('No unknown molecule labels reported yet.');
                } else {
                    console.log('Unknown labels flagged this session (send to Claude):');
                    for (const [label, comp] of reportedUnknownLabels) {
                        console.log('  ' + label + '  ' + JSON.stringify(comp));
                    }
                }
                return [...reportedUnknownLabels.keys()];
            };
        }

        // --- UI / Display State ---
        let showLabels = true;
        let showBonds = true;
        let showShells = true;
        let showVelocity = true;
        let showGrid = true;
        let showTrails = false;
        let showPhotons = true;
        // Traveling photons: real particles of light with position, velocity,
        // wavelength, and polarization. See spawnTravelingPhoton() and
        // updatePhotons(). Photons do NOT yet interact with atoms (Step 2);
        // for now this is a visualization upgrade that honestly shows
        // wavelength/color/polarization but does not claim wave behavior.
        let useTravelingPhotons = true;
        // Show the sinusoidal wiggle along a photon's polarization axis. When
        // off, photons render as simple small dots. When on, you see the
        // wavelength visually as a spatial sine wave.
        let showPhotonWiggle = true;
        // Continuous/auto-emit mode state
        let continuousLight = false;           // master toggle for auto-emit
        let shineMode = 'burst';               // 'burst' | 'beam' | 'continuous'
        let currentShineWavelength = 532;      // track slider value
        const CONTINUOUS_EMIT_INTERVAL = 30;   // frames between auto-emit pops
        let useVerletIntegration = true;
        let simSpeed = 1.0;          // time-scale multiplier

        // --- Realism feature toggles ---
        let useRealOrbitals = true;      // Shaped probability clouds for s/p/d electrons
        let useAngleBending = true;      // Bond angle restoring forces
        let useMorsePotential = true;    // Morse-style bond potential (anharmonic)
        let useNuclearDecay = false;     // Alpha and beta- decay for unstable nuclei
        let useTunneling = false;        // Rare position jumps for bound electrons
        let useTrueScale = false;        // Real atom:nucleus size ratio (nucleus ~100,000x smaller)
        let useHydrogenBonding = true;   // Directional H...O/N/F attraction (now geometric)
        let magneticField = { x: 0, y: 0, z: 0 }; // Magnetic field vector for Lorentz force

        // --- Ballistic fast-path ---
        // "Things just roll, they don't check." Isolated particles (no neighbors
        // within range) skip the pairwise force loop entirely. See applyForces().
        // Toggle via the "Ballistic Fast-Path" checkbox in the Realism section.
        let useBallisticFastPath = true;
        let lastBallisticCount = 0;   // diagnostics: how many particles took fast path last tick
        let lastActiveCount = 0;      // diagnostics: how many went through pairwise loop

        // --- Display mode state ---
        let particleColorMode = 'type'; // 'type' | 'speed' | 'ke' | 'charge'
        let showLonePairs = false;
        let tempTintBg = false;
        // Phase coloring: tints each nucleus a subtle color based on its
        // computed phase (solid/liquid/gas/plasma). On by default so users see
        // the water-cools-to-blue-ice effect without hunting for a toggle.
        let showPhaseColoring = true;

        // --- Inspector / picking / dragging state ---
        let inspectedParticle = null;
        let draggingParticle = null;
        let dragPlaneZ = 0;              // World-space depth used for drag plane
        let lastMouseIsDown = false;

        // --- Graphs state ---
        let graphsOpen = false;
        const GRAPH_HISTORY = 300;       // Samples to keep
        const graphData = {
            temp: [],
            energy: [],
            molecules: [],
            nuclei: [],
            // Rolling buffer of particle speeds used to draw the Maxwell–Boltzmann
            // histogram. Populated once every ~6 frames, same throttle as other graphs.
            speedSamples: []
        };

        // --- Simulated time (cartoon calibration) ---
        // Each call to advanceSimulation() represents ~0.5 attoseconds of simulated
        // time. Rationale: an electron orbital period in the sim takes roughly 200
        // ticks to complete, and the real-world orbital period is ~100 attoseconds,
        // so ~0.5 as/tick is a sensible cartoon calibration. This is NOT physically
        // accurate — real physics happens over a huge range of timescales, and a
        // fixed tick size can't capture all of it. But it gives users a sense of
        // scale: 1 femtosecond of sim time = ~2,000 ticks = a few seconds of real
        // viewing at 60 fps. Resets on "Clear All".
        const SIM_TIME_PER_TICK_AS = 0.5;   // attoseconds per advanceSimulation() call
        let simTime = 0;                    // current simulated time, in attoseconds

        // --- Log filters ---
        const logFilters = { bonds: true, decay: true, binding: true, other: true };
        let labelLayerElement = null;
        let statsBubbleElement = null;
        const labelPool = [];        // Reusable DOM nodes for floating labels
        let fpsHistory = [];         // Rolling FPS average
        const MAX_TRAIL_LENGTH = 25; // How many past positions to remember per particle
        let trailFrame = 0;          // Used to throttle trail recording

        // --- Spatial partitioning (uniform grid) for O(N) neighbor queries ---
        // Cell size = the SHORT-RANGE reach the grid guarantees (a ±1-cell search
        // always finds every pair within one cell width). 132 covers the full LJ
        // cutoff (3σ ≈ 132) for period-1/2 atoms (H, C, N, O, F...), which are the
        // overwhelmingly common case. Long-range Coulomb and gravity are NOT
        // grid-limited any more — they get exact dedicated passes in applyForces().
        const GRID_CELL_SIZE = 132;
        let spatialGrid = new Map(); // key "gx,gy,gz" -> array of particles

        // --- Physics Constants ---
        const k = 85;
        const minInteractionDistSq = 10 * 10;
        const maxInteractionDistSq = 500 * 500;
        const damping = 0.995; // Slightly less aggressive so thermostat can do its job
        const nuclearForceRangeSq = 14 * 14; // Extended so protons/neutrons can actually find each other
        const nuclearForceStrength = 2.5;
        const nucleonRepulsionStrength = 1.2;
        const nuclearHardCoreSq = 6 * 6; // Short-range repulsion to prevent overlap collapse
        const bohrRadius = 20;
        const orbitalSpeed = 0.04;
        const bindingDistanceThreshold = bohrRadius * 1.8;
        const bindingVelocityThresholdSq = 1.8 * 1.8;
        const shellCapacities = [2, 8, 18, 32, 32, 18, 8];
        let G = 0;
        let electricField = { x: 0, y: 0, z: 0 };
        const K_shell = 2.0;
        // Ionic (Na-Cl) bond length = the ions' contact distance: the average of
        // their outer-shell radii, (44 + 72) / 2 = 58, the same "contact" rule
        // the Lennard-Jones sigma uses for neutral atoms. It was 44 while the
        // shell-overlap repulsion kept Na+ and Cl- apart until r1 + r2 = 116, so
        // ions could never get within the old 50-unit reaction distance (the
        // Ionic Mix preset formed no NaCl) and the crystal preset, spaced at 48,
        // started deep in overlap and blew apart.
        const equilibriumBondDist_NaCl = bohrRadius * 2.9;
        const reactionDistSq = (equilibriumBondDist_NaCl * 1.2) ** 2;
        const bindingEnergySq = 2.0 * 2.0;
        const reactionProbability = 0.1;
        const bondForceConstant = 1.5;
        const dissociationProbability = 0.0005;
        const reactionProbability_covalent = 0.08;
        const dissociationProbability_covalent = 0.0002;
        const bondForceConstant_covalent = 2.0;
        const equilibriumBondDist = { default: bohrRadius * 1.8, 'H-H': bohrRadius * 1.4, 'C-H': bohrRadius * 1.7, 'O-H': bohrRadius * 1.6, 'C-C': bohrRadius * 2.2, 'C=C': bohrRadius * 2.0, 'C-O': bohrRadius * 2.1, 'C=O': bohrRadius * 1.9, 'N-H': bohrRadius * 1.65 };
        const LJ_epsilon = 0.8;
        const LJ_sigma_scale = 1.0;
        const LJ_cutoff_scale = 3.0;
        const neutrality_tolerance = 0.1;
        let targetTemperature = 0.3;
        const thermostatStrength = 0.1;
        const thermostatFrequency = 3;
        const MAX_PARTICLES = 4000; // Safety cap to prevent browser lockup
        // Pauli exclusion approximation: mild repulsion between bound electrons
        // on the same nucleus, so they spread around the shell rather than clumping.
        const pauliRepulsionStrength = 0.6;
        // Bond dissociates if stretched beyond this multiple of equilibrium distance.
        // Replaces pure stochastic breaking with temperature-coupled breaking.
        const bondBreakStretchRatio = 2.4;
        // Coulomb cutoff radius (uses shifted-force method for smooth falloff).
        const coulombCutoff = 400;
        const coulombCutoffSq = coulombCutoff * coulombCutoff;
        // --- Force-sign convention -----------------------------------------
        // The original engine applied Coulomb, gravity, and Lennard-Jones with
        // inverted directions (like charges attracted, gravity repelled for
        // G > 0, and "van der Waals" pulled neutral atoms into overlap until
        // chemistry intercepted the collapse). Corrected signs are now the
        // default; the "Legacy force signs" checkbox in the Physics panel
        // restores the old behavior if you preferred its feel.
        let useLegacyForceSigns = false;
        // Reach guaranteed by the spatial grid (one cell + ±1-cell search).
        // Short-range terms (nuclear, LJ, shell overlap, contact) are clamped
        // to this distance in BOTH the brute-force and grid paths, so physics
        // no longer changes discontinuously when crossing GRID_THRESHOLD.
        const SHORT_RANGE_CUTOFF_SQ = GRID_CELL_SIZE * GRID_CELL_SIZE;
        // Exact long-range passes are O(n²) over small subsets. Above these
        // counts we fall back to grid-reach-limited forces for that tick
        // (graceful degradation instead of a frame-time cliff).
        const EXACT_COULOMB_MAX = 350;   // max charged particles for exact pass
        const EXACT_GRAVITY_MAX = 350;   // max active particles for exact pass
        // Per-tick switches read by calculateInteraction(). applyForces() sets
        // them before each pair sweep so the brute path computes everything
        // in-pair while the grid path delegates long-range terms to the exact
        // passes (avoiding double counting).
        let PAIR_RANGE_GATE_SQ = maxInteractionDistSq;
        let PAIR_DO_COULOMB = true;
        let PAIR_DO_GRAVITY = true;
        let logBoxElement; let entityListElement;

        // --- Element Data ---
        const elementNames = { 1:"H", 2:"He", 3:"Li", 4:"Be", 5:"B", 6:"C", 7:"N", 8:"O", 9:"F", 10:"Ne", 11:"Na", 12:"Mg", 13:"Al", 14:"Si", 15:"P", 16:"S", 17:"Cl", 18:"Ar", 19:"K", 20:"Ca", 21:"Sc", 22:"Ti", 23:"V", 24:"Cr", 25:"Mn", 26:"Fe", 27:"Co", 28:"Ni", 29:"Cu", 30:"Zn", 31:"Ga", 32:"Ge", 33:"As", 34:"Se", 35:"Br", 36:"Kr", 37:"Rb", 38:"Sr", 39:"Y", 40:"Zr", 41:"Nb", 42:"Mo", 43:"Tc", 44:"Ru", 45:"Rh", 46:"Pd", 47:"Ag", 48:"Cd", 49:"In", 50:"Sn", 51:"Sb", 52:"Te", 53:"I", 54:"Xe", 55:"Cs", 56:"Ba", 57:"La", 58:"Ce", 59:"Pr", 60:"Nd", 61:"Pm", 62:"Sm", 63:"Eu", 64:"Gd", 65:"Tb", 66:"Dy", 67:"Ho", 68:"Er", 69:"Tm", 70:"Yb", 71:"Lu", 72:"Hf", 73:"Ta", 74:"W", 75:"Re", 76:"Os", 77:"Ir", 78:"Pt", 79:"Au", 80:"Hg", 81:"Tl", 82:"Pb", 83:"Bi", 84:"Po", 85:"At", 86:"Rn", 87:"Fr", 88:"Ra", 89:"Ac", 90:"Th", 91:"Pa", 92:"U", 93:"Np", 94:"Pu", 95:"Am", 96:"Cm", 97:"Bk", 98:"Cf", 99:"Es", 100:"Fm", 101:"Md", 102:"No", 103:"Lr", 104:"Rf", 105:"Db", 106:"Sg", 107:"Bh", 108:"Hs", 109:"Mt", 110:"Ds", 111:"Rg", 112:"Cn", 113:"Nh", 114:"Fl", 115:"Mc", 116:"Lv", 117:"Ts", 118:"Og" };
        // Default neutron counts = the most abundant isotope (or the longest-lived
        // one for elements with no stable isotope). 18 entries were corrected in
        // revision 2: they had been round(atomic weight) - Z, which picked
        // radioactive isotopes for Zn-65, Se-79, Te-127, Re-186, Os-191, Ir-192
        // and minor isotopes for Ge, Zr, Ru, Cd, Sn, Xe, Ba, Nd, Er, Yb, Hf, Hg.
        const atomConfigs = { hydrogen: { p: 1, n: 0, e: 1 }, helium: { p: 2, n: 2, e: 2 }, lithium: { p: 3, n: 4, e: 3 }, beryllium: { p: 4, n: 5, e: 4 }, boron: { p: 5, n: 6, e: 5 }, carbon: { p: 6, n: 6, e: 6 }, nitrogen: { p: 7, n: 7, e: 7 }, oxygen: { p: 8, n: 8, e: 8 }, fluorine: { p: 9, n: 10, e: 9 }, neon: { p: 10, n: 10, e: 10 }, sodium: { p: 11, n: 12, e: 11 }, magnesium: { p: 12, n: 12, e: 12 }, aluminum: { p: 13, n: 14, e: 13 }, silicon: { p: 14, n: 14, e: 14 }, phosphorus:{ p: 15, n: 16, e: 15 }, sulfur:    { p: 16, n: 16, e: 16 }, chlorine:  { p: 17, n: 18, e: 17 }, argon:     { p: 18, n: 22, e: 18 }, potassium: { p: 19, n: 20, e: 19 }, calcium:   { p: 20, n: 20, e: 20 }, scandium:  { p: 21, n: 24, e: 21 }, titanium:  { p: 22, n: 26, e: 22 }, vanadium:  { p: 23, n: 28, e: 23 }, chromium:  { p: 24, n: 28, e: 24 }, manganese: { p: 25, n: 30, e: 25 }, iron:      { p: 26, n: 30, e: 26 }, cobalt:    { p: 27, n: 32, e: 27 }, nickel:    { p: 28, n: 30, e: 28 }, copper:    { p: 29, n: 34, e: 29 }, zinc:      { p: 30, n: 34, e: 30 }, gallium:   { p: 31, n: 38, e: 31 }, germanium: { p: 32, n: 42, e: 32 }, arsenic:   { p: 33, n: 42, e: 33 }, selenium:  { p: 34, n: 46, e: 34 }, bromine:   { p: 35, n: 44, e: 35 }, krypton:   { p: 36, n: 48, e: 36 }, rubidium:  { p: 37, n: 48, e: 37 }, strontium: { p: 38, n: 50, e: 38 }, yttrium:   { p: 39, n: 50, e: 39 }, zirconium: { p: 40, n: 50, e: 40 }, niobium:   { p: 41, n: 52, e: 41 }, molybdenum:{ p: 42, n: 56, e: 42 }, technetium:{ p: 43, n: 55, e: 43 }, ruthenium: { p: 44, n: 58, e: 44 }, rhodium:   { p: 45, n: 58, e: 45 }, palladium: { p: 46, n: 60, e: 46 }, silver:    { p: 47, n: 60, e: 47 }, cadmium:   { p: 48, n: 66, e: 48 }, indium:    { p: 49, n: 66, e: 49 }, tin:       { p: 50, n: 70, e: 50 }, antimony:  { p: 51, n: 70, e: 51 }, tellurium: { p: 52, n: 78, e: 52 }, iodine:    { p: 53, n: 74, e: 53 }, xenon:     { p: 54, n: 78, e: 54 }, cesium:    { p: 55, n: 78, e: 55 }, barium:    { p: 56, n: 82, e: 56 }, lanthanum: { p: 57, n: 82, e: 57 }, cerium:    { p: 58, n: 82, e: 58 }, praseodymium:{ p: 59, n: 82, e: 59 }, neodymium: { p: 60, n: 82, e: 60 }, promethium:{ p: 61, n: 84, e: 61 }, samarium:  { p: 62, n: 90, e: 62 }, europium:  { p: 63, n: 90, e: 63 }, gadolinium:{ p: 64, n: 94, e: 64 }, terbium:   { p: 65, n: 94, e: 65 }, dysprosium:{ p: 66, n: 98, e: 66 }, holmium:   { p: 67, n: 98, e: 67 }, erbium:    { p: 68, n: 98, e: 68 }, thulium:   { p: 69, n: 100, e: 69 }, ytterbium: { p: 70, n: 104, e: 70 }, lutetium:  { p: 71, n: 104, e: 71 }, hafnium:   { p: 72, n: 108, e: 72 }, tantalum:  { p: 73, n: 108, e: 73 }, tungsten:  { p: 74, n: 110, e: 74 }, rhenium:   { p: 75, n: 112, e: 75 }, osmium:    { p: 76, n: 116, e: 76 }, iridium:   { p: 77, n: 116, e: 77 }, platinum:  { p: 78, n: 117, e: 78 }, gold:      { p: 79, n: 118, e: 79 }, mercury:   { p: 80, n: 122, e: 80 }, thallium:  { p: 81, n: 124, e: 81 }, lead:      { p: 82, n: 126, e: 82 }, bismuth:   { p: 83, n: 126, e: 83 }, polonium:  { p: 84, n: 125, e: 84 }, astatine:  { p: 85, n: 125, e: 85 }, radon:     { p: 86, n: 136, e: 86 }, francium:  { p: 87, n: 136, e: 87 }, radium:    { p: 88, n: 138, e: 88 }, actinium:  { p: 89, n: 138, e: 89 }, thorium:   { p: 90, n: 142, e: 90 }, protactinium:{ p: 91, n: 140, e: 91 }, uranium:   { p: 92, n: 146, e: 92 }, neptunium: { p: 93, n: 144, e: 93 }, plutonium: { p: 94, n: 150, e: 94 }, americium: { p: 95, n: 148, e: 95 }, curium:    { p: 96, n: 151, e: 96 }, berkelium: { p: 97, n: 150, e: 97 }, californium:{ p: 98, n: 153, e: 98 }, einsteinium:{ p: 99, n: 153, e: 99 }, fermium:   { p: 100, n: 157, e: 100 }, mendelevium:{ p: 101, n: 157, e: 101 }, nobelium:  { p: 102, n: 157, e: 102 }, lawrencium:{ p: 103, n: 159, e: 103 }, rutherfordium:{ p: 104, n: 161, e: 104 }, dubnium:   { p: 105, n: 163, e: 105 }, seaborgium:{ p: 106, n: 165, e: 106 }, bohrium:   { p: 107, n: 164, e: 107 }, hassium:   { p: 108, n: 169, e: 108 }, meitnerium:{ p: 109, n: 169, e: 109 }, darmstadtium:{ p: 110, n: 171, e: 110 }, roentgenium:{ p: 111, n: 171, e: 111 }, copernicium:{ p: 112, n: 173, e: 112 }, nihonium:  { p: 113, n: 171, e: 113 }, flerovium: { p: 114, n: 175, e: 114 }, moscovium: { p: 115, n: 174, e: 115 }, livermorium:{ p: 116, n: 177, e: 116 }, tennessine:{ p: 117, n: 177, e: 117 }, oganesson: { p: 118, n: 176, e: 118 } };
        const properties = { electron: { charge: -1, mass: 0.05, color: [100, 150, 255], radius: 3 }, proton: { charge: 1, mass: 1.0, color: [255, 80, 80], radius: 5 }, neutron: { charge: 0, mass: 1.01,color: [150, 150, 150], radius: 5 }, positron: { charge: 1, mass: 0.05, color: [255, 130, 220], radius: 3 } };

        // Element symbol -> atomConfigs key ('H' -> 'hydrogen'). The guided-lesson
        // API passes symbols, but atomConfigs is keyed by lowercase names, so
        // api.addAtom('H') used to look up 'h' and add nothing.
        const SYMBOL_TO_TYPE = (() => {
            const m = {};
            for (const [type, cfg] of Object.entries(atomConfigs)) {
                const sym = elementNames[cfg.p];
                if (sym) m[sym] = type;
            }
            return m;
        })();
        function resolveAtomType(nameOrSymbol) {
            if (!nameOrSymbol) return null;
            const s = String(nameOrSymbol).trim();
            if (atomConfigs[s.toLowerCase()]) return s.toLowerCase();
            if (SYMBOL_TO_TYPE[s]) return SYMBOL_TO_TYPE[s];
            const cap = s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
            return SYMBOL_TO_TYPE[cap] || null;
        }

        // =====================================================================
        //  AUFBAU SHELL FILLING
        // =====================================================================
        // Electrons per shell for an atom (or isoelectronic ion) holding `count`
        // electrons, following the Madelung (n + l) order plus the well-known
        // ground-state exceptions. Shells used to fill strictly in order
        // (2, 8, 18, 32...), which gave potassium 2-8-9 instead of 2-8-8-1 and
        // iron 2-8-16 instead of 2-8-14-2.
        const MADELUNG_ORDER = [[1,0],[2,0],[2,1],[3,0],[3,1],[4,0],[3,2],[4,1],[5,0],[4,2],[5,1],[6,0],[4,3],[5,2],[6,1],[7,0],[5,3],[6,2],[7,1]];
        const AUFBAU_EXCEPTIONS = {   // electrons per shell, ground state
            24: [2,8,13,1], 29: [2,8,18,1], 41: [2,8,18,12,1], 42: [2,8,18,13,1],
            44: [2,8,18,15,1], 45: [2,8,18,16,1], 46: [2,8,18,18], 47: [2,8,18,18,1],
            57: [2,8,18,18,9,2], 58: [2,8,18,19,9,2], 64: [2,8,18,25,9,2],
            78: [2,8,18,32,17,1], 79: [2,8,18,32,18,1],
            89: [2,8,18,32,18,9,2], 90: [2,8,18,32,18,10,2], 91: [2,8,18,32,20,9,2],
            92: [2,8,18,32,21,9,2], 93: [2,8,18,32,22,9,2], 96: [2,8,18,32,25,9,2],
            103: [2,8,18,32,32,8,3]
        };
        const _shellCountCache = new Map();
        function shellCountsFor(count) {
            count = Math.max(0, Math.floor(count));
            if (_shellCountCache.has(count)) return _shellCountCache.get(count);
            let result;
            if (AUFBAU_EXCEPTIONS[count]) {
                result = AUFBAU_EXCEPTIONS[count].slice();
            } else {
                result = [0, 0, 0, 0, 0, 0, 0];
                let left = count;
                for (const [n, l] of MADELUNG_ORDER) {
                    if (left <= 0) break;
                    const take = Math.min(left, 4 * l + 2);
                    result[n - 1] += take;
                    left -= take;
                }
                while (result.length && result[result.length - 1] === 0) result.pop();
            }
            _shellCountCache.set(count, result);
            return result;
        }
        // Shell (1-based) the next electron should join, given the electrons a
        // nucleus already holds: the Aufbau target for (held + 1) electrons,
        // falling back to the first shell with room. 0 = every shell is full.
        function shellForNextElectron(boundElectrons) {
            const have = new Array(shellCapacities.length).fill(0);
            let total = 0;
            for (const e of (boundElectrons || [])) {
                if (!e || !e.orbitalLevel) continue;
                if (e.orbitalLevel >= 1 && e.orbitalLevel <= have.length) have[e.orbitalLevel - 1]++;
                total++;
            }
            const target = shellCountsFor(total + 1);
            for (let i = 0; i < target.length && i < have.length; i++) {
                if (have[i] < target[i] && have[i] < shellCapacities[i]) return i + 1;
            }
            for (let i = 0; i < shellCapacities.length; i++) {
                if (have[i] < shellCapacities[i]) return i + 1;
            }
            return 0;
        }

        // Molecule configs - using 3D directional vectors instead of 2D angles for better geometry
        // `dir` is a unit-vector direction from the central atom (or from `bondTo` atom).
        // If absent, falls back to a 2D angle + z-jitter (legacy).
        const moleculeConfigs = {
            water: { displayName: "Water (H₂O)", components: [
                { id: 'O1', type: 'oxygen', charge: 0 },
                { id: 'H1', type: 'hydrogen', charge: 0, bondTo: 'O1', bondType: 'covalent', dir: [ 0.6088,  0.7934, 0], distScale: 1.0 },
                { id: 'H2', type: 'hydrogen', charge: 0, bondTo: 'O1', bondType: 'covalent', dir: [-0.6088,  0.7934, 0], distScale: 1.0 }
            ] },
            salt: { displayName: "Salt (NaCl)", components: [
                { id: 'Na1', type: 'sodium', charge: +1 },
                { id: 'Cl1', type: 'chlorine', charge: -1, bondTo: 'Na1', bondType: 'ionic', dir: [1, 0, 0], distScale: 1.0 }
            ] },
            hydrogenGas: { displayName: "Hydrogen (H₂)", components: [
                { id: 'H1', type: 'hydrogen', charge: 0 },
                { id: 'H2', type: 'hydrogen', charge: 0, bondTo: 'H1', bondType: 'covalent', dir: [1, 0, 0], distScale: 1.0 }
            ] },
            oxygenGas: { displayName: "Oxygen (O₂)", components: [
                { id: 'O1', type: 'oxygen', charge: 0 },
                { id: 'O2', type: 'oxygen', charge: 0, bondTo: 'O1', bondType: 'covalent', bondOrder: 2, dir: [1, 0, 0], distScale: 0.85 }
            ] },
            nitrogenGas: { displayName: "Nitrogen (N₂)", components: [
                { id: 'N1', type: 'nitrogen', charge: 0 },
                { id: 'N2', type: 'nitrogen', charge: 0, bondTo: 'N1', bondType: 'covalent', bondOrder: 3, dir: [1, 0, 0], distScale: 0.75 }
            ] },
            carbonDioxide: { displayName: "Carbon Dioxide (CO₂)", components: [
                { id: 'C1', type: 'carbon', charge: 0 },
                { id: 'O1', type: 'oxygen', charge: 0, bondTo: 'C1', bondType: 'covalent', bondOrder: 2, dir: [ 1, 0, 0], distScale: 0.85 },
                { id: 'O2', type: 'oxygen', charge: 0, bondTo: 'C1', bondType: 'covalent', bondOrder: 2, dir: [-1, 0, 0], distScale: 0.85 }
            ] },
            // Methane - proper tetrahedral geometry (109.5° bond angles)
            methane: { displayName: "Methane (CH₄)", components: [
                { id: 'C1', type: 'carbon', charge: 0 },
                { id: 'H1', type: 'hydrogen', charge: 0, bondTo: 'C1', bondType: 'covalent', dir: [ 1,  1,  1], distScale: 1.0 },
                { id: 'H2', type: 'hydrogen', charge: 0, bondTo: 'C1', bondType: 'covalent', dir: [-1, -1,  1], distScale: 1.0 },
                { id: 'H3', type: 'hydrogen', charge: 0, bondTo: 'C1', bondType: 'covalent', dir: [-1,  1, -1], distScale: 1.0 },
                { id: 'H4', type: 'hydrogen', charge: 0, bondTo: 'C1', bondType: 'covalent', dir: [ 1, -1, -1], distScale: 1.0 }
            ] },
            // Ammonia - trigonal pyramidal
            ammonia: { displayName: "Ammonia (NH₃)", components: [
                { id: 'N1', type: 'nitrogen', charge: 0 },
                { id: 'H1', type: 'hydrogen', charge: 0, bondTo: 'N1', bondType: 'covalent', dir: [ 0.9428,  0,     -0.3333], distScale: 1.0 },
                { id: 'H2', type: 'hydrogen', charge: 0, bondTo: 'N1', bondType: 'covalent', dir: [-0.4714,  0.8165,-0.3333], distScale: 1.0 },
                { id: 'H3', type: 'hydrogen', charge: 0, bondTo: 'N1', bondType: 'covalent', dir: [-0.4714, -0.8165,-0.3333], distScale: 1.0 }
            ] },
            // Ethane - tetrahedral around each carbon
            ethane: { displayName: "Ethane (C₂H₆)", components: [
                { id: 'C1', type: 'carbon', charge: 0 },
                { id: 'C2', type: 'carbon', charge: 0, bondTo: 'C1', bondType: 'covalent', dir: [1, 0, 0], distScale: 1.0 },
                { id: 'H1', type: 'hydrogen', charge: 0, bondTo: 'C1', bondType: 'covalent', dir: [-0.577,  0.816,  0    ], distScale: 1.0 },
                { id: 'H2', type: 'hydrogen', charge: 0, bondTo: 'C1', bondType: 'covalent', dir: [-0.577, -0.408,  0.707], distScale: 1.0 },
                { id: 'H3', type: 'hydrogen', charge: 0, bondTo: 'C1', bondType: 'covalent', dir: [-0.577, -0.408, -0.707], distScale: 1.0 },
                { id: 'H4', type: 'hydrogen', charge: 0, bondTo: 'C2', bondType: 'covalent', dir: [ 0.577,  0.816,  0    ], distScale: 1.0 },
                { id: 'H5', type: 'hydrogen', charge: 0, bondTo: 'C2', bondType: 'covalent', dir: [ 0.577, -0.408,  0.707], distScale: 1.0 },
                { id: 'H6', type: 'hydrogen', charge: 0, bondTo: 'C2', bondType: 'covalent', dir: [ 0.577, -0.408, -0.707], distScale: 1.0 }
            ] },
            // Ethene - planar, 120°
            ethene: { displayName: "Ethene (C₂H₄)", components: [
                { id: 'C1', type: 'carbon', charge: 0 },
                { id: 'C2', type: 'carbon', charge: 0, bondTo: 'C1', bondType: 'covalent', bondOrder: 2, dir: [1, 0, 0], distScale: 0.85 },
                { id: 'H1', type: 'hydrogen', charge: 0, bondTo: 'C1', bondType: 'covalent', dir: [-0.5,  0.866, 0], distScale: 1.0 },
                { id: 'H2', type: 'hydrogen', charge: 0, bondTo: 'C1', bondType: 'covalent', dir: [-0.5, -0.866, 0], distScale: 1.0 },
                { id: 'H3', type: 'hydrogen', charge: 0, bondTo: 'C2', bondType: 'covalent', dir: [ 0.5,  0.866, 0], distScale: 1.0 },
                { id: 'H4', type: 'hydrogen', charge: 0, bondTo: 'C2', bondType: 'covalent', dir: [ 0.5, -0.866, 0], distScale: 1.0 }
            ] }
        };

        // --- Helper Functions ---
        // Events have a category (bonds/decay/binding/other) so they can be filtered.
        // Auto-categorizes from message content if not provided — backward-compatible.
        function logEvent(message, category) {
            if (!category) {
                const lower = message.toLowerCase();
                if (lower.includes('bond')) category = 'bonds';
                else if (lower.includes('decay')) category = 'decay';
                else if (lower.includes('bound') || lower.includes('captured')) category = 'binding';
                else category = 'other';
            }
            const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
            const fullMessage = `[${timestamp}] ${message}`;
            console.log(fullMessage);
            recentLogsHtml.push({ text: fullMessage, cat: category });
            if (recentLogsHtml.length > maxLogLinesHtml) recentLogsHtml.shift();
            refreshLogBox();
        }
        // Log lines are plain text. Escape before they reach innerHTML: some
        // messages carry text from outside the app (a scene file's JSON parse
        // error echoes the start of the file).
        function escapeHtml(s) {
            return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
        }
        function refreshLogBox() {
            const logBoxDiv = document.getElementById('logBoxHtml');
            if (!logBoxDiv) return;
            const visible = recentLogsHtml.filter(e => logFilters[e.cat]);
            logBoxDiv.innerHTML = visible.map(e => escapeHtml(e.text)).join('<br>');
            logBoxDiv.scrollTop = logBoxDiv.scrollHeight;
        }

        // Element label for a nucleus with Z protons and A nucleons. A lone
        // neutron is labeled 'n' (it used to show as "Z=0" in the entity list and
        // the 3D labels); neutron-only clusters read '2n', '3n', ...
        function nucleusElementName(Z, A) {
            if (Z > 0) return elementNames[Z] || `Z=${Z}`;
            return A <= 1 ? 'n' : `${A}n`;
        }

        function getTypicalMaxBonds(elementName) {
            switch (elementName) {
                case 'H': return 1;
                case 'O': return 2;
                case 'N': return 3;
                case 'C': return 4;
                case 'F': case 'Cl': case 'Br': case 'I': return 1;
                case 'S': return 2;
                case 'P': return 3;
                case 'Si': return 4;
                default: return 0;
            }
        }

        // Preferred bond angle in radians, based on element and number of bonds.
        // Real chemistry driver is electron-pair geometry (VSEPR). This function
        // picks sensible angles from that theory.
        function getPreferredBondAngle(elementName, bondCount) {
            if (bondCount < 2) return null;
            switch (elementName) {
                case 'C':
                    if (bondCount === 2) return PI;                    // linear (sp)
                    if (bondCount === 3) return radians(120);           // trigonal planar (sp²)
                    if (bondCount === 4) return radians(109.5);         // tetrahedral (sp³)
                    return radians(109.5);
                case 'N':
                    if (bondCount === 2) return radians(120);           // bent (lone pair)
                    if (bondCount === 3) return radians(107);           // pyramidal (lone pair)
                    return radians(109.5);
                case 'O':
                    if (bondCount === 2) return radians(104.5);         // bent (2 lone pairs)
                    return radians(109.5);
                case 'S':
                    if (bondCount === 2) return radians(92);            // narrower than water
                    return radians(109.5);
                case 'P':
                    if (bondCount === 3) return radians(93);            // pyramidal
                    return radians(109.5);
                case 'Si':
                    return radians(109.5);                              // sp³
                default:
                    return radians(109.5);
            }
        }

        function getEquilibriumDist(p1, p2) {
            if (!p1 || !p2) return equilibriumBondDist.default;
            let name1 = p1.elementName || '?';
            let name2 = p2.elementName || '?';
            let key1 = `${name1}-${name2}`;
            let key2 = `${name2}-${name1}`;
            let base = equilibriumBondDist[key1] || equilibriumBondDist[key2] || equilibriumBondDist.default;
            // Higher-order bonds are shorter. Factors based on typical real ratios:
            //   single : double : triple ≈ 1.00 : 0.87 : 0.78 (matches C-C/C=C/C≡C)
            const order = getBondOrder(p1, p2);
            if (order === 2) base *= 0.87;
            else if (order === 3) base *= 0.78;
            return base;
        }

        function canFormCovalentBond(p1, p2) {
            if (!p1 || !p2 || !p1.isNucleusCenter || !p2.isNucleusCenter) return false;
            if (p1 === p2) return false;
            if (p1.bonds.includes(p2)) return false;
            // Prevent mixing ionic and covalent on the same atom
            if (p1.bondedTo || p2.bondedTo) return false;
            const typicalCovalent = ['H', 'C', 'N', 'O', 'P', 'S', 'Si', 'F', 'Cl', 'Br', 'I'];
            if (typicalCovalent.includes(p1.elementName) && typicalCovalent.includes(p2.elementName)) {
                if (p1.bonds.length < p1.maxBonds && p2.bonds.length < p2.maxBonds) {
                    return true;
                }
            }
            return false;
        }

        function getEffectiveMass(p) {
            if (!p) return 0;
            let mass = p.mass;
            if (p.isNucleusCenter) {
                mass += p.nucleusMembers.reduce((sum, m) => sum + (m ? m.mass : 0), 0);
                mass += p.boundElectrons.reduce((sum, e) => sum + (e ? e.mass : 0), 0);
            }
            return max(mass, 0.01);
        }

        // Net charge of a nucleus (accounting for bound electrons). 0 for non-nuclei-center particles.
        function getNetCharge(p) {
            if (!p) return 0;
            if (!p.isNucleusCenter) return p.charge;
            return p.nucleusCharge + p.boundElectrons.reduce((sum, e) => sum + (e ? e.charge : 0), 0);
        }

        // Get the covalent bond order between two atoms (1 = single, 2 = double, 3 = triple).
        function getBondOrder(p1, p2) {
            if (!p1 || !p2) return 1;
            if (p1.bondOrderMap && p1.bondOrderMap.has(p2)) return p1.bondOrderMap.get(p2);
            if (p2.bondOrderMap && p2.bondOrderMap.has(p1)) return p2.bondOrderMap.get(p1);
            return 1;
        }

        // =====================================================================
        //  ORBITAL QUANTUM NUMBERS
        // =====================================================================
        // Given an electron's index-within-shell and its shell number, figure out
        // which subshell (s/p/d/f) it belongs to and which variant (e.g. px/py/pz).
        // This follows simplified Aufbau: within each shell, s fills first,
        // then p, then d, then f.
        //   Shell 1: 1s(2)
        //   Shell 2: 2s(2) + 2p(6) = 8
        //   Shell 3: 3s(2) + 3p(6) + 3d(10) = 18
        //   Shell 4+: s(2) + p(6) + d(10) + f(14) = 32
        const P_VARIANTS = ['x', 'y', 'z'];
        const D_VARIANTS = ['z2', 'xy', 'xz', 'yz', 'x2y2'];
        const F_VARIANTS = ['0', '1', '2', '3', '4', '5', '6'];

        function assignOrbital(electron, shellLevel, indexInShell) {
            // Pick subshell by index within shell
            if (indexInShell < 2) {
                electron.subshell = 's';
                electron.orbitalVariant = indexInShell.toString(); // 0 or 1 (spin-ish)
            } else if (indexInShell < 8) {
                electron.subshell = 'p';
                // 6 electrons in p = 3 variants × 2 spins; map index 2..7 → variant 0..2
                electron.orbitalVariant = P_VARIANTS[Math.floor((indexInShell - 2) / 2)];
            } else if (indexInShell < 18) {
                electron.subshell = 'd';
                electron.orbitalVariant = D_VARIANTS[Math.floor((indexInShell - 8) / 2)];
            } else {
                electron.subshell = 'f';
                electron.orbitalVariant = F_VARIANTS[Math.floor((indexInShell - 18) / 2) % F_VARIANTS.length];
            }
        }

        // Sample a position relative to the nucleus, drawn from the given orbital's
        // probability density. Returns a p5.Vector.
        // Uses analytic approximations, not real quantum wavefunctions.
        function sampleOrbitalPosition(shellLevel, subshell, variant) {
            // Base radius scales with shell (n²·a₀ in real quantum mechanics, but we
            // keep our linear scaling for visibility)
            const baseR = bohrRadius * shellLevel * (1 + (shellLevel - 1) * 0.1);
            // Radial Gaussian spread - gives a "cloud" feel
            const rSpread = baseR * 0.18;
            let r = baseR + randomGaussian() * rSpread;
            if (r < baseR * 0.3) r = baseR * 0.3;

            if (subshell === 's') {
                // Spherical: uniform direction
                return p5.Vector.random3D().mult(r);
            } else if (subshell === 'p') {
                // Dumbbell along one axis. Probability peaks near axis, ~zero at nodal plane.
                // Sample: heavy weight along chosen axis, small perpendicular spread.
                const sign = random(1) < 0.5 ? 1 : -1;
                // cos²(θ) distribution along axis: sample θ from |cos| squared
                const axialFrac = Math.pow(random(1), 0.4) * sign; // biased toward ±1
                const perpFrac = sqrt(1 - axialFrac * axialFrac);
                const perpAngle = random(TWO_PI);
                const pPerp1 = perpFrac * cos(perpAngle);
                const pPerp2 = perpFrac * sin(perpAngle);
                let vec;
                if (variant === 'x') vec = createVector(axialFrac, pPerp1 * 0.35, pPerp2 * 0.35);
                else if (variant === 'y') vec = createVector(pPerp1 * 0.35, axialFrac, pPerp2 * 0.35);
                else vec = createVector(pPerp1 * 0.35, pPerp2 * 0.35, axialFrac);
                return vec.mult(r);
            } else if (subshell === 'd') {
                // d orbitals have more complex shapes. We approximate each variant
                // with a few representative lobes.
                if (variant === 'z2') {
                    // Two lobes along z + torus in xy-plane
                    if (random(1) < 0.4) {
                        // Torus
                        const angle = random(TWO_PI);
                        return createVector(r * 0.7 * cos(angle), r * 0.7 * sin(angle), r * 0.15 * (random(1) - 0.5));
                    } else {
                        // Axial lobe
                        const sign = random(1) < 0.5 ? 1 : -1;
                        const perpAngle = random(TWO_PI);
                        const pr = random(0, r * 0.3);
                        return createVector(pr * cos(perpAngle), pr * sin(perpAngle), sign * r);
                    }
                } else if (variant === 'xy') {
                    // Four lobes in xy-plane along diagonals
                    const quadrant = Math.floor(random(4));
                    const sx = (quadrant & 1) ? 1 : -1;
                    const sy = (quadrant & 2) ? 1 : -1;
                    const t = random(0.5, 1.0);
                    return createVector(sx * r * t * 0.7, sy * r * t * 0.7, (random(1) - 0.5) * r * 0.2);
                } else if (variant === 'xz') {
                    const quadrant = Math.floor(random(4));
                    const sx = (quadrant & 1) ? 1 : -1;
                    const sz = (quadrant & 2) ? 1 : -1;
                    const t = random(0.5, 1.0);
                    return createVector(sx * r * t * 0.7, (random(1) - 0.5) * r * 0.2, sz * r * t * 0.7);
                } else if (variant === 'yz') {
                    const quadrant = Math.floor(random(4));
                    const sy = (quadrant & 1) ? 1 : -1;
                    const sz = (quadrant & 2) ? 1 : -1;
                    const t = random(0.5, 1.0);
                    return createVector((random(1) - 0.5) * r * 0.2, sy * r * t * 0.7, sz * r * t * 0.7);
                } else {
                    // x²-y²: four lobes along x and y axes
                    const lobe = Math.floor(random(4));
                    let vec;
                    if (lobe === 0) vec = createVector(r, 0, 0);
                    else if (lobe === 1) vec = createVector(-r, 0, 0);
                    else if (lobe === 2) vec = createVector(0, r, 0);
                    else vec = createVector(0, -r, 0);
                    vec.add(p5.Vector.random3D().mult(r * 0.2));
                    return vec;
                }
            } else {
                // f orbital: complex, approximate as isotropic cloud with bias
                return p5.Vector.random3D().mult(r);
            }
        }

        // --- Small UI helpers (used by setup and the keyboard shortcuts) ---
        function onClick(id, fn) {
            const el = document.getElementById(id);
            if (el) el.addEventListener('click', fn);
            return el;
        }
        function setPaused(paused) {
            isPaused = !!paused;
            const pauseBtn = document.getElementById('pauseBtn');
            const stepBtn = document.getElementById('stepBtn');
            if (pauseBtn) pauseBtn.textContent = isPaused ? 'Resume' : 'Pause';
            if (stepBtn) stepBtn.disabled = !isPaused;
            logEvent(isPaused ? "Simulation Paused." : "Simulation Resumed.");
        }
        function togglePause() { setPaused(!isPaused); }
        function stepOnce() {
            if (!isPaused) return;
            logEvent("Simulation Stepped.");
            advanceSimulation();
        }
        function resetCamera() {
            // camera() with no arguments restores p5's own default view (eye at
            // z = 800 in p5 1.9). The old call, camera(0, 0, (height/2)/tan(PI/6), ...),
            // matches older p5 defaults; under 1.9 it lands closer to or farther
            // from the scene than the startup view, depending on window height.
            camera();
            // orbitControl keeps momentum between frames; without this the view
            // kept drifting after a reset.
            if (typeof _renderer !== 'undefined' && _renderer) {
                if (_renderer.rotateVelocity) _renderer.rotateVelocity.set(0, 0);
                if (_renderer.moveVelocity) _renderer.moveVelocity.set(0, 0);
                _renderer.zoomVelocity = 0;
            }
            logEvent("Camera reset.");
        }
        function saveSnapshot() {
            const d = new Date();
            const pad = (n) => String(n).padStart(2, '0');
            const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
            try {
                saveCanvas(`quantum-snapshot-${stamp}`, 'png');
                logEvent(`Snapshot saved (quantum-snapshot-${stamp}.png).`, 'other');
            } catch (e) {
                logEvent(`Snapshot failed: ${e.message}`, 'other');
            }
        }
        function setSimSpeed(v) {
            simSpeed = Math.round(constrain(v, 0.1, 3) * 10) / 10;
            const slider = document.getElementById('speedSlider');
            const label = document.getElementById('speedValue');
            if (slider) slider.value = simSpeed;
            if (label) label.textContent = `${simSpeed.toFixed(1)}×`;
        }
        function toggleCheckbox(id) {
            const el = document.getElementById(id);
            if (!el) return;
            el.checked = !el.checked;
            el.dispatchEvent(new Event('change'));
        }

        // p5 listens for mouse, wheel and touch events on window, and
        // orbitControl() treats any press or wheel anywhere over the full-window
        // canvas as camera input. So dragging a sidebar slider spun the camera
        // and scrolling a panel or modal zoomed it. Stop those events at the
        // document when they did not start on the 3D canvas; the UI element's own
        // handlers have already run by then (bubble order: target ... document,
        // then window, where p5 listens).
        function isolateUiPointerEvents() {
            const block = (e) => {
                if (mainCanvasEl && e.target !== mainCanvasEl) e.stopPropagation();
            };
            ['mousedown', 'wheel', 'touchstart', 'touchmove'].forEach(type =>
                document.addEventListener(type, block, { passive: true }));
        }

        // Keyboard shortcuts. Ignored while typing in a text/number field or a
        // select, and while a modal or the tour has the keyboard.
        function initKeyboardShortcuts() {
            document.addEventListener('keydown', (e) => {
                if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
                const t = e.target;
                const tag = t && t.tagName ? t.tagName : '';
                const type = (t && t.type ? String(t.type) : '').toLowerCase();
                const textEntry = tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable) ||
                    (tag === 'INPUT' && !['checkbox', 'radio', 'range', 'button'].includes(type));
                if (textEntry) return;
                // Space / Enter on a focused button or checkbox keep their native meaning
                if ((e.key === ' ' || e.key === 'Enter') && (tag === 'BUTTON' || tag === 'INPUT')) return;
                if (document.querySelector('#helpModalBackdrop.open, #infoModalBackdrop.open, #glossaryBackdrop.open, #tourOverlay.open')) return;
                switch (e.key) {
                    case ' ': togglePause(); break;
                    case 'n': case 'N': case '.':
                        if (!isPaused) setPaused(true); else stepOnce();
                        break;
                    case 'r': case 'R': resetCamera(); break;
                    case 'p': case 'P': saveSnapshot(); break;
                    case 'g': case 'G': toggleGraphs(); break;
                    case 'l': case 'L': toggleCheckbox('labelsCheckbox'); break;
                    case 't': case 'T': toggleCheckbox('showTrailsCheckbox'); break;
                    case 'h': case 'H': case '?': openHelpModal(); break;
                    case '[': setSimSpeed(simSpeed - 0.1); break;
                    case ']': setSimSpeed(simSpeed + 0.1); break;
                    case 'Escape': closeInspector(); break;
                    default: return;
                }
                e.preventDefault();
            });
        }

        // --- p5.js Functions ---
        function setup() {
            const mainRenderer = createCanvas(windowWidth, windowHeight, WEBGL);
            mainCanvasEl = (mainRenderer && mainRenderer.elt) || document.getElementById('defaultCanvas0');
            angleMode(RADIANS);
            isolateUiPointerEvents();
            logBoxElement = document.getElementById('logBoxHtml');
            entityListElement = document.getElementById('entityList');

            // Entity list hover — event delegation
            if (entityListElement) {
                entityListElement.addEventListener('mouseover', (event) => {
                    if (event.target && event.target.nodeName === 'LI' && event.target.hasAttribute('data-entity-key')) {
                        const hoveredKey = event.target.getAttribute('data-entity-key');
                        if (hoveredEntityType !== hoveredKey) {
                            hoveredEntityType = hoveredKey;
                        }
                    }
                });
                entityListElement.addEventListener('mouseout', (event) => {
                    if (!entityListElement.contains(event.relatedTarget)) {
                        if (hoveredEntityType !== null) {
                            hoveredEntityType = null;
                        }
                    }
                });
            }

            // Populate Dropdowns
            const atomSelect = select('#atomSelect');
            if (atomSelect) {
                let sortedKeys = Object.keys(atomConfigs).sort((a, b) => atomConfigs[a].p - atomConfigs[b].p);
                sortedKeys.forEach(type => {
                    const config = atomConfigs[type];
                    const elementName = elementNames[config.p] || `Z=${config.p}`;
                    const displayName = `${type.charAt(0).toUpperCase() + type.slice(1)} (${elementName}, A≈${config.p + config.n})`;
                    atomSelect.option(displayName, type);
                });
            }
            const moleculeSelect = select('#moleculeSelect');
            if (moleculeSelect) {
                for (const key in moleculeConfigs) moleculeSelect.option(moleculeConfigs[key].displayName, key);
            }

            // Button listeners. These used p5's .mousePressed(), which listens
            // for mousedown from ANY mouse button: a right-click on "Clear All"
            // wiped the scene. It also ignored the keyboard (Enter/Space on a
            // focused button). Plain 'click' listeners fix both.
            onClick('addElectron', () => addParticle('electron'));
            onClick('addProton', () => addParticle('proton'));
            onClick('addNeutron', () => addParticle('neutron'));
            onClick('addPositron', () => addParticle('positron'));
            onClick('addNaIon', () => addIon('sodium', +1));
            onClick('addClIon', () => addIon('chlorine', -1));
            onClick('clear', () => {
                clearParticles();
                try { Achievements.notify('scene_cleared'); } catch(_e){}
            });
            onClick('randomFill', randomFillSpace);

            // Save / Load scene wiring ---------------------------------------
            const saveBtn = document.getElementById('saveSceneBtn');
            const loadBtn = document.getElementById('loadSceneBtn');
            const loadFileInput = document.getElementById('loadSceneFileInput');
            if (saveBtn) saveBtn.addEventListener('click', saveSceneToFile);
            if (loadBtn && loadFileInput) {
                loadBtn.addEventListener('click', () => loadFileInput.click());
                loadFileInput.addEventListener('change', (e) => {
                    const file = e.target.files && e.target.files[0];
                    if (file) loadSceneFromFile(file);
                    // Reset value so choosing the same file again re-triggers
                    loadFileInput.value = '';
                });
            }

            // Shine Light: emit photons based on selected mode. Delegates to
            // the top-level autoEmitContinuousLight() helper so the button and
            // auto-emit use the same emission logic.
            const shineLightBtn = select('#shineLight');
            const shineSlider = select('#shineWavelength');
            if (shineSlider) {
                const updateShineLabel = () => {
                    const v = parseInt(shineSlider.value(), 10);
                    currentShineWavelength = v;
                    const color = wavelengthToColor(v);
                    let tag = '';
                    if (v < 380) tag = ' UV';
                    else if (v > 750) tag = ' IR';
                    const el = document.getElementById('shineWavelengthValue');
                    if (el) {
                        el.textContent = `${v} nm${tag}`;
                        el.style.color = `rgb(${color[0]},${color[1]},${color[2]})`;
                        el.style.fontWeight = '600';
                    }
                };
                shineSlider.input(updateShineLabel);
                updateShineLabel();
            }
            const shineModeSelect = document.getElementById('shineMode');
            if (shineModeSelect) {
                shineModeSelect.addEventListener('change', () => {
                    shineMode = shineModeSelect.value || 'burst';
                });
            }
            const continuousLightCheckboxEl = document.getElementById('continuousLightCheckbox');
            if (continuousLightCheckboxEl) {
                continuousLightCheckboxEl.addEventListener('change', () => {
                    continuousLight = continuousLightCheckboxEl.checked;
                    if (continuousLight) {
                        logEvent(`Auto-emit ON (${shineMode}, λ=${currentShineWavelength} nm)`, 'other');
                        try { Achievements.notify('auto_emit_on'); } catch(_e){}
                    }
                });
            }
            if (shineLightBtn) {
                shineLightBtn.elt.addEventListener('click', () => {
                    autoEmitContinuousLight();
                    logEvent(`Shined photons (${shineMode}, λ=${currentShineWavelength} nm)`, 'other');
                    try { Achievements.notify('photon_fired'); } catch(_e){}
                });
            }

            const addSelectedAtomBtn = select('#addSelectedAtom');
            if (addSelectedAtomBtn && atomSelect) {
                addSelectedAtomBtn.elt.addEventListener('click', () => {
                    const selectedType = atomSelect.value();
                    if (selectedType && atomConfigs[selectedType]) addAtom(selectedType);
                    else if (selectedType) logEvent(`Error: Selected atom type "${selectedType}" not found in config.`);
                });
            }
            const addSelectedMoleculeBtn = select('#addSelectedMolecule');
            if (addSelectedMoleculeBtn && moleculeSelect) {
                addSelectedMoleculeBtn.elt.addEventListener('click', () => {
                    const selectedType = moleculeSelect.value();
                    if (selectedType && moleculeConfigs[selectedType]) addMolecule(selectedType);
                    else logEvent(`Error: Invalid molecule selected: ${selectedType}`);
                });
            }

            // Pause / Step — DON'T stop the draw loop; just gate physics. This keeps
            // orbitControl() responsive while paused, a big UX fix from the original.
            onClick('pauseBtn', togglePause);
            onClick('stepBtn', stepOnce);

            const unbreakableCheckbox = select('#unbreakableCheckbox');
            if (unbreakableCheckbox) {
                unbreakableCheckbox.changed(() => {
                    unbreakableBonds = unbreakableCheckbox.checked();
                    logEvent(`Unbreakable Bonds: ${unbreakableBonds ? 'ON' : 'OFF'}`);
                });
            }

            const efieldXInput = select('#efieldX');
            const efieldYInput = select('#efieldY');
            const efieldZInput = select('#efieldZ');
            if (efieldXInput) efieldXInput.input(() => {
                let v = parseFloat(efieldXInput.value());
                if (!isNaN(v)) { electricField.x = v; logEvent(`Ex = ${v.toFixed(3)}`); }
            });
            if (efieldYInput) efieldYInput.input(() => {
                let v = parseFloat(efieldYInput.value());
                if (!isNaN(v)) { electricField.y = v; logEvent(`Ey = ${v.toFixed(3)}`); }
            });
            if (efieldZInput) efieldZInput.input(() => {
                let v = parseFloat(efieldZInput.value());
                if (!isNaN(v)) { electricField.z = v; logEvent(`Ez = ${v.toFixed(3)}`); }
            });

            const gravitySlider = select('#gravitySlider');
            const gravityValueSpan = select('#gravityValue');
            if (gravitySlider && gravityValueSpan) {
                gravityValueSpan.html(G.toFixed(3));
                gravitySlider.value(G);
                gravitySlider.input(() => {
                    let newG = parseFloat(gravitySlider.value());
                    if (!isNaN(newG)) { G = newG; gravityValueSpan.html(G.toFixed(3)); }
                });
            }

            const tempSlider = select('#tempSlider');
            const tempValueSpan = select('#tempValue');
            if (tempSlider && tempValueSpan) {
                tempValueSpan.html(targetTemperature.toFixed(1));
                tempSlider.value(targetTemperature);
                tempSlider.input(() => {
                    let newTemp = parseFloat(tempSlider.value());
                    if (!isNaN(newTemp)) {
                        targetTemperature = max(0, newTemp);
                        tempValueSpan.html(targetTemperature.toFixed(1));
                        logEvent(`Target T = ${targetTemperature.toFixed(1)}`);
                        try { Achievements.notify('temp_changed'); } catch(_e){}
                    }
                });
            }

            logEvent("Simulation Initialized.");
            updateEntityList();

            // Mobile drawer toggle wiring. No-op on desktop (CSS hides the
            // hamburger and close buttons). On narrow viewports, clicking the
            // hamburger opens the drawer; clicking the backdrop or × closes it.
            // The `.mobile-drawer-open` class on <body> is what CSS uses to
            // slide the drawer in.
            (function setupMobileDrawer() {
                const toggle = document.getElementById('mobileToggle');
                const drawerClose = document.getElementById('mobileDrawerClose');
                const backdrop = document.getElementById('mobileBackdrop');
                const openDrawer = () => document.body.classList.add('mobile-drawer-open');
                const closeDrawer = () => document.body.classList.remove('mobile-drawer-open');
                if (toggle) toggle.addEventListener('click', openDrawer);
                if (drawerClose) drawerClose.addEventListener('click', closeDrawer);
                if (backdrop) backdrop.addEventListener('click', closeDrawer);
                // Close drawer when the user taps a preset or action button
                // inside it — gives a satisfying "I did the thing, get out of
                // the way" feel on phones. We only auto-close for action
                // buttons, not for section-headers/checkboxes/sliders that
                // are part of browsing the menu.
                document.querySelectorAll('#controls button').forEach(btn => {
                    if (btn.id === 'mobileDrawerClose') return;
                    if (btn.classList.contains('section-header')) return;
                    btn.addEventListener('click', () => {
                        if (window.matchMedia('(max-width: 720px)').matches) {
                            setTimeout(closeDrawer, 150);
                        }
                    });
                });
            })();

            // =================================================================
            //  ONBOARDING TOUR
            // =================================================================
            // Walks first-time users through the main features. Uses localStorage
            // to remember if someone's already done it. Re-triggerable from the
            // "Take the Tour" button at the top of the sidebar.
            (function setupTour() {
                const overlay = document.getElementById('tourOverlay');
                const spotlight = document.getElementById('tourSpotlight');
                const card = document.getElementById('tourCard');
                const titleEl = document.getElementById('tourTitle');
                const bodyEl = document.getElementById('tourBody');
                const stepEl = document.getElementById('tourStepIndicator');
                const nextBtn = document.getElementById('tourNext');
                const backBtn = document.getElementById('tourBack');
                const skipBtn = document.getElementById('tourSkip');
                const startBtn = document.getElementById('tourStartBtn');
                if (!overlay || !spotlight || !card) return;

                // Step data. Each step targets a CSS selector; if the target
                // isn't found, the spotlight hides and the card is centered.
                // `onEnter` is optional — runs when the step becomes active
                // (used e.g. to open the drawer on mobile so a target is visible).
                const steps = [
                    {
                        target: null,
                        title: 'Welcome! 👋',
                        body: "This is a 3D particle-physics sandbox. You can build atoms and molecules from scratch, watch them react, and see physics concepts come alive.<br><br><b>Camera controls:</b><br>• Drag to rotate<br>• Scroll / pinch to zoom<br>• Right-drag (two-finger drag on touch) to pan<br>• Right-click a particle (long-press on touch) to inspect it<br><br>Let's take a quick tour."
                    },
                    {
                        target: '#atomSelect',
                        title: 'Add an atom',
                        body: "Pick an element from this dropdown, then press the <b>Add</b> button beside it. Try adding a Hydrogen: you'll see its nucleus (1 proton) and an orbiting electron.",
                        mobileOpenDrawer: true
                    },
                    {
                        target: '#moleculeSelect',
                        title: 'Or add a whole molecule',
                        body: "Prefer a ready-made molecule? Pick one here and press its <b>Add</b> button. <b>Water (H₂O)</b> is a great starter: you'll see it with proper bent geometry.",
                        mobileOpenDrawer: true
                    },
                    {
                        target: '#glossaryBtn',
                        title: 'The Glossary',
                        body: "Tap this to browse every element, particle, and molecule the sim knows about. Great for looking up what you just made, or just exploring the periodic table.",
                        mobileOpenDrawer: true
                    },
                    {
                        target: '#shineLight',
                        title: 'Shine some light',
                        body: "Fire photons of any wavelength. Hit atoms with matching energies and they absorb the photon (glow yellow) and later re-emit. Hydrogen's ground state only absorbs ultraviolet: try 122 nm. This is atomic spectroscopy, live.",
                        mobileOpenDrawer: true
                    },
                    {
                        target: '#toggleDoubleSlitBtn',
                        title: 'Double-Slit demo',
                        body: "Open the classic wave-optics experiment. Drag the sliders and watch the interference pattern change — real Fraunhofer-diffraction math, computed live.",
                        mobileOpenDrawer: true
                    },
                    {
                        target: '#logBoxHtml',
                        title: 'Watch the log',
                        body: "Every reaction, bond formation, decay, and photon event shows up here in real time. If something interesting happens on screen, check the log to see what.",
                        mobileCloseDrawer: true
                    },
                    {
                        target: null,
                        title: "You're ready 🚀",
                        body: "That's the whirlwind tour. Poke around: try the Presets section, turn on Graphs, explore the Glossary. Everything's reversible with the <b>Clear All</b> button.<br><br>Keyboard: <b>Space</b> pause, <b>N</b> step, <b>R</b> reset camera, <b>P</b> snapshot, <b>G</b> graphs, <b>H</b> help.<br><br>If you want the tour again, it's the first button at the top of the sidebar."
                    }
                ];

                let currentStep = 0;
                let active = false;

                function openMobileDrawerIfNeeded() {
                    if (window.matchMedia('(max-width: 720px)').matches) {
                        document.body.classList.add('mobile-drawer-open');
                    }
                }
                function closeMobileDrawerIfOpen() {
                    document.body.classList.remove('mobile-drawer-open');
                }

                function positionSpotlightAndCard(targetEl) {
                    if (!targetEl) {
                        // Centered card, no spotlight
                        spotlight.style.display = 'none';
                        card.style.left = '50%';
                        card.style.top = '50%';
                        card.style.transform = 'translate(-50%, -50%)';
                        return;
                    }
                    const rect = targetEl.getBoundingClientRect();
                    if (rect.width === 0 && rect.height === 0) {
                        // Element not visible — treat as no target
                        spotlight.style.display = 'none';
                        card.style.left = '50%';
                        card.style.top = '50%';
                        card.style.transform = 'translate(-50%, -50%)';
                        return;
                    }
                    spotlight.style.display = 'block';
                    const pad = 6;
                    spotlight.style.left = (rect.left - pad) + 'px';
                    spotlight.style.top = (rect.top - pad) + 'px';
                    spotlight.style.width = (rect.width + pad * 2) + 'px';
                    spotlight.style.height = (rect.height + pad * 2) + 'px';

                    // Place card: below the target if there's room, else above.
                    // On mobile we use the CSS-forced left/right, only top matters.
                    // Measure the card's ACTUAL height so tall cards (with long
                    // body text) don't get clipped at the bottom.
                    const vh = window.innerHeight;
                    const vw = window.innerWidth;
                    // Temporarily clear transform so measurement is accurate
                    const savedTransform = card.style.transform;
                    card.style.transform = '';
                    const cardH = card.offsetHeight || 170;
                    const cardW = card.offsetWidth || 320;
                    card.style.transform = savedTransform;
                    const gap = 18;   // space between target and card
                    let top, left;
                    if (rect.bottom + cardH + gap + 10 < vh) {
                        top = rect.bottom + gap;
                    } else if (rect.top - cardH - gap > 10) {
                        top = rect.top - cardH - gap;
                    } else {
                        // Neither above nor below fits — tuck card at whichever
                        // screen edge has more room
                        const spaceAbove = rect.top;
                        const spaceBelow = vh - rect.bottom;
                        if (spaceBelow > spaceAbove) {
                            top = Math.max(10, vh - cardH - 10);
                        } else {
                            top = 10;
                        }
                    }
                    // On desktop, position left relative to target; on mobile CSS forces full-width
                    if (window.matchMedia('(max-width: 720px)').matches) {
                        card.style.left = '';
                        card.style.transform = '';
                        card.style.top = top + 'px';
                    } else {
                        left = rect.left;
                        // Keep card fully on screen
                        left = Math.max(10, Math.min(left, vw - cardW - 10));
                        card.style.left = left + 'px';
                        card.style.top = top + 'px';
                        card.style.transform = '';
                    }
                }

                // Walk up from the target to find any collapsed section-body
                // ancestor and expand it. This is needed when a tour step
                // points at a control inside a section the user has collapsed.
                function expandAncestorSections(targetEl) {
                    if (!targetEl) return;
                    let node = targetEl.parentElement;
                    while (node && node !== document.body) {
                        if (node.classList && node.classList.contains('section-body')
                            && node.classList.contains('collapsed')) {
                            node.classList.remove('collapsed');
                            // Also un-collapse the header so its indicator flips
                            const id = node.id;
                            if (id) {
                                const hdr = document.querySelector(`.section-header[data-target="${id}"]`);
                                if (hdr) hdr.classList.remove('collapsed');
                            }
                        }
                        node = node.parentElement;
                    }
                }

                // Scroll the target fully into view within its nearest
                // scrolling ancestor (usually #controls for sidebar items).
                // We use scrollIntoView with block:'center' for a nice result.
                function scrollTargetIntoView(targetEl) {
                    if (!targetEl) return;
                    try {
                        targetEl.scrollIntoView({
                            behavior: 'smooth',
                            block: 'center',
                            inline: 'center'
                        });
                    } catch (e) {
                        // Fallback for old browsers: plain scrollIntoView
                        targetEl.scrollIntoView();
                    }
                }

                function renderStep() {
                    const step = steps[currentStep];
                    if (!step) { endTour(); return; }
                    titleEl.textContent = step.title;
                    bodyEl.innerHTML = step.body;
                    stepEl.textContent = `${currentStep + 1} / ${steps.length}`;
                    backBtn.style.visibility = currentStep === 0 ? 'hidden' : 'visible';
                    nextBtn.textContent = currentStep === steps.length - 1 ? 'Finish' : 'Next';

                    // Mobile drawer handling for this step
                    if (step.mobileOpenDrawer) openMobileDrawerIfNeeded();
                    if (step.mobileCloseDrawer) closeMobileDrawerIfOpen();

                    // Resolve the target, expand any collapsed ancestor sections,
                    // then scroll it into view. We wait for the drawer animation
                    // + the scroll animation to settle before measuring. 450ms
                    // is enough for both smooth-scroll and drawer slide.
                    const target = step.target ? document.querySelector(step.target) : null;
                    expandAncestorSections(target);
                    const needsDrawerWait = step.mobileOpenDrawer || step.mobileCloseDrawer;
                    const drawerDelay = needsDrawerWait ? 260 : 10;
                    setTimeout(() => {
                        // Scroll after drawer is done animating
                        scrollTargetIntoView(target);
                        // Measure after scroll has settled. scrollIntoView with
                        // smooth behavior takes ~200-300ms. Two-pass measurement:
                        // position immediately (looks close even mid-scroll) then
                        // again after scroll finishes (locks in final position).
                        positionSpotlightAndCard(target);
                        setTimeout(() => {
                            positionSpotlightAndCard(target);
                        }, 320);
                    }, drawerDelay);
                }

                function startTour() {
                    active = true;
                    currentStep = 0;
                    overlay.classList.add('open');
                    renderStep();
                }
                function endTour() {
                    active = false;
                    overlay.classList.remove('open');
                    try { localStorage.setItem('quantum_tour_completed', '1'); } catch (e) {}
                    try { Achievements.notify('tour_taken'); } catch(_e){}
                }
                function nextStep() {
                    if (currentStep >= steps.length - 1) { endTour(); return; }
                    currentStep++;
                    renderStep();
                }
                function prevStep() {
                    if (currentStep <= 0) return;
                    currentStep--;
                    renderStep();
                }

                nextBtn.addEventListener('click', nextStep);
                backBtn.addEventListener('click', prevStep);
                skipBtn.addEventListener('click', endTour);
                // Keyboard: Esc skips, arrows move between steps
                document.addEventListener('keydown', (e) => {
                    if (!active) return;
                    if (e.key === 'Escape') { endTour(); e.preventDefault(); }
                    else if (e.key === 'ArrowRight') { nextStep(); e.preventDefault(); }
                    else if (e.key === 'ArrowLeft') { prevStep(); e.preventDefault(); }
                });
                if (startBtn) startBtn.addEventListener('click', startTour);
                // Retake-tour button inside the Help modal header
                const retakeBtn = document.getElementById('helpRetakeTourBtn');
                if (retakeBtn) {
                    retakeBtn.addEventListener('click', () => {
                        // Close help modal first
                        const helpBackdrop = document.getElementById('helpModalBackdrop');
                        if (helpBackdrop) helpBackdrop.classList.remove('open');
                        // Small delay so help modal's close animation finishes
                        setTimeout(startTour, 180);
                    });
                }

                // Re-position on window resize (phone rotation, browser resize)
                window.addEventListener('resize', () => {
                    if (!active) return;
                    const step = steps[currentStep];
                    const target = step && step.target ? document.querySelector(step.target) : null;
                    positionSpotlightAndCard(target);
                });

                // Auto-start for first-time visitors
                let seen = false;
                try { seen = localStorage.getItem('quantum_tour_completed') === '1'; } catch (e) {}
                if (!seen) {
                    // Small delay so the sim has a chance to draw its first frame
                    setTimeout(startTour, 700);
                }
            })();

            // --- Wire up new UI ---
            labelLayerElement = document.getElementById('labelLayer');
            statsBubbleElement = document.getElementById('statsBubble');
            initStatsBubble();
            initKeyboardShortcuts();

            // Collapsible sections
            document.querySelectorAll('.section-header').forEach(header => {
                header.addEventListener('click', () => {
                    const targetId = header.getAttribute('data-target');
                    const body = document.getElementById(targetId);
                    if (body) {
                        body.classList.toggle('collapsed');
                        header.classList.toggle('collapsed');
                    }
                });
            });

            // Display checkboxes
            const hookCheckbox = (id, setter) => {
                const el = document.getElementById(id);
                if (el) el.addEventListener('change', () => setter(el.checked));
            };
            // Light mode — swaps data-theme="light" on <html>, persists to localStorage.
            // The 3D canvas is intentionally unaffected (atoms are color-calibrated
            // for dark backgrounds); only the surrounding UI changes.
            (function setupLightMode() {
                const cb = document.getElementById('lightModeCheckbox');
                const html = document.documentElement;
                function applyTheme(theme) {
                    if (theme === 'light') html.setAttribute('data-theme', 'light');
                    else html.removeAttribute('data-theme');
                }
                // Restore previous preference, if any
                let saved = null;
                try { saved = localStorage.getItem('quantum_theme'); } catch(_e){}
                // No saved choice: follow the system, as the page head already did before first paint.
                if (saved === 'light' || (saved === null && document.documentElement.getAttribute('data-theme') === 'light')) {
                    applyTheme('light');
                    if (cb) cb.checked = true;
                }
                if (cb) {
                    cb.addEventListener('change', () => {
                        const theme = cb.checked ? 'light' : 'dark';
                        applyTheme(theme);
                        try { localStorage.setItem('quantum_theme', theme); } catch(_e){}
                    });
                }
            })();

            hookCheckbox('labelsCheckbox',      v => { showLabels = v; if (!v) clearAllLabels(); });
            hookCheckbox('showBondsCheckbox',   v => showBonds = v);
            hookCheckbox('showShellsCheckbox',  v => showShells = v);
            hookCheckbox('showVelocityCheckbox',v => showVelocity = v);
            hookCheckbox('showGridCheckbox',    v => showGrid = v);
            hookCheckbox('showTrailsCheckbox',  v => {
                showTrails = v;
                if (!v) particles.forEach(p => { if (p) p.trail = []; });
            });
            hookCheckbox('showPhaseColoringCheckbox', v => showPhaseColoring = v);
            hookCheckbox('showPhotonsCheckbox', v => showPhotons = v);
            hookCheckbox('travelingPhotonsCheckbox', v => useTravelingPhotons = v);
            hookCheckbox('photonWiggleCheckbox', v => showPhotonWiggle = v);
            hookCheckbox('absorptionCheckbox', v => useAbsorption = v);
            hookCheckbox('ballisticCheckbox', v => {
                useBallisticFastPath = v;
                if (v) logEvent("Ballistic fast-path ENABLED — isolated particles skip force loop", 'other');
                else logEvent("Ballistic fast-path DISABLED — all particles go through force loop", 'other');
            });
            hookCheckbox('verletCheckbox',      v => useVerletIntegration = v);
            hookCheckbox('containmentCheckbox', v => {
                useContainment = v;
                logEvent(`Containment sphere ${v ? 'ON' : 'OFF'}`, 'other');
            });
            hookCheckbox('realOrbitalsCheckbox', v => useRealOrbitals = v);
            hookCheckbox('angleBendingCheckbox', v => useAngleBending = v);
            hookCheckbox('morsePotentialCheckbox', v => useMorsePotential = v);
            hookCheckbox('legacySignsCheckbox', v => {
                useLegacyForceSigns = v;
                logEvent(v ? "Legacy (inverted) force signs ENABLED" : "Corrected force signs ENABLED", 'other');
            });
            hookCheckbox('nuclearDecayCheckbox', v => { useNuclearDecay = v; if (v) logEvent("Radioactive decay ENABLED"); });
            hookCheckbox('tunnelingCheckbox', v => useTunneling = v);
            hookCheckbox('trueScaleCheckbox', v => useTrueScale = v);
            hookCheckbox('hydrogenBondCheckbox', v => useHydrogenBonding = v);
            hookCheckbox('showLonePairsCheckbox', v => showLonePairs = v);
            hookCheckbox('tempTintCheckbox', v => tempTintBg = v);

            // Color-by mode select
            const colorModeSelect = document.getElementById('colorMode');
            if (colorModeSelect) {
                colorModeSelect.addEventListener('change', () => {
                    particleColorMode = colorModeSelect.value;
                });
            }

            // Magnetic field inputs
            const bfieldX = document.getElementById('bfieldX');
            const bfieldY = document.getElementById('bfieldY');
            const bfieldZ = document.getElementById('bfieldZ');
            if (bfieldX) bfieldX.addEventListener('input', () => {
                const v = parseFloat(bfieldX.value);
                if (!isNaN(v)) { magneticField.x = v; logEvent(`Bx = ${v.toFixed(3)}`, 'other'); }
            });
            if (bfieldY) bfieldY.addEventListener('input', () => {
                const v = parseFloat(bfieldY.value);
                if (!isNaN(v)) { magneticField.y = v; logEvent(`By = ${v.toFixed(3)}`, 'other'); }
            });
            if (bfieldZ) bfieldZ.addEventListener('input', () => {
                const v = parseFloat(bfieldZ.value);
                if (!isNaN(v)) { magneticField.z = v; logEvent(`Bz = ${v.toFixed(3)}`, 'other'); }
            });

            // Graphs toggle button
            const graphsBtn = document.getElementById('toggleGraphsBtn');
            if (graphsBtn) graphsBtn.addEventListener('click', toggleGraphs);
            const graphsClose = document.getElementById('graphsClose');
            if (graphsClose) graphsClose.addEventListener('click', toggleGraphs);

            // Inspector close button
            const inspectorCloseBtn = document.getElementById('inspectorClose');
            if (inspectorCloseBtn) inspectorCloseBtn.addEventListener('click', closeInspector);

            // Log filter checkboxes
            ['Bonds', 'Decay', 'Binding', 'Other'].forEach(label => {
                const el = document.getElementById('logFilter' + label);
                if (el) el.addEventListener('change', () => {
                    logFilters[label.toLowerCase()] = el.checked;
                    refreshLogBox();
                });
            });

            // 3D picking + drag input handling (right-click inspect, left-drag particles)
            initInputHandling();

            // Speed slider
            const speedSlider = document.getElementById('speedSlider');
            const speedValue = document.getElementById('speedValue');
            if (speedSlider && speedValue) {
                speedSlider.addEventListener('input', () => {
                    simSpeed = parseFloat(speedSlider.value);
                    speedValue.textContent = `${simSpeed.toFixed(1)}×`;
                });
            }

            // Reset camera / snapshot buttons
            onClick('resetCameraBtn', resetCamera);
            onClick('snapshotBtn', saveSnapshot);

            // Preset scenarios
            document.querySelectorAll('.presetBtn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const preset = btn.getAttribute('data-preset');
                    if (preset) loadPreset(preset);
                });
            });
        }

        function draw() {
            // Background: flat gray, or temperature-tinted if enabled
            if (tempTintBg) {
                const bg = getBackgroundColor();
                background(bg[0], bg[1], bg[2]);
            } else {
                background(30);
            }
            ambientLight(100);
            directionalLight(255, 255, 255, 0.5, 0.5, -1);
            orbitControl();

            // Physics is advanced N times per frame based on simSpeed. For sub-1 speeds,
            // we probabilistically skip frames to approximate slow motion.
            if (!isPaused) {
                if (simSpeed >= 1.0) {
                    let steps = floor(simSpeed);
                    let fractional = simSpeed - steps;
                    if (random(1) < fractional) steps++;
                    for (let s = 0; s < steps; s++) advanceSimulation();
                } else {
                    if (random(1) < simSpeed) advanceSimulation();
                }
            }

            if (!isPaused && frameCount % 10 === 0) {
                updateEntityList();
            }

            // Record trails (throttled)
            if (showTrails && !isPaused && frameCount % 2 === 0) {
                recordTrails();
            }

            // Record graph samples every ~6 frames (throttled to reduce memory)
            if (graphsOpen && !isPaused && frameCount % 6 === 0) {
                recordGraphSample();
            }

            if (showGrid) drawGrid();
            if (useContainment) drawContainment();
            if (showTrails) drawTrails();
            if (showPhotons) drawPhotons();
            if (showBonds) drawBondLines();
            if (showShells) drawAtomShells();
            noStroke();
            for (let i = particles.length - 1; i >= 0; i--) {
                if (particles[i]) particles[i].display();
            }
            if (showVelocity) drawVelocityVectors();
            if (showLonePairs) drawLonePairs();

            // Floating labels rendered as HTML overlay (projected from WEBGL).
            if (showLabels) renderFloatingLabels();

            updateInfoPanel();
            updateStatsBubble();

            // Keep the inspector panel showing up-to-date info if open
            if (inspectedParticle && frameCount % 3 === 0) renderInspector();

            // Draw graphs (HTML canvas, independent of WEBGL)
            if (graphsOpen && frameCount % 3 === 0) drawGraphs();

            // Keep double-slit panel animated (only particle mode needs redraw;
            // static patterns don't change unless a slider moves).
            if (doubleSlitState.open && doubleSlitState.mode === 'particles' && frameCount % 2 === 0) {
                drawDoubleSlit();
            }
        }

        // Performance: cluster identification and molecule walking are expensive
        // (O(N²) in nucleons). We throttle them to every N frames. Callers that
        // add or remove particles set forceNucleiRefresh = true to trigger an
        // immediate full update on the next tick. Cluster identity doesn't
        // change from frame to frame for stable matter, so ~50ms latency is
        // invisible to users.
        let forceNucleiRefresh = true;       // ensure first tick always runs
        const NUCLEI_UPDATE_INTERVAL = 3;    // every N physics ticks

        // Single-tick physics advancement, usable from both draw() and Step button.
        // Supports both semi-implicit Euler (legacy) and velocity Verlet (default).
        function advanceSimulation() {
            // Advance the simulated clock before physics, so stats bubble and graphs
            // see the same time index this frame.
            simTime += SIM_TIME_PER_TICK_AS;
            simTick++;

            // Only run cluster / molecule identification on throttled ticks, or
            // when something changed (new atom/molecule added, nuclear decay, etc.)
            const runNucleiThisTick = forceNucleiRefresh
                || (simTick % NUCLEI_UPDATE_INTERVAL === 0);
            if (runNucleiThisTick) {
                updateNuclei();
                handleReactions();
                updateMolecules();
                forceNucleiRefresh = false;
            }

            if (useVerletIntegration) {
                // Velocity Verlet:
                //   v(t+dt/2) = v(t) + 0.5 * a(t) * dt
                //   x(t+dt)   = x(t) + v(t+dt/2) * dt
                //   [compute a(t+dt) via applyForces()]
                //   v(t+dt)   = v(t+dt/2) + 0.5 * a(t+dt) * dt
                // IMPORTANT: a(t) here is the acceleration computed at the END of
                // the previous step (its second force pass). We must NOT zero acc
                // between steps. First-ever frame: acc is zero, which is fine—no kick.

                // --- Step 1: half-kick + drift ---
                for (let i = 0; i < particles.length; i++) {
                    let p = particles[i];
                    if (!p || p.isBound) continue;
                    if (p.nucleusMembers.length > 0 && !p.isNucleusCenter) continue;
                    // Half-kick with a(t)
                    p.vel.x += 0.5 * p.acc.x; p.vel.y += 0.5 * p.acc.y; p.vel.z += 0.5 * p.acc.z;
                    // Speed cap before the drift too. It was only applied after the
                    // second half-kick, so a large a(t) (several clamped pair forces
                    // add up) could drift a nucleus 15+ units in one tick, leaving
                    // its glued nucleons behind: the nucleus tore in two.
                    const maxDrift = p.isNucleusCenter ? 4 : (p.bondedTo || (p.bonds && p.bonds.length > 0) ? 5 : 7);
                    if (p.vel.magSq() > maxDrift * maxDrift) p.vel.setMag(maxDrift);
                    // Drift
                    if (!isNaN(p.vel.x) && !isNaN(p.vel.y) && !isNaN(p.vel.z)) {
                        p.pos.add(p.vel);
                    } else {
                        p.vel.set(0, 0, 0);   // a NaN velocity used to freeze the particle forever
                    }
                    // Now zero acc so we can accumulate a(t+dt) fresh
                    p.acc.set(0, 0, 0);
                }

                // --- Step 2: compute a(t+dt) at new positions ---
                applyForces();
                // Angle-bending, magnetic and hydrogen-bond forces belong to
                // a(t+dt) too. They used to be added after the second half-kick,
                // so Verlet (the default) applied them at half strength compared
                // with Euler.
                applyExtraForces();

                // --- Step 3: second half-kick + bond forces + damping ---
                for (let i = 0; i < particles.length; i++) {
                    let p = particles[i];
                    if (!p) continue;
                    p.applyBondForces();    // Bond springs contribute to a(t+dt)
                    if (p.isBound) { p.updateOrbit(); continue; }
                    if (p.nucleusMembers.length > 0 && !p.isNucleusCenter) continue;
                    // Second half-kick
                    p.vel.x += 0.5 * p.acc.x; p.vel.y += 0.5 * p.acc.y; p.vel.z += 0.5 * p.acc.z;
                    // Apply damping (thermostat-compatible)
                    p.vel.mult(damping);
                    // Speed cap
                    let maxSpeed = p.isNucleusCenter ? 4 : (p.bondedTo || (p.bonds && p.bonds.length > 0) ? 5 : 7);
                    if (p.vel.magSq() > maxSpeed * maxSpeed) p.vel.setMag(maxSpeed);
                    // Glue nucleons to center
                    if (p.isNucleusCenter) p.updateNucleonMembers();
                    // acc stays intact so next step can use it as a(t)
                }
            } else {
                // Legacy: semi-implicit Euler — applyForces → update (integrate)
                applyForces();
                applyExtraForces();
                for (let i = particles.length - 1; i >= 0; i--) {
                    if (particles[i]) particles[i].update();
                }
            }

            // Elastic containment wall (after integration, before binding checks)
            applyContainment();

            attemptBinding();

            // Radioactive decay check: runs rarely (every 40 ticks per nucleus)
            if (useNuclearDecay && simTick % 40 === 0) applyNuclearDecay();

            // Electron-positron annihilation: returns immediately when there
            // are no free positrons.
            handleAnnihilation();

            // Pauli exclusion approximation: electrons on the same nucleus+shell
            // should spread around the shell. Nudge their phases apart when close.
            applyPauliExclusion();

            if (simTick % thermostatFrequency === 0) applyThermostat();

            // Continuous light emission (auto-emit mode). Keyed to ticks: at 2-3x
            // speed the frameCount test fired 2-3 identical bursts in one frame.
            if (continuousLight && simTick % CONTINUOUS_EMIT_INTERVAL === 0) {
                autoEmitContinuousLight();
            }

            // Advance photon positions (traveling ones) and cull expired/far-away.
            updatePhotons();
        }

        // Forces evaluated at the new positions alongside applyForces():
        // VSEPR-lite bond angles, the Lorentz force, and hydrogen bonds.
        function applyExtraForces() {
            if (useAngleBending) applyBondAngleForces();
            applyMagneticField();
            if (useHydrogenBonding) applyHydrogenBonding();
        }

        // Elastic spherical wall. Particles that cross it are put back on the
        // surface and their outward velocity component is reflected, so kinetic
        // energy is conserved and the thermostat sees no artificial loss.
        function applyContainment() {
            if (!useContainment) return;
            const R = CONTAINMENT_RADIUS, R2 = R * R;
            for (let i = 0; i < particles.length; i++) {
                const p = particles[i];
                if (!p || !p.pos || p.isBound) continue;
                if (p.nucleusMembers.length > 0 && !p.isNucleusCenter) continue;
                const x = p.pos.x, y = p.pos.y, z = p.pos.z;
                const d2 = x * x + y * y + z * z;
                if (d2 <= R2 || !(d2 < Infinity)) continue;
                const d = Math.sqrt(d2);
                const nx = x / d, ny = y / d, nz = z / d;
                const vr = p.vel.x * nx + p.vel.y * ny + p.vel.z * nz;
                if (vr > 0) {
                    p.vel.x -= 2 * vr * nx; p.vel.y -= 2 * vr * ny; p.vel.z -= 2 * vr * nz;
                }
                const s = R / d;
                p.pos.set(x * s, y * s, z * s);
                if (p.isNucleusCenter) p.updateNucleonMembers();
            }
        }

        // Three faint great circles mark the containment wall.
        function drawContainment() {
            const R = CONTAINMENT_RADIUS, SEG = 72;
            push();
            noFill();
            stroke(110, 140, 190, 70);
            strokeWeight(1);
            for (let plane = 0; plane < 3; plane++) {
                beginShape();
                for (let i = 0; i <= SEG; i++) {
                    const a = (i / SEG) * TWO_PI;
                    const c = R * Math.cos(a), s = R * Math.sin(a);
                    if (plane === 0) vertex(c, s, 0);
                    else if (plane === 1) vertex(c, 0, s);
                    else vertex(0, c, s);
                }
                endShape();
            }
            pop();
        }

        function windowResized() {
            resizeCanvas(windowWidth, windowHeight);
        }

        // --- Particle Class ---
        class Particle {
            constructor(x, y, z, type) {
                this.pos = createVector(x, y, z);
                this.vel = p5.Vector.random3D().mult(random(0.1, 0.5));
                this.acc = createVector(0, 0, 0);
                this.type = type;
                const props = properties[type] || { charge: 0, mass: 1, color: [200, 200, 200], radius: 6 };
                this.charge = props.charge;
                this.mass = max(props.mass, 0.01);
                this.color = [...props.color];
                this.radius = props.radius;
                this.isBound = false;
                this.boundTo = null;
                this.orbitalLevel = 0;
                // --- Orbital quantum info (for bound electrons) ---
                // subshell: 's' | 'p' | 'd' | 'f'
                // orbitalVariant: for p, 'x'|'y'|'z'; for d, 'z2'|'xy'|'xz'|'yz'|'x2y2'; for f, 0..6
                this.subshell = 's';
                this.orbitalVariant = 'x';
                // Stable orbital axis + phase for legacy circular-orbit mode
                this.orbitalAxis = p5.Vector.random3D();
                this.orbitalPhase = random(TWO_PI);
                this.orbitalAngularSpeed = orbitalSpeed * random(0.8, 1.2);
                // For quantum-orbital cloud: current target position (relative to nucleus)
                // and a frame counter to resample.
                this.orbitalTarget = p5.Vector.random3D();
                this.orbitalResampleIn = 0;
                this.baseAngle = 0;
                this.currentAngle = 0;
                this.isNucleusCenter = false;
                this.nucleusMembers = [];
                this.nucleusCharge = this.charge;
                this.boundElectrons = [];
                this.elementName = '';
                this.maxBonds = 0;
                this.bonds = [];
                this.isPartOfMolecule = false;
                this.bondedTo = null;
                this.moleculeLabel = null;
                this.trail = []; // Past positions for optional motion trails
                this.__fidx = -1; // Per-tick spatial-grid stamp (set by rebuildSpatialGrid)
                // Previous acceleration for velocity Verlet integration
                this.prevAcc = createVector(0, 0, 0);
                // Covalent bond orders: Map from partner Particle → integer (1, 2, 3)
                // Only populated when molecules are built with explicit bond orders.
                // Missing entries default to single bond.
                this.bondOrderMap = new Map();
            }

            applyForce(force) {
                // Bound electrons don't feel forces directly (their motion is scripted);
                // but nuclei, free particles, and bonded nuclei all do.
                if (this.isBound) return;
                if (!force || isNaN(force.x) || isNaN(force.y) || isNaN(force.z)) return;
                let effectiveMass = massForTick(this);
                let maxAcc = 5.0;
                let f = p5.Vector.div(force, max(effectiveMass, 0.1));
                if (f.magSq() > maxAcc * maxAcc) f.setMag(maxAcc);
                this.acc.add(f);
            }

            // Allocation-free variant used by the hot pairwise loop. Semantics
            // are identical to applyForce(): bound-electron skip, NaN guard,
            // effective-mass division, per-call acceleration clamp of 5.0.
            applyForceScalar(fx, fy, fz) {
                if (this.isBound) return;
                if (fx !== fx || fy !== fy || fz !== fz) return; // NaN guard
                const m = Math.max(massForTick(this), 0.1);
                let ax = fx / m, ay = fy / m, az = fz / m;
                const maxAcc = 5.0;
                const aSq = ax * ax + ay * ay + az * az;
                if (aSq > maxAcc * maxAcc) {
                    const s = maxAcc / Math.sqrt(aSq);
                    ax *= s; ay *= s; az *= s;
                }
                this.acc.x += ax; this.acc.y += ay; this.acc.z += az;
            }

            // Spring forces from bonds (covalent + ionic) — extracted so it can be called
            // between force passes in Verlet integration.
            applyBondForces() {
                if (this.bonds && this.bonds.length > 0) {
                    for (const partner of this.bonds) {
                        if (partner && partner.pos && this.pos) {
                            let bondVector = p5.Vector.sub(partner.pos, this.pos);
                            let currentDist = bondVector.mag();
                            if (currentDist > 0.1) {
                                const eqDist = getEquilibriumDist(this, partner);
                                const order = getBondOrder(this, partner);
                                // Bond stiffness scales with order: double ≈ 1.8x, triple ≈ 2.6x
                                const stiffness = bondForceConstant_covalent * (order === 1 ? 1 : order === 2 ? 1.8 : 2.6);
                                const displacement = currentDist - eqDist;
                                let bondForceMag;
                                if (useMorsePotential) {
                                    // Morse potential: V(r) = D_e * (1 - exp(-a(r-re)))²
                                    // Force: F(r) = 2 * D_e * a * exp(-a(r-re)) * (1 - exp(-a(r-re)))
                                    // As r → ∞ the force goes to zero (no infinite restoring pull),
                                    // so stretched bonds can genuinely dissociate. As r → re, it
                                    // approaches a simple spring. At r < re it pushes back very hard.
                                    const D_e = stiffness * eqDist * 0.5; // well depth
                                    const a = 1.2 / eqDist;               // steepness parameter
                                    const expTerm = Math.exp(-a * displacement);
                                    bondForceMag = 2 * D_e * a * expTerm * (1 - expTerm);
                                } else {
                                    // Classic harmonic spring
                                    bondForceMag = stiffness * displacement;
                                }
                                const bondForce = bondVector.normalize().mult(bondForceMag);
                                this.applyForce(bondForce);
                            }
                        }
                    }
                }
                if (this.bondedTo) {
                    let partner = this.bondedTo;
                    if (partner && partner.pos && this.pos) {
                        let bondVector = p5.Vector.sub(partner.pos, this.pos);
                        let currentDist = bondVector.mag();
                        if (currentDist > 0.1) {
                            let displacement = currentDist - equilibriumBondDist_NaCl;
                            let bondStrength = bondForceConstant * displacement;
                            let bondForce = bondVector.normalize().mult(bondStrength);
                            this.applyForce(bondForce);
                        }
                    } else {
                        logEvent(`Bond broken: partner invalid for ${this.elementName || this.type}`);
                        this.bondedTo = null;
                    }
                }
            }

            // Orbit an electron around its nucleus. Behavior depends on whether
            // useRealOrbitals is on: the "quantum" path samples from the orbital's
            // probability cloud; the legacy path uses a simple circle.
            updateOrbit() {
                if (!this.isBound || !this.boundTo || !this.boundTo.pos) return;
                const nucleusPos = this.boundTo.pos;
                // While excited (after absorbing a photon) the electron is drawn
                // in the shell it was promoted to, so the jump is visible. Shell
                // bookkeeping (orbitalLevel) stays with the ground-state shell.
                const level = (this.isExcited && this.excitedToShell) ? this.excitedToShell : this.orbitalLevel;
                if (this._drawnLevel !== level) {
                    this._drawnLevel = level;
                    this.orbitalResampleIn = 0;   // move to the new shell right away
                }

                // --- Electron tunneling: rare teleport to classically forbidden spot ---
                if (useTunneling && random(1) < 0.002) {
                    // Occasional jump to a position on the "wrong" side of the nucleus
                    const r = bohrRadius * level * (1 + (level - 1) * 0.1);
                    const teleportPos = p5.Vector.add(nucleusPos, p5.Vector.random3D().mult(r * random(0.4, 1.6)));
                    this.pos = teleportPos;
                    this.vel = this.boundTo.vel ? this.boundTo.vel.copy() : createVector(0, 0, 0);
                    this.acc.mult(0);
                    // Small visual cue
                    photons.push({
                        pos: teleportPos.copy(), birthFrame: frameCount,
                        maxRadius: 8, duration: 12, color: [150, 230, 255], age: 0,
                        isFlash: true
                    });
                    return;
                }

                if (useRealOrbitals) {
                    // --- Quantum cloud path: smoothly move toward sampled targets ---
                    // Resample target every ~30 frames or when we've reached current one
                    this.orbitalResampleIn -= 1;
                    const distToTarget = this.orbitalTarget
                        ? p5.Vector.sub(p5.Vector.add(nucleusPos, this.orbitalTarget), this.pos).magSq()
                        : Infinity;
                    if (this.orbitalResampleIn <= 0 || distToTarget < 4) {
                        this.orbitalTarget = sampleOrbitalPosition(
                            level, this.subshell, this.orbitalVariant
                        );
                        this.orbitalResampleIn = floor(random(20, 50));
                    }
                    // Smoothly lerp toward (nucleus + target)
                    const absTarget = p5.Vector.add(nucleusPos, this.orbitalTarget);
                    this.pos = p5.Vector.lerp(this.pos, absTarget, 0.15);
                } else {
                    // --- Legacy simple circular orbit ---
                    const radius = bohrRadius * level * (1 + (level - 1) * 0.1);
                    this.orbitalPhase += this.orbitalAngularSpeed;
                    let axis = this.orbitalAxis;
                    if (axis.magSq() < 0.0001) { axis = p5.Vector.random3D(); this.orbitalAxis = axis; }
                    const helper = abs(axis.x) < 0.9 ? createVector(1, 0, 0) : createVector(0, 1, 0);
                    const u = p5.Vector.cross(axis, helper).normalize();
                    const v = p5.Vector.cross(axis, u).normalize();
                    const offset = p5.Vector.add(
                        p5.Vector.mult(u, cos(this.orbitalPhase) * radius),
                        p5.Vector.mult(v, sin(this.orbitalPhase) * radius)
                    );
                    this.pos = p5.Vector.add(nucleusPos, offset);
                }
                this.vel = this.boundTo.vel ? this.boundTo.vel.copy() : createVector(0, 0, 0);
                this.acc.mult(0);
            }

            // Keep non-center nucleons glued to their center
            updateNucleonMembers() {
                this.nucleusMembers.forEach(member => {
                    if (member && member.pos && this.pos) {
                        let targetOffset = p5.Vector.sub(member.pos, this.pos).limit(member.radius + this.radius - 0.5);
                        member.pos.lerp(p5.Vector.add(this.pos, targetOffset), 0.7);
                        member.vel = this.vel ? this.vel.copy() : createVector(0, 0, 0);
                    }
                });
            }

            // Legacy Euler integration path (called when useVerletIntegration is false).
            update() {
                this.applyBondForces();

                if (this.isBound && this.boundTo && this.boundTo.pos) {
                    this.updateOrbit();
                    return;
                }

                if (this.nucleusMembers.length > 0 && !this.isNucleusCenter) {
                    this.vel.mult(damping * 0.8);
                    this.pos.add(this.vel);
                    this.acc.mult(0);
                    return;
                }

                this.vel.add(this.acc);
                this.vel.mult(damping);
                let maxSpeed = this.isNucleusCenter ? 4 : (this.bondedTo || (this.bonds && this.bonds.length > 0) ? 5 : 7);
                if (this.vel.magSq() > maxSpeed * maxSpeed) this.vel.setMag(maxSpeed);
                if (this.pos && this.vel && !isNaN(this.vel.x) && !isNaN(this.vel.y) && !isNaN(this.vel.z)) {
                    this.pos.add(this.vel);
                } else {
                    if (this.vel) this.vel.set(0, 0, 0);
                }
                this.acc.mult(0);
                if (this.isNucleusCenter) this.updateNucleonMembers();
            }

            display() {
                if (!this.pos || isNaN(this.pos.x) || isNaN(this.pos.y) || isNaN(this.pos.z)) return;
                push();
                translate(this.pos.x, this.pos.y, this.pos.z);
                let displayRadius = this.radius;
                // True-scale rendering mode: nucleus particles are drawn much smaller
                // to approximate the real size ratio (nucleus ~100,000x smaller than
                // the whole atom). We cap the shrink to keep them barely visible
                // rather than literally 100,000x smaller.
                if (useTrueScale) {
                    if (this.type === 'proton' || this.type === 'neutron' || this.isNucleusCenter) {
                        displayRadius *= 0.08; // ~12x shrink — still see it, much closer to real
                    } else if (this.type === 'electron' || this.type === 'positron') {
                        displayRadius *= 0.5;  // electrons/positrons are genuinely small even in reality
                    }
                }
                let energyColorMod = 1.0;
                if (this.vel && !this.isBound) {
                    let kineticEnergy = 0.5 * massForTick(this) * this.vel.magSq();
                    energyColorMod = constrain(map(kineticEnergy, 0, targetTemperature * 2 + 1, 0.8, 1.5), 0.7, 1.6);
                }
                let baseColor = [...this.color];

                // Color-by mode: override the default type-based color
                if (particleColorMode !== 'type') {
                    const cc = getColorByValue(this);
                    if (cc) baseColor = cc;
                }

                if (this.isBound) { baseColor[3] = 160; displayRadius *= 0.9; }
                if (this.bondedTo || (this.bonds && this.bonds.length > 0)) { energyColorMod *= 0.95; }
                let r = constrain(baseColor[0] * energyColorMod, 0, 255);
                let g = constrain(baseColor[1] * energyColorMod, 0, 255);
                let b = constrain(baseColor[2] * energyColorMod, 0, 255);
                let a = baseColor.length > 3 ? baseColor[3] : 220;

                // Hover highlight. The key is only computed while an entity-list
                // row is hovered: it used to be computed for every particle every
                // frame, scanning every nucleus's member list for each free one.
                let shouldHighlight = (hoveredEntityType !== null && entityKeyFor(this) === hoveredEntityType);

                if (shouldHighlight) {
                    let blinkRate = 20;
                    let blinkOn = frameCount % blinkRate < (blinkRate / 2);
                    if (blinkOn) emissiveMaterial(255, 223, 0);
                    else emissiveMaterial(128, 110, 0);
                } else if (this.isPartOfMolecule) {
                    emissiveMaterial(50, 40, 0);
                } else if (showPhaseColoring && this.isNucleusCenter && this.phase) {
                    // Subtle phase-based tint — only on nucleus centers, so
                    // loose electrons/protons keep their normal look. The tint
                    // is dim enough not to overwhelm the atom's element color.
                    //   solid  → cool blue (atoms held in place by neighbors)
                    //   liquid → teal (mobile but close-packed)
                    //   gas    → almost nothing (default look)
                    //   plasma → hot magenta (ionized, high-energy)
                    switch (this.phase) {
                        case 'solid':  emissiveMaterial(20, 60, 110); break;
                        case 'liquid': emissiveMaterial(25, 75, 80);  break;
                        case 'plasma': emissiveMaterial(180, 40, 90); break;
                        default:       emissiveMaterial(0);
                    }
                } else if (this.isExcited) {
                    // Electron has absorbed a photon and is in an excited state —
                    // give it a yellow-white halo so you can spot excited atoms.
                    emissiveMaterial(220, 200, 80);
                } else {
                    emissiveMaterial(0);
                }
                // ambientMaterial() only accepts 3 args (RGB). Alpha goes via fill().
                ambientMaterial(r, g, b);
                // (the old else-branch called noFill(), which would have made an
                // opaque particle invisible)
                if (a < 255) fill(r, g, b, a); else fill(r, g, b);
                noStroke();
                // Coarser tessellation for small spheres: p5's default 24x16
                // mesh is 768 triangles per particle, invisible detail at 3-5 px.
                const detail = displayRadius < 4 ? 10 : 16;
                sphere(max(0.5, displayRadius), detail, Math.round(detail * 0.75));
                pop();
            }
        }

        // Entity-list key for a particle: molecule label, element+charge for a
        // nucleus, or the particle type for anything free. Shared by the entity
        // list and the hover highlight so the two always agree. Membership test
        // is O(1): non-center nucleons carry their cluster adjacency in
        // nucleusMembers, and electrons/positrons are never nucleus members.
        function entityKeyFor(p) {
            if (!p) return null;
            if (p.isPartOfMolecule && p.moleculeLabel) return p.moleculeLabel;
            if (p.isNucleusCenter) {
                if (p.elementName === 'n' && (!p.boundElectrons || p.boundElectrons.length === 0)) return 'Neutron';
                const netCharge = getNetCharge(p);
                let chargeLabel = '';
                if (netCharge > 0) chargeLabel = `+${netCharge}`;
                else if (netCharge < 0) chargeLabel = `${netCharge}`;
                return `${p.elementName}${chargeLabel}`;
            }
            if (p.isBound || p.bondedTo || (p.bonds && p.bonds.length > 0)) return null;
            if (p.nucleusMembers && p.nucleusMembers.length > 0) return null;   // inside a nucleus
            return p.type.charAt(0).toUpperCase() + p.type.slice(1);
        }

        // Effective mass (particle + nucleons + bound electrons), cached per
        // tick by applyForces(). getEffectiveMass() walks the member and
        // electron lists, and it used to run for every pairwise force call:
        // a uranium atom summed ~330 entries per interaction.
        function massForTick(p) {
            return (p.__emTick === simTick && p.__em !== undefined) ? p.__em : getEffectiveMass(p);
        }

        // --- Simulation Add/Clear ---
        function addParticle(type, silent = false) {
            if (particles.length >= MAX_PARTICLES) {
                if (!silent) logEvent(`Particle cap (${MAX_PARTICLES}) reached; skipping.`);
                return;
            }
            const spawnRadius = 150;
            const x = random(-spawnRadius, spawnRadius);
            const y = random(-spawnRadius, spawnRadius);
            const z = random(-spawnRadius, spawnRadius);
            if (properties[type]) {
                particles.push(new Particle(x, y, z, type));
                forceNucleiRefresh = true;
                if (!silent) logEvent(`Added ${type}`);
            } else {
                console.error("Invalid particle type:", type);
            }
        }

        // deltaNOverride (optional): neutron offset to use instead of the ΔN box.
        // The lesson engine uses it (the C-14 step needs +2 regardless of the UI).
        function addAtom(type, deltaNOverride) {
            const config = atomConfigs[type];
            if (!config) { logEvent(`Error: Unknown atom type "${type}"`, 'other'); return; }
            // Read isotope offset (ΔN) from the input — user can deliberately pick
            // a lighter or heavier-than-stable isotope
            let deltaN = 0;
            if (typeof deltaNOverride === 'number' && isFinite(deltaNOverride)) {
                deltaN = Math.round(deltaNOverride);
            } else {
                const isoInput = document.getElementById('isotopeN');
                if (isoInput) {
                    const v = parseInt(isoInput.value, 10);
                    if (!isNaN(v)) deltaN = v;
                }
            }
            const effectiveN = max(0, config.n + deltaN);
            const customConfig = { p: config.p, n: effectiveN, e: config.e };
            if (particles.length + customConfig.p + customConfig.n + customConfig.e > MAX_PARTICLES) {
                logEvent(`Cannot add ${type}: would exceed particle cap.`, 'other');
                return;
            }
            // Spawn clear of existing matter
            let spawnX, spawnY, spawnZ;
            let spawnRange = 80;
            if (particles.length > 200) spawnRange = 160;
            if (particles.length > 600) spawnRange = 260;
            const minClearance = 50;
            for (let tries = 0; tries < 10; tries++) {
                spawnX = random(-spawnRange, spawnRange);
                spawnY = random(-spawnRange, spawnRange);
                spawnZ = random(-spawnRange, spawnRange);
                let clear = true;
                for (const n of nuclei) {
                    if (!n || !n.pos) continue;
                    const dx = n.pos.x - spawnX, dy = n.pos.y - spawnY, dz = n.pos.z - spawnZ;
                    if (dx*dx + dy*dy + dz*dz < minClearance*minClearance) { clear = false; break; }
                }
                if (clear) break;
            }
            let structure = createAtomOrIonStructure(type, customConfig, customConfig.p, 0, spawnX, spawnY, spawnZ);
            if (structure && structure.nucleusCenter && structure.allParticles) {
                particles.push(...structure.allParticles);
                forceNucleiRefresh = true;
                const isoLabel = deltaN === 0 ? '' : ` (${effectiveN === 0 ? 'no n' : `N=${effectiveN}`})`;
                logEvent(`Added atom: ${structure.nucleusCenter.elementName}${isoLabel}`, 'other');
                try { Achievements.notify('atom_added', { symbol: structure.nucleusCenter.elementName }); } catch(_e){}
            } else {
                logEvent(`Failed to add atom ${type} structure.`, 'other');
            }
        }

        function addIon(elementType, desiredCharge) {
            const baseType = elementType.toLowerCase();
            const config = atomConfigs[baseType];
            if (!config) { logEvent(`Error: Base atom type "${baseType}" not found.`); return; }
            const electronsNeeded = config.p - desiredCharge;
            if (electronsNeeded < 0) {
                logEvent(`Error: Cannot create ion ${elementType} with charge ${desiredCharge}.`);
                return;
            }
            if (particles.length + config.p + config.n + electronsNeeded > MAX_PARTICLES) {
                logEvent(`Cannot add ion: would exceed particle cap.`);
                return;
            }
            // Spawn clear of existing matter
            let spawnX, spawnY, spawnZ;
            let spawnRange = 80;
            if (particles.length > 200) spawnRange = 160;
            if (particles.length > 600) spawnRange = 260;
            const minClearance = 50;
            for (let tries = 0; tries < 10; tries++) {
                spawnX = random(-spawnRange, spawnRange);
                spawnY = random(-spawnRange, spawnRange);
                spawnZ = random(-spawnRange, spawnRange);
                let clear = true;
                for (const n of nuclei) {
                    if (!n || !n.pos) continue;
                    const dx = n.pos.x - spawnX, dy = n.pos.y - spawnY, dz = n.pos.z - spawnZ;
                    if (dx*dx + dy*dy + dz*dz < minClearance*minClearance) { clear = false; break; }
                }
                if (clear) break;
            }
            let structure = createAtomOrIonStructure(baseType, config, electronsNeeded, desiredCharge, spawnX, spawnY, spawnZ);
            if (structure && structure.nucleusCenter && structure.allParticles) {
                particles.push(...structure.allParticles);
                forceNucleiRefresh = true;
                logEvent(`Added ion: ${structure.nucleusCenter.elementName}${desiredCharge > 0 ? '+' : ''}${desiredCharge}`);
                try { Achievements.notify('atom_added', { symbol: structure.nucleusCenter.elementName }); } catch(_e){}
            } else {
                logEvent(`Failed to add ion ${elementType} structure.`);
            }
        }

        function createAtomOrIonStructure(baseType, config, electronsToBind, charge, spawnX, spawnY, spawnZ) {
            const particleVelocity = p5.Vector.random3D().mult(random(0.3, 1.0));
            let newNucleons = [];
            let newElectrons = [];
            let nucleusCenter = null;

            // Build nucleons distributed in a small sphere (not overlapping)
            const totalNucleons = config.p + config.n;
            for (let i = 0; i < config.p; i++) {
                let offset = p5.Vector.random3D().mult(random(0, properties.proton.radius * 0.8));
                let p = new Particle(spawnX + offset.x, spawnY + offset.y, spawnZ + offset.z, 'proton');
                p.vel = particleVelocity.copy();
                newNucleons.push(p);
            }
            for (let i = 0; i < config.n; i++) {
                let offset = p5.Vector.random3D().mult(random(0, properties.neutron.radius * 0.8));
                let n = new Particle(spawnX + offset.x, spawnY + offset.y, spawnZ + offset.z, 'neutron');
                n.vel = particleVelocity.copy();
                newNucleons.push(n);
            }

            if (newNucleons.length > 0) {
                nucleusCenter = newNucleons[0];
                nucleusCenter.pos.set(spawnX, spawnY, spawnZ);
                nucleusCenter.isNucleusCenter = true;
                nucleusCenter.nucleusMembers = newNucleons.slice(1);
                nucleusCenter.nucleusCharge = config.p * properties.proton.charge;
                nucleusCenter.elementName = elementNames[config.p] || `Z=${config.p}`;
                nucleusCenter.maxBonds = getTypicalMaxBonds(nucleusCenter.elementName);
                nucleusCenter.bonds = [];
                nucleusCenter.boundElectrons = [];
                nucleusCenter.nucleusMembers.forEach(member => {
                    member.isNucleusCenter = false;
                    member.vel = particleVelocity.copy();
                    let offsetDir = p5.Vector.random3D().mult(nucleusCenter.radius * 0.7);
                    member.pos = p5.Vector.add(nucleusCenter.pos, offsetDir);
                });
            } else {
                logEvent(`Error creating nucleus structure for ${baseType}`);
                return null;
            }

            // Bind electrons shell by shell, in Aufbau (Madelung) proportions:
            // potassium gets 2-8-8-1 rather than 2-8-9.
            const shellTargets = shellCountsFor(electronsToBind);
            let electronCount = 0;
            for (let shell = 0; shell < shellCapacities.length && electronCount < electronsToBind; shell++) {
                let capacity = Math.min(shellCapacities[shell], shellTargets[shell] || 0);
                let shellLevel = shell + 1;
                let electronsInThisShell = 0;
                while (electronCount < electronsToBind && electronsInThisShell < capacity) {
                    let elec = new Particle(spawnX, spawnY, spawnZ, 'electron');
                    elec.isBound = true;
                    elec.boundTo = nucleusCenter;
                    elec.orbitalLevel = shellLevel;
                    elec.orbitalAxis = p5.Vector.random3D();
                    elec.orbitalPhase = random(TWO_PI);
                    elec.orbitalAngularSpeed = orbitalSpeed * random(0.8, 1.2) / shellLevel;
                    // Assign quantum-orbital info based on position within the shell
                    assignOrbital(elec, shellLevel, electronsInThisShell);
                    elec.orbitalTarget = sampleOrbitalPosition(shellLevel, elec.subshell, elec.orbitalVariant);
                    elec.orbitalResampleIn = floor(random(10, 30));
                    let radius = bohrRadius * shellLevel * (1 + (shellLevel - 1) * 0.1);
                    let randomVec = p5.Vector.random3D().mult(radius);
                    elec.pos = p5.Vector.add(nucleusCenter.pos, randomVec);
                    elec.vel = particleVelocity.copy();
                    nucleusCenter.boundElectrons.push(elec);
                    newElectrons.push(elec);
                    electronsInThisShell++;
                    electronCount++;
                }
            }
            if (electronCount < electronsToBind) {
                logEvent(`Warning: ${baseType} needs ${electronsToBind} e-, capacity allowed ${electronCount}.`);
            }
            return { nucleusCenter: nucleusCenter, allParticles: [...newNucleons, ...newElectrons] };
        }

        function addMolecule(moleculeKey) {
            const config = moleculeConfigs[moleculeKey];
            if (!config) { logEvent(`Error: Unknown molecule type: ${moleculeKey}`); return; }
            // Cap check (approximate)
            let estCount = 0;
            for (const c of config.components) {
                const cfg = atomConfigs[c.type.toLowerCase()];
                if (cfg) estCount += cfg.p + cfg.n + (cfg.p - (c.charge || 0));
            }
            if (particles.length + estCount > MAX_PARTICLES) {
                logEvent(`Cannot add ${config.displayName}: would exceed particle cap.`);
                return;
            }

            // Diagnostic: mark the next several updateNuclei() calls to dump cluster
            // info to the console. Helps debug cases like "adding water produces
            // HeO". Auto-clears after N frames. Bumped to 120 frames (~2 sec at 60 fps)
            // so we can see the bug appear LATER, not just at spawn.
            if (typeof window !== 'undefined' && window.QSIM_DEBUG) {
                _diagnoseNextMoleculeAdd = {
                    key: moleculeKey,
                    framesRemaining: 120,
                    startFrame: (typeof frameCount !== 'undefined' ? frameCount : 0),
                    logEveryNFrames: 10  // throttle to keep console readable
                };
            }

            // Pick a spawn position that doesn't overlap existing matter. We
            // try up to 12 random locations; accept the first that has no
            // existing nucleus within minClearance units. Falls back to the
            // last candidate if none is clear — better than infinite loop.
            // This prevents the old failure where two waters spawned in
            // overlapping cubes fused into "ClHe"-style super-nuclei on the
            // very first physics tick.
            const minClearance = 60;            // molecules are ~40-80 units wide
            let spawnRange = 80;                // grow if scene is getting busy
            if (particles.length > 200) spawnRange = 160;
            if (particles.length > 600) spawnRange = 260;
            let spawnX, spawnY, spawnZ;
            for (let tries = 0; tries < 12; tries++) {
                spawnX = random(-spawnRange, spawnRange);
                spawnY = random(-spawnRange, spawnRange);
                spawnZ = random(-spawnRange, spawnRange);
                let clear = true;
                for (const n of nuclei) {
                    if (!n || !n.pos) continue;
                    const dx = n.pos.x - spawnX;
                    const dy = n.pos.y - spawnY;
                    const dz = n.pos.z - spawnZ;
                    if (dx * dx + dy * dy + dz * dz < minClearance * minClearance) {
                        clear = false; break;
                    }
                }
                if (clear) break;
            }
            const moleculeVelocity = p5.Vector.random3D().mult(random(0.2, 0.8));
            let componentParticles = {};
            let allNewParticles = [];
            let componentData = {};

            for (const component of config.components) {
                const baseConfig = atomConfigs[component.type.toLowerCase()];
                if (!baseConfig) { logEvent(`Error: Base atom config not found for ${component.type}`); continue; }
                const electronsNeeded = baseConfig.p - component.charge;
                if (electronsNeeded < 0) { logEvent(`Error: Invalid charge for ${component.type}`); continue; }
                // Use separate spawn offset so components don't fully overlap before placement
                let structure = createAtomOrIonStructure(component.type, baseConfig, electronsNeeded, component.charge, spawnX, spawnY, spawnZ);
                if (structure && structure.nucleusCenter) {
                    componentParticles[component.id] = structure.nucleusCenter;
                    allNewParticles.push(...structure.allParticles);
                    componentData[component.id] = component;
                } else {
                    logEvent(`Failed to create structure for component ${component.id}`);
                    return;
                }
            }

            // Place components via BFS, respecting specified directions
            let placedParticles = new Set();
            let queue = [];
            const firstComponentId = config.components[0].id;
            if (componentParticles[firstComponentId]) {
                let firstNucleus = componentParticles[firstComponentId];
                firstNucleus.pos.set(spawnX, spawnY, spawnZ);
                allNewParticles.forEach(p => {
                    if (p.boundTo === firstNucleus || p === firstNucleus || firstNucleus.nucleusMembers.includes(p))
                        p.vel = moleculeVelocity.copy();
                });
                placedParticles.add(firstComponentId);
                queue.push(firstComponentId);
            } else {
                logEvent("Error: First molecule component invalid.");
                return;
            }

            while (queue.length > 0) {
                let currentId = queue.shift();
                let currentNucleus = componentParticles[currentId];
                for (const compId in componentParticles) {
                    if (placedParticles.has(compId)) continue;
                    const compConfig = componentData[compId];
                    if (compConfig.bondTo === currentId) {
                        let partnerNucleus = componentParticles[compId];
                        let bondType = compConfig.bondType || 'covalent';
                        let dist;
                        if (bondType === 'ionic') {
                            dist = equilibriumBondDist_NaCl * (compConfig.distScale || 1.0);
                        } else {
                            dist = getEquilibriumDist(currentNucleus, partnerNucleus) * (compConfig.distScale || 1.0);
                        }
                        // Prefer direction vector; fall back to legacy 2D angle
                        let offsetVec;
                        if (compConfig.dir && compConfig.dir.length === 3) {
                            let dv = createVector(compConfig.dir[0], compConfig.dir[1], compConfig.dir[2]);
                            if (dv.magSq() > 0) dv.normalize();
                            else dv = p5.Vector.random3D();
                            offsetVec = p5.Vector.mult(dv, dist);
                        } else {
                            let angle = radians(compConfig.angle || 0);
                            offsetVec = createVector(dist * cos(angle), dist * sin(angle), 0);
                        }
                        partnerNucleus.pos = p5.Vector.add(currentNucleus.pos, offsetVec);
                        // Update dependent particles (nucleons + bound electrons)
                        allNewParticles.forEach(p => {
                            if (p === partnerNucleus || partnerNucleus.nucleusMembers.includes(p) || p.boundTo === partnerNucleus) {
                                p.vel = moleculeVelocity.copy();
                            }
                        });
                        placedParticles.add(compId);
                        queue.push(compId);
                    }
                }
            }

            // Reposition bound electrons around their (now moved) nuclei
            allNewParticles.forEach(p => {
                if (p.type === 'electron' && p.isBound && p.boundTo && p.boundTo.pos) {
                    let nucleusPos = p.boundTo.pos;
                    let radius = bohrRadius * p.orbitalLevel * (1 + (p.orbitalLevel - 1) * 0.1);
                    let randomVec = p5.Vector.random3D().mult(radius);
                    p.pos = p5.Vector.add(nucleusPos, randomVec);
                }
            });

            // Reposition non-center nucleons near their nucleus center
            for (const id in componentParticles) {
                let nc = componentParticles[id];
                nc.nucleusMembers.forEach(m => {
                    let offset = p5.Vector.random3D().mult(nc.radius * 0.7);
                    m.pos = p5.Vector.add(nc.pos, offset);
                });
            }

            // Form the bonds
            for (const compId in componentParticles) {
                const compConfig = componentData[compId];
                if (compConfig.bondTo) {
                    let p1 = componentParticles[compId];
                    let p2 = componentParticles[compConfig.bondTo];
                    if (p1 && p2) {
                        if (compConfig.bondType === 'ionic') {
                            if (!p1.bondedTo && !p2.bondedTo && p1.bonds.length === 0 && p2.bonds.length === 0) {
                                p1.bondedTo = p2; p2.bondedTo = p1;
                            } else logEvent(`Bonding conflict for ionic ${compId}-${compConfig.bondTo}`);
                        } else {
                            if (!p1.bonds.includes(p2) && p1.bonds.length < p1.maxBonds && p2.bonds.length < p2.maxBonds) {
                                p1.bonds.push(p2); p2.bonds.push(p1);
                                // Record bond order (default 1 if not specified)
                                const order = compConfig.bondOrder || 1;
                                if (order > 1) {
                                    p1.bondOrderMap.set(p2, order);
                                    p2.bondOrderMap.set(p1, order);
                                }
                            } else logEvent(`Bonding conflict for covalent ${compId}-${compConfig.bondTo}`);
                        }
                    }
                }
            }

            particles.push(...allNewParticles);
            forceNucleiRefresh = true;
            logEvent(`Added molecule: ${config.displayName}`);
            try {
                // Gather composition from components for achievement classification
                const composition = {};
                for (const c of config.components) {
                    if (c.type) composition[c.type] = (composition[c.type] || 0) + 1;
                }
                Achievements.notify('molecule_added', {
                    id: moleculeKey,          // was config.id, which is undefined
                    displayName: config.displayName,
                    composition
                });
            } catch(_e){}
        }

        function randomFillSpace() {
            const numParticles = floor(random(80, 250));
            const particleTypes = ['electron', 'proton', 'neutron'];
            const weights = [0.4, 0.4, 0.2];
            let cumulativeWeights = [];
            let sum = 0;
            weights.forEach(w => { sum += w; cumulativeWeights.push(sum); });
            logEvent(`Adding ${numParticles} random particles...`);
            for (let i = 0; i < numParticles; i++) {
                let r = random(sum);
                let randomType = particleTypes[0];
                for (let j = 0; j < cumulativeWeights.length; j++) {
                    if (r < cumulativeWeights[j]) { randomType = particleTypes[j]; break; }
                }
                addParticle(randomType, true); // silent — don't flood log
            }
        }

        function clearParticles() {
            particles = []; nuclei = []; molecules = []; photons = [];
            simTime = 0;  // reset the simulated clock
            electricField.x = 0; electricField.y = 0; electricField.z = 0;
            let eXInput = select('#efieldX'); if (eXInput) eXInput.value('0');
            let eYInput = select('#efieldY'); if (eYInput) eYInput.value('0');
            let eZInput = select('#efieldZ'); if (eZInput) eZInput.value('0');
            G = 0;
            let gSlider = select('#gravitySlider'); if (gSlider) gSlider.value(G);
            let gValueSpan = select('#gravityValue'); if (gValueSpan) gValueSpan.html(G.toFixed(3));
            targetTemperature = 0.3;
            let tempSlider = select('#tempSlider'); if (tempSlider) tempSlider.value(targetTemperature);
            let tempValueSpan = select('#tempValue'); if (tempValueSpan) tempValueSpan.html(targetTemperature.toFixed(1));
            unbreakableBonds = false;
            let ubCheckbox = select('#unbreakableCheckbox'); if (ubCheckbox) ubCheckbox.checked(false);
            // The magnetic field was the one physics setting "Clear All" left
            // behind (E, G, T and unbreakable were reset, B kept acting).
            magneticField.x = 0; magneticField.y = 0; magneticField.z = 0;
            ['bfieldX', 'bfieldY', 'bfieldZ'].forEach(id => { const el = document.getElementById(id); if (el) el.value = '0'; });
            recentLogsHtml = [];
            const logBox = document.getElementById('logBoxHtml'); if (logBox) logBox.innerHTML = '';
            if (entityListElement) entityListElement.innerHTML = '<h4 aria-level=2>Entities:</h4><ul><li>None</li></ul>';
            hoveredEntityType = null; // FIXED: was `hoveredParticle` (undefined)
            // Drop references to particles that no longer exist
            draggingParticle = null;
            if (inspectedParticle) closeInspector();
            // Graph history described the old scene
            graphData.temp = []; graphData.energy = []; graphData.molecules = [];
            graphData.nuclei = []; graphData.speedSamples = [];
            lastMoleculeCount = 0;
            clearAllLabels();
            spatialGrid.clear();
            fpsHistory = [];
            logEvent("Simulation Cleared & Reset.");
        }

        // =====================================================================
        //  SAVE / LOAD SCENE (file-based)
        // =====================================================================
        // Serializes the current scene to a JSON file the user can download,
        // and loads scenes back from files. File-based rather than URL-based
        // because scenes with many particles produce JSON too large to fit in
        // a reasonable URL fragment.
        //
        // Format: { v: version, p: [...], b: [...], n: [...], e: [...],
        //           s: {settings}, t: simTime }
        // Each particle: [typeCode, x, y, z, vx, vy, vz, extras?]

        const SCENE_FILE_VERSION = 1;
        const SCENE_TYPE_CODES = { 'electron': 'e', 'proton': 'p', 'neutron': 'n', 'positron': 'q' };
        const SCENE_TYPE_DECODE = { 'e': 'electron', 'p': 'proton', 'n': 'neutron', 'q': 'positron' };

        function serializeSceneToObject() {
            // Index the particles that are actually written. The old code indexed
            // the raw array but wrote a filtered one, so any hole in the array
            // shifted every later bond / nucleus / electron reference.
            const list = particles.filter(p => p && p.pos);
            const idx = new Map();
            list.forEach((p, i) => idx.set(p, i));

            const r2 = (n) => Math.round(n * 100) / 100;

            // Particles: [tc, x, y, z, vx, vy, vz, extras?]
            const pArr = list.map(p => {
                const arr = [
                    SCENE_TYPE_CODES[p.type] || p.type,
                    r2(p.pos.x), r2(p.pos.y), r2(p.pos.z),
                    r2(p.vel.x), r2(p.vel.y), r2(p.vel.z)
                ];
                const extras = {};
                if (p.isNucleusCenter && p.elementName) extras.e = p.elementName;
                if (p.isBound) extras.b = 1;
                if (p.orbitalLevel) extras.ol = p.orbitalLevel;
                if (p.isExcited) {
                    extras.x = 1;
                    // optional (ignored by older readers): excited shell and line
                    if (p.excitedToShell) extras.xs = p.excitedToShell;
                    if (p.excitedWavelength) extras.xw = r2(p.excitedWavelength);
                }
                if (Object.keys(extras).length > 0) arr.push(extras);
                return arr;
            });

            // Bond pairs
            const bArr = [];
            list.forEach((p, i) => {
                if (p.bonds) {
                    p.bonds.forEach(q => {
                        const j = idx.get(q);
                        if (j !== undefined && i < j) {
                            const order = p.bondOrderMap && p.bondOrderMap.get(q);
                            bArr.push(order && order > 1 ? [i, j, order] : [i, j]);
                        }
                    });
                }
                if (p.bondedTo) {
                    const j = idx.get(p.bondedTo);
                    if (j !== undefined && i < j) bArr.push([i, j, 0]); // 0 = ionic
                }
            });

            // Nucleus groups
            const nArr = [];
            nuclei.forEach(nuc => {
                const centerIdx = idx.get(nuc);
                if (centerIdx === undefined) return;
                const members = (nuc.nucleusMembers || [])
                    .map(m => idx.get(m))
                    .filter(i => i !== undefined);
                nArr.push([centerIdx, ...members]);
            });

            // Bound-electron groups
            const eArr = [];
            nuclei.forEach(nuc => {
                const centerIdx = idx.get(nuc);
                if (centerIdx === undefined) return;
                const eIdx = (nuc.boundElectrons || [])
                    .map(e => idx.get(e))
                    .filter(i => i !== undefined);
                if (eIdx.length > 0) eArr.push([centerIdx, ...eIdx]);
            });

            // Settings
            const s = {
                T: targetTemperature,
                G: G,
                ef: [electricField.x, electricField.y, electricField.z],
                bf: [magneticField.x, magneticField.y, magneticField.z],
                ub: unbreakableBonds ? 1 : 0,
                cb: useContainment ? 1 : 0     // optional; older readers ignore it
            };

            return {
                v: SCENE_FILE_VERSION,
                p: pArr,
                b: bArr,
                n: nArr,
                e: eArr,
                s: s,
                t: Math.round(simTime),
                meta: {
                    savedAt: new Date().toISOString(),
                    particleCount: pArr.length
                }
            };
        }

        // Inverse: takes a parsed scene object and rebuilds the sim from it.
        // Returns { ok: bool, message: string }.
        function deserializeSceneFromObject(scene) {
            if (!scene || typeof scene !== 'object') {
                return { ok: false, message: 'Not a valid scene object.' };
            }
            if (scene.v !== SCENE_FILE_VERSION) {
                return { ok: false, message: `Unsupported scene version (got ${scene.v}, expected ${SCENE_FILE_VERSION}).` };
            }
            if (!Array.isArray(scene.p)) {
                return { ok: false, message: 'Scene has no particles array.' };
            }

            clearParticles();

            // Scene files are shared, so treat every field as untrusted: numbers
            // must be finite, indexes must be integers in range.
            const num = (v, fallback = 0) => (typeof v === 'number' && isFinite(v)) ? v : fallback;
            const at = (list, i) => (Number.isInteger(i) && i >= 0 && i < list.length) ? list[i] : null;

            // 1) Rebuild particles. Invalid entries keep a null slot so the
            //    indexes used by the bond / nucleus / electron arrays stay aligned
            //    (skipping them used to shift every later reference).
            const slots = [];
            for (const entry of scene.p) {
                if (!Array.isArray(entry) || entry.length < 7) { slots.push(null); continue; }
                const [tc, x, y, z, vx, vy, vz, extras] = entry;
                const type = SCENE_TYPE_DECODE[tc] || tc;
                if (!Object.prototype.hasOwnProperty.call(properties, type)) { slots.push(null); continue; }
                const p = new Particle(num(x), num(y), num(z), type);
                p.vel.set(num(vx), num(vy), num(vz));
                if (extras && typeof extras === 'object') {
                    // extras.e (element name) is deliberately NOT restored: it is
                    // recomputed from the proton count below. Names reach innerHTML
                    // (entity list, inspector), so a crafted file could inject markup.
                    if (extras.b) p.isBound = true;
                    const ol = Math.round(num(extras.ol));
                    if (ol >= 1 && ol <= shellCapacities.length) p.orbitalLevel = ol;
                    if (extras.x) {
                        p.isExcited = true;
                        const xs = Math.round(num(extras.xs));
                        if (xs >= 1 && xs <= shellCapacities.length) p.excitedToShell = xs;
                        const xw = num(extras.xw);
                        if (xw > 0) p.excitedWavelength = xw;
                    }
                }
                slots.push(p);
            }
            particles = slots;   // compacted after all links are rebuilt

            // 2) Rebuild nucleus groups
            if (Array.isArray(scene.n)) {
                for (const group of scene.n) {
                    if (!Array.isArray(group) || group.length < 1) continue;
                    const center = at(particles, group[0]);
                    if (!center || (center.type !== 'proton' && center.type !== 'neutron')) continue;
                    center.isNucleusCenter = true;
                    center.nucleusMembers = [];
                    for (let k = 1; k < group.length; k++) {
                        const mem = at(particles, group[k]);
                        if (mem && mem !== center && (mem.type === 'proton' || mem.type === 'neutron')) {
                            mem.isNucleusCenter = false;
                            center.nucleusMembers.push(mem);
                        }
                    }
                    const cluster = [center, ...center.nucleusMembers];
                    center.elementName = nucleusElementName(
                        cluster.filter(m => m.type === 'proton').length, cluster.length);
                    center.maxBonds = getTypicalMaxBonds(center.elementName);
                    center.nucleusCharge = cluster.reduce((q, m) => q + m.charge, 0);
                    center.boundElectrons = [];
                }
            }

            // 3) Rebuild bound-electron groups
            if (Array.isArray(scene.e)) {
                for (const group of scene.e) {
                    if (!Array.isArray(group) || group.length < 2) continue;
                    const center = at(particles, group[0]);
                    if (!center || !center.isNucleusCenter) continue;
                    center.boundElectrons = [];
                    for (let k = 1; k < group.length; k++) {
                        const e = at(particles, group[k]);
                        if (e && e.type === 'electron') {
                            e.boundTo = center;
                            e.isBound = true;
                            if (!e.orbitalLevel) e.orbitalLevel = 1;
                            center.boundElectrons.push(e);
                        }
                    }
                    // Subshells are not stored in the file: reassign them in
                    // Aufbau order (they all came back as 's' before).
                    const perShell = {};
                    center.boundElectrons.forEach(e => {
                        const idxInShell = perShell[e.orbitalLevel] || 0;
                        perShell[e.orbitalLevel] = idxInShell + 1;
                        assignOrbital(e, e.orbitalLevel, idxInShell);
                        e.orbitalTarget = sampleOrbitalPosition(e.orbitalLevel, e.subshell, e.orbitalVariant);
                        e.orbitalResampleIn = 0;
                    });
                }
            }
            // A bound flag with no owning nucleus would leave a frozen electron
            for (const p of particles) {
                if (p && p.isBound && !p.boundTo) { p.isBound = false; p.isExcited = false; }
            }

            // 4) Rebuild bonds
            if (Array.isArray(scene.b)) {
                for (const pair of scene.b) {
                    if (!Array.isArray(pair) || pair.length < 2) continue;
                    const [i, j, order] = pair;
                    const a = at(particles, i), b = at(particles, j);
                    if (!a || !b || a === b) continue;
                    if (order === 0) {
                        a.bondedTo = b;
                        b.bondedTo = a;
                    } else {
                        if (!a.bonds.includes(b)) a.bonds.push(b);
                        if (!b.bonds.includes(a)) b.bonds.push(a);
                        if (order === 2 || order === 3) {
                            a.bondOrderMap.set(b, order);
                            b.bondOrderMap.set(a, order);
                        }
                    }
                }
            }
            particles = particles.filter(p => p);

            // 5) Apply physics settings (clamped to the ranges the UI allows)
            if (scene.s && typeof scene.s === 'object') {
                if (typeof scene.s.T === 'number' && isFinite(scene.s.T)) {
                    targetTemperature = constrain(scene.s.T, 0, 30);
                    const ts = select('#tempSlider'); if (ts) ts.value(targetTemperature);
                    const tv = select('#tempValue'); if (tv) tv.html(targetTemperature.toFixed(1));
                }
                if (typeof scene.s.G === 'number' && isFinite(scene.s.G)) {
                    G = constrain(scene.s.G, 0, 0.5);
                    const gs = select('#gravitySlider'); if (gs) gs.value(G);
                    const gv = select('#gravityValue'); if (gv) gv.html(G.toFixed(3));
                }
                if (Array.isArray(scene.s.ef)) {
                    electricField.x = num(scene.s.ef[0]);
                    electricField.y = num(scene.s.ef[1]);
                    electricField.z = num(scene.s.ef[2]);
                    const ex = select('#efieldX'); if (ex) ex.value(electricField.x);
                    const ey = select('#efieldY'); if (ey) ey.value(electricField.y);
                    const ez = select('#efieldZ'); if (ez) ez.value(electricField.z);
                }
                if (Array.isArray(scene.s.bf)) {
                    magneticField.x = num(scene.s.bf[0]);
                    magneticField.y = num(scene.s.bf[1]);
                    magneticField.z = num(scene.s.bf[2]);
                    // The B inputs were never updated on load, so the panel showed
                    // 0 while a loaded field was bending every charge.
                    const bx = document.getElementById('bfieldX'); if (bx) bx.value = magneticField.x;
                    const by = document.getElementById('bfieldY'); if (by) by.value = magneticField.y;
                    const bz = document.getElementById('bfieldZ'); if (bz) bz.value = magneticField.z;
                }
                if (scene.s.ub) {
                    unbreakableBonds = true;
                    const ub = select('#unbreakableCheckbox'); if (ub) ub.checked(true);
                }
                if (scene.s.cb === 0 || scene.s.cb === 1) {
                    useContainment = scene.s.cb === 1;
                    const cb = document.getElementById('containmentCheckbox'); if (cb) cb.checked = useContainment;
                }
            }

            if (typeof scene.t === 'number' && isFinite(scene.t) && scene.t >= 0) simTime = scene.t;
            forceNucleiRefresh = true;

            return {
                ok: true,
                message: `Loaded scene: ${particles.length} particles, ${Array.isArray(scene.b) ? scene.b.length : 0} bonds.`
            };
        }

        // Trigger a file download of the current scene
        function saveSceneToFile() {
            try {
                const scene = serializeSceneToObject();
                const json = JSON.stringify(scene, null, 2);
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                // Filename: quantum-scene-YYYY-MM-DD-HHMM.json
                const d = new Date();
                const pad = (n) => String(n).padStart(2, '0');
                const stamp = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
                a.href = url;
                a.download = `quantum-scene-${stamp}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                // Revoke after a short delay so the browser has time to start the download
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                logEvent(`Saved scene (${scene.p.length} particles) to ${a.download}`);
            } catch (e) {
                console.error('Save failed:', e);
                logEvent(`Save failed: ${e.message}`);
            }
        }

        // Read a user-selected file and deserialize it
        function loadSceneFromFile(file) {
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const text = ev.target.result;
                    const scene = JSON.parse(text);
                    const result = deserializeSceneFromObject(scene);
                    if (result.ok) {
                        logEvent(result.message);
                    } else {
                        logEvent(`Load failed: ${result.message}`);
                        alert(`Couldn't load that file:\n\n${result.message}`);
                    }
                } catch (e) {
                    console.error('Load failed:', e);
                    logEvent(`Load failed: ${e.message}`);
                    alert(`Couldn't parse that file:\n\n${e.message}`);
                }
            };
            reader.onerror = () => {
                logEvent(`Could not read file.`);
                alert(`Could not read ${file.name}.`);
            };
            reader.readAsText(file);
        }



        // --- Nucleus & Molecule Identification ---
        // When a former nucleus center ends up as a member of a bigger cluster
        // (it fused into a nucleus whose center has a lower index), its chemical
        // bonds used to stay on the member particle: orphaned, while the partner
        // kept a bond to something no longer treated as an atom. Move them to the
        // new center, dropping bonds inside the cluster and any beyond the new
        // element's valence.
        function transferBondsToCenter(from, to, clusterSet) {
            if (from.bonds && from.bonds.length) {
                for (const partner of from.bonds.slice()) {
                    const order = (from.bondOrderMap && from.bondOrderMap.get(partner)) || 1;
                    if (partner && partner.bonds) {
                        const k = partner.bonds.indexOf(from);
                        if (k > -1) partner.bonds.splice(k, 1);
                        if (partner.bondOrderMap) partner.bondOrderMap.delete(from);
                    }
                    if (!partner || partner === to || clusterSet.has(partner)) continue;
                    if (to.bonds.includes(partner) || to.bonds.length >= to.maxBonds) continue;
                    to.bonds.push(partner);
                    partner.bonds.push(to);
                    if (order > 1) { to.bondOrderMap.set(partner, order); partner.bondOrderMap.set(to, order); }
                }
                from.bonds = [];
                if (from.bondOrderMap) from.bondOrderMap.clear();
            }
            if (from.bondedTo) {
                const partner = from.bondedTo;
                from.bondedTo = null;
                if (partner.bondedTo === from) partner.bondedTo = null;
                if (partner !== to && !clusterSet.has(partner) && !to.bondedTo && !partner.bondedTo) {
                    to.bondedTo = partner;
                    partner.bondedTo = to;
                }
            }
        }

        function updateNuclei() {
            let newlyFormedNucleiNames = [];
            let wasCenterMap = new Map();
            const particleIndex = new Map();
            particles.forEach((p, i) => { if (p) particleIndex.set(p, i); });
            nuclei.forEach(n => { if (n) wasCenterMap.set(n, true); });
            nuclei = [];

            // --- Remember the previous-frame nucleus ownership -----------------
            // Before we clear isNucleusCenter on all nucleons, build a map of
            // "nucleon → the center it belonged to last frame". We need this to
            // prevent the flood-fill from merging two atoms that are covalently
            // bonded to each other — if a water molecule's H-O bond oscillates
            // inward, we should NOT let the strong-force flood-fill treat it as
            // a fused HeO-like nucleus. That's the long-standing HeO bug:
            // thermal motion briefly brings nucleons within range, they cluster,
            // the element label gets recomputed from the wrong proton count.
            //
            // Map: every nucleon → its previous-frame center particle.
            // For nucleons that WERE centers, they map to themselves.
            const previousCenterOf = new Map();
            particles.forEach(p => {
                if (!p) return;
                if (p.type !== 'proton' && p.type !== 'neutron') return;
                if (p.isNucleusCenter) {
                    previousCenterOf.set(p, p);
                    (p.nucleusMembers || []).forEach(m => previousCenterOf.set(m, p));
                }
            });

            // Reset per-frame fields on nucleons. Preserve bonds & bound electron lists on centers.
            particles.forEach(p => {
                if (!p) return;
                if (p.type === 'proton' || p.type === 'neutron') {
                    p.nucleusMembers = [];
                    p.isNucleusCenter = false;
                    p.nucleusCharge = p.charge;
                    // Don't clear elementName/bonds here - they'll be re-derived if p becomes a center
                } else {
                    p.isPartOfMolecule = false;
                }
            });

            let currentNucleons = particles.filter(p => p && (p.type === 'proton' || p.type === 'neutron'));

            // Build adjacency — a nucleon belongs to a cluster if another
            // nucleon is within nuclearForceRangeSq * 1.5. BUT: refuse to merge
            // two nucleons that are owned by different atoms already covalently
            // bonded to each other. Atoms in a covalent bond stay as separate
            // nuclei even if thermal motion briefly brings them close.
            for (let i = 0; i < currentNucleons.length; i++) {
                let p1 = currentNucleons[i];
                if (!p1.pos) continue;
                const owner1 = previousCenterOf.get(p1);
                for (let j = i + 1; j < currentNucleons.length; j++) {
                    let p2 = currentNucleons[j];
                    if (!p2.pos) continue;
                    let diff = p5.Vector.sub(p1.pos, p2.pos);
                    let dSq = diff.magSq();
                    if (dSq < nuclearForceRangeSq * 1.5) {
                        // Covalent-bond guard: if p1 and p2's previous-frame
                        // centers are different atoms AND those atoms belong
                        // to the same molecule, do NOT merge them. "Same
                        // molecule" means either:
                        //   (a) owner1 and owner2 are directly covalently/ionically bonded, or
                        //   (b) owner1 and owner2 share a common bond partner
                        //       (e.g. H1 and H2 in water — both bonded to O,
                        //        not directly bonded to each other, but still
                        //        shouldn't merge into a "He" cluster).
                        const owner2 = previousCenterOf.get(p2);
                        if (owner1 && owner2 && owner1 !== owner2) {
                            // Two atoms that both still carry electrons never fuse.
                            // Chemistry-temperature collisions used to merge
                            // nuclei whenever nucleons passed within ~17 units:
                            // water clusters grew He, C or Na, two Na+ ions became
                            // Ti. Fusion stays possible where it belongs: bare
                            // nuclei and free nucleons (plasma, nucleon soup).
                            if (owner1.boundElectrons && owner1.boundElectrons.length > 0 &&
                                owner2.boundElectrons && owner2.boundElectrons.length > 0) continue;
                            // Direct bond?
                            let bonded =
                                (owner1.bonds && owner1.bonds.includes(owner2)) ||
                                (owner2.bonds && owner2.bonds.includes(owner1)) ||
                                owner1.bondedTo === owner2 ||
                                owner2.bondedTo === owner1;
                            // Shared-partner bond? (e.g. H-O-H)
                            if (!bonded && owner1.bonds && owner2.bonds) {
                                for (const partner of owner1.bonds) {
                                    if (owner2.bonds.includes(partner)) {
                                        bonded = true; break;
                                    }
                                }
                            }
                            if (bonded) continue;
                        }
                        if (!p1.nucleusMembers.includes(p2)) p1.nucleusMembers.push(p2);
                        if (!p2.nucleusMembers.includes(p1)) p2.nucleusMembers.push(p1);
                    }
                }
            }

            // Flood-fill cluster identification
            let processed = new Set();
            currentNucleons.forEach(p => {
                if (processed.has(p)) return;
                let cluster = new Set([p]);
                let queue = [...p.nucleusMembers];
                processed.add(p);
                while (queue.length > 0) {
                    let member = queue.shift();
                    if (member instanceof Particle && !processed.has(member)) {
                        processed.add(member);
                        cluster.add(member);
                        member.nucleusMembers.forEach(nextMember => {
                            if (nextMember instanceof Particle && !processed.has(nextMember)) queue.push(nextMember);
                        });
                    }
                }
                if (cluster.size === 0) return;

                // Choose center as the lowest-index particle in the cluster (stable across frames).
                // Index lookups come from a map built once per update; the old
                // particles.indexOf() per comparison was O(cluster x N) per nucleus.
                let centerParticle = [...cluster].reduce((a, b) => {
                    let idxA = particleIndex.has(a) ? particleIndex.get(a) : -1;
                    let idxB = particleIndex.has(b) ? particleIndex.get(b) : -1;
                    if (idxA === -1) return b;
                    if (idxB === -1) return a;
                    return idxA < idxB ? a : b;
                });
                if (!centerParticle) return;

                let wasAlreadyCenter = wasCenterMap.has(centerParticle);
                centerParticle.isNucleusCenter = true;
                centerParticle.nucleusMembers = [...cluster].filter(mem => mem !== centerParticle);
                centerParticle.nucleusCharge = 0;
                centerParticle.boundElectrons = centerParticle.boundElectrons || [];
                let currentBoundElectrons = [];
                let protonCount = 0;

                cluster.forEach(member => {
                    if (!member) return;
                    centerParticle.nucleusCharge += member.charge;
                    if (member.type === 'proton') protonCount++;
                    if (member.boundElectrons && member.boundElectrons.length > 0) {
                        currentBoundElectrons.push(...member.boundElectrons.filter(e => e instanceof Particle));
                        if (member !== centerParticle) member.boundElectrons = [];
                    }
                });
                centerParticle.boundElectrons = [...new Set(currentBoundElectrons)];
                centerParticle.elementName = nucleusElementName(protonCount, cluster.size);
                centerParticle.maxBonds = getTypicalMaxBonds(centerParticle.elementName);
                centerParticle.bonds = centerParticle.bonds || [];
                centerParticle.boundElectrons.forEach(e => { if (e) e.boundTo = centerParticle; });
                nuclei.push(centerParticle);

                // A former center that became a member keeps no chemistry of its own
                cluster.forEach(member => {
                    if (member !== centerParticle && ((member.bonds && member.bonds.length > 0) || member.bondedTo)) {
                        transferBondsToCenter(member, centerParticle, cluster);
                    }
                });

                // Fusion: the cluster holds nucleons that belonged to two or more
                // separate nuclei last update. This used to be checked only when
                // the center had NOT been a center before, but the merged center is
                // almost always the lower-index nucleus that already was one, so
                // proton-proton fusion never registered (the fusion lesson could
                // not finish).
                const previousOwners = new Set();
                cluster.forEach(member => {
                    const prev = previousCenterOf.get(member);
                    if (prev) previousOwners.add(prev);
                });
                const fused = cluster.size > 1 && previousOwners.size >= 2;
                if (cluster.size > 1 && (!wasAlreadyCenter || fused) && centerParticle.elementName) {
                    newlyFormedNucleiNames.push(centerParticle.elementName);
                }
                if (fused && protonCount >= 2) {
                    try { Achievements.notify('fusion'); } catch(_e){}
                }

                // Keep non-center nucleons close to the center
                cluster.forEach(member => {
                    if (member !== centerParticle && member.pos && centerParticle.pos) {
                        let offset = p5.Vector.sub(member.pos, centerParticle.pos).limit(member.radius + centerParticle.radius - 1);
                        member.pos = p5.Vector.add(centerParticle.pos, offset);
                        member.isNucleusCenter = false;
                    }
                });
            });

            if (newlyFormedNucleiNames.length > 0) {
                logEvent(`Nuclei formed: ${newlyFormedNucleiNames.join(', ')}`);
            }

            // --- Diagnostic cluster dump -----------------------------------
            // If addMolecule() recently ran, log what clusters actually formed
            // so we can diagnose why "water" sometimes produces HeO etc.
            // Only log every N frames (default 10) and always log when the
            // cluster composition changes from the previous logged state.
            if (_diagnoseNextMoleculeAdd && _diagnoseNextMoleculeAdd.framesRemaining > 0) {
                _diagnoseNextMoleculeAdd.framesRemaining--;
                const frameOffset = (typeof frameCount !== 'undefined' ? frameCount : 0)
                                    - _diagnoseNextMoleculeAdd.startFrame;
                const rows = nuclei.map(n => {
                    let p = 0, nCount = 0;
                    const cluster = [n, ...(n.nucleusMembers || [])];
                    for (const m of cluster) {
                        if (!m) continue;
                        if (m.type === 'proton') p++;
                        else if (m.type === 'neutron') nCount++;
                    }
                    return {
                        element: n.elementName,
                        p, n: nCount,
                        pos: n.pos ? [+n.pos.x.toFixed(1), +n.pos.y.toFixed(1), +n.pos.z.toFixed(1)] : null
                    };
                });
                // Build a concise signature for change detection
                const signature = rows.map(r => `${r.element}${r.p}n${r.n}`).sort().join(',');
                const changed = signature !== _diagnoseNextMoleculeAdd.lastSignature;
                const throttle = _diagnoseNextMoleculeAdd.logEveryNFrames || 10;
                const dueForPeriodicLog = (frameOffset % throttle === 0);
                if (changed || dueForPeriodicLog) {
                    const tag = changed ? '[DIAG-CHANGE]' : '[DIAG]';
                    console.log(
                        `${tag} add:${_diagnoseNextMoleculeAdd.key} +${frameOffset}f — ` +
                        `clusters: ${rows.length} — ` +
                        rows.map(r => `${r.element}(p=${r.p},n=${r.n})@${JSON.stringify(r.pos)}`).join('  |  ')
                    );
                    _diagnoseNextMoleculeAdd.lastSignature = signature;
                }
                if (_diagnoseNextMoleculeAdd.framesRemaining <= 0) {
                    console.log(`[DIAG] add:${_diagnoseNextMoleculeAdd.key} — diagnostic window closed`);
                    _diagnoseNextMoleculeAdd = null;
                }
            }
        }

        let lastMoleculeCount = 0;   // molecules found by the previous updateMolecules()
        function updateMolecules() {
            let newlyFormedMolecules = [];
            let previousMoleculeLabels = new Set(molecules.map(m => m.label));
            molecules = [];
            particles.forEach(p => { if (p) { p.isPartOfMolecule = false; p.moleculeLabel = null; } });

            let processedInMolecule = new Set();
            nuclei.forEach(startNode => {
                if (!startNode || processedInMolecule.has(startNode) ||
                    (!startNode.bondedTo && (!startNode.bonds || startNode.bonds.length === 0))) {
                    return;
                }
                let currentMoleculeGroup = new Set();
                let queue = [startNode];
                processedInMolecule.add(startNode);
                while (queue.length > 0) {
                    let currentNode = queue.shift();
                    currentMoleculeGroup.add(currentNode);
                    let neighbors = []; // FIXED: was implicit global in original
                    if (currentNode.bondedTo && currentNode.bondedTo instanceof Particle) {
                        neighbors.push(currentNode.bondedTo);
                    }
                    if (currentNode.bonds && currentNode.bonds.length > 0) {
                        neighbors.push(...currentNode.bonds);
                    }
                    neighbors.forEach(neighbor => {
                        if (neighbor && neighbor instanceof Particle && !processedInMolecule.has(neighbor)) {
                            processedInMolecule.add(neighbor);
                            queue.push(neighbor);
                        }
                    });
                }

                if (currentMoleculeGroup.size >= 2) {
                    let moleculeEntities = [...currentMoleculeGroup];
                    let labelPos = createVector(0, 0, 0);
                    let totalMass = 0;
                    moleculeEntities.forEach(p => {
                        if (!p || !p.pos) return;
                        p.isPartOfMolecule = true;
                        let mass = p.mass;
                        if (p.isNucleusCenter) {
                            mass += p.nucleusMembers.reduce((sum, m) => sum + (m ? m.mass : 0), 0);
                            mass += p.boundElectrons.reduce((sum, e) => sum + (e ? e.mass : 0), 0);
                        }
                        if (mass > 0) {
                            labelPos.add(p5.Vector.mult(p.pos, mass));
                            totalMass += mass;
                        }
                    });
                    if (totalMass <= 0) {
                        let validPosEntities = moleculeEntities.filter(c => c && c.pos);
                        if (validPosEntities.length > 0) {
                            validPosEntities.forEach(center => labelPos.add(center.pos));
                            labelPos.div(validPosEntities.length);
                        } else return;
                    } else labelPos.div(totalMass);

                    let moleculeLabel = "Molecule";
                    let formulaCounts = {};
                    let nameParts = [];
                    moleculeEntities.filter(p => p && p.isNucleusCenter).forEach(c => {
                        if (c.elementName) formulaCounts[c.elementName] = (formulaCounts[c.elementName] || 0) + 1;
                    });
                    // Hill system ordering: C first, then H, then others alphabetical
                    let allKeys = Object.keys(formulaCounts);
                    let orderedKeys = [];
                    if (allKeys.includes('C')) orderedKeys.push('C');
                    if (allKeys.includes('H')) orderedKeys.push('H');
                    allKeys.filter(k => k !== 'C' && k !== 'H').sort().forEach(k => orderedKeys.push(k));
                    orderedKeys.forEach(name => {
                        nameParts.push(`${name}${formulaCounts[name] > 1 ? formulaCounts[name] : ''}`);
                    });
                    if (nameParts.length > 0) moleculeLabel = nameParts.join('');

                    moleculeEntities.forEach(p => p.moleculeLabel = moleculeLabel);
                    molecules.push({ centers: moleculeEntities, labelPos: labelPos, label: moleculeLabel, isInView: false });
                    if (!previousMoleculeLabels.has(moleculeLabel)) newlyFormedMolecules.push(moleculeLabel);
                }
            });

            if (newlyFormedMolecules.length > 0) {
                logEvent(`Molecule(s) formed/updated: ${[...new Set(newlyFormedMolecules)].join(', ')}`);
            } else if (molecules.length < lastMoleculeCount) {
                // Compares molecule counts. It used to compare the new count with
                // the number of distinct previous LABELS, so losing one of two
                // waters (1 label) was never reported.
                logEvent("Molecule(s) dissociated.");
            }
            lastMoleculeCount = molecules.length;

            // --- Unknown-molecule reporter ---------------------------------
            // Any time a new molecule label forms that we don't have in the
            // info-modal database, log it once and show it in the unknown-panel
            // UI so the user can copy it for patching.
            if (newlyFormedMolecules.length > 0) {
                let newlyReported = false;
                for (const label of new Set(newlyFormedMolecules)) {
                    if (reportedUnknownLabels.has(label)) continue;

                    // Compute element composition up front — we need it both for
                    // the "is this really a molecule?" check and for the UI.
                    // Composition represents ONE instance of this molecule, not
                    // the sum across all molecules with the same label. If the
                    // scene has three separate HHe clusters, we want to report
                    // {H:1, He:1} (the per-molecule composition), not {H:3, He:3}.
                    const composition = {};
                    const representative = molecules.find(mm => mm.label === label);
                    if (representative) {
                        representative.centers.forEach(p => {
                            if (p && p.isNucleusCenter && p.elementName) {
                                composition[p.elementName] = (composition[p.elementName] || 0) + 1;
                            }
                        });
                    }

                    let known = false;
                    try {
                        // 1. Exact hit in the molecule DB, or hit via alias.
                        if (typeof moleculeInfo !== 'undefined' && moleculeInfo[label]) known = true;
                        else if (typeof moleculeAliases !== 'undefined' &&
                                 moleculeAliases[label] &&
                                 moleculeInfo[moleculeAliases[label]]) known = true;
                        // 2. Single-element labels (e.g. "H", "He", "Fe", "He2")
                        //    aren't really molecules — the info modal already
                        //    resolves them via the element database, so don't
                        //    flag them.
                        if (!known) {
                            const elementKeys = Object.keys(composition);
                            if (elementKeys.length === 1 &&
                                typeof elementInfo !== 'undefined' &&
                                elementInfo[elementKeys[0]]) {
                                known = true;
                            }
                        }
                    } catch (_e) { /* TDZ or other; treat as unknown */ }

                    if (!known) {
                        reportedUnknownLabels.set(label, composition);
                        newlyReported = true;
                        console.warn(
                            `[PATCH-ME] Unknown molecule label "${label}" — ` +
                            `composition: ${JSON.stringify(composition)}. ` +
                            `Send this line to Claude to add it to the info database.`
                        );
                    }

                    // Also feed the classifier: record this in the discoveries
                    // panel regardless of whether it's in the DB — the classifier
                    // may still flag it as Notable (real but unusual).
                    try { recordDiscovery(label, composition); } catch (_e) {}

                    // Radical detection: molecules that are known open-shell
                    // species (unpaired electron). Short list of common ones
                    // produced by the cartoon. If the label matches, fire the
                    // achievement.
                    try {
                        // Labels as the sim writes them (C first, then H, then
                        // alphabetical): HN2 and HO2 were listed as N2H / HOO /
                        // O2H, which the sim never produces.
                        const KNOWN_RADICALS = new Set([
                            'HO', 'HS', 'NO', 'NO2', 'CH3', 'CN', 'CH', 'HN',
                            'HN2', 'HO2', 'CHO', 'HSi', 'HP'
                        ]);
                        if (KNOWN_RADICALS.has(label)) {
                            Achievements.notify('radical_formed');
                        }
                    } catch(_e){}
                }
                if (newlyReported) {
                    refreshUnknownPanel();
                    // First unknown of the session: show the panel (unless the
                    // user already closed it)
                    if (!unknownPanelVisible && !unknownPanelUserHidden) setUnknownPanelVisible(true);
                }
            }
        }

        // --- Interaction, Binding & Reactions ---
        // =====================================================================
        //  PHYSICS MICRO-BENCHMARK (console tool)
        // =====================================================================
        // From the browser console:  __benchPhysics(300, 180)
        // Spawns N synthetic free particles, times `ticks` calls to
        // advanceSimulation(), logs ms/tick, then restores the previous scene.
        window.__benchPhysics = function (n = 300, ticks = 180) {
            const saved = serializeSceneToObject();
            try {
                clearParticles();
                const span = 700;
                for (let i = 0; i < n; i++) {
                    const t = (i % 3 === 0) ? 'proton' : (i % 3 === 1) ? 'electron' : 'neutron';
                    particles.push(new Particle(
                        (Math.random() - 0.5) * span,
                        (Math.random() - 0.5) * span,
                        (Math.random() - 0.5) * span, t));
                }
                forceNucleiRefresh = true;
                const t0 = performance.now();
                for (let s = 0; s < ticks; s++) advanceSimulation();
                const t1 = performance.now();
                const msPerTick = (t1 - t0) / ticks;
                console.log('[bench] N=' + n + ' ticks=' + ticks + ' -> ' +
                    msPerTick.toFixed(3) + ' ms/tick (' +
                    (1000 / msPerTick).toFixed(0) + ' ticks/s), active=' +
                    lastActiveCount + ', ballistic=' + lastBallisticCount);
                return msPerTick;
            } finally {
                clearParticles();
                try { deserializeSceneFromObject(saved); }
                catch (e) { console.warn('[bench] scene restore failed', e); }
            }
        };

        function applyForces() {
            // Active = everything that integrates on its own: not a bound
            // electron, not a non-center nucleon. Their effective masses are
            // cached for this tick (see massForTick).
            const allActive = [];
            for (let i = 0; i < particles.length; i++) {
                const p = particles[i];
                if (!p || !p.pos || p.isBound || (p.nucleusMembers.length > 0 && !p.isNucleusCenter)) continue;
                p.__em = getEffectiveMass(p);
                p.__emTick = simTick;
                allActive.push(p);
            }

            // Uniform electric field (scalar form; identical semantics)
            const hasEField = electricField.x !== 0 || electricField.y !== 0 || electricField.z !== 0;
            if (hasEField) {
                for (const p of allActive) {
                    const q = getNetCharge(p);
                    if (q !== 0) p.applyForceScalar(electricField.x * q, electricField.y * q, electricField.z * q);
                }
            }

            // =================================================================
            // BALLISTIC FAST-PATH ("things just roll, they don't check")
            // =================================================================
            // Particles with no neighbor within short-range reach (and no bonds)
            // skip the short-range pair sweep. They are NOT exempt from the
            // long-range terms below: isolation is a short-range notion, and
            // dropping them from the Coulomb and gravity passes (as the old code
            // did) meant a proton and an electron 300 units apart never attracted
            // and the gravity demo never pulled distant particles together.
            let ballisticCount = 0;
            let pairList = allActive;
            if (useBallisticFastPath) {
                rebuildSpatialGrid(allActive);
                const filtered = [];
                for (const p of allActive) {
                    const eligible = !p.bondedTo && !(p.bonds && p.bonds.length > 0);
                    if (eligible && !gridHasNeighbor(p)) ballisticCount++;
                    else filtered.push(p);
                }
                pairList = filtered;
            }
            lastBallisticCount = ballisticCount;
            lastActiveCount = pairList.length;

            // Long-range terms: exact O(n²) passes over ALL active particles,
            // so their reach depends on neither the grid nor the fast path.
            // Above the caps, degrade to in-pair terms at pair-sweep reach.
            const charged = [];
            for (const p of allActive) {
                if (Math.abs(getNetCharge(p)) > neutrality_tolerance) charged.push(p);
            }
            const doCoulombPass = charged.length >= 2 && charged.length <= EXACT_COULOMB_MAX;
            const doGravityPass = (G !== 0) && allActive.length <= EXACT_GRAVITY_MAX;
            PAIR_DO_COULOMB = charged.length >= 2 && !doCoulombPass;   // fallback only
            PAIR_DO_GRAVITY = (G !== 0) && !doGravityPass;             // fallback only

            const N = pairList.length;
            const GRID_THRESHOLD = 80;

            if (N < GRID_THRESHOLD) {
                // Brute force over the pair list. Short-range terms clamp
                // themselves to SHORT_RANGE_CUTOFF_SQ; only the fallback
                // long-range terms need the wider gate.
                PAIR_RANGE_GATE_SQ = (PAIR_DO_COULOMB || PAIR_DO_GRAVITY) ? maxInteractionDistSq : SHORT_RANGE_CUTOFF_SQ;
                for (let i = 0; i < N; i++) {
                    const p1 = pairList[i];
                    for (let j = i + 1; j < N; j++) {
                        calculateInteraction(p1, pairList[j]);
                    }
                }
            } else {
                if (!useBallisticFastPath) rebuildSpatialGrid(pairList);
                PAIR_RANGE_GATE_SQ = SHORT_RANGE_CUTOFF_SQ;

                // Short-range pair sweep via cell lists. Each particle lives in
                // exactly one bucket and carries a unique per-tick __fidx stamp,
                // so the ordering test alone visits each unordered pair once —
                // no Set, no indexOf, no string keys. (A ballistic particle has
                // no neighbor, so it never appears in a swept particle's cells.)
                for (let i = 0; i < N; i++) {
                    const p1 = pairList[i];
                    const buckets = collectNeighborBuckets(p1, __bucketScratch);
                    const myIdx = p1.__fidx;
                    for (let b = 0; b < buckets.length; b++) {
                        const cell = buckets[b];
                        for (let c = 0; c < cell.length; c++) {
                            const p2 = cell[c];
                            if (p2.__fidx > myIdx) calculateInteraction(p1, p2);
                        }
                    }
                }
            }

            if (doCoulombPass) exactCoulombPass(charged);
            if (doGravityPass) exactGravityPass(allActive);
        }

        // Scalar Coulomb coefficient along the p1→p2 unit vector (positive =
        // pulls the pair together). Shifted-force form: smooth zero at cutoff.
        // Shared by the in-pair path and the exact pass so they cannot diverge.
        function coulombDirScalar(q1, q2, dSq) {
            const rSq = Math.max(dSq, minInteractionDistSq);
            const base = k * q1 * q2 * (1.0 / rSq - 1.0 / coulombCutoffSq);
            return useLegacyForceSigns ? base : -base;
        }

        // Scalar gravity coefficient along the p1→p2 unit vector.
        function gravityDirScalar(m1, m2, dSq) {
            const base = -(G * m1 * m2) / Math.max(dSq, minInteractionDistSq);
            return useLegacyForceSigns ? base : -base;
        }

        // Effective collision radii for a nucleus pair (outermost-shell based).
        // Written into a scratch object to keep the hot loop allocation-free.
        const __effScratch = { r1: 0, r2: 0 };
        function computeEffRadii(p1, p2) {
            let m1 = 0;
            const be1 = p1.boundElectrons;
            for (let i = 0; i < be1.length; i++) {
                const e = be1[i];
                if (e && e.orbitalLevel > m1) m1 = e.orbitalLevel;
            }
            let m2 = 0;
            const be2 = p2.boundElectrons;
            for (let i = 0; i < be2.length; i++) {
                const e = be2[i];
                if (e && e.orbitalLevel > m2) m2 = e.orbitalLevel;
            }
            __effScratch.r1 = (m1 === 0) ? p1.radius : bohrRadius * m1 * (1 + (m1 - 1) * 0.1);
            __effScratch.r2 = (m2 === 0) ? p2.radius : bohrRadius * m2 * (1 + (m2 - 1) * 0.1);
        }

        function calculateInteraction(p1, p2) {
            if (!p1 || !p1.pos || !p2 || !p2.pos) return;
            const dx = p2.pos.x - p1.pos.x;
            const dy = p2.pos.y - p1.pos.y;
            const dz = p2.pos.z - p1.pos.z;
            const dSq = dx * dx + dy * dy + dz * dz;
            if (dSq > PAIR_RANGE_GATE_SQ || dSq < 0.01) return;
            const dist = Math.sqrt(dSq);
            const inv = 1.0 / dist;
            const nx = dx * inv, ny = dy * inv, nz = dz * inv; // unit p1 -> p2
            let f = 0; // scalar along n: positive pulls p1 toward p2

            const isP1Nucleus = p1.isNucleusCenter;
            const isP2Nucleus = p2.isNucleusCenter;
            const alreadyBonded = (p1.bondedTo === p2) || (p1.bonds && p1.bonds.includes(p2));

            // Strong nuclear force: short-range attraction between free nucleons,
            // plus free-nucleon-to-small-nucleus attraction so fusion can occur.
            // A "free" nucleon is one with no cluster-mates. updateNuclei() makes
            // every lone nucleon the center of its own one-nucleon cluster, so
            // the old test (!isNucleusCenter) was false for every settled
            // nucleon and this attraction never ran.
            const isP1FreeNucleon = (p1.type === 'proton' || p1.type === 'neutron') && p1.nucleusMembers.length === 0;
            const isP2FreeNucleon = (p2.type === 'proton' || p2.type === 'neutron') && p2.nucleusMembers.length === 0;
            const nuclearAttractionApplies =
                (isP1FreeNucleon && isP2FreeNucleon) ||
                (isP1FreeNucleon && isP2Nucleus && p2.nucleusMembers.length < 50) ||
                (isP2FreeNucleon && isP1Nucleus && p1.nucleusMembers.length < 50);
            if (nuclearAttractionApplies && dSq < nuclearForceRangeSq) {
                if (dSq < nuclearHardCoreSq) {
                    const overlap = Math.sqrt(nuclearHardCoreSq) - dist;
                    f -= nucleonRepulsionStrength * overlap;        // hard core: repel
                } else {
                    f += nuclearForceStrength * (1.0 - dSq / nuclearForceRangeSq); // attract
                }
            }

            if (!alreadyBonded) {
                let lj_applied = false;
                const netCharge1 = getNetCharge(p1);
                const netCharge2 = getNetCharge(p2);
                const isNeutral1 = isP1Nucleus && Math.abs(netCharge1) < neutrality_tolerance;
                const isNeutral2 = isP2Nucleus && Math.abs(netCharge2) < neutrality_tolerance;

                if (isP1Nucleus && isP2Nucleus && isNeutral1 && isNeutral2) {
                    // Lennard-Jones between two neutral atoms (van der Waals).
                    // Clamped to SHORT_RANGE_CUTOFF_SQ in both paths so brute
                    // and grid modes agree exactly.
                    lj_applied = true;
                    if (dSq < SHORT_RANGE_CUTOFF_SQ) {
                        computeEffRadii(p1, p2);
                        const sigma = ((__effScratch.r1 + __effScratch.r2) / 2) * LJ_sigma_scale;
                        const cutoffDist = sigma * LJ_cutoff_scale;
                        if (dist < cutoffDist && sigma > 0) {
                            const sr = sigma / dist;
                            const sr6 = Math.pow(sr, 6);
                            const sr12 = sr6 * sr6;
                            // Textbook scalar: positive = repulsive.
                            let ljMag = (24 * LJ_epsilon / dist) * (2 * sr12 - sr6);
                            const max_lj_force = 50.0;
                            if (Math.abs(ljMag) > max_lj_force) ljMag = Math.sign(ljMag) * max_lj_force;
                            // Corrected: repulsive scalar pushes apart (−n direction).
                            // Legacy preserved the historical inversion.
                            f += useLegacyForceSigns ? ljMag : -ljMag;
                        }
                    }
                } else {
                    // Coulomb (shifted-force, smooth zero at the cutoff).
                    if (PAIR_DO_COULOMB && netCharge1 !== 0 && netCharge2 !== 0 && dSq < coulombCutoffSq) {
                        f += coulombDirScalar(netCharge1, netCharge2, dSq);
                    }
                    // Electron-shell overlap repulsion between two atoms. Contact is
                    // at the AVERAGE of the outer-shell radii, the same rule as the
                    // Lennard-Jones sigma for neutral atoms. It used to be the SUM,
                    // twice the neutral contact distance, which kept Na+ and Cl-
                    // 116 units apart (never within bonding range) and made the
                    // NaCl crystal preset explode.
                    if (isP1Nucleus && isP2Nucleus && dSq < SHORT_RANGE_CUTOFF_SQ) {
                        computeEffRadii(p1, p2);
                        const overlap = 0.5 * (__effScratch.r1 + __effScratch.r2) - dist;
                        if (overlap > 0) {
                            f -= K_shell * overlap * overlap;
                        }
                    }
                }

                // Hard-sphere contact repulsion (free particles and ions).
                const contactR = p1.radius + p2.radius;
                if (dSq < contactR * contactR && !lj_applied) {
                    let shellOverlapHandled = false;
                    if (isP1Nucleus && isP2Nucleus) {
                        computeEffRadii(p1, p2);
                        if (0.5 * (__effScratch.r1 + __effScratch.r2) - dist > 0) shellOverlapHandled = true;
                    }
                    if (!shellOverlapHandled) {
                        const overlap = contactR - dist;
                        if (overlap > 0) f -= 0.8 * overlap;
                    }
                }
            }

            // Gravity (sign per convention; legacy = historical inversion). Uses
            // the whole atom's mass: p.mass is only the center nucleon, so a
            // uranium atom used to pull (and be pulled) like a single proton.
            if (PAIR_DO_GRAVITY && G !== 0) {
                f += gravityDirScalar(massForTick(p1), massForTick(p2), dSq);
            }

            if (f !== 0) {
                const fx = nx * f, fy = ny * f, fz = nz * f;
                p1.applyForceScalar(fx, fy, fz);
                p2.applyForceScalar(-fx, -fy, -fz);   // Newton's 3rd law
            }
        }

        // Exact Coulomb among charged active particles (typically a small set:
        // ions, free electrons/protons/positrons). Restores the full 400-unit
        // shifted-force reach that the spatial grid cannot provide.
        const __chargeScratch = [];
        function exactCoulombPass(charged) {
            const n = charged.length;
            for (let i = 0; i < n; i++) __chargeScratch[i] = getNetCharge(charged[i]);
            for (let i = 0; i < n; i++) {
                const p1 = charged[i];
                const q1 = __chargeScratch[i];
                if (q1 === 0 || !p1.pos) continue;
                for (let j = i + 1; j < n; j++) {
                    const p2 = charged[j];
                    const q2 = __chargeScratch[j];
                    if (q2 === 0 || !p2.pos) continue;
                    if ((p1.bondedTo === p2) || (p1.bonds && p1.bonds.includes(p2))) continue;
                    const dx = p2.pos.x - p1.pos.x;
                    const dy = p2.pos.y - p1.pos.y;
                    const dz = p2.pos.z - p1.pos.z;
                    const dSq = dx * dx + dy * dy + dz * dz;
                    if (dSq >= coulombCutoffSq || dSq < 0.01) continue;
                    const f = coulombDirScalar(q1, q2, dSq);
                    const inv = 1.0 / Math.sqrt(dSq);
                    const fx = dx * inv * f, fy = dy * inv * f, fz = dz * inv * f;
                    p1.applyForceScalar(fx, fy, fz);
                    p2.applyForceScalar(-fx, -fy, -fz);
                }
            }
        }

        // Exact gravity among all active particles when G != 0 (gravity is an
        // explicit demo toggle; scenes using it are usually modest in size).
        function exactGravityPass(list) {
            const n = list.length;
            for (let i = 0; i < n; i++) {
                const p1 = list[i];
                if (!p1 || !p1.pos) continue;
                const m1 = massForTick(p1);   // whole-atom mass (was the center nucleon's)
                for (let j = i + 1; j < n; j++) {
                    const p2 = list[j];
                    if (!p2 || !p2.pos) continue;
                    const dx = p2.pos.x - p1.pos.x;
                    const dy = p2.pos.y - p1.pos.y;
                    const dz = p2.pos.z - p1.pos.z;
                    const dSq = dx * dx + dy * dy + dz * dz;
                    if (dSq > maxInteractionDistSq || dSq < 0.01) continue;
                    const f = gravityDirScalar(m1, massForTick(p2), dSq);
                    const inv = 1.0 / Math.sqrt(dSq);
                    const fx = dx * inv * f, fy = dy * inv * f, fz = dz * inv * f;
                    p1.applyForceScalar(fx, fy, fz);
                    p2.applyForceScalar(-fx, -fy, -fz);
                }
            }
        }

        function attemptBinding() {
            let freeElectrons = particles.filter(p => p && p.type === 'electron' && !p.isBound && p.pos && p.vel);
            // Only atoms/nuclei with net-positive charge (or slightly below) should attract electrons.
            // The original used raw nucleusCharge, so neutral atoms kept absorbing electrons.
            // Net charge is tracked as electrons bind during this pass. It used to
            // be checked once up front, so three free electrons near one bare
            // proton could all bind in the same tick and make H with charge -2.
            const netCharge = new Map();
            let potentialNuclei = nuclei.filter(n => {
                if (!n || !n.pos) return false;
                let net = getNetCharge(n);
                netCharge.set(n, net);
                return net > 0.1; // only attract if positively charged (ions or atoms missing e-)
            });
            freeElectrons.forEach(electron => {
                let closestNucleus = null;
                let minDistSq = Infinity;
                potentialNuclei.forEach(nucleus => {
                    if (netCharge.get(nucleus) <= 0.1) return;
                    const dx = nucleus.pos.x - electron.pos.x, dy = nucleus.pos.y - electron.pos.y, dz = nucleus.pos.z - electron.pos.z;
                    const dSq = dx * dx + dy * dy + dz * dz;
                    if (dSq < minDistSq) { minDistSq = dSq; closestNucleus = nucleus; }
                });
                if (closestNucleus && minDistSq < bindingDistanceThreshold ** 2) {
                    let nucleusVel = closestNucleus.vel || createVector(0, 0, 0);
                    let relVel = p5.Vector.sub(electron.vel, nucleusVel);
                    if (relVel.magSq() < bindingVelocityThresholdSq) {
                        // Aufbau: the shell the next electron belongs in (K+ takes
                        // its 19th electron in shell 4, not shell 3).
                        const targetShell = shellForNextElectron(closestNucleus.boundElectrons);
                        for (let shell = 0; shell < shellCapacities.length; shell++) {
                            let shellLevel = shell + 1;
                            if (targetShell && shellLevel !== targetShell) continue;
                            let currentInShell = closestNucleus.boundElectrons.filter(e => e && e.orbitalLevel === shellLevel).length;
                            if (currentInShell < shellCapacities[shell]) {
                                netCharge.set(closestNucleus, netCharge.get(closestNucleus) - 1);
                                electron.isBound = true;
                                electron.boundTo = closestNucleus;
                                electron.orbitalLevel = shellLevel;
                                electron.orbitalAxis = p5.Vector.random3D();
                                electron.orbitalPhase = random(TWO_PI);
                                electron.orbitalAngularSpeed = orbitalSpeed * random(0.8, 1.2) / shellLevel;
                                assignOrbital(electron, shellLevel, currentInShell);
                                electron.orbitalTarget = sampleOrbitalPosition(shellLevel, electron.subshell, electron.orbitalVariant);
                                electron.orbitalResampleIn = floor(random(10, 30));
                                closestNucleus.boundElectrons.push(electron);
                                electron.vel.mult(0.1);
                                photons.push({
                                    pos: electron.pos.copy(),
                                    birthFrame: frameCount,
                                    maxRadius: 15 + shellLevel * 5,
                                    duration: 15 + shellLevel * 2,
                                    color: [255, 255, 100],
                                    age: 0,
                                    isFlash: true
                                });
                                // Also emit real traveling photons — the energy
                                // released when an electron binds goes into
                                // light. Wavelength chosen loosely by shell:
                                // deeper shells release higher-energy (bluer)
                                // photons. Emit 2 in opposite directions (pair
                                // conservation of momentum cartoon).
                                // (The formula was 600 - 60n, which made the
                                // deepest shell the reddest, the opposite of this
                                // comment. Shell 1 -> 420 nm ... shell 7 -> 780 nm.)
                                const bindWL = 360 + shellLevel * 60; // nm
                                const emitDir = p5.Vector.random3D();
                                spawnTravelingPhoton(electron.pos, bindWL, emitDir);
                                spawnTravelingPhoton(electron.pos, bindWL, p5.Vector.mult(emitDir, -1));
                                logEvent(`Electron bound to ${closestNucleus.elementName} (${shellLevel}${electron.subshell})`);
                                break;
                            }
                        }
                    }
                }
            });
        }

        function handleReactions() {
            // Ionic bonding (Na+ + Cl- -> NaCl)
            let newlyBondedIonic = new Set();
            let potentialNa = nuclei.filter(n => n && !n.bondedTo && n.bonds.length === 0 &&
                n.elementName === 'Na' && getNetCharge(n) === 1);
            let potentialCl = nuclei.filter(n => n && !n.bondedTo && n.bonds.length === 0 &&
                n.elementName === 'Cl' && getNetCharge(n) === -1);
            potentialNa.forEach(naIon => {
                if (newlyBondedIonic.has(naIon)) return;
                potentialCl.forEach(clIon => {
                    if (newlyBondedIonic.has(clIon) || newlyBondedIonic.has(naIon)) return;
                    if (!naIon.pos || !clIon.pos) return;
                    let diff = p5.Vector.sub(naIon.pos, clIon.pos);
                    let distSq = diff.magSq();
                    if (distSq < reactionDistSq) {
                        let relVelSq = p5.Vector.sub(naIon.vel || createVector(0, 0, 0), clIon.vel || createVector(0, 0, 0)).magSq();
                        if (relVelSq < bindingEnergySq) {
                            if (random(1) < reactionProbability) {
                                naIon.bondedTo = clIon;
                                clIon.bondedTo = naIon;
                                logEvent("Ionic bond formed: NaCl");
                                try { Achievements.notify('bond_formed', { kind: 'ionic' }); } catch(_e){}
                                newlyBondedIonic.add(naIon);
                                newlyBondedIonic.add(clIon);
                            }
                        }
                    }
                });
            });

            // Covalent bonding
            let newlyBondedCovalent = new Set();
            let potentialReactants = nuclei.filter(n => n && !n.bondedTo && n.bonds.length < n.maxBonds && n.maxBonds > 0);
            for (let i = 0; i < potentialReactants.length; i++) {
                let p1 = potentialReactants[i];
                if (newlyBondedCovalent.has(p1) || newlyBondedIonic.has(p1)) continue;
                for (let j = i + 1; j < potentialReactants.length; j++) {
                    let p2 = potentialReactants[j];
                    if (newlyBondedCovalent.has(p2) || newlyBondedIonic.has(p2)) continue;
                    if (!p1.pos || !p2.pos) continue;
                    if (canFormCovalentBond(p1, p2)) {
                        let diff = p5.Vector.sub(p1.pos, p2.pos);
                        let distSq = diff.magSq();
                        let reactDist = getEquilibriumDist(p1, p2) * 1.2;
                        if (distSq < reactDist * reactDist) {
                            let relVelSq = p5.Vector.sub(p1.vel || createVector(0, 0, 0), p2.vel || createVector(0, 0, 0)).magSq();
                            if (relVelSq < bindingEnergySq * 1.5) {
                                if (random(1) < reactionProbability_covalent) {
                                    p1.bonds.push(p2);
                                    p2.bonds.push(p1);
                                    newlyBondedCovalent.add(p1);
                                    newlyBondedCovalent.add(p2);
                                    logEvent(`Covalent bond formed: ${p1.elementName}-${p2.elementName}`);
                                    try { Achievements.notify('bond_formed', { kind: 'covalent' }); } catch(_e){}
                                    break;
                                }
                            }
                        }
                    }
                }
            }

            // Ionic bond dissociation
            let currentlyIonicBonded = particles.filter(p => p && p.bondedTo);
            let processedIonicBonds = new Set();
            currentlyIonicBonded.forEach(p1 => {
                if (processedIonicBonds.has(p1)) return;
                let p2 = p1.bondedTo;
                if (p2 && !processedIonicBonds.has(p2)) {
                    // Stretch-based breaking: if the ionic bond has been pulled
                    // beyond bondBreakStretchRatio × equilibrium, snap it. This
                    // couples dissociation naturally to kinetic energy / temperature.
                    let breakByStretch = false;
                    if (!unbreakableBonds && p1.pos && p2.pos) {
                        const d = p5.Vector.sub(p1.pos, p2.pos).mag();
                        if (d > equilibriumBondDist_NaCl * bondBreakStretchRatio) breakByStretch = true;
                    }
                    if (breakByStretch || (!unbreakableBonds && random(1) < dissociationProbability)) {
                        const reason = breakByStretch ? 'stretched' : 'spontaneous';
                        logEvent(`Ionic bond broken: ${p1.elementName || '?'}-${p2.elementName || '?'} (${reason})`);
                        p1.bondedTo = null;
                        p2.bondedTo = null;
                        if (p1.pos && p2.pos) {
                            let pushVec = p5.Vector.sub(p1.pos, p2.pos).normalize().mult(0.5);
                            p1.applyForce(pushVec);
                            p2.applyForce(pushVec.mult(-1));
                        }
                    }
                    processedIonicBonds.add(p1);
                    processedIonicBonds.add(p2);
                } else if (!p2 && p1.bondedTo) {
                    p1.bondedTo = null;
                }
            });

            // Covalent bond dissociation + integrity check
            nuclei.forEach(p1 => {
                if (!p1 || !p1.bonds || p1.bonds.length === 0) return;
                for (let i = p1.bonds.length - 1; i >= 0; i--) {
                    let p2 = p1.bonds[i];
                    if (!p2 || !p2.bonds || !p2.bonds.includes(p1)) {
                        p1.bonds.splice(i, 1);
                        continue;
                    }
                    if (processedIonicBonds.has(p1) || processedIonicBonds.has(p2)) continue;
                    // Stretch-based breaking for covalent bonds
                    let breakByStretch = false;
                    if (!unbreakableBonds && p1.pos && p2.pos) {
                        const eqDist = getEquilibriumDist(p1, p2);
                        const d = p5.Vector.sub(p1.pos, p2.pos).mag();
                        if (d > eqDist * bondBreakStretchRatio) breakByStretch = true;
                    }
                    if (breakByStretch || (!unbreakableBonds && random(1) < dissociationProbability_covalent)) {
                        const reason = breakByStretch ? 'stretched' : 'spontaneous';
                        logEvent(`Covalent bond broken: ${p1.elementName}-${p2.elementName} (${reason})`);
                        let p2Index = p2.bonds.indexOf(p1);
                        if (p2Index > -1) p2.bonds.splice(p2Index, 1);
                        p1.bonds.splice(i, 1);
                        // Clean bond-order map
                        if (p1.bondOrderMap) p1.bondOrderMap.delete(p2);
                        if (p2.bondOrderMap) p2.bondOrderMap.delete(p1);
                        if (p1.pos && p2.pos) {
                            let pushVec = p5.Vector.sub(p1.pos, p2.pos).normalize().mult(0.6);
                            p1.applyForce(pushVec);
                            p2.applyForce(pushVec.mult(-1));
                        }
                    }
                }
            });
        }

        // --- Temperature Functions ---
        function calculateAverageKE() {
            let totalKE = 0; let count = 0;
            particles.forEach(p => {
                if (p && p.vel && !p.isBound && !(p.nucleusMembers.length > 0 && !p.isNucleusCenter)) {
                    let mass = getEffectiveMass(p);
                    let speedSq = p.vel.magSq();
                    totalKE += 0.5 * mass * speedSq;
                    count++;
                }
            });
            return (count > 0) ? totalKE / count : 0;
        }

        // Nuclear decay. Very simplified model:
        //   - Z > 83 nuclei may alpha-decay: eject a He-4 nucleus (2p + 2n)
        //   - Neutron-rich nuclei (N above the stable band) may beta-minus
        //     decay: one neutron converts to a proton + emitted fast electron
        //   - Proton-rich nuclei (N below the stable band) may beta-plus decay:
        //     one proton converts to a neutron + emitted fast positron. The
        //     positron is a real particle in the sim (type: 'positron',
        //     charge +1, same mass as an electron) and will feel the electric
        //     force and eventually meet a free electron, at which point the
        //     two annihilate into a photon flash (see handleAnnihilation()).
        // Half-lives are compressed way down so you see decay in seconds, not eons.
        //
        // Stable neutron range [minN, maxN] for Z = 1..83: lightest to heaviest
        // stable (or effectively stable primordial) isotope. Tc (43) and Pm (61)
        // have no stable isotope; their bands are empty (minN > maxN) and sit
        // at the observed split between electron capture and beta-minus.
        // This replaces the fit N = Z + 0.007 Z^2 (+/- 2), which sat 3-5
        // neutrons too high for heavy nuclei: Pb-208, Bi-209, Au-197, Pt-195 and
        // others beta-plus decayed, U-238 preferred beta-plus to alpha, and
        // C-14 (N = 8) counted as stable, so the carbon-dating lesson could
        // never see its beta decay.
        const STABLE_N_BAND = [null,
            [0,1],[1,2],[3,4],[5,5],[5,6],[6,7],[7,8],[8,10],[10,10],[10,12],                   // H..Ne
            [12,12],[12,14],[14,14],[14,16],[16,16],[16,20],[18,20],[18,22],[20,22],[20,28],     // Na..Ca
            [24,24],[24,28],[27,28],[26,30],[30,30],[28,32],[32,32],[30,36],[34,36],[34,40],     // Sc..Zn
            [38,40],[38,44],[42,42],[40,48],[44,46],[42,50],[48,50],[46,50],[50,50],[50,56],     // Ga..Zr
            [52,52],[50,58],[55,54],[52,60],[58,58],[56,64],[60,62],[58,68],[64,66],[62,74],     // Nb..Sn
            [70,72],[68,78],[74,74],[70,82],[78,78],[74,82],[81,82],[78,84],[82,82],[82,90],     // Sb..Nd
            [85,84],[82,92],[88,90],[88,96],[94,94],[90,98],[98,98],[94,102],[100,100],[98,106], // Pm..Yb
            [104,105],[102,108],[107,108],[106,112],[110,112],[108,116],[114,116],[112,120],[118,118],[116,124], // Lu..Hg
            [122,124],[122,126],[126,126]                                                     // Tl, Pb, Bi
        ];
        // Beta-stability line from the semi-empirical mass formula:
        // Z*(A) = A / (1.98 + 0.0155 A^(2/3)), solved for A at fixed Z.
        // Used for Z > 83, where no isotope is stable (alpha decay dominates).
        function stableNeutronCount(Z) {
            if (Z <= 0) return 0;
            let A = 2 * Z;
            for (let i = 0; i < 30; i++) A = Z * (1.98 + 0.0155 * Math.pow(A, 2 / 3));
            return Math.round(A - Z);
        }
        function nuclearStabilityBand(Z) {
            if (Z >= 1 && Z < STABLE_N_BAND.length) {
                const b = STABLE_N_BAND[Z];
                return { minN: b[0], maxN: b[1] };
            }
            const c = stableNeutronCount(Z);
            return { minN: c - 2, maxN: c + 2 };
        }

        const ALPHA_DECAY_PROB_PER_CHECK = 0.03;  // ~chance per 40-tick check if Z>83
        const BETA_DECAY_PROB_PER_CHECK = 0.05;   // ~chance per 40-tick check if N off

        function applyNuclearDecay() {
            // Iterate a snapshot because decay modifies the particles array
            const candidates = nuclei.slice();
            for (const center of candidates) {
                if (!center || !center.pos || !center.isNucleusCenter) continue;
                // Count protons and neutrons in this cluster
                let Z = 0, N = 0;
                const cluster = [center, ...center.nucleusMembers];
                for (const m of cluster) {
                    if (!m) continue;
                    if (m.type === 'proton') Z++;
                    else if (m.type === 'neutron') N++;
                }
                if (Z < 1) continue;
                const band = nuclearStabilityBand(Z);

                // Alpha decay: heavy nuclei spit out He-4
                if (Z > 83 && cluster.length >= 6 && random(1) < ALPHA_DECAY_PROB_PER_CHECK) {
                    performAlphaDecay(center, cluster);
                    continue;
                }
                // Beta-minus: neutron-rich → neutron turns into proton
                if (N > band.maxN && random(1) < BETA_DECAY_PROB_PER_CHECK) {
                    performBetaMinusDecay(center, cluster);
                    continue;
                }
                // Beta-plus: proton-rich → proton turns into neutron + positron.
                // Guard against removing the last proton in light nuclei.
                if (N < band.minN && Z >= 2 && random(1) < BETA_DECAY_PROB_PER_CHECK) {
                    performBetaPlusDecay(center, cluster);
                    continue;
                }
            }
        }

        function performAlphaDecay(center, cluster) {
            // Grab 2 protons + 2 neutrons from the cluster (not the center itself
            // if possible, so the remaining nucleus stays intact)
            const members = center.nucleusMembers.slice();
            const protons = members.filter(m => m && m.type === 'proton');
            const neutrons = members.filter(m => m && m.type === 'neutron');
            if (protons.length < 2 || neutrons.length < 2) return;
            const ejected = [protons[0], protons[1], neutrons[0], neutrons[1]];
            // Detach from center
            for (const m of ejected) {
                const idx = center.nucleusMembers.indexOf(m);
                if (idx > -1) center.nucleusMembers.splice(idx, 1);
                m.nucleusMembers = [];
                m.isNucleusCenter = false;
            }
            // Give them a coordinated velocity outward. They are placed 30 units
            // out: members sit up to ~9 units from the center and nucleons within
            // ~17 units cluster, so at the old 12 units the alpha particle was
            // usually re-absorbed by its parent on the next nucleus update.
            const dir = p5.Vector.random3D();
            const speed = 6.0; // fast! alpha decay releases lots of energy
            const alphaCenter = p5.Vector.add(center.pos, p5.Vector.mult(dir, 30));
            for (const m of ejected) {
                m.vel = p5.Vector.mult(dir, speed).add(p5.Vector.random3D().mult(0.3));
                m.pos = p5.Vector.add(alphaCenter, p5.Vector.random3D().mult(2));
                m.acc.set(0, 0, 0);
            }
            forceNucleiRefresh = true;
            // Also kick the parent nucleus in the opposite direction (conservation)
            const recoil = p5.Vector.mult(dir, -speed * 0.3);
            center.vel.add(recoil);
            // Flashy photon (stationary event marker)
            photons.push({
                pos: center.pos.copy(),
                birthFrame: frameCount,
                maxRadius: 40,
                duration: 25,
                color: [255, 180, 80],
                age: 0,
                isFlash: true
            });
            // Real gamma photons — alpha decays are usually accompanied by
            // gamma emission as the daughter nucleus de-excites. Very short
            // wavelength, rendered as bright near-white.
            for (let k = 0; k < 2; k++) {
                spawnTravelingPhoton(center.pos, 50, p5.Vector.random3D()); // 50 nm = far UV/soft X
            }
            logEvent(`Alpha decay! ${center.elementName} → lighter nucleus + He-4`);
            try { Achievements.notify('alpha_decay'); } catch(_e){}
        }

        function performBetaMinusDecay(center, cluster) {
            // Find one neutron in the cluster. If it's the center, it's weirder to
            // convert, so prefer a non-center member.
            let neutron = center.nucleusMembers.find(m => m && m.type === 'neutron');
            if (!neutron && center.type === 'neutron') neutron = center;
            if (!neutron) return;
            // Convert neutron → proton (change type, charge, color and mass;
            // the mass used to stay at the neutron's 1.01)
            neutron.type = 'proton';
            neutron.charge = 1;
            neutron.color = [...properties.proton.color];
            neutron.mass = properties.proton.mass;
            forceNucleiRefresh = true;   // re-identify the element next tick
            // Spawn a fast beta electron near the nucleus
            if (particles.length < MAX_PARTICLES) {
                const emitDir = p5.Vector.random3D();
                const e = new Particle(
                    center.pos.x + emitDir.x * 8,
                    center.pos.y + emitDir.y * 8,
                    center.pos.z + emitDir.z * 8,
                    'electron'
                );
                e.vel = p5.Vector.mult(emitDir, 5.0); // high speed (beta radiation)
                particles.push(e);
            }
            // Recoil on nucleus
            center.vel.add(p5.Vector.random3D().mult(0.3));
            // Visual — flash + a real photon (stand-in for antineutrino/gamma)
            photons.push({
                pos: center.pos.copy(),
                birthFrame: frameCount,
                maxRadius: 25,
                duration: 18,
                color: [120, 220, 180],
                age: 0,
                isFlash: true
            });
            spawnTravelingPhoton(center.pos, 450, p5.Vector.random3D()); // blue-green
            logEvent(`Beta⁻ decay! Neutron → proton + fast electron`);
            try { Achievements.notify('beta_decay'); } catch(_e){}
        }

        // Beta-plus decay: a proton inside a proton-rich nucleus converts to
        // a neutron, emitting a fast positron (e⁺). The positron carries charge
        // +1 and the same mass as an electron, so it feels electrostatic forces
        // like any other charged particle. If it meets a free electron, they
        // annihilate into photons (see handleAnnihilation()).
        function performBetaPlusDecay(center, cluster) {
            // Find a proton to convert. Prefer non-center members so the
            // nucleus's identity-tracking stays anchored.
            let proton = center.nucleusMembers.find(m => m && m.type === 'proton');
            if (!proton && center.type === 'proton') proton = center;
            if (!proton) return;
            // Convert proton → neutron (change type, charge, and color)
            proton.type = 'neutron';
            proton.charge = 0;
            proton.color = [...properties.neutron.color];
            proton.mass = properties.neutron.mass;
            forceNucleiRefresh = true;   // re-identify the element next tick
            // Spawn a fast positron just outside the nucleus
            if (particles.length < MAX_PARTICLES) {
                const emitDir = p5.Vector.random3D();
                const e = new Particle(
                    center.pos.x + emitDir.x * 8,
                    center.pos.y + emitDir.y * 8,
                    center.pos.z + emitDir.z * 8,
                    'positron'
                );
                e.vel = p5.Vector.mult(emitDir, 5.0); // high speed (beta radiation)
                particles.push(e);
            }
            // Recoil on nucleus (opposite direction is averaged by randomness)
            center.vel.add(p5.Vector.random3D().mult(0.3));
            // Visual — orange/pink flash to distinguish from β⁻ (greenish)
            photons.push({
                pos: center.pos.copy(),
                birthFrame: frameCount,
                maxRadius: 25,
                duration: 18,
                color: [255, 170, 220],
                age: 0,
                isFlash: true
            });
            spawnTravelingPhoton(center.pos, 620, p5.Vector.random3D()); // orange-red
            logEvent(`Beta⁺ decay! Proton → neutron + fast positron`);
            try { Achievements.notify('beta_plus_decay'); } catch(_e){}
        }

        // Electron-positron annihilation: when a free positron comes within
        // a few units of a free electron, both particles are destroyed and
        // their rest mass is released as photons (a pair of back-to-back
        // gamma rays in reality — visually, a bright flash). This is the
        // textbook E = mc² demonstration.
        const ANNIHILATION_DISTANCE = 12;
        function handleAnnihilation() {
            // Collect free positrons and free electrons (not bound). Leptons are
            // never nucleus members, so no nucleus scan is needed: the old loop
            // walked every nucleus's member list for every particle, every tick,
            // even with no positron in the scene (~3.4 ms/tick at 2,400 particles).
            const freePositrons = [];
            for (const p of particles) {
                if (p && p.pos && !p.isBound && p.type === 'positron') freePositrons.push(p);
            }
            if (freePositrons.length === 0) return;
            const freeElectrons = [];
            for (const p of particles) {
                if (p && p.pos && !p.isBound && p.type === 'electron') freeElectrons.push(p);
            }
            if (freeElectrons.length === 0) return;

            // Pair positrons with nearest electrons. Mark both for deletion.
            const toDelete = new Set();
            const annihilationPoints = [];
            for (const pos of freePositrons) {
                if (toDelete.has(pos)) continue;
                let closest = null;
                let closestDistSq = ANNIHILATION_DISTANCE * ANNIHILATION_DISTANCE;
                for (const ele of freeElectrons) {
                    if (toDelete.has(ele)) continue;
                    const dx = pos.pos.x - ele.pos.x;
                    const dy = pos.pos.y - ele.pos.y;
                    const dz = pos.pos.z - ele.pos.z;
                    const d2 = dx*dx + dy*dy + dz*dz;
                    if (d2 < closestDistSq) {
                        closestDistSq = d2;
                        closest = ele;
                    }
                }
                if (closest) {
                    toDelete.add(pos);
                    toDelete.add(closest);
                    // Midpoint of the two is where the flash appears
                    annihilationPoints.push(createVector(
                        (pos.pos.x + closest.pos.x) * 0.5,
                        (pos.pos.y + closest.pos.y) * 0.5,
                        (pos.pos.z + closest.pos.z) * 0.5
                    ));
                }
            }
            if (toDelete.size === 0) return;
            // Remove annihilated particles from the global particle list
            particles = particles.filter(p => !toDelete.has(p));
            if (inspectedParticle && toDelete.has(inspectedParticle)) closeInspector();
            if (draggingParticle && toDelete.has(draggingParticle)) draggingParticle = null;
            // Spawn bright photon flashes (two gamma rays per annihilation,
            // represented as one big visual pop for simplicity)
            for (const pt of annihilationPoints) {
                photons.push({
                    pos: pt.copy(),
                    birthFrame: frameCount,
                    maxRadius: 45,
                    duration: 30,
                    color: [255, 240, 200],
                    age: 0,
                    isFlash: true
                });
                // Emit two real back-to-back gamma-ray photons. This is the
                // characteristic signature of e⁻ + e⁺ annihilation (and what
                // PET scans detect!). Wavelength ~2.4 pm in reality (511 keV);
                // we represent as ~30 nm for visibility (far-UV look).
                const dir = p5.Vector.random3D();
                spawnTravelingPhoton(pt, 30, dir);
                spawnTravelingPhoton(pt, 30, p5.Vector.mult(dir, -1));
            }
            logEvent(`Annihilation! ${annihilationPoints.length} e⁺/e⁻ pair${annihilationPoints.length > 1 ? 's' : ''} → γγ`, 'decay');
            try { Achievements.notify('annihilation'); } catch(_e){}
        }

        // Bond-angle restoring force. For each atom that has 2+ covalent partners,
        // compute the actual angle between each pair of bonds and apply a torque
        // (as linear forces on the outer atoms) to nudge toward the preferred angle.
        // Strength is modest so bonds can still bend under thermal motion.
        const angleForceStrength = 0.4;
        function applyBondAngleForces() {
            nuclei.forEach(center => {
                if (!center || !center.bonds || center.bonds.length < 2) return;
                const nBonds = center.bonds.length;
                const preferredAngle = getPreferredBondAngle(center.elementName, nBonds);
                if (preferredAngle === null) return;
                // For every pair of bonded partners around this center:
                for (let i = 0; i < nBonds; i++) {
                    const A = center.bonds[i];
                    if (!A || !A.pos) continue;
                    for (let j = i + 1; j < nBonds; j++) {
                        const B = center.bonds[j];
                        if (!B || !B.pos) continue;
                        const rCA = p5.Vector.sub(A.pos, center.pos);
                        const rCB = p5.Vector.sub(B.pos, center.pos);
                        const lenA = rCA.mag();
                        const lenB = rCB.mag();
                        if (lenA < 0.5 || lenB < 0.5) continue;
                        const uA = p5.Vector.div(rCA, lenA);
                        const uB = p5.Vector.div(rCB, lenB);
                        let cosTheta = constrain(p5.Vector.dot(uA, uB), -1, 1);
                        const theta = acos(cosTheta);
                        const deltaTheta = theta - preferredAngle;
                        if (abs(deltaTheta) < 0.01) continue;
                        // Tangent at A, perpendicular to uA in the plane of uA and uB:
                        // t_A = (uB - cosTheta * uA) normalized, points from A toward B's side
                        const tA = p5.Vector.sub(uB, p5.Vector.mult(uA, cosTheta));
                        const tAmag = tA.mag();
                        const tB = p5.Vector.sub(uA, p5.Vector.mult(uB, cosTheta));
                        const tBmag = tB.mag();
                        if (tAmag < 0.01 || tBmag < 0.01) continue; // near parallel; skip
                        tA.div(tAmag);
                        tB.div(tBmag);
                        // If actual angle > preferred, we need to DECREASE it: push A and B toward each other
                        // If actual < preferred, push them apart. sign of deltaTheta controls direction.
                        const magnitude = angleForceStrength * deltaTheta;
                        // tA points from A toward B's side, so moving A along +tA
                        // CLOSES the angle. Too wide (magnitude > 0) → push along +tA;
                        // too narrow → along -tA. The sign here used to be inverted,
                        // which drove every bend AWAY from its VSEPR angle: water
                        // folded to ~38° (H-H contact) instead of 104.5°.
                        const FA = p5.Vector.mult(tA, magnitude);
                        const FB = p5.Vector.mult(tB, magnitude);
                        A.applyForce(FA);
                        B.applyForce(FB);
                        // Reaction on center (conserves momentum)
                        center.applyForce(p5.Vector.mult(p5.Vector.add(FA, FB), -1));
                    }
                }
            });
        }

        // Pauli exclusion approximation: bound electrons on the same nucleus+shell
        // get their orbital phases nudged apart when they're close to each other.
        // This makes multi-electron shells spread naturally instead of clumping.
        function applyPauliExclusion() {
            nuclei.forEach(nucleus => {
                if (!nucleus.boundElectrons || nucleus.boundElectrons.length < 2) return;
                // Group electrons by shell
                const byShell = {};
                for (const e of nucleus.boundElectrons) {
                    if (!e) continue;
                    const s = e.orbitalLevel;
                    (byShell[s] = byShell[s] || []).push(e);
                }
                for (const shell in byShell) {
                    const group = byShell[shell];
                    if (group.length < 2) continue;
                    for (let i = 0; i < group.length; i++) {
                        for (let j = i + 1; j < group.length; j++) {
                            const e1 = group[i], e2 = group[j];
                            if (!e1.pos || !e2.pos) continue;
                            const diff = p5.Vector.sub(e2.pos, e1.pos);
                            const dSq = diff.magSq();
                            // Characteristic separation — smaller shells = electrons closer
                            const threshold = bohrRadius * 1.2;
                            if (dSq < threshold * threshold) {
                                // Nudge phases apart. Sign based on phase difference.
                                let dphi = ((e2.orbitalPhase - e1.orbitalPhase) % TWO_PI + TWO_PI) % TWO_PI;
                                if (dphi > PI) dphi -= TWO_PI;
                                const nudge = pauliRepulsionStrength * 0.02;
                                if (dphi >= 0) { e2.orbitalPhase += nudge; e1.orbitalPhase -= nudge; }
                                else           { e2.orbitalPhase -= nudge; e1.orbitalPhase += nudge; }
                            }
                        }
                    }
                }
            });
        }

        function applyThermostat() {
            let currentAverageKE = calculateAverageKE();
            if (currentAverageKE < 0.001 && targetTemperature < 0.001) return;
            let scaleFactor = (currentAverageKE > 0.001) ? sqrt(max(0, targetTemperature) / currentAverageKE) : 1.0;
            let lerpedScale = lerp(1.0, scaleFactor, thermostatStrength);
            particles.forEach(p => {
                if (p && p.vel && !p.isBound && !(p.nucleusMembers.length > 0 && !p.isNucleusCenter)) {
                    p.vel.mult(lerpedScale);
                    if (targetTemperature < 0.01 && p.vel.magSq() < 0.01) {
                        p.vel.add(p5.Vector.random3D().mult(0.05));
                    }
                }
            });
        }

        // --- Drawing Functions ---
        function drawGrid() {
            const gridSize = 1000;
            const gridSpacing = 50;
            const gridColor = color(80, 80, 80, 150);
            const axisColorX = color(255, 0, 0, 200);
            const axisColorY = color(0, 255, 0, 200);
            const axisColorZ = color(0, 100, 255, 200);
            push();
            noFill();
            stroke(gridColor);
            strokeWeight(0.5);
            const halfSize = gridSize / 2;
            for (let i = -halfSize; i <= halfSize; i += gridSpacing) {
                if (abs(i) < 0.1) continue;
                line(i, -halfSize, 0, i, halfSize, 0);
                line(-halfSize, i, 0, halfSize, i, 0);
            }
            strokeWeight(1.5);
            stroke(axisColorX); line(-halfSize * 1.1, 0, 0, halfSize * 1.1, 0, 0);
            stroke(axisColorY); line(0, -halfSize * 1.1, 0, 0, halfSize * 1.1, 0);
            stroke(axisColorZ); line(0, 0, -halfSize * 1.1, 0, 0, halfSize * 1.1);
            pop();
        }

        function drawVelocityVectors() {
            push();
            stroke(0, 200, 0, 150);
            strokeWeight(1.0);
            noFill();
            particles.forEach(p => {
                if (p && p.pos && p.vel && !p.isBound &&
                    !(p.nucleusMembers.length > 0 && !p.isNucleusCenter) &&
                    p.vel.magSq() > 0.01) {
                    push();
                    translate(p.pos.x, p.pos.y, p.pos.z);
                    let end = p5.Vector.mult(p.vel, 2.0);
                    line(0, 0, 0, end.x, end.y, end.z);
                    pop();
                }
            });
            pop();
        }

        function drawBondLines() {
            push();
            stroke(180, 180, 180, 120);
            strokeWeight(1.5);
            noFill();
            // Each bond is drawn once, from its lower-index end. Indexes are
            // stamped in one pass; the old code called particles.indexOf() twice
            // per bond per frame and built a string key for each.
            for (let i = 0; i < particles.length; i++) { if (particles[i]) particles[i].__drawIdx = i; }
            particles.forEach((p1, i1) => {
                if (!p1 || !p1.pos) return;
                // Gather partners along with their bond order
                const partners = [];
                if (p1.bondedTo) partners.push({ p: p1.bondedTo, order: 1 });
                if (p1.bonds) {
                    for (const p2 of p1.bonds) partners.push({ p: p2, order: getBondOrder(p1, p2) });
                }
                partners.forEach(({ p: p2, order }) => {
                    if (!p2 || !p2.pos) return;
                    const i2 = p2.__drawIdx;
                    if (i2 === undefined || particles[i2] !== p2) return;   // partner no longer in the scene
                    if (i2 < i1) return;                                   // drawn from the other end
                    if (i2 === i1) return;
                    if (order === 1) {
                        line(p1.pos.x, p1.pos.y, p1.pos.z, p2.pos.x, p2.pos.y, p2.pos.z);
                    } else {
                        // Parallel lines for double/triple bonds. Build a perpendicular
                        // offset vector in world space.
                        const dir = p5.Vector.sub(p2.pos, p1.pos);
                        if (dir.magSq() < 0.01) return;
                        dir.normalize();
                        // Any vector not parallel to dir → cross product for perp
                        const helper = abs(dir.x) < 0.9 ? createVector(1, 0, 0) : createVector(0, 1, 0);
                        const perp = p5.Vector.cross(dir, helper).normalize();
                        const spacing = 2.5;  // world units between parallel lines
                        if (order === 2) {
                            const off = p5.Vector.mult(perp, spacing * 0.5);
                            line(p1.pos.x + off.x, p1.pos.y + off.y, p1.pos.z + off.z,
                                 p2.pos.x + off.x, p2.pos.y + off.y, p2.pos.z + off.z);
                            line(p1.pos.x - off.x, p1.pos.y - off.y, p1.pos.z - off.z,
                                 p2.pos.x - off.x, p2.pos.y - off.y, p2.pos.z - off.z);
                        } else { // triple
                            line(p1.pos.x, p1.pos.y, p1.pos.z, p2.pos.x, p2.pos.y, p2.pos.z);
                            const off = p5.Vector.mult(perp, spacing);
                            line(p1.pos.x + off.x, p1.pos.y + off.y, p1.pos.z + off.z,
                                 p2.pos.x + off.x, p2.pos.y + off.y, p2.pos.z + off.z);
                            line(p1.pos.x - off.x, p1.pos.y - off.y, p1.pos.z - off.z,
                                 p2.pos.x - off.x, p2.pos.y - off.y, p2.pos.z - off.z);
                        }
                    }
                });
            });
            pop();
        }

        // =====================================================================
        //  PHOTONS — propagation + wave-style visualization
        // =====================================================================
        // A photon in the sim is an object with:
        //   pos         — 3D position
        //   vel         — 3D velocity (all photons travel at the sim's "c")
        //   wavelength  — in nanometers (visible is ~400–700)
        //   polAxis     — unit 3D vector perpendicular to vel; the wiggle direction
        //   birthFrame  — when it was spawned
        //   duration    — lifetime in frames
        //   color       — RGB array, derived from wavelength
        //   isFlash     — true for stationary "event flash" rings (spontaneous
        //                 emission / bond-break markers). false for traveling photons.
        //   maxRadius   — only used for flashes (expanding ring radius)
        //
        // Photons do NOT yet interact with matter. Today they just propagate and
        // render. This keeps the upgrade safe while teaching wavelength/color/
        // polarization honestly. Absorption + emission are future steps.
        //
        // Honest caveat baked into the code: the "wiggle" is a cartoon. Real
        // photons aren't wiggling point particles; they're field excitations.
        // What the wiggle teaches correctly: wavelength, polarization direction.
        // What it does NOT teach: interference, diffraction, coherence.

        // Sim "speed of light": units per frame. Chosen so that a photon
        // traverses a typical scene (±200 units) in about 1–2 seconds of
        // real viewing at 60 fps — visible but not instantaneous.
        const PHOTON_SPEED = 8.0;

        // Visual scale: 1 nanometer of real wavelength = this many sim units
        // in the wiggle. Tuned so visible photons (400–700 nm) have a wiggle
        // period of ~40–70 units — large enough to actually read as a wave in
        // a typical scene (±200 units) instead of looking like a coiled spring.
        const PHOTON_WAVELENGTH_VISUAL_SCALE = 0.1;

        // Approximate visible-spectrum RGB for a given wavelength in nm.
        // Algorithm adapted from Dan Bruton's classic piecewise-linear formula.
        // Outside 380–780 nm we return a dim neutral color.
        function wavelengthToColor(wavelength) {
            const w = wavelength;
            let r = 0, g = 0, b = 0;
            if (w >= 380 && w < 440)       { r = -(w - 440) / 60; g = 0; b = 1; }
            else if (w >= 440 && w < 490)  { r = 0; g = (w - 440) / 50; b = 1; }
            else if (w >= 490 && w < 510)  { r = 0; g = 1; b = -(w - 510) / 20; }
            else if (w >= 510 && w < 580)  { r = (w - 510) / 70; g = 1; b = 0; }
            else if (w >= 580 && w < 645)  { r = 1; g = -(w - 645) / 65; b = 0; }
            else if (w >= 645 && w <= 780) { r = 1; g = 0; b = 0; }
            else if (w < 380)              { r = 0.4; g = 0.2; b = 0.5; }  // UV – dim violet
            else                            { r = 0.4; g = 0.1; b = 0.1; }  // IR – dim red

            // Intensity taper near visible edges (mimics eye sensitivity)
            let intensity = 1.0;
            if (w >= 380 && w < 420)      intensity = 0.3 + 0.7 * (w - 380) / 40;
            else if (w >= 700 && w <= 780) intensity = 0.3 + 0.7 * (780 - w) / 80;

            const gamma = 0.8;
            r = Math.pow(Math.max(0, r) * intensity, gamma) * 255;
            g = Math.pow(Math.max(0, g) * intensity, gamma) * 255;
            b = Math.pow(Math.max(0, b) * intensity, gamma) * 255;
            return [Math.round(r), Math.round(g), Math.round(b)];
        }

        // Rough energy-to-wavelength mapping for internal physics use.
        // E (eV) ≈ 1240 / λ (nm). Inverse: λ = 1240 / E.
        function energyToWavelength(energyEV) {
            if (energyEV <= 0) return 1000;
            return 1240 / energyEV;
        }

        // Build a unit vector perpendicular to v (for polarization axis).
        function perpendicularUnit(v) {
            // Pick an axis that isn't parallel to v
            const vx = v.x, vy = v.y, vz = v.z;
            let ax, ay, az;
            if (Math.abs(vx) < Math.abs(vy) && Math.abs(vx) < Math.abs(vz)) {
                ax = 1; ay = 0; az = 0;
            } else if (Math.abs(vy) < Math.abs(vz)) {
                ax = 0; ay = 1; az = 0;
            } else {
                ax = 0; ay = 0; az = 1;
            }
            // Cross v × a to get a perpendicular
            let px = vy * az - vz * ay;
            let py = vz * ax - vx * az;
            let pz = vx * ay - vy * ax;
            const m = Math.sqrt(px * px + py * py + pz * pz) || 1;
            return { x: px / m, y: py / m, z: pz / m };
        }

        // Spawn a traveling photon at pos going in dir with given wavelength.
        // If dir is omitted, picks a random 3D direction.
        // Used by emission events, external light sources, and the user-fire button.
        function spawnTravelingPhoton(pos, wavelength, dir) {
            if (!useTravelingPhotons) return;
            const d = dir || p5.Vector.random3D();
            if (d.magSq() < 1e-9) return;
            d.normalize();
            const vel = p5.Vector.mult(d, PHOTON_SPEED);
            const polAxis = perpendicularUnit(vel);
            const color = wavelengthToColor(wavelength);
            photons.push({
                pos: pos.copy ? pos.copy() : createVector(pos.x, pos.y, pos.z),
                vel: vel,
                wavelength: wavelength,
                polAxis: polAxis,
                birthFrame: frameCount,
                duration: 240,   // ~4 seconds at 60 fps
                color: color,
                age: 0,
                isFlash: false,
                isTraveling: true
            });
        }

        // Top-level helper used by the main draw loop's auto-emit mode and by
        // the Shine Light button. Spawns a pattern of photons based on the
        // user's shineMode selection ('burst', 'beam', or 'continuous').
        function autoEmitContinuousLight() {
            const wl = currentShineWavelength;
            if (shineMode === 'beam') {
                // Narrow stream from −X edge heading +X
                for (let k = 0; k < 4; k++) {
                    const origin = createVector(-180, random(-30, 30), random(-30, 30));
                    spawnTravelingPhoton(origin, wl, createVector(1, 0, 0));
                }
            } else {
                // burst / continuous: radiate outward from origin
                const origin = createVector(0, 0, 0);
                for (let k = 0; k < 12; k++) {
                    spawnTravelingPhoton(origin, wl, p5.Vector.random3D());
                }
            }
        }

        // Update loop: advance photon positions and cull dead ones.
        // =====================================================================
        //  PHOTON ABSORPTION & SPONTANEOUS EMISSION
        // =====================================================================
        // A traveling photon passing close to an atom can be absorbed if its
        // energy matches an electron transition energy. The target electron
        // jumps to a higher shell (gets tagged "excited"), and the photon is
        // destroyed. Later, the excited electron spontaneously drops back and
        // emits a photon at the same wavelength (any direction).
        //
        // Simplified Bohr-like energy model:
        //   E_n (eV) ≈ −13.6 · Z_eff² / n²
        // For ground-state n=1 to excited n=m, the absorption energy is
        //   ΔE = 13.6 · Z² · (1/1² − 1/m²)   (Lyman series for hydrogen)
        // This gives hydrogen's real spectrum: 10.2 eV (n=1→2, 121.6 nm Ly-α),
        // 12.1 eV (121.6 nm / wait, actually λ = 1240/E so 10.2 eV = 121.5 nm).
        // For visible Balmer lines (n=2→m) we'd need an already-excited atom.
        //
        // We allow transitions from any current shell up to any higher one
        // (not just n=1), so the sim shows both absorption and emission
        // spectra correctly. Transitions use Z_eff = 1 as a rough uniform cartoon.
        let useAbsorption = true;
        // How close a photon must pass to an atom to be considered for absorption
        const ABSORPTION_RADIUS = 26;
        const ABSORPTION_RADIUS_SQ = ABSORPTION_RADIUS * ABSORPTION_RADIUS;
        // Wavelength matching tolerance (nm). Real atomic lines are extremely
        // narrow, but in cartoon physics we widen them so absorption actually
        // happens given the coarse wavelength slider granularity.
        const ABSORPTION_TOLERANCE_NM = 15;
        // Base probability that a matched photon gets absorbed per pass. Real
        // photon-atom cross-sections are tiny; we cheat this up so the effect
        // is visible on reasonable timescales. Scaled by atomic number so
        // heavier atoms absorb more readily.
        const ABSORPTION_BASE_PROB = 0.25;
        // Probability per frame that an excited electron spontaneously
        // relaxes and emits a photon. Real lifetimes are ~10⁻⁸ s; our value
        // gives a sim lifetime of ~30–60 frames, fast enough to see cycles.
        const SPONTANEOUS_EMIT_PROB = 0.03;

        // Compute the photon wavelength for an electron transition between
        // shells n_from and n_to around an atom of effective charge Z_eff.
        // Returns wavelength in nm. Uses the Rydberg formula with approximate
        // constants chosen to reproduce hydrogen-like spectra.
        function shellTransitionWavelength(nFrom, nTo, zEff) {
            if (nFrom === nTo) return Infinity;
            const Z = zEff || 1;
            // ΔE in eV; positive when going up (absorption) or down (emission)
            const invFrom = 1 / (nFrom * nFrom);
            const invTo   = 1 / (nTo * nTo);
            const dE = Math.abs(13.6 * Z * Z * (invFrom - invTo));
            if (dE <= 0) return Infinity;
            return 1240 / dE;
        }

        // Given a nucleus and a photon's wavelength, try to find a shell
        // transition that would absorb this photon. Returns {electron, fromShell, toShell}
        // or null if no match.
        function findAbsorptionTarget(nucleus, photonWL) {
            if (!nucleus || !nucleus.boundElectrons || nucleus.boundElectrons.length === 0) return null;
            // Use Z_eff = 1 for a uniform cartoon. In reality Z_eff varies with
            // shielding; not worth modeling accurately.
            const Z = 1;
            // For each bound electron, check promotions to higher shells
            for (const e of nucleus.boundElectrons) {
                if (!e || e.isExcited) continue;       // skip already-excited
                const nFrom = e.orbitalLevel || 1;
                // Try promotions to higher shells up to 5 above current
                const maxN = Math.min(nFrom + 4, 7);
                for (let nTo = nFrom + 1; nTo <= maxN; nTo++) {
                    const lambda = shellTransitionWavelength(nFrom, nTo, Z);
                    if (Math.abs(lambda - photonWL) < ABSORPTION_TOLERANCE_NM) {
                        return { electron: e, fromShell: nFrom, toShell: nTo, wavelength: lambda };
                    }
                }
            }
            return null;
        }

        // Attempt absorption of one photon by any nearby atom. Returns true
        // if the photon was absorbed (and should be removed by caller).
        function tryAbsorbPhoton(ph) {
            if (!useAbsorption || !ph || !ph.isTraveling || !ph.pos) return false;
            // Iterate nuclei and see which one is nearest and in range
            let closest = null, closestDSq = ABSORPTION_RADIUS_SQ;
            for (const nuc of nuclei) {
                if (!nuc || !nuc.pos) continue;
                const dx = nuc.pos.x - ph.pos.x;
                const dy = nuc.pos.y - ph.pos.y;
                const dz = nuc.pos.z - ph.pos.z;
                const dSq = dx * dx + dy * dy + dz * dz;
                if (dSq < closestDSq) {
                    closestDSq = dSq;
                    closest = nuc;
                }
            }
            if (!closest) return false;
            const target = findAbsorptionTarget(closest, ph.wavelength);
            if (!target) return false;
            // Probabilistic absorption — proximity-weighted
            const proximity = 1 - Math.sqrt(closestDSq) / ABSORPTION_RADIUS;
            const prob = ABSORPTION_BASE_PROB * proximity;
            if (Math.random() > prob) return false;
            // Absorbed! Mark electron as excited and remember its original shell
            // so it can drop back down and emit later.
            const e = target.electron;
            e.isExcited = true;
            e.excitedFromShell = target.fromShell;
            e.excitedToShell = target.toShell;
            e.excitedWavelength = target.wavelength;
            e.excitedOnFrame = frameCount;
            // Visual pop at the absorption point — a subtle white flash so the
            // user can see where absorption happened.
            photons.push({
                pos: closest.pos.copy(),
                birthFrame: frameCount,
                maxRadius: 10,
                duration: 10,
                color: [255, 255, 200],
                age: 0,
                isFlash: true
            });
            logEvent(`Absorption: ${closest.elementName} captured λ=${ph.wavelength.toFixed(0)} nm (n=${target.fromShell}→${target.toShell})`, 'binding');
            try { Achievements.notify('photon_absorbed'); } catch(_e){}
            return true;
        }

        // Each frame, give excited electrons a chance to drop back down and
        // emit a photon at the transition wavelength. Emission direction is
        // random (isotropic — real spontaneous emission is like this).
        function processSpontaneousEmission() {
            if (!useAbsorption) return;
            for (const nuc of nuclei) {
                if (!nuc || !nuc.boundElectrons) continue;
                for (const e of nuc.boundElectrons) {
                    if (!e || !e.isExcited) continue;
                    if (Math.random() < SPONTANEOUS_EMIT_PROB) {
                        // Emit photon at the stored wavelength
                        const wl = e.excitedWavelength || 500;
                        spawnTravelingPhoton(nuc.pos, wl, p5.Vector.random3D());
                        // Clear excitation state
                        e.isExcited = false;
                        delete e.excitedFromShell;
                        delete e.excitedToShell;
                        delete e.excitedWavelength;
                        delete e.excitedOnFrame;
                        logEvent(`Emission: ${nuc.elementName} relaxed, emitted λ=${wl.toFixed(0)} nm`, 'binding');
                        try { Achievements.notify('photon_emitted'); } catch(_e){}
                    }
                }
            }
        }

        // Update loop: advance photon positions, check absorption, and cull.
        function updatePhotons() {
            for (let i = photons.length - 1; i >= 0; i--) {
                const ph = photons[i];
                if (!ph) { photons.splice(i, 1); continue; }
                // Age in physics ticks. It used to be frameCount - birthFrame, so
                // photons kept aging while paused (resuming after ~4 s culled every
                // photon at once) and flew 3x farther before expiring at 3x speed.
                ph.age = (ph.age || 0) + 1;
                // Move traveling photons
                if (ph.isTraveling && ph.pos && ph.vel) {
                    ph.pos.x += ph.vel.x;
                    ph.pos.y += ph.vel.y;
                    ph.pos.z += ph.vel.z;
                    // Check absorption — if consumed, cull photon and continue
                    if (tryAbsorbPhoton(ph)) {
                        photons.splice(i, 1);
                        continue;
                    }
                }
                // Cull when expired or out of sight (far beyond the scene)
                const tooOld = ph.age > ph.duration;
                const farAway = ph.pos && (
                    Math.abs(ph.pos.x) > 1500 ||
                    Math.abs(ph.pos.y) > 1500 ||
                    Math.abs(ph.pos.z) > 1500
                );
                if (tooOld || farAway) photons.splice(i, 1);
            }
            // After motion, let excited atoms spontaneously re-emit
            processSpontaneousEmission();
        }

        // Render all photons. Two modes:
        //   isFlash (or traveling=false): old-style expanding sphere ring
        //       (kept for emission event markers — visible pop at the event)
        //   isTraveling: moving photon rendered as a small sphere trailing a
        //       wiggling sinusoid along its polarization axis
        function drawPhotons() {
            if (!photons.length) return;
            push();
            noFill();
            for (let i = 0; i < photons.length; i++) {
                const ph = photons[i];
                if (!ph || !ph.pos || isNaN(ph.age)) continue;
                const ageRatio = ph.age / ph.duration;
                if (ageRatio < 0 || ageRatio > 1) continue;

                if (ph.isTraveling) {
                    drawTravelingPhoton(ph, ageRatio);
                } else {
                    // Flash ring: expanding sphere fading out
                    const currentRadius = ageRatio * (ph.maxRadius || 20);
                    const alpha = 200 * (1 - ageRatio);
                    if (alpha <= 0) continue;
                    push();
                    translate(ph.pos.x, ph.pos.y, ph.pos.z);
                    stroke(ph.color[0], ph.color[1], ph.color[2], alpha);
                    strokeWeight(1.5);
                    sphere(currentRadius);
                    pop();
                }
            }
            pop();
        }

        // Render a traveling photon as a visible wave along its direction of
        // travel. Two curves are drawn:
        //   - the main sinusoid, bright and thick (the "wave")
        //   - a faint parallel echo offset along the wavefront to add depth
        // The wavelength (color-correct for the photon's λ) is directly
        // readable as the spatial period of the wiggle, and polarization is
        // the wiggle direction. Explicitly cartoon: no interference.
        function drawTravelingPhoton(ph, ageRatio) {
            const hx = ph.pos.x, hy = ph.pos.y, hz = ph.pos.z;
            const col = ph.color;
            const alpha = 255 * (1 - 0.5 * ageRatio);

            // Bright head marker so the photon's leading edge is easy to spot
            push();
            translate(hx, hy, hz);
            noStroke();
            emissiveMaterial(col[0], col[1], col[2]);
            ambientMaterial(col[0], col[1], col[2], alpha);
            sphere(2.4);
            pop();

            if (!showPhotonWiggle) return;
            if (!ph.vel || !ph.polAxis) return;

            const vmag = Math.sqrt(ph.vel.x * ph.vel.x + ph.vel.y * ph.vel.y + ph.vel.z * ph.vel.z);
            if (vmag < 1e-6) return;
            const dx = ph.vel.x / vmag, dy = ph.vel.y / vmag, dz = ph.vel.z / vmag;

            // Visual wavelength
            const lambdaWorld = Math.max(ph.wavelength * PHOTON_WAVELENGTH_VISUAL_SCALE, 4);
            const k = (2 * Math.PI) / lambdaWorld;
            // Big, readable amplitude: about a third of wavelength, but with a
            // floor so very-short-wavelength (UV/gamma) photons still have a
            // visible wiggle.
            const amplitude = Math.max(lambdaWorld * 0.35, 5);
            // Tail long enough to show about 4 full wavelengths — makes the
            // wave obvious at a glance.
            const tailLen = lambdaWorld * 4.0;
            const SEGMENTS = 48;

            push();
            noFill();
            // Main wave: thick, bright, full-alpha
            stroke(col[0], col[1], col[2], alpha);
            strokeWeight(2.4);
            beginShape();
            for (let s = 0; s <= SEGMENTS; s++) {
                const t = s / SEGMENTS;   // 0 at head, 1 at tail
                const back = t * tailLen;
                const bx = hx - dx * back;
                const by = hy - dy * back;
                const bz = hz - dz * back;
                const phase = k * back;
                const taper = Math.max(0, 1 - t * t); // quadratic taper (brighter near head)
                const a = amplitude * Math.sin(phase) * taper;
                vertex(
                    bx + ph.polAxis.x * a,
                    by + ph.polAxis.y * a,
                    bz + ph.polAxis.z * a
                );
            }
            endShape();

            // Ghost echo on the opposite side — gives the wave a sense of
            // volume and makes the polarization plane obvious.
            stroke(col[0], col[1], col[2], alpha * 0.35);
            strokeWeight(1.4);
            beginShape();
            for (let s = 0; s <= SEGMENTS; s++) {
                const t = s / SEGMENTS;
                const back = t * tailLen;
                const bx = hx - dx * back;
                const by = hy - dy * back;
                const bz = hz - dz * back;
                const phase = k * back;
                const taper = Math.max(0, 1 - t * t);
                const a = -amplitude * Math.sin(phase) * taper * 0.35;
                vertex(
                    bx + ph.polAxis.x * a,
                    by + ph.polAxis.y * a,
                    bz + ph.polAxis.z * a
                );
            }
            endShape();

            pop();
        }

        function drawAtomShells() {
            const shellColor = color(150, 180, 255, 40);
            push();
            colorMode(RGB);
            stroke(shellColor);
            strokeWeight(0.5);
            noFill();
            nuclei.forEach(nucleus => {
                if (!nucleus || !nucleus.pos || nucleus.isPartOfMolecule || nucleus.boundElectrons.length === 0) return;
                let maxShell = 0;
                nucleus.boundElectrons.forEach(e => { if (e && e.orbitalLevel > maxShell) maxShell = e.orbitalLevel; });
                // Cap shell drawing for large atoms to prevent massive spheres
                let drawUpTo = min(maxShell, 4);
                for (let shell = 1; shell <= drawUpTo; shell++) {
                    let radius = bohrRadius * shell * (1 + (shell - 1) * 0.1);
                    push();
                    translate(nucleus.pos.x, nucleus.pos.y, nucleus.pos.z);
                    // 16x10 wireframe instead of the 24x16 default (~2.4x fewer edges per shell)
                    sphere(radius, 16, 10);
                    pop();
                }
            });
            pop();
        }

        // Rebuilt 6 times a second (was every frame, with an average-KE pass and
        // a p5 select() each time), and only when the text actually changes.
        let _infoPanelEl = null, _infoPanelLast = '';
        function updateInfoPanel() {
            if (frameCount % 10 !== 0 && _infoPanelLast) return;
            if (!_infoPanelEl) _infoPanelEl = document.getElementById('info');
            if (!_infoPanelEl) return;
            let eFieldInfo = ` | E: (${electricField.x.toFixed(2)}, ${electricField.y.toFixed(2)}, ${electricField.z.toFixed(2)})`;
            let currentAvgKE = calculateAverageKE();
            let pausedTag = isPaused ? ' <span style="color:#ffcc44">[PAUSED]</span>' : '';
            const html =
                `Particles: ${particles.length} | Nuclei: ${nuclei.length} | Molecules: ${molecules.length}${eFieldInfo}${pausedTag}<br>` +
                `G: ${G.toFixed(3)} | Avg KE (Temp): ${currentAvgKE.toFixed(2)}<br>` +
                `Controls: Drag=Orbit, Wheel=Zoom, R-Drag=Pan, R-Click=Inspect, H=Help`;
            if (html !== _infoPanelLast) { _infoPanelEl.innerHTML = html; _infoPanelLast = html; }
        }

        function updateEntityList() {
            if (!entityListElement) entityListElement = document.getElementById('entityList');
            if (!entityListElement) return;

            let counts = { Electron: 0, Proton: 0, Neutron: 0, Positron: 0 };

            // Same keys as the hover highlight (entityKeyFor), minus molecule
            // members, which are counted per molecule below.
            particles.forEach(p => {
                if (!p || (p.isPartOfMolecule && p.moleculeLabel)) return;
                const key = entityKeyFor(p);
                if (key) counts[key] = (counts[key] || 0) + 1;
            });

            // Count molecules
            molecules.forEach(m => { if (m && m.label) counts[m.label] = (counts[m.label] || 0) + 1; });

            let listHTML = "<h4 aria-level=2>Entities:</h4><ul>";
            let sortedKeys = Object.keys(counts).sort((a, b) => {
                const basic = ['Electron', 'Proton', 'Neutron', 'Positron'];
                let aIsBasic = basic.includes(a);
                let bIsBasic = basic.includes(b);
                if (aIsBasic && !bIsBasic) return -1;
                if (!aIsBasic && bIsBasic) return 1;
                return a.localeCompare(b);
            });

            let hasContent = false;
            if (counts['Electron'] > 0) { listHTML += `<li data-entity-key="Electron">Electron x ${counts['Electron']}</li>`; hasContent = true; }
            if (counts['Positron'] > 0) { listHTML += `<li data-entity-key="Positron">Positron x ${counts['Positron']}</li>`; hasContent = true; }
            if (counts['Proton'] > 0) { listHTML += `<li data-entity-key="Proton">Proton x ${counts['Proton']}</li>`; hasContent = true; }
            if (counts['Neutron'] > 0) { listHTML += `<li data-entity-key="Neutron">Neutron x ${counts['Neutron']}</li>`; hasContent = true; }

            // Separate atoms/ions from molecules for clarity
            let atomKeys = sortedKeys.filter(k => !['Electron', 'Proton', 'Neutron', 'Positron'].includes(k) && counts[k] > 0);
            let atomList = [];
            let moleculeList = [];
            let moleculeLabelSet = new Set(molecules.map(m => m.label));
            atomKeys.forEach(k => {
                if (moleculeLabelSet.has(k)) moleculeList.push(k);
                else atomList.push(k);
            });

            if (atomList.length > 0) {
                listHTML += `<li class="category">--- Atoms/Ions ---</li>`;
                atomList.forEach(key => {
                    listHTML += `<li data-entity-key="${key}">${key} x ${counts[key]}</li>`;
                    hasContent = true;
                });
            }
            if (moleculeList.length > 0) {
                listHTML += `<li class="category">--- Molecules ---</li>`;
                moleculeList.forEach(key => {
                    listHTML += `<li data-entity-key="${key}">${key} x ${counts[key]}</li>`;
                    hasContent = true;
                });
            }

            if (!hasContent) listHTML += "<li>None</li>";
            listHTML += "</ul>";

            entityListElement.innerHTML = listHTML;
        }

        // =====================================================================
        //  FLOATING LABELS
        // =====================================================================
        // Project 3D WEBGL coords to screen space and position HTML labels.
        // p5.js WEBGL mode DOES NOT provide screenX/screenY, so we read the
        // active camera + projection matrices from the renderer and do the math
        // ourselves. This is the standard model-view-projection pipeline.
        function worldToScreen(x, y, z) {
            // p5 in global mode typically exposes _renderer as window._renderer,
            // but we defensively check both that and the p5 instance pattern.
            const renderer = (typeof _renderer !== 'undefined' && _renderer) ||
                             (window._p5Instance && window._p5Instance._renderer);
            if (!renderer || !renderer.uMVMatrix || !renderer.uPMatrix) return null;
            const mv = renderer.uMVMatrix.mat4;
            const pm = renderer.uPMatrix.mat4;
            if (!mv || !pm) return null;
            // Apply model-view: eye = MV * [x, y, z, 1]
            const ex = mv[0]*x + mv[4]*y + mv[8]*z + mv[12];
            const ey = mv[1]*x + mv[5]*y + mv[9]*z + mv[13];
            const ez = mv[2]*x + mv[6]*y + mv[10]*z + mv[14];
            const ew = mv[3]*x + mv[7]*y + mv[11]*z + mv[15];
            // Apply projection: clip = P * eye
            const cx = pm[0]*ex + pm[4]*ey + pm[8]*ez + pm[12]*ew;
            const cy = pm[1]*ex + pm[5]*ey + pm[9]*ez + pm[13]*ew;
            const cz = pm[2]*ex + pm[6]*ey + pm[10]*ez + pm[14]*ew;
            const cw = pm[3]*ex + pm[7]*ey + pm[11]*ez + pm[15]*ew;
            // Behind the camera or zero w → cull
            if (cw <= 0.0001) return null;
            // Normalize to NDC (-1..1), then to canvas pixels. WEBGL origin is
            // the canvas center, so (ndcx * width/2 + width/2, -ndcy * height/2 + height/2)
            // maps NDC to the standard top-left screen coords.
            const ndcx = cx / cw;
            const ndcy = cy / cw;
            const ndcz = cz / cw;
            if (ndcz < -1 || ndcz > 1) return null; // behind near/far plane
            const sx = (ndcx * 0.5 + 0.5) * width;
            const sy = (1.0 - (ndcy * 0.5 + 0.5)) * height;
            return { x: sx, y: sy, depth: ndcz };
        }

        function renderFloatingLabels() {
            if (!labelLayerElement) return;
            // Collect targets to label
            const targets = []; // {id, text, pos, className}

            // Molecules — labeled at center-of-mass
            molecules.forEach((m, idx) => {
                if (!m || !m.labelPos || !m.label) return;
                const id = `mol_${idx}_${m.label}`;
                targets.push({ id, text: m.label, pos: m.labelPos, className: 'floatLabel molecule' });
            });

            // Nucleus centers (skip those inside molecules — molecule label wins)
            nuclei.forEach((n) => {
                if (!n || !n.pos || !n.elementName) return;
                if (n.isPartOfMolecule) return;
                const net = getNetCharge(n);
                let suffix = '';
                if (net > 0) suffix = `⁺${net > 1 ? net : ''}`;
                else if (net < 0) suffix = `⁻${-net > 1 ? -net : ''}`;
                // (the id used to be `nuc_${particles.indexOf(n)}`: an O(N) scan per
                // nucleus per frame for a value nothing reads)
                targets.push({
                    id: 'nuc',
                    text: `${n.elementName}${suffix}`,
                    pos: n.pos,
                    className: 'floatLabel nucleus'
                });
            });

            // Free particles — cap to avoid visual spam
            let freeLabeled = 0;
            const maxFreeLabels = 60;
            for (let i = 0; i < particles.length && freeLabeled < maxFreeLabels; i++) {
                const p = particles[i];
                if (!p || !p.pos) continue;
                if (p.isBound) continue;
                if (p.isNucleusCenter) continue;
                if (p.nucleusMembers.length > 0 && !p.isNucleusCenter) continue;
                if (p.bondedTo || (p.bonds && p.bonds.length > 0)) continue;
                // (membership is already settled by the nucleusMembers test above;
                // a per-particle scan of every nucleus's members used to run here)

                let glyph;
                if (p.type === 'electron') glyph = 'e⁻';
                else if (p.type === 'positron') glyph = 'e⁺';
                else if (p.type === 'proton') glyph = 'p⁺';
                else if (p.type === 'neutron') glyph = 'n';
                else glyph = p.type;
                const id = `p_${i}_${p.type}`;
                targets.push({ id, text: glyph, pos: p.pos, className: 'floatLabel particle' });
                freeLabeled++;
            }

            // Project to screen and collect visible labels
            const projected = [];
            const screenW = width;
            const screenH = height;
            for (const t of targets) {
                const sp = worldToScreen(t.pos.x, t.pos.y, t.pos.z);
                if (!sp) continue;
                if (sp.x < -50 || sp.x > screenW + 50 || sp.y < -30 || sp.y > screenH + 30) continue;
                projected.push({ t, sx: sp.x, sy: sp.y, depth: sp.depth });
            }
            // Farther labels first so closer ones overlay them
            projected.sort((a, b) => b.depth - a.depth);

            // Assign pool nodes
            let poolIdx = 0;
            for (const { t, sx, sy } of projected) {
                let node;
                if (poolIdx < labelPool.length) {
                    node = labelPool[poolIdx];
                    node.style.display = 'block';
                } else {
                    node = document.createElement('div');
                    labelLayerElement.appendChild(node);
                    labelPool.push(node);
                }
                node._labelId = t.id;
                if (node.className !== t.className) node.className = t.className;
                if (node.textContent !== t.text) node.textContent = t.text;
                node.style.left = sx + 'px';
                node.style.top  = (sy - 8) + 'px';
                poolIdx++;
            }
            for (let i = poolIdx; i < labelPool.length; i++) {
                labelPool[i].style.display = 'none';
            }
        }

        function clearAllLabels() {
            for (const node of labelPool) node.style.display = 'none';
        }

        // =====================================================================
        //  TRAILS
        // =====================================================================
        function recordTrails() {
            for (const p of particles) {
                if (!p || !p.pos) continue;
                // A particle that became bound or joined a nucleus keeps no trail
                // (its last trail used to stay frozen on screen forever)
                if (p.isBound || (p.nucleusMembers.length > 0 && !p.isNucleusCenter)) {
                    if (p.trail && p.trail.length) p.trail = [];
                    continue;
                }
                if (!p.trail) p.trail = [];
                p.trail.push(p.pos.copy());
                if (p.trail.length > MAX_TRAIL_LENGTH) p.trail.shift();
            }
        }

        function drawTrails() {
            push();
            noFill();
            for (const p of particles) {
                if (!p || !p.trail || p.trail.length < 2) continue;
                const col = p.color || [200, 200, 200];
                strokeWeight(1.0);
                // Draw as a segmented line with increasing alpha
                beginShape();
                for (let i = 0; i < p.trail.length; i++) {
                    const alpha = map(i, 0, p.trail.length - 1, 20, 150);
                    stroke(col[0], col[1], col[2], alpha);
                    const pt = p.trail[i];
                    vertex(pt.x, pt.y, pt.z);
                }
                endShape();
            }
            pop();
        }

        // =====================================================================
        //  STATS BUBBLE (FPS + particle count, color-coded)
        // =====================================================================

        // Format simulated time from attoseconds into the most natural unit.
        // Crossover thresholds chosen so you always see 1-3 significant figures.
        // Returns e.g. "42 as", "1.3 fs", "250 fs", "2.1 ps", "5 ns".
        function formatSimTime(as) {
            if (as < 1)         return as.toFixed(2) + ' as';
            if (as < 1000)      return as.toFixed(as < 10 ? 1 : 0) + ' as';
            const fs = as / 1000;
            if (fs < 1000)      return fs.toFixed(fs < 10 ? 2 : fs < 100 ? 1 : 0) + ' fs';
            const ps = fs / 1000;
            if (ps < 1000)      return ps.toFixed(ps < 10 ? 2 : ps < 100 ? 1 : 0) + ' ps';
            const ns = ps / 1000;
            if (ns < 1000)      return ns.toFixed(ns < 10 ? 2 : ns < 100 ? 1 : 0) + ' ns';
            const us = ns / 1000;
            return us.toFixed(us < 10 ? 2 : us < 100 ? 1 : 0) + ' μs';
        }

        // The bubble's markup is built once; each update only changes text and
        // classes. It used to rebuild its innerHTML every frame, which also
        // destroyed and recreated the tooltip spans 60 times a second.
        let statsSpans = null;
        function initStatsBubble() {
            if (!statsBubbleElement) return;
            statsBubbleElement.innerHTML =
                'FPS: <span data-sb="fps" class="good">--</span> ' +
                '| Particles: <span data-sb="particles">0</span> ' +
                '| Nuclei: <span data-sb="nuclei">0</span> ' +
                '| Molecules: <span data-sb="molecules">0</span>' +
                '<span data-sb="phase" class="sbHidden"></span>' +
                ' <span data-sb="ballistic" class="sbHidden" title="Ballistic fast-path: particles with no neighbor in short-range reach this tick skipped the short-range force loop (long-range Coulomb and gravity still act on them). Higher % = bigger speedup. Spread-out gases hit 80%+; dense liquids and solids hit near 0%."></span>' +
                ' <span data-sb="time" class="simTime" title="Simulated time since last Clear. Cartoon calibration: 1 attosecond (as) = 10⁻¹⁸ s, 1 femtosecond (fs) = 10⁻¹⁵ s. Each sim tick ≈ 0.5 as. Real atomic processes happen on these timescales; the sim compresses time so you can watch.">t = 0.00 as</span>';
            statsSpans = {};
            statsBubbleElement.querySelectorAll('[data-sb]').forEach(el => { statsSpans[el.getAttribute('data-sb')] = el; });
        }
        function setSpan(el, text, cls) {
            if (!el) return;
            if (el.textContent !== text) el.textContent = text;
            if (cls !== undefined && el.className !== cls) el.className = cls;
        }
        function updateStatsBubble() {
            if (!statsBubbleElement) return;
            if (!statsSpans) initStatsBubble();
            const fps = frameRate();
            fpsHistory.push(fps);
            if (fpsHistory.length > 30) fpsHistory.shift();

            // Update phase tag only every 20 frames to avoid flicker
            if (frameCount % 20 === 0) cachedPhase = computePhase();
            if (frameCount % 6 !== 0) return;   // 10 text updates a second are plenty

            const avgFps = fpsHistory.reduce((a, b) => a + b, 0) / fpsHistory.length;
            let cls = 'good';
            if (avgFps < 25) cls = 'bad';
            else if (avgFps < 45) cls = 'warn';
            setSpan(statsSpans.fps, avgFps.toFixed(0), cls);
            setSpan(statsSpans.particles, String(particles.length));
            setSpan(statsSpans.nuclei, String(nuclei.length));
            setSpan(statsSpans.molecules, String(molecules.length));
            setSpan(statsSpans.phase, cachedPhase || '', cachedPhase ? `phaseTag phase-${cachedPhase}` : 'sbHidden');

            // Ballistic fast-path diagnostics: how many particles rolled freely
            // vs went through the pairwise force loop last tick.
            if (useBallisticFastPath && (lastBallisticCount + lastActiveCount) > 0) {
                const total = lastBallisticCount + lastActiveCount;
                const pct = Math.round((lastBallisticCount / total) * 100);
                const ballCls = pct > 60 ? 'good' : pct > 30 ? 'warn' : '';
                setSpan(statsSpans.ballistic, `🎳 ${pct}%`, ballCls);
            } else {
                setSpan(statsSpans.ballistic, '', 'sbHidden');
            }
            setSpan(statsSpans.time, `t = ${formatSimTime(simTime)}`);
        }

        // =====================================================================
        //  PRESET SCENARIOS
        // =====================================================================
        function loadPreset(name) {
            clearParticles();
            try { Achievements.notify('preset_loaded', { name }); } catch(_e){}
            switch (name) {
                case 'hydrogenCloud': {
                    logEvent("Preset: Hydrogen gas cloud");
                    for (let i = 0; i < 20; i++) addMolecule('hydrogenGas');
                    targetTemperature = 2.0;
                    syncTempUI();
                    break;
                }
                case 'saltFormation': {
                    logEvent("Preset: Na + Cl ionic mix");
                    for (let i = 0; i < 15; i++) addIon('sodium', +1);
                    for (let i = 0; i < 15; i++) addIon('chlorine', -1);
                    targetTemperature = 0.5;
                    syncTempUI();
                    break;
                }
                case 'waterCluster': {
                    logEvent("Preset: Water cluster");
                    for (let i = 0; i < 12; i++) addMolecule('water');
                    targetTemperature = 1.0;
                    syncTempUI();
                    break;
                }
                case 'plasma': {
                    logEvent("Preset: Hot plasma");
                    for (let i = 0; i < 30; i++) addIon('hydrogen', +1); // bare protons
                    for (let i = 0; i < 30; i++) addParticle('electron', true);
                    targetTemperature = 8.0;
                    syncTempUI();
                    break;
                }
                case 'crystalSalt': {
                    logEvent("Preset: NaCl crystal lattice");
                    // Build a 3×3×3 checkerboard of Na+ and Cl- ions
                    // Nearest neighbors at the ionic contact distance (was 48, deep
                    // inside the shell-overlap repulsion, so the lattice exploded)
                    const spacing = equilibriumBondDist_NaCl;
                    const n = 3;
                    for (let ix = 0; ix < n; ix++) {
                        for (let iy = 0; iy < n; iy++) {
                            for (let iz = 0; iz < n; iz++) {
                                const isNa = ((ix + iy + iz) % 2) === 0;
                                const x = (ix - (n-1)/2) * spacing;
                                const y = (iy - (n-1)/2) * spacing;
                                const z = (iz - (n-1)/2) * spacing;
                                spawnIonAt(isNa ? 'sodium' : 'chlorine', isNa ? +1 : -1, x, y, z);
                            }
                        }
                    }
                    targetTemperature = 0.2;
                    syncTempUI();
                    const ubCheckbox = document.getElementById('unbreakableCheckbox');
                    if (ubCheckbox) { ubCheckbox.checked = true; unbreakableBonds = true; }
                    break;
                }
                case 'fusionSoup': {
                    logEvent("Preset: Hot nucleon soup");
                    for (let i = 0; i < 40; i++) addParticle('proton', true);
                    for (let i = 0; i < 40; i++) addParticle('neutron', true);
                    targetTemperature = 5.0;
                    syncTempUI();
                    break;
                }
                default:
                    logEvent(`Unknown preset: ${name}`);
            }
        }

        function syncTempUI() {
            const tempSlider = document.getElementById('tempSlider');
            const tempValueSpan = document.getElementById('tempValue');
            if (tempSlider) tempSlider.value = targetTemperature;
            if (tempValueSpan) tempValueSpan.textContent = targetTemperature.toFixed(1);
        }

        // Spawn an ion at an exact position (used by crystal preset).
        function spawnIonAt(elementType, desiredCharge, x, y, z) {
            const baseType = elementType.toLowerCase();
            const config = atomConfigs[baseType];
            if (!config) return;
            const electronsNeeded = config.p - desiredCharge;
            if (electronsNeeded < 0) return;
            if (particles.length + config.p + config.n + electronsNeeded > MAX_PARTICLES) return;
            const structure = createAtomOrIonStructure(baseType, config, electronsNeeded, desiredCharge, x, y, z);
            if (structure && structure.allParticles) {
                // Zero initial velocity for a settled crystal
                structure.allParticles.forEach(p => { if (p.vel) p.vel.set(0, 0, 0); });
                particles.push(...structure.allParticles);
                // Identify the new nuclei on the very next tick. Without this the
                // new nucleons could integrate as free particles for up to two
                // ticks and shove each other apart before being clustered.
                forceNucleiRefresh = true;
            }
        }

        // =====================================================================
        //  SPATIAL GRID (uniform grid for O(N) neighbor queries)
        // =====================================================================
        // Currently informational — applyForces still does O(N²) but inside a
        // filtered list. Could be further optimized; kept simple for now.
        // Integer cell keys: composite base-20001 packing, injective for cell
        // coordinates within ±9999 (±1.3 million world units at cell size 132).
        // Coordinates beyond that clamp to the boundary cell; the only effect
        // is a few extra distance-gated candidate checks for runaway particles.
        const GRID_COORD_LIMIT = 9999;
        const GRID_KEY_SPAN = 2 * GRID_COORD_LIMIT + 3;
        function gridCellKey(gx, gy, gz) {
            if (gx < -GRID_COORD_LIMIT) gx = -GRID_COORD_LIMIT; else if (gx > GRID_COORD_LIMIT) gx = GRID_COORD_LIMIT;
            if (gy < -GRID_COORD_LIMIT) gy = -GRID_COORD_LIMIT; else if (gy > GRID_COORD_LIMIT) gy = GRID_COORD_LIMIT;
            if (gz < -GRID_COORD_LIMIT) gz = -GRID_COORD_LIMIT; else if (gz > GRID_COORD_LIMIT) gz = GRID_COORD_LIMIT;
            return (gx + GRID_COORD_LIMIT + 1)
                 + GRID_KEY_SPAN * (gy + GRID_COORD_LIMIT + 1)
                 + GRID_KEY_SPAN * GRID_KEY_SPAN * (gz + GRID_COORD_LIMIT + 1);
        }

        const NEIGHBOR_OFFSETS = (() => {
            const o = [];
            for (let dx = -1; dx <= 1; dx++)
                for (let dy = -1; dy <= 1; dy++)
                    for (let dz = -1; dz <= 1; dz++) o.push([dx, dy, dz]);
            return o;
        })();

        function rebuildSpatialGrid(particleList) {
            spatialGrid.clear();
            let stamp = 0;
            for (const p of particleList) {
                if (!p || !p.pos) continue;
                p.__fidx = stamp++;   // unique per-tick id; replaces indexOf()
                const key = gridCellKey(
                    Math.floor(p.pos.x / GRID_CELL_SIZE),
                    Math.floor(p.pos.y / GRID_CELL_SIZE),
                    Math.floor(p.pos.z / GRID_CELL_SIZE));
                let cell = spatialGrid.get(key);
                if (!cell) { cell = []; spatialGrid.set(key, cell); }
                cell.push(p);
            }
        }

        // Collect the (deduplicated) buckets of the 27-cell neighborhood into
        // a caller-supplied scratch array. Dedup by reference guards against
        // the clamped-coordinate edge case where two offsets map to one key.
        const __bucketScratch = [];
        function collectNeighborBuckets(p, out) {
            out.length = 0;
            if (!p || !p.pos) return out;
            const gx = Math.floor(p.pos.x / GRID_CELL_SIZE);
            const gy = Math.floor(p.pos.y / GRID_CELL_SIZE);
            const gz = Math.floor(p.pos.z / GRID_CELL_SIZE);
            for (let i = 0; i < NEIGHBOR_OFFSETS.length; i++) {
                const off = NEIGHBOR_OFFSETS[i];
                const cell = spatialGrid.get(gridCellKey(gx + off[0], gy + off[1], gz + off[2]));
                if (!cell) continue;
                let dup = false;
                for (let b = 0; b < out.length; b++) if (out[b] === cell) { dup = true; break; }
                if (!dup) out.push(cell);
            }
            return out;
        }

        // Early-exit existence test used by the ballistic fast-path.
        function gridHasNeighbor(p) {
            if (!p || !p.pos) return false;
            const gx = Math.floor(p.pos.x / GRID_CELL_SIZE);
            const gy = Math.floor(p.pos.y / GRID_CELL_SIZE);
            const gz = Math.floor(p.pos.z / GRID_CELL_SIZE);
            for (let i = 0; i < NEIGHBOR_OFFSETS.length; i++) {
                const off = NEIGHBOR_OFFSETS[i];
                const cell = spatialGrid.get(gridCellKey(gx + off[0], gy + off[1], gz + off[2]));
                if (!cell) continue;
                for (let c = 0; c < cell.length; c++) if (cell[c] !== p) return true;
            }
            return false;
        }

        // Back-compat flat neighbor list (no longer used by the hot loop).
        function getNeighbors(p) {
            const out = [];
            const buckets = collectNeighborBuckets(p, []);
            for (const cell of buckets) out.push(...cell);
            return out;
        }

        // =====================================================================
        //  COLOR-BY MODE
        // =====================================================================
        // Returns an [r,g,b,a] color for a particle based on the current particleColorMode.
        function getColorByValue(p) {
            if (!p || !p.vel) return null;
            if (particleColorMode === 'speed') {
                const s = p.vel.mag();
                const t = constrain(s / 4.0, 0, 1);
                // Blue (slow) to red (fast)
                return [lerp(60, 255, t), lerp(120, 60, t), lerp(255, 40, t), 220];
            } else if (particleColorMode === 'ke') {
                const m = getEffectiveMass(p);
                const ke = 0.5 * m * p.vel.magSq();
                const t = constrain(ke / (targetTemperature * 3 + 1), 0, 1);
                return [lerp(40, 255, t), lerp(40, 200, t), lerp(200, 40, t), 220];
            } else if (particleColorMode === 'charge') {
                const q = getNetCharge(p);
                if (q > 0) {
                    const t = constrain(q / 3, 0, 1);
                    return [255, lerp(180, 60, t), lerp(180, 60, t), 220];
                } else if (q < 0) {
                    const t = constrain(-q / 3, 0, 1);
                    return [lerp(180, 60, t), lerp(180, 60, t), 255, 220];
                } else {
                    return [180, 180, 180, 200]; // neutral = gray
                }
            }
            return null;
        }

        // =====================================================================
        //  TEMPERATURE-TINTED BACKGROUND
        // =====================================================================
        // Returns the background color based on current average KE when tempTintBg is on.
        function getBackgroundColor() {
            if (!tempTintBg) return [30, 30, 30];
            const avgKE = calculateAverageKE();
            // Map 0 → cool blue, 2 → neutral gray, 10+ → warm red
            const t = constrain(avgKE / 10.0, 0, 1);
            // Cool: (20, 30, 55) -> Neutral (30,30,30) -> Hot (60, 25, 20)
            if (t < 0.2) {
                const k = t / 0.2;
                return [lerp(20, 30, k), lerp(30, 30, k), lerp(55, 30, k)];
            } else {
                const k = (t - 0.2) / 0.8;
                return [lerp(30, 75, k), lerp(30, 25, k), lerp(30, 20, k)];
            }
        }

        // =====================================================================
        //  MAGNETIC FIELD (Lorentz force)
        // =====================================================================
        // For each charged free particle: F = q * (v × B)
        function applyMagneticField() {
            if (magneticField.x === 0 && magneticField.y === 0 && magneticField.z === 0) return;
            const B = createVector(magneticField.x, magneticField.y, magneticField.z);
            for (let i = 0; i < particles.length; i++) {
                const p = particles[i];
                if (!p || p.isBound) continue;
                if (p.nucleusMembers.length > 0 && !p.isNucleusCenter) continue;
                const q = getNetCharge(p);
                if (q === 0) continue;
                if (!p.vel) continue;
                // F = q * (v × B)
                const force = p5.Vector.cross(p.vel, B).mult(q);
                p.applyForce(force);
            }
        }

        // =====================================================================
        //  HYDROGEN BONDING
        // =====================================================================
        // Directional hydrogen bonding.
        // Weak attraction between a hydrogen covalently bonded to an electroneg-
        // ative donor (O, N, or F) and ANOTHER electronegative atom nearby.
        //
        // Real H-bonds have STRONG geometric preference: the donor-H...acceptor
        // angle should be close to LINEAR (180°). A 90° geometry gives nearly
        // zero binding. We model that with a (cosθ)² gate on the attractive
        // force, where θ is the angle at H between the donor and the acceptor.
        //
        // This is what produces the real-world consequences of H-bonding:
        //   - Water clusters of ~4-coordinated molecules (the tetrahedral motif)
        //   - Ice's characteristic OPEN hexagonal lattice (less dense than liquid,
        //     which is why ice floats)
        //   - DNA base pairing geometry (AT / GC locking in one orientation)
        // Without directionality, all nearby O/N/F atoms pull equally — unphysical slop.
        // =====================================================================
        const HBOND_DIST_SQ = (bohrRadius * 2.5) ** 2;
        // Strength tuned to be ~4-5% of bondForceConstant_covalent — real H-bonds
        // are about 1/20th the strength of the O-H covalent bond they partner with.
        const HBOND_STRENGTH = 0.12;
        const ELECTRONEG = new Set(['O', 'N', 'F']);
        function applyHydrogenBonding() {
            for (let i = 0; i < nuclei.length; i++) {
                const h = nuclei[i];
                if (!h || h.elementName !== 'H' || !h.bonds || h.bonds.length === 0) continue;
                const donor = h.bonds[0]; // atom H is covalently bonded to
                if (!donor || !ELECTRONEG.has(donor.elementName)) continue;
                if (!h.pos || !donor.pos) continue;

                // Donor→H direction (unit vector). We want the acceptor to be
                // roughly on the far side of H along this line.
                const armX = h.pos.x - donor.pos.x;
                const armY = h.pos.y - donor.pos.y;
                const armZ = h.pos.z - donor.pos.z;
                const armMag = Math.sqrt(armX * armX + armY * armY + armZ * armZ);
                if (armMag < 1e-6) continue;
                const armNx = armX / armMag, armNy = armY / armMag, armNz = armZ / armMag;

                for (let j = 0; j < nuclei.length; j++) {
                    const acceptor = nuclei[j];
                    if (!acceptor || acceptor === donor || acceptor === h) continue;
                    if (!ELECTRONEG.has(acceptor.elementName)) continue;
                    if (h.bonds.includes(acceptor)) continue;
                    if (!acceptor.pos) continue;

                    // H→acceptor vector
                    const dx = acceptor.pos.x - h.pos.x;
                    const dy = acceptor.pos.y - h.pos.y;
                    const dz = acceptor.pos.z - h.pos.z;
                    const dSq = dx * dx + dy * dy + dz * dz;
                    if (dSq > HBOND_DIST_SQ || dSq < 1) continue;

                    const dist = Math.sqrt(dSq);
                    const dNx = dx / dist, dNy = dy / dist, dNz = dz / dist;

                    // cos(angle) between donor→H and H→acceptor
                    // colinear (D-H...A straight line) → cos = 1 (ideal)
                    // perpendicular                    → cos = 0 (no bond)
                    // acceptor on wrong side of H     → cos < 0 (skip)
                    const cosAng = armNx * dNx + armNy * dNy + armNz * dNz;
                    if (cosAng <= 0) continue;

                    // (cosθ)² strongly penalizes bent geometries; distance falls off linearly.
                    const angleFactor = cosAng * cosAng;
                    const distFactor = 1 - dSq / HBOND_DIST_SQ;
                    const mag = HBOND_STRENGTH * angleFactor * distFactor;

                    const force = createVector(dNx * mag, dNy * mag, dNz * mag);
                    h.applyForce(force);
                    acceptor.applyForce(p5.Vector.mult(force, -1));

                    // Notify achievements system once per session when we're
                    // actually doing real hydrogen-bonding work (strong geometry
                    // and close enough). The isEarned check keeps this cheap.
                    if (mag > HBOND_STRENGTH * 0.3 &&
                        typeof Achievements !== 'undefined' &&
                        !Achievements.isEarned('hydrogen_bond')) {
                        try { Achievements.notify('hydrogen_bond'); } catch(_e){}
                    }
                }
            }
        }

        // =====================================================================
        //  LONE-PAIR VISUALIZATION
        // =====================================================================
        // Render pale purple lobes for lone pairs on O (water: 2) and N (ammonia: 1).
        // Positions are computed to complete the tetrahedral arrangement with
        // whatever bonds the atom already has.
        function getLonePairCount(elementName, bondCount) {
            if (elementName === 'O' && bondCount === 2) return 2; // water
            if (elementName === 'N' && bondCount === 3) return 1; // ammonia
            if (elementName === 'N' && bondCount === 2) return 2;
            if (elementName === 'F' && bondCount === 1) return 3;
            return 0;
        }
        function drawLonePairs() {
            if (!showLonePairs) return;
            push();
            noStroke();
            for (const center of nuclei) {
                if (!center || !center.pos || !center.bonds) continue;
                const nBonds = center.bonds.length;
                const nLP = getLonePairCount(center.elementName, nBonds);
                if (nLP === 0) continue;
                // Compute average direction of existing bonds (outward from center)
                const bondDirs = [];
                for (const b of center.bonds) {
                    if (!b || !b.pos) continue;
                    const d = p5.Vector.sub(b.pos, center.pos);
                    if (d.magSq() > 0.01) { d.normalize(); bondDirs.push(d); }
                }
                if (bondDirs.length === 0) continue;
                // Lone pairs point opposite to the average bond direction, spread
                // out to maintain ~tetrahedral symmetry
                const avg = createVector(0, 0, 0);
                for (const d of bondDirs) avg.add(d);
                if (avg.magSq() < 0.001) continue;
                avg.normalize();
                const lpDir = p5.Vector.mult(avg, -1); // opposite to bonds
                // Build perpendicular basis for splitting multiple lone pairs
                const helper = abs(lpDir.x) < 0.9 ? createVector(1, 0, 0) : createVector(0, 1, 0);
                const u = p5.Vector.cross(lpDir, helper).normalize();
                const v = p5.Vector.cross(lpDir, u).normalize();
                const offset = 14; // distance from nucleus for lone-pair lobe
                const radius = 5;
                for (let k = 0; k < nLP; k++) {
                    let dir;
                    if (nLP === 1) {
                        dir = lpDir;
                    } else if (nLP === 2) {
                        // Two lobes splayed from the anti-bond direction
                        const angle = (k === 0 ? -1 : 1) * radians(52);
                        dir = p5.Vector.add(p5.Vector.mult(lpDir, cos(angle)), p5.Vector.mult(u, sin(angle)));
                    } else {
                        // Three lobes in 120° arrangement around anti-bond axis
                        const angle = k * TWO_PI / nLP;
                        const tilt = radians(30);
                        dir = p5.Vector.add(
                            p5.Vector.mult(lpDir, cos(tilt)),
                            p5.Vector.add(
                                p5.Vector.mult(u, sin(tilt) * cos(angle)),
                                p5.Vector.mult(v, sin(tilt) * sin(angle))
                            )
                        );
                    }
                    const lobePos = p5.Vector.add(center.pos, p5.Vector.mult(dir, offset));
                    push();
                    translate(lobePos.x, lobePos.y, lobePos.z);
                    emissiveMaterial(40, 20, 60);
                    ambientMaterial(180, 140, 220, 140);
                    sphere(radius);
                    pop();
                }
            }
            pop();
        }

        // =====================================================================
        //  PICKING (3D ray-to-sphere intersection)
        // =====================================================================
        // Given a click/tap at screen coords (sx, sy), figure out which particle
        // (if any) the user meant. Uses the worldToScreen projection we already
        // have; projects every particle center to screen and picks the closest
        // match within a pixel radius, breaking ties by camera distance.
        function pickParticleAt(sx, sy, pixelRadius, filterFn) {
            pixelRadius = pixelRadius || 20;
            let best = null;
            let bestDepth = Infinity;
            for (const p of particles) {
                if (!p || !p.pos) continue;
                // Non-center nucleons live inside their cluster; skip — they're uninteresting to click
                if (p.nucleusMembers.length > 0 && !p.isNucleusCenter) continue;
                if (filterFn && !filterFn(p)) continue;
                const proj = worldToScreen(p.pos.x, p.pos.y, p.pos.z);
                if (!proj) continue;
                const dx = proj.x - sx;
                const dy = proj.y - sy;
                const d2 = dx*dx + dy*dy;
                if (d2 < pixelRadius * pixelRadius) {
                    // Score by screen proximity, break ties by depth
                    if (proj.depth < bestDepth) {
                        best = p;
                        bestDepth = proj.depth;
                    }
                }
            }
            return best;
        }

        // Convert a screen-space drag delta back to a world-space delta on the
        // drag plane (the plane parallel to the screen that passes through the
        // particle's original position). This lets us drag a particle smoothly.
        function screenDeltaToWorld(sdx, sdy) {
            // Move in the plane facing the camera. The old version sampled the
            // world X and Y axes and dropped Z, so once the view was rotated
            // (looking along X, say) a drag did nothing or went sideways.
            // The camera's right and up axes are the first two rows of the view
            // matrix's rotation part; project a 10-unit step along each to get
            // pixels-per-unit, then solve the 2x2 system for the screen delta.
            if (!draggingParticle || !draggingParticle.pos) return createVector(0, 0, 0);
            const r = (typeof _renderer !== 'undefined') ? _renderer : null;
            if (!r || !r.uMVMatrix) return createVector(0, 0, 0);
            const mv = r.uMVMatrix.mat4;
            const ax = createVector(mv[0], mv[4], mv[8]);
            const ay = createVector(mv[1], mv[5], mv[9]);
            if (ax.magSq() < 1e-12 || ay.magSq() < 1e-12) return createVector(0, 0, 0);
            ax.normalize(); ay.normalize();
            const p = draggingParticle.pos;
            const basis = worldToScreen(p.x, p.y, p.z);
            const pa = worldToScreen(p.x + ax.x * 10, p.y + ax.y * 10, p.z + ax.z * 10);
            const pb = worldToScreen(p.x + ay.x * 10, p.y + ay.y * 10, p.z + ay.z * 10);
            if (!basis || !pa || !pb) return createVector(0, 0, 0);
            const j11 = (pa.x - basis.x) / 10, j12 = (pb.x - basis.x) / 10;
            const j21 = (pa.y - basis.y) / 10, j22 = (pb.y - basis.y) / 10;
            const det = j11 * j22 - j12 * j21;
            if (abs(det) < 1e-6) return createVector(0, 0, 0);
            const u = (sdx * j22 - sdy * j12) / det;
            const v = (sdy * j11 - sdx * j21) / det;
            return p5.Vector.add(p5.Vector.mult(ax, u), p5.Vector.mult(ay, v));
        }

        // =====================================================================
        //  INSPECTOR PANEL
        // =====================================================================
        function openInspector(particle, clientX, clientY) {
            if (!particle) return;
            inspectedParticle = particle;
            const panel = document.getElementById('inspector');
            const title = document.getElementById('inspectorTitle');
            const body = document.getElementById('inspectorBody');
            const actions = document.getElementById('inspectorActions');
            if (!panel || !title || !body || !actions) return;

            // Position near click, keeping on screen
            const W = 280;
            const H = 250;
            let left = clientX + 10;
            let top = clientY + 10;
            if (left + W > window.innerWidth - 10) left = clientX - W - 10;
            if (top + H > window.innerHeight - 10) top = window.innerHeight - H - 10;
            if (top < 10) top = 10;
            panel.style.left = left + 'px';
            panel.style.top = top + 'px';

            renderInspector();
            renderInspectorActions(particle);
            panel.classList.add('open');
        }

        // Action buttons are built once per opening. renderInspector() runs
        // every 3 frames and used to rebuild them each time, so a click that
        // took longer than ~50 ms between press and release landed on a
        // destroyed button and did nothing.
        function renderInspectorActions(p) {
            const actions = document.getElementById('inspectorActions');
            if (!actions) return;
            actions.innerHTML = '';
            const del = document.createElement('button');
            del.className = 'actionBtn';
            del.textContent = '🗑 Remove this particle';
            del.addEventListener('click', () => {
                removeParticle(p);
                closeInspector();
            });
            actions.appendChild(del);

            if (!p.isBound && !(p.nucleusMembers.length > 0 && !p.isNucleusCenter)) {
                const kick = document.createElement('button');
                kick.className = 'actionBtn';
                kick.textContent = '💨 Kick in random direction';
                kick.addEventListener('click', () => {
                    if (p.vel) p.vel.add(p5.Vector.random3D().mult(3));
                });
                actions.appendChild(kick);
            }
        }

        // Electron configuration of a set of bound electrons, ordered by n then
        // l and abbreviated with the largest complete noble-gas core:
        // "1s² 2s² 2p⁴", "[Ar] 3d⁶ 4s²".
        const SUPERSCRIPT_DIGITS = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
        function toSuperscript(n) { return String(n).split('').map(d => SUPERSCRIPT_DIGITS[+d] || d).join(''); }
        const NOBLE_CORES = [[86, 'Rn'], [54, 'Xe'], [36, 'Kr'], [18, 'Ar'], [10, 'Ne'], [2, 'He']];
        function electronConfiguration(electrons) {
            const L = { s: 0, p: 1, d: 2, f: 3 };
            const counts = new Map();
            let total = 0;
            for (const e of (electrons || [])) {
                if (!e || !e.orbitalLevel) continue;
                const key = `${e.orbitalLevel}${e.subshell || 's'}`;
                counts.set(key, (counts.get(key) || 0) + 1);
                total++;
            }
            if (total === 0) return '(none)';
            const keys = [...counts.keys()].sort((a, b) => {
                const na = parseInt(a, 10), nb = parseInt(b, 10);
                if (na !== nb) return na - nb;
                return L[a.slice(-1)] - L[b.slice(-1)];
            });
            let prefix = '';
            const skip = new Set();
            for (const [z, sym] of NOBLE_CORES) {
                if (total <= z) continue;
                const core = [];
                let left = z;
                for (const [n, l] of MADELUNG_ORDER) {
                    if (left <= 0) break;
                    core.push([`${n}${'spdf'[l]}`, 4 * l + 2]);
                    left -= 4 * l + 2;
                }
                if (core.every(([k, cap]) => counts.get(k) === cap)) {
                    prefix = `[${sym}]`;
                    core.forEach(([k]) => skip.add(k));
                    break;
                }
            }
            const parts = keys.filter(k => !skip.has(k)).map(k => `${k}${toSuperscript(counts.get(k))}`);
            return [prefix, ...parts].filter(Boolean).join(' ');
        }

        function closeInspector() {
            inspectedParticle = null;
            const panel = document.getElementById('inspector');
            if (panel) panel.classList.remove('open');
        }

        function renderInspector() {
            if (!inspectedParticle) return;
            const p = inspectedParticle;
            // If the particle has been removed, close
            if (!particles.includes(p)) { closeInspector(); return; }
            const title = document.getElementById('inspectorTitle');
            const body = document.getElementById('inspectorBody');
            const actions = document.getElementById('inspectorActions');
            if (!title || !body || !actions) return;

            let titleText;
            if (p.isNucleusCenter) {
                const net = getNetCharge(p);
                let suffix = '';
                if (net > 0) suffix = `⁺${net > 1 ? net : ''}`;
                else if (net < 0) suffix = `⁻${-net > 1 ? -net : ''}`;
                titleText = `Nucleus: ${p.elementName}${suffix}`;
            } else if (p.type === 'electron') {
                titleText = p.isBound
                    ? `Bound Electron (${p.orbitalLevel}${p.subshell})`
                    : 'Free Electron';
            } else if (p.type === 'proton') titleText = 'Proton';
            else if (p.type === 'neutron') titleText = 'Neutron';
            else titleText = p.type;
            title.textContent = titleText;

            // Build rows
            const rows = [];
            const fmt = (v, digits) => (typeof v === 'number' ? v.toFixed(digits || 2) : String(v));
            rows.push(['Type', p.type]);
            rows.push(['Charge', fmt(getNetCharge(p), 2)]);
            rows.push(['Mass', fmt(getEffectiveMass(p), 2)]);
            if (p.pos) rows.push(['Position', `${fmt(p.pos.x, 1)}, ${fmt(p.pos.y, 1)}, ${fmt(p.pos.z, 1)}`]);
            if (p.vel) {
                const speed = p.vel.mag();
                rows.push(['Speed', fmt(speed, 2)]);
                const ke = 0.5 * getEffectiveMass(p) * p.vel.magSq();
                rows.push(['Kinetic E', fmt(ke, 2)]);
            }
            if (p.isNucleusCenter) {
                const nucleonCount = 1 + (p.nucleusMembers ? p.nucleusMembers.length : 0);
                let protons = 0, neutrons = 0;
                for (const m of [p, ...(p.nucleusMembers || [])]) {
                    if (!m) continue;
                    if (m.type === 'proton') protons++;
                    else if (m.type === 'neutron') neutrons++;
                }
                rows.push(['Nucleons', `${protons} p + ${neutrons} n`]);
                rows.push(['Element', p.elementName || '?']);
                rows.push(['Bound electrons', (p.boundElectrons || []).length]);
                if (p.boundElectrons && p.boundElectrons.length > 0) {
                    rows.push(['Config', electronConfiguration(p.boundElectrons)]);
                }
                rows.push(['Bonds', (p.bonds || []).length + (p.bondedTo ? 1 : 0)]);
                rows.push(['Max bonds', p.maxBonds]);
                if (p.bonds && p.bonds.length > 0) {
                    const bondInfo = p.bonds.map(b => {
                        const order = getBondOrder(p, b);
                        const partnerEl = b.elementName || '?';
                        const sym = order === 3 ? '≡' : order === 2 ? '=' : '-';
                        return `${sym}${partnerEl}`;
                    }).join(' ');
                    rows.push(['  partners', bondInfo]);
                }
            }
            if (p.isBound) {
                rows.push(['Orbital', `${p.orbitalLevel}${p.subshell}${p.orbitalVariant ? ' ('+p.orbitalVariant+')' : ''}`]);
                if (p.boundTo && p.boundTo.elementName) {
                    rows.push(['Bound to', p.boundTo.elementName]);
                }
            }
            if (p.isPartOfMolecule && p.moleculeLabel) {
                rows.push(['Molecule', p.moleculeLabel]);
            }

            const html = rows.map(([k, v]) =>
                `<div class="row"><span class="k">${k}:</span><span class="v">${v}</span></div>`
            ).join('');
            if (body.innerHTML !== html) body.innerHTML = html;
            // (action buttons: see renderInspectorActions, built once per opening)
        }

        function removeParticle(p) {
            if (!p) return;
            // If p is a nucleus center, drop the whole cluster including bound electrons
            const toDelete = new Set([p]);
            if (p.isNucleusCenter) {
                for (const m of p.nucleusMembers || []) toDelete.add(m);
                for (const e of p.boundElectrons || []) toDelete.add(e);
            }
            // Clean bond references
            for (const other of particles) {
                if (!other) continue;
                if (toDelete.has(other)) continue;
                if (other.bonds) {
                    for (let i = other.bonds.length - 1; i >= 0; i--) {
                        if (toDelete.has(other.bonds[i])) {
                            if (other.bondOrderMap) other.bondOrderMap.delete(other.bonds[i]);
                            other.bonds.splice(i, 1);
                        }
                    }
                }
                if (other.bondedTo && toDelete.has(other.bondedTo)) other.bondedTo = null;
                if (other.boundElectrons) {
                    for (let i = other.boundElectrons.length - 1; i >= 0; i--) {
                        if (toDelete.has(other.boundElectrons[i])) other.boundElectrons.splice(i, 1);
                    }
                }
            }
            particles = particles.filter(x => !toDelete.has(x));
            nuclei = nuclei.filter(x => !toDelete.has(x));
            if (draggingParticle && toDelete.has(draggingParticle)) draggingParticle = null;
            // Re-identify now so labels, molecules and the entity list update even
            // while paused (the removed molecule's label used to linger).
            updateNuclei();
            updateMolecules();
            updateEntityList();
            forceNucleiRefresh = true;
            logEvent(`Removed particle`, 'other');
        }

        // =====================================================================
        //  LIVE GRAPHS
        // =====================================================================
        function recordGraphSample() {
            if (!graphsOpen) return;
            const avgKE = calculateAverageKE();
            let totalKE = 0;
            // Collect speed samples for the Maxwell–Boltzmann histogram. We look
            // at one representative particle per "thing" — i.e. each free particle,
            // and the center of each nucleus (so a water molecule contributes 3
            // speeds, not 10 nucleons + 8 electrons). This keeps the histogram
            // reading as "thermal motion of atoms/ions" rather than being swamped
            // by internal nucleon jiggle.
            const speeds = [];
            for (const p of particles) {
                if (!p || !p.vel || p.isBound) continue;
                if (p.nucleusMembers.length > 0 && !p.isNucleusCenter) continue;
                totalKE += 0.5 * getEffectiveMass(p) * p.vel.magSq();
                speeds.push(p.vel.mag());
            }
            graphData.temp.push(avgKE);
            graphData.energy.push(totalKE);
            graphData.molecules.push(molecules.length);
            graphData.nuclei.push(nuclei.length);
            // Keep the most recent single-frame speeds (snapshot). We don't
            // accumulate across frames — the histogram should reflect current state.
            graphData.speedSamples = speeds;
            for (const key in graphData) {
                // speedSamples isn't a time-series, skip the shift trim
                if (key === 'speedSamples') continue;
                if (graphData[key].length > GRAPH_HISTORY) graphData[key].shift();
            }
        }

        function drawGraphs() {
            if (!graphsOpen) return;
            drawGraph('graphTemp', graphData.temp, [255, 180, 80], 'graphTempNow');
            drawMBGraph();
            drawGraph('graphEnergy', graphData.energy, [120, 220, 160], 'graphEnergyNow');
            drawCountsGraph();
        }

        // --- Maxwell-Boltzmann speed histogram --------------------------------
        // Bars: histogram of current particle speeds.
        // Dashed line: theoretical M-B distribution f(v) ∝ v² · exp(−v²/(2·σ²))
        // where σ²=kT/m. Since the sim's temperature is just avgKE and all atoms
        // have different masses, we simply pick the scale so the M-B peak sits
        // at the current mean speed — the *shape* is what we care about teaching.
        function drawMBGraph() {
            const canvas = document.getElementById('graphMB');
            if (!canvas) return;
            const nowEl = document.getElementById('graphMBNow');
            const ctx = canvas.getContext('2d');
            const W = canvas.width = canvas.clientWidth;
            const H = canvas.height = canvas.clientHeight;
            ctx.clearRect(0, 0, W, H);

            const speeds = graphData.speedSamples || [];

            // Axis line at bottom
            ctx.strokeStyle = 'rgba(255,255,255,0.15)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, H - 1); ctx.lineTo(W, H - 1); ctx.stroke();

            if (speeds.length < 3) {
                ctx.fillStyle = 'rgba(200,200,200,0.4)';
                ctx.font = '10px monospace';
                ctx.fillText('(not enough particles)', 6, H / 2);
                if (nowEl) nowEl.textContent = 'v̄ = —';
                return;
            }

            // Mean and RMS speed
            let sumV = 0, sumV2 = 0, maxV = 0;
            for (const v of speeds) {
                sumV += v; sumV2 += v * v;
                if (v > maxV) maxV = v;
            }
            const meanV = sumV / speeds.length;
            const rmsV  = Math.sqrt(sumV2 / speeds.length);

            // Show the full distribution with a bit of headroom
            const axisMax = Math.max(maxV * 1.05, meanV * 3, 0.5);

            // Bin the speeds
            const NUM_BINS = 28;
            const bins = new Array(NUM_BINS).fill(0);
            for (const v of speeds) {
                let b = Math.floor((v / axisMax) * NUM_BINS);
                if (b >= NUM_BINS) b = NUM_BINS - 1;
                if (b < 0) b = 0;
                bins[b]++;
            }
            let maxCount = 0;
            for (const c of bins) if (c > maxCount) maxCount = c;
            if (maxCount < 1) maxCount = 1;

            // Draw histogram bars
            const barW = W / NUM_BINS;
            for (let i = 0; i < NUM_BINS; i++) {
                const h = (bins[i] / maxCount) * (H - 6);
                const x = i * barW;
                const y = H - 1 - h;
                ctx.fillStyle = 'rgba(255, 200, 120, 0.55)';
                ctx.fillRect(x + 1, y, barW - 2, h);
            }

            // Theoretical M-B curve: f(v) ∝ v² exp(−v²/(2σ²))
            // Peak at σ·√2. Choose σ so the curve peaks at rmsV / √3 ≈ most
            // probable speed for a M-B ensemble (v_p = √(2kT/m), v_rms = √(3kT/m)).
            // Rough but pedagogically correct.
            const vp = rmsV * Math.sqrt(2 / 3); // most probable speed
            const sigma = Math.max(vp / Math.sqrt(2), 1e-6);

            // Sample the theoretical curve to find its peak (for normalization)
            const SAMPLES = 120;
            const curve = new Array(SAMPLES);
            let curveMax = 0;
            for (let i = 0; i < SAMPLES; i++) {
                const v = (i / (SAMPLES - 1)) * axisMax;
                const y = v * v * Math.exp(-(v * v) / (2 * sigma * sigma));
                curve[i] = y;
                if (y > curveMax) curveMax = y;
            }
            if (curveMax < 1e-9) curveMax = 1;

            // Draw curve (dashed yellow)
            ctx.strokeStyle = 'rgba(255, 225, 130, 0.9)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            for (let i = 0; i < SAMPLES; i++) {
                const x = (i / (SAMPLES - 1)) * W;
                const y = H - 1 - (curve[i] / curveMax) * (H - 6);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
            ctx.setLineDash([]);

            // Mean speed tick
            const meanX = (meanV / axisMax) * W;
            ctx.strokeStyle = 'rgba(150, 220, 255, 0.6)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(meanX, H - 1); ctx.lineTo(meanX, 2); ctx.stroke();

            if (nowEl) nowEl.textContent = `v̄ = ${meanV.toFixed(2)} · v_rms = ${rmsV.toFixed(2)}`;
        }

        function drawGraph(canvasId, data, color, nowId) {
            const canvas = document.getElementById(canvasId);
            if (!canvas || data.length === 0) return;
            const ctx = canvas.getContext('2d');
            const W = canvas.width = canvas.clientWidth;
            const H = canvas.height = canvas.clientHeight;
            ctx.clearRect(0, 0, W, H);
            // Find data range
            let maxVal = 0.001;
            for (const v of data) if (v > maxVal) maxVal = v;
            // Draw axis line at bottom
            ctx.strokeStyle = 'rgba(255,255,255,0.15)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, H - 1); ctx.lineTo(W, H - 1); ctx.stroke();
            // Plot data
            ctx.strokeStyle = `rgba(${color[0]},${color[1]},${color[2]},0.9)`;
            ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},0.18)`;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            let lastX = 0;
            for (let i = 0; i < data.length; i++) {
                const x = (i / (GRAPH_HISTORY - 1)) * W;
                const y = H - 1 - (data[i] / maxVal) * (H - 4);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
                lastX = x;
            }
            ctx.stroke();
            // Fill area under curve. Close at the last sample, not the right
            // edge: until the history filled up, the fill ran a wedge from the
            // newest point to the bottom-right corner.
            ctx.lineTo(lastX, H);
            ctx.lineTo(0, H);
            ctx.closePath();
            ctx.fill();
            // Update "now" label
            const nowEl = document.getElementById(nowId);
            if (nowEl) nowEl.textContent = data[data.length - 1].toFixed(2);
        }

        function drawCountsGraph() {
            const canvas = document.getElementById('graphCounts');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const W = canvas.width = canvas.clientWidth;
            const H = canvas.height = canvas.clientHeight;
            ctx.clearRect(0, 0, W, H);
            const molData = graphData.molecules;
            const nucData = graphData.nuclei;
            if (molData.length === 0) return;
            let maxVal = 1;
            for (const v of molData) if (v > maxVal) maxVal = v;
            for (const v of nucData) if (v > maxVal) maxVal = v;
            // Molecules (amber)
            ctx.strokeStyle = 'rgba(255, 200, 120, 0.9)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            for (let i = 0; i < molData.length; i++) {
                const x = (i / (GRAPH_HISTORY - 1)) * W;
                const y = H - 1 - (molData[i] / maxVal) * (H - 4);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
            // Nuclei (cyan)
            ctx.strokeStyle = 'rgba(120, 200, 255, 0.9)';
            ctx.beginPath();
            for (let i = 0; i < nucData.length; i++) {
                const x = (i / (GRAPH_HISTORY - 1)) * W;
                const y = H - 1 - (nucData[i] / maxVal) * (H - 4);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
            // Axis
            ctx.strokeStyle = 'rgba(255,255,255,0.15)';
            ctx.beginPath();
            ctx.moveTo(0, H - 1); ctx.lineTo(W, H - 1); ctx.stroke();
            // Label
            const nowEl = document.getElementById('graphCountsNow');
            if (nowEl) nowEl.textContent = `${molData[molData.length-1]} mol / ${nucData[nucData.length-1]} nuc`;
        }

        function toggleGraphs() {
            graphsOpen = !graphsOpen;
            const panel = document.getElementById('graphsPanel');
            if (panel) panel.classList.toggle('open', graphsOpen);
            if (graphsOpen) {
                // Clear history when reopening to avoid stale data
                graphData.temp = [];
                graphData.energy = [];
                graphData.molecules = [];
                graphData.nuclei = [];
                try { Achievements.notify('graphs_opened'); } catch(_e){}
            }
        }

        // =====================================================================
        //  DOUBLE-SLIT DEMO (WAVE MODE)
        // =====================================================================
        // A dedicated 2D overlay that computes real Fraunhofer diffraction
        // for a two-slit experiment and renders the resulting intensity pattern.
        // This is SEPARATE from the 3D particle photons — the particle sim
        // doesn't do wave math. This panel does, using the textbook formula:
        //
        //    I(θ) = I₀ · [ cos(π·d·sinθ/λ) ]²           ← interference (2 slits)
        //               · [ sinc(π·a·sinθ/λ) ]²         ← diffraction envelope (slit width)
        //
        // where:
        //   d = slit separation (center-to-center)
        //   a = width of each slit
        //   λ = wavelength
        //   θ = angle from the slits to a point on the screen
        //   sinc(x) = sin(x)/x
        //
        // Numbers on sliders are labeled in real physical units (nm, μm, mm)
        // so users can experiment with parameters like real optics textbooks use.

        const doubleSlitState = {
            open: false,
            mode: 'two',           // 'two' | 'one' | 'particles'
            wavelength: 500,       // nm
            slitSep: 8000,         // nm (8 μm)
            slitWidth: 2000,       // nm (2 μm)
            screenDist: 100,       // mm
            // Particle-mode samples (accumulated photon-hit positions across
            // the screen; each one drawn as a faint dot). Reset on param change.
            particleHits: [],
            lastRenderTime: 0
        };

        // Compute normalized intensity I(x) at screen position x (in mm, relative
        // to the center of the screen directly behind the midpoint of the slits).
        // Uses the Fraunhofer far-field approximation, valid when screen
        // distance >> slit separation — which our defaults satisfy.
        // useBothSlits: true = two-slit pattern; false = single-slit only.
        function doubleSlitIntensity(x_mm, useBothSlits) {
            const s = doubleSlitState;
            // Convert everything to a common length unit (meters) for numerics
            const lambda_m = s.wavelength * 1e-9;        // nm → m
            const d_m = s.slitSep * 1e-9;                // nm → m
            const a_m = s.slitWidth * 1e-9;              // nm → m
            const L_m = s.screenDist * 1e-3;             // mm → m
            const x_m = x_mm * 1e-3;                     // mm → m
            // In the far-field / small-angle limit, sin(θ) ≈ x/L
            const sinTheta = x_m / Math.sqrt(x_m * x_m + L_m * L_m);

            // Single-slit diffraction envelope: [sinc(π·a·sinθ/λ)]²
            const beta = Math.PI * a_m * sinTheta / lambda_m;
            let sincFactor;
            if (Math.abs(beta) < 1e-9) {
                sincFactor = 1;
            } else {
                const sinc = Math.sin(beta) / beta;
                sincFactor = sinc * sinc;
            }

            if (!useBothSlits) {
                return sincFactor;
            }

            // Two-slit interference: [cos(π·d·sinθ/λ)]²
            const alpha = Math.PI * d_m * sinTheta / lambda_m;
            const interferenceFactor = Math.cos(alpha) * Math.cos(alpha);

            return sincFactor * interferenceFactor;
        }

        // Render the full double-slit scene on the canvas.
        // Left third: the optical schematic (source → barrier with slits).
        // Right two-thirds: the intensity pattern on a simulated screen.
        function drawDoubleSlit() {
            const canvas = document.getElementById('doubleSlitCanvas');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            // Resize canvas to match displayed size (prevents stretching)
            const W = canvas.width = canvas.clientWidth;
            const H = canvas.height = canvas.clientHeight;
            // Bail out gracefully if the panel hasn't laid out yet — calling
            // arc() or fillRect() on a zero-width canvas can throw.
            if (W < 40 || H < 40) return;

            ctx.clearRect(0, 0, W, H);

            const s = doubleSlitState;
            const color = wavelengthToColor(s.wavelength);
            const cStr = `rgb(${color[0]},${color[1]},${color[2]})`;
            const cStrDim = `rgba(${color[0]},${color[1]},${color[2]},0.35)`;

            // Layout: left panel (schematic) is ~35% width, right (screen) is rest
            const schW = Math.floor(W * 0.35);
            const screenX = schW + 4;
            const screenW = W - screenX - 2;
            const midY = H / 2;

            // --- Schematic (left) ---
            // Source dot
            ctx.fillStyle = cStr;
            ctx.beginPath();
            ctx.arc(12, midY, 3, 0, Math.PI * 2);
            ctx.fill();
            // Wavy arrows from source to slits
            ctx.strokeStyle = cStrDim;
            ctx.lineWidth = 1;
            const barrierX = schW - 18;
            // Barrier with slits
            ctx.fillStyle = '#5a6278';
            ctx.fillRect(barrierX - 3, 8, 6, H - 16);
            // Compute slit positions scaled to panel height
            // Map slit separation (nm) to a visual gap of ~20% of H, with slit width visible
            const slitPixGap = Math.min(Math.max(H * 0.1 * (s.slitSep / 8000), 12), H * 0.35);
            const slitPixW = Math.min(Math.max(3, slitPixGap * 0.25 * (s.slitWidth / 2000)), 10);
            // Cut the two slits in the barrier (for 'two' and 'particles' modes) or one (for 'one')
            ctx.fillStyle = '#0a0c15';
            if (s.mode === 'one') {
                // Single slit at the center
                ctx.fillRect(barrierX - 3, midY - slitPixW / 2, 6, slitPixW);
            } else {
                ctx.fillRect(barrierX - 3, midY - slitPixGap - slitPixW / 2, 6, slitPixW);
                ctx.fillRect(barrierX - 3, midY + slitPixGap - slitPixW / 2, 6, slitPixW);
            }
            // Waves: draw a few sinusoid arcs from source to barrier.
            // Guard against negative radii when the panel hasn't laid out yet
            // or is extremely narrow — arc() throws on negative radius.
            ctx.strokeStyle = cStrDim;
            const waveSpan = Math.max(schW - 30, 4);
            for (let w = 1; w <= 4; w++) {
                const r = Math.max(w * waveSpan / 4, 1);
                ctx.beginPath();
                ctx.arc(12, midY, r, -Math.PI / 4, Math.PI / 4);
                ctx.stroke();
            }
            // Label "source" / "barrier"
            ctx.fillStyle = '#8a93a8';
            ctx.font = '9px monospace';
            ctx.fillText('source', 4, 12);
            ctx.fillText('barrier', barrierX - 18, H - 4);

            // --- Screen + pattern (right) ---
            // Draw a dim frame
            ctx.strokeStyle = '#2a2d40';
            ctx.lineWidth = 1;
            ctx.strokeRect(screenX, 6, screenW, H - 12);

            // Compute and render pattern
            // We sweep x-positions from -halfRange to +halfRange (mm) and map
            // to canvas y (vertical), drawing a horizontal intensity bar for each.
            // Choose halfRange based on slit separation and wavelength so the
            // central maxima and a few side lobes fit nicely.
            // Angular half-width ~ 3 · λ / d (3 orders visible). Converted to mm on screen:
            const halfRangeMm = Math.max(3 * (s.wavelength * 1e-9) / (s.slitSep * 1e-9) * s.screenDist,
                                          2 * (s.wavelength * 1e-9) / (s.slitWidth * 1e-9) * s.screenDist);

            const PIX_STEPS = H - 14;
            const useBoth = (s.mode === 'two' || s.mode === 'particles');
            // Compute intensities
            const intensities = new Array(PIX_STEPS);
            let maxI = 1e-9;
            for (let py = 0; py < PIX_STEPS; py++) {
                // py=0 at top → largest +x; py=mid → x=0; py=bottom → largest −x
                const t = py / (PIX_STEPS - 1);
                const x_mm = (1 - 2 * t) * halfRangeMm;
                const I = doubleSlitIntensity(x_mm, useBoth);
                intensities[py] = I;
                if (I > maxI) maxI = I;
            }

            if (s.mode !== 'particles') {
                // Intensity bands (continuous bright bar representation)
                for (let py = 0; py < PIX_STEPS; py++) {
                    const I = intensities[py] / maxI;
                    if (I < 0.001) continue;
                    const alpha = Math.pow(I, 0.75);  // slight gamma
                    ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;
                    ctx.fillRect(screenX + 2, 7 + py, screenW - 4, 1);
                }
            } else {
                // Particle-dot mode: accumulate random hits weighted by intensity
                // Each render, add a few new dots (so the pattern "paints in" over time)
                const HITS_PER_FRAME = 40;
                for (let k = 0; k < HITS_PER_FRAME; k++) {
                    // Rejection sampling: pick random y, accept with probability I/maxI
                    const py = Math.floor(Math.random() * PIX_STEPS);
                    const I = intensities[py] / maxI;
                    if (Math.random() < I) {
                        s.particleHits.push({
                            py: py,
                            px: Math.random() * (screenW - 4),
                            age: 0
                        });
                    }
                }
                // Cap history so old dots fade away
                if (s.particleHits.length > 3000) {
                    s.particleHits.splice(0, s.particleHits.length - 3000);
                }
                // Draw all hits
                ctx.fillStyle = cStr;
                for (const hit of s.particleHits) {
                    ctx.globalAlpha = 0.65;
                    ctx.fillRect(screenX + 2 + hit.px, 7 + hit.py, 1, 1);
                }
                ctx.globalAlpha = 1.0;
            }

            // Mode label in corner
            ctx.fillStyle = '#aaa';
            ctx.font = '9px monospace';
            const modeLbl = s.mode === 'one' ? 'single slit'
                          : s.mode === 'two' ? 'two slits (interference)'
                          : 'particle hits';
            ctx.fillText(modeLbl, screenX + 4, H - 4);
        }

        function toggleDoubleSlit() {
            doubleSlitState.open = !doubleSlitState.open;
            const panel = document.getElementById('doubleSlitPanel');
            if (panel) panel.classList.toggle('open', doubleSlitState.open);
            if (doubleSlitState.open) {
                doubleSlitState.particleHits = [];
                drawDoubleSlit();
                try { Achievements.notify('double_slit_opened'); } catch(_e){}
            }
        }

        function initDoubleSlit() {
            const btn = document.getElementById('toggleDoubleSlitBtn');
            if (btn) btn.addEventListener('click', toggleDoubleSlit);
            const closeBtn = document.getElementById('doubleSlitClose');
            if (closeBtn) closeBtn.addEventListener('click', toggleDoubleSlit);

            // Mode tabs
            const tabs = document.querySelectorAll('#doubleSlitPanel .mode-tabs button');
            tabs.forEach(tab => {
                tab.addEventListener('click', () => {
                    tabs.forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');
                    doubleSlitState.mode = tab.getAttribute('data-mode');
                    doubleSlitState.particleHits = [];
                    drawDoubleSlit();
                    if (doubleSlitState.mode === 'particles') {
                        try { Achievements.notify('double_slit_particles'); } catch(_e){}
                    }
                });
            });

            // Sliders with live value readouts
            function bindSlider(id, valId, stateKey, formatter) {
                const el = document.getElementById(id);
                const valEl = document.getElementById(valId);
                if (!el || !valEl) return;
                const update = () => {
                    const v = parseFloat(el.value);
                    doubleSlitState[stateKey] = v;
                    valEl.textContent = formatter(v);
                    doubleSlitState.particleHits = [];
                    drawDoubleSlit();
                };
                el.addEventListener('input', update);
                update();
            }
            bindSlider('dsWavelength', 'dsWavelengthVal', 'wavelength', v => `${v.toFixed(0)} nm`);
            bindSlider('dsSlitSep', 'dsSlitSepVal', 'slitSep', v => `${(v / 1000).toFixed(1)} μm`);
            bindSlider('dsSlitWidth', 'dsSlitWidthVal', 'slitWidth', v => `${(v / 1000).toFixed(1)} μm`);
            bindSlider('dsScreen', 'dsScreenVal', 'screenDist', v => `${v.toFixed(0)} mm`);

            // Also, color the wavelength slider readout per the actual photon color
            const dsWLVal = document.getElementById('dsWavelengthVal');
            const dsWLSlider = document.getElementById('dsWavelength');
            if (dsWLVal && dsWLSlider) {
                const styleWLVal = () => {
                    const v = parseFloat(dsWLSlider.value);
                    const col = wavelengthToColor(v);
                    dsWLVal.style.color = `rgb(${col[0]},${col[1]},${col[2]})`;
                    dsWLVal.style.fontWeight = '600';
                };
                dsWLSlider.addEventListener('input', styleWLVal);
                styleWLVal();
            }
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initDoubleSlit);
        } else {
            initDoubleSlit();
        }

        // =====================================================================
        //  PHASE INDICATOR
        // =====================================================================
        // Heuristic: classify each nucleus's phase (solid / liquid / gas / plasma)
        // by looking at its neighborhood (how many other atoms are within a few
        // bond lengths) and its net charge. Store the result on each nucleus as
        // `p.phase` so rendering can use it for visual cues. Also return the
        // dominant phase for the system-wide stats-bubble tag.
        //
        // Per-particle rules:
        //   - Net charge > 0.5 AND high KE  → 'plasma'
        //   - Many close neighbors          → 'solid'
        //   - A few neighbors               → 'liquid'
        //   - Few/no neighbors              → 'gas'
        //
        // The thresholds are tuned so cooling water below T≈0.3 starts turning
        // nuclei "solid" blue, and heating plasma-presets shows red.
        let cachedPhase = '';
        const PHASE_NEIGHBOR_RADIUS = 70;        // distance to count as "neighbor"
        const PHASE_NEIGHBOR_RADIUS_SQ = PHASE_NEIGHBOR_RADIUS * PHASE_NEIGHBOR_RADIUS;
        const PHASE_SOLID_NEIGHBORS   = 4;       // ≥4 neighbors within R → solid-like
        const PHASE_LIQUID_NEIGHBORS  = 2;       // ≥2 → liquid-like
        const PHASE_PLASMA_KE         = 3.0;     // avg KE threshold for plasma
        const PHASE_PLASMA_CHARGE     = 0.5;     // net charge magnitude for plasma
        function computePhase() {
            const n = nuclei.length;
            if (particles.length === 0) return '';

            // Count neighbors for each nucleus center using a simple O(N²) scan
            // (N is small — a few dozen nuclei in realistic demos). Good enough.
            const neighborCounts = new Array(n).fill(0);
            for (let i = 0; i < n; i++) {
                const ni = nuclei[i];
                if (!ni || !ni.pos) continue;
                for (let j = i + 1; j < n; j++) {
                    const nj = nuclei[j];
                    if (!nj || !nj.pos) continue;
                    const dx = ni.pos.x - nj.pos.x;
                    const dy = ni.pos.y - nj.pos.y;
                    const dz = ni.pos.z - nj.pos.z;
                    const dSq = dx * dx + dy * dy + dz * dz;
                    if (dSq < PHASE_NEIGHBOR_RADIUS_SQ) {
                        neighborCounts[i]++;
                        neighborCounts[j]++;
                    }
                }
            }

            // Running system-wide tally for the summary tag.
            const tally = { solid: 0, liquid: 0, gas: 0, plasma: 0 };
            const avgKE = calculateAverageKE();

            for (let i = 0; i < n; i++) {
                const p = nuclei[i];
                if (!p) continue;
                const speed2 = (p.vel && p.vel.magSq) ? p.vel.magSq() : 0;
                const netCharge = Math.abs(getNetCharge(p));

                // Plasma: hot ion with few bound electrons.
                if (netCharge > PHASE_PLASMA_CHARGE && speed2 > PHASE_PLASMA_KE) {
                    p.phase = 'plasma';
                } else if (neighborCounts[i] >= PHASE_SOLID_NEIGHBORS && avgKE < 1.2) {
                    p.phase = 'solid';
                } else if (neighborCounts[i] >= PHASE_LIQUID_NEIGHBORS && avgKE < 2.5) {
                    p.phase = 'liquid';
                } else {
                    p.phase = 'gas';
                }
                tally[p.phase]++;
            }

            // Also tag free charged particles (loose protons, electrons) as plasma-ish
            // only if they're hot — this makes the fully-ionized hydrogen-plasma
            // preset read correctly in the stats-bubble.
            let hotFreeCharges = 0, totalFree = 0;
            for (const p of particles) {
                if (!p || p.isBound) continue;
                if (p.nucleusMembers && p.nucleusMembers.length > 0 && !p.isNucleusCenter) continue;
                if (p.isNucleusCenter) continue; // already counted above
                totalFree++;
                const speed2 = (p.vel && p.vel.magSq) ? p.vel.magSq() : 0;
                if (Math.abs(p.charge) > 0 && speed2 > PHASE_PLASMA_KE) hotFreeCharges++;
            }
            if (hotFreeCharges > 3 && hotFreeCharges > totalFree * 0.3) tally.plasma += hotFreeCharges;

            // Pick the dominant phase for the system-wide tag. Prefer "interesting"
            // phases over gas when any non-trivial fraction is present.
            let phase = '';
            if (tally.plasma > 0 && tally.plasma >= (tally.solid + tally.liquid + tally.gas) * 0.3) {
                phase = 'plasma';
            } else if (tally.solid >= tally.liquid && tally.solid >= tally.gas && tally.solid > 0) {
                phase = 'solid';
            } else if (tally.liquid >= tally.gas && tally.liquid > 0) {
                phase = 'liquid';
            } else if (tally.gas > 0) {
                phase = 'gas';
            }
            return phase;
        }

        // =====================================================================
        //  MOUSE / TOUCH INPUT HANDLING
        // =====================================================================
        // We hook native events directly rather than using p5's mousePressed etc.,
        // because we need right-click / context-menu semantics and precise screen
        // coords. orbitControl() still handles left-drag rotation.
        function initInputHandling() {
            // The 3D canvas. This used to be document.querySelector('canvas'),
            // which returns the FIRST canvas in the page: the hidden #graphTemp
            // graph. Right-click inspect and particle dragging were bound to a
            // canvas nobody could see, so neither worked.
            const canvasEl = mainCanvasEl || document.getElementById('defaultCanvas0');
            if (!canvasEl) return;

            // Right button: remember where it went down, so a right-DRAG (camera
            // pan) that ends over a particle does not also open the inspector
            // (Windows fires contextmenu on mouseup).
            let rightDownX = null, rightDownY = null;
            canvasEl.addEventListener('mousedown', (e) => {
                if (e.button === 2) { rightDownX = e.clientX; rightDownY = e.clientY; }
            });

            // Suppress browser right-click menu over canvas
            canvasEl.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                if (rightDownX !== null &&
                    (Math.abs(e.clientX - rightDownX) > 5 || Math.abs(e.clientY - rightDownY) > 5)) {
                    rightDownX = rightDownY = null;
                    return;   // that was a pan, not a click
                }
                rightDownX = rightDownY = null;
                const rect = canvasEl.getBoundingClientRect();
                const sx = e.clientX - rect.left;
                const sy = e.clientY - rect.top;
                const picked = pickParticleAt(sx, sy, 25);
                if (picked) {
                    openInspector(picked, e.clientX, e.clientY);
                } else {
                    closeInspector();
                }
            });

            let lastMouseX = 0, lastMouseY = 0;

            // Left-click: if on a particle, start drag. Otherwise let orbitControl handle.
            canvasEl.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return; // only left
                const rect = canvasEl.getBoundingClientRect();
                const sx = e.clientX - rect.left;
                const sy = e.clientY - rect.top;
                // Only free-moving particles can be dragged, so pick among those
                // (a bound electron in front of its nucleus used to win the pick
                // and turn the drag into a camera rotation).
                const picked = pickParticleAt(sx, sy, 15, q => !q.isBound);
                if (picked) {
                    draggingParticle = picked;
                    lastMouseX = e.clientX; lastMouseY = e.clientY;
                    canvasEl.classList.add('dragging');
                    // Freeze this particle's velocity during drag
                    if (picked.vel) picked.vel.set(0, 0, 0);
                    e.stopPropagation();
                }
            });
            canvasEl.addEventListener('mousemove', (e) => {
                if (!draggingParticle) { lastMouseX = e.clientX; lastMouseY = e.clientY; return; }
                const dx = e.clientX - lastMouseX;
                const dy = e.clientY - lastMouseY;
                lastMouseX = e.clientX; lastMouseY = e.clientY;
                // Convert screen delta to world delta
                const worldDelta = screenDeltaToWorld(dx, dy);
                if (draggingParticle.pos) {
                    draggingParticle.pos.add(worldDelta);
                    if (draggingParticle.vel) draggingParticle.vel.set(0, 0, 0);
                }
                e.stopPropagation();
            }, true);

            const endDrag = () => {
                if (draggingParticle) {
                    canvasEl.classList.remove('dragging');
                    draggingParticle = null;
                }
            };
            canvasEl.addEventListener('mouseup', endDrag);
            canvasEl.addEventListener('mouseleave', endDrag);

            // Initialize mouse coords to avoid jump on first drag
            canvasEl.addEventListener('mouseenter', (e) => {
                lastMouseX = e.clientX; lastMouseY = e.clientY;
            });

            // Touch: long-press → inspect, single-finger drag → rotate (default),
            // two-finger pinch handled by orbitControl.
            let touchStartTime = 0;
            let touchStartX = 0, touchStartY = 0;
            let touchLongPressTimer = null;
            canvasEl.addEventListener('touchstart', (e) => {
                if (e.touches.length !== 1) return;
                const t = e.touches[0];
                const rect = canvasEl.getBoundingClientRect();
                touchStartX = t.clientX;
                touchStartY = t.clientY;
                touchStartTime = Date.now();
                // Schedule long-press inspect
                touchLongPressTimer = setTimeout(() => {
                    const sx = t.clientX - rect.left;
                    const sy = t.clientY - rect.top;
                    const picked = pickParticleAt(sx, sy, 35);
                    if (picked) openInspector(picked, t.clientX, t.clientY);
                }, 600);
            }, { passive: true });
            const cancelLongPress = () => {
                if (touchLongPressTimer) { clearTimeout(touchLongPressTimer); touchLongPressTimer = null; }
            };
            canvasEl.addEventListener('touchmove', (e) => {
                if (!e.touches[0]) return;
                const t = e.touches[0];
                // If finger moved more than 10px, cancel long-press
                if (abs(t.clientX - touchStartX) > 10 || abs(t.clientY - touchStartY) > 10) {
                    cancelLongPress();
                }
            }, { passive: true });
            canvasEl.addEventListener('touchend', cancelLongPress);
            canvasEl.addEventListener('touchcancel', cancelLongPress);
        }

        // =====================================================================
        //  HELP MODAL + GLOSSARY
        // =====================================================================
        // The glossary. Keys are terms used in the help pages (case-sensitive).
        // Each definition is written at roughly a 9th-grade reading level and
        // does not rely on other undefined jargon.
        const glossary = {
            "atom": "The smallest piece of a pure chemical element. An atom has a tiny core (nucleus) with one or more positive particles, usually surrounded by the same number of small negative particles called electrons. Gold, oxygen, and hydrogen are all made of atoms.",
            "nucleus": "The tiny, heavy center of an atom. It is made of protons and usually neutrons. Almost all of an atom's mass is here.",
            "proton": "A positive particle found in the nucleus of every atom. The number of protons tells you which element the atom is.",
            "neutron": "A particle in the nucleus that has no electric charge. It adds mass and helps hold the nucleus together.",
            "electron": "A very light negative particle. Electrons live in the space around an atom's nucleus and control how atoms stick to each other.",
            "ion": "An atom that has an extra electron or is missing one. This gives it an electric charge (either plus or minus).",
            "charge": "A property that makes particles push or pull on each other. Opposite charges attract; the same charges push apart. Protons are plus, electrons are minus, neutrons are neutral.",
            "element": "A substance made of only one kind of atom. Every atom of an element has the same number of protons. Examples: hydrogen (1 proton), carbon (6 protons), iron (26 protons).",
            "molecule": "Two or more atoms joined together by a shared connection called a bond. Water (H₂O) and table salt (NaCl) are molecules.",
            "bond": "A connection between two atoms that holds them together to form a molecule.",
            "ionic bond": "A bond where one atom gives up an electron to another atom. The two atoms then stick together because one is plus and the other is minus, and opposite charges pull. Table salt (Na⁺ and Cl⁻) is held by an ionic bond.",
            "covalent bond": "A bond where two atoms share one or more electrons. The shared electrons act like glue. Water is held together by covalent bonds.",
            "shell": "A rough layer or zone where electrons live around a nucleus. The first shell is closest to the nucleus and holds up to 2 electrons. The next can hold up to 8. Outer shells can hold more.",
            "orbit": "The path an electron takes as it moves around a nucleus in the old planet-like picture of the atom. This simulator can show that picture (turn off Quantum Orbitals in the Realism panel), but by default it draws electrons as clouds instead.",
            "photon": "A tiny burst of light energy. In the real world, atoms give off or absorb photons when electrons change shells.",
            "Coulomb force": "The push or pull between things that have electric charge. Same signs push apart, opposite signs pull together. Named after the French physicist who studied it.",
            "Coulomb's law": "The rule that tells how strong the Coulomb force is. It says the push or pull gets weaker fast as the two things get farther apart.",
            "strong nuclear force": "A very strong pull that only works over tiny distances. It glues protons and neutrons together inside a nucleus and beats the push between the positive protons.",
            "Lennard-Jones": "A rule that describes a weak pull between two neutral atoms when they are close but not touching. It also pushes them apart if they get too close. Real atoms feel this in gases and liquids.",
            "van der Waals force": "A gentle pull between atoms and molecules that have no overall charge. It's what makes gecko feet sticky and what turns gas into liquid when it gets cold enough.",
            "Pauli exclusion": "A rule in real physics that says electrons cannot all pile up in the same spot. In this simulator it makes the electrons in the same shell spread out around the nucleus.",
            "gravity": "The pull that every object with mass has on every other object. It's what keeps your feet on the ground. In this simulator, you can turn gravity up or down with a slider.",
            "electric field": "An invisible push or pull that fills a region of space. A charged particle placed in an electric field gets pushed in one direction. You can set one in this simulator to test how charges react.",
            "temperature": "A measure of how fast particles are moving on average. Hotter means faster. This simulator lets you set a target temperature and will warm up or cool down the particles to match.",
            "kinetic energy": "The energy something has because it is moving. Faster and heavier objects have more kinetic energy. Temperature is basically the average kinetic energy of the particles.",
            "thermostat": "A tool that tries to keep temperature at a target value. This simulator uses one to speed up or slow down particles to hit the target temperature you set.",
            "velocity": "How fast something is moving, and in what direction. An arrow pointing in the direction of motion.",
            "acceleration": "How fast velocity is changing. When a force pushes on a particle, its velocity changes — that change is acceleration.",
            "mass": "How much stuff a particle has. Heavier particles are harder to push. Protons and neutrons have about the same mass; electrons are much lighter.",
            "Verlet integration": "A careful method for updating particle positions step by step. It's more accurate than simpler methods and keeps energy mostly steady, which is important for things that swing back and forth.",
            "integration": "The act of taking tiny steps in time to figure out where particles move next, based on the forces pushing on them.",
            "Euler method": "The simplest step-by-step way to move particles. Works but slowly loses or gains fake energy over time.",
            "simulation": "A computer program that uses math rules to copy what real things do. This one uses simple rules to copy how atoms and particles behave.",
            "cartoon physics": "A simple version of real physics that captures the big ideas but leaves out a lot of detail. Useful for learning and playing, not for science homework.",
            "isotope": "An atom of an element that has extra or fewer neutrons than usual. Carbon-12 and carbon-14 are isotopes of carbon.",
            "plasma": "A hot state of matter where atoms have been ripped apart into bare nuclei and free electrons. The sun is made of plasma.",
            "crystal": "A solid where atoms or ions are arranged in a neat, repeating pattern, like blocks in a wall. Salt and diamond are crystals.",
            "lattice": "The regular 3D grid pattern of atoms or ions in a crystal.",
            "dissociation": "When a bond breaks and two atoms or ions that were stuck together split up.",
            "equilibrium": "The ideal distance or position something settles at when no extra forces push it. Bonds have an equilibrium length — their preferred distance.",
            "net charge": "The total charge of an atom or ion after adding up all of its protons and electrons. If protons outnumber electrons, net charge is plus; if electrons outnumber protons, it's minus.",
            "valence": "The number of bonds an atom usually makes. Hydrogen has a valence of 1, oxygen 2, nitrogen 3, carbon 4.",
            "orbital": "A 3D region of space around a nucleus where an electron is likely to be. Real orbitals have shapes: s orbitals are spheres, p orbitals are dumbbells, d orbitals have four lobes or a ring. This simulator moves each electron around a cloud of that shape.",
            "nuclear force": "The force that holds protons and neutrons together inside a nucleus. Very strong but only works up close.",
            "spring force": "A pulling or pushing force that gets stronger the more you stretch or squeeze something. In this simulator, bonds act like tiny springs.",
            "equilibrium bond length": "The natural distance between two bonded atoms. If you push them closer, the bond pushes back; if you pull them apart, the bond pulls them back.",
            "frame": "A single picture the computer draws on screen. This simulator draws many frames per second to make things look like they're moving.",
            "FPS": "Frames Per Second — how many pictures the computer draws every second. Higher numbers mean smoother motion. 60 FPS is very smooth.",
            "vector": "An arrow that has both a size and a direction. Used to represent things like velocity or force.",
            "projection": "The math of taking a 3D point and figuring out where it should appear on a flat 2D screen.",
            "sigma": "In the Lennard-Jones rule, a number that sets how close two atoms can get before they start pushing each other away.",
            "cutoff": "A distance past which we stop counting a force. Saves time because very far-away particles barely affect each other anyway.",
            "Hill notation": "A standard way to write a molecule's formula. Carbon comes first, then hydrogen, then other elements in alphabet order. Methane is CH₄, not HC₄.",
            "ambient material": "A color setting in 3D graphics that controls how a shape looks under soft light coming from all directions.",
            "emissive material": "A color setting that makes a 3D shape look like it's glowing on its own, as if it gives off light.",
            "WEBGL": "A way for web pages to draw 3D graphics quickly using your computer's graphics chip.",
            "p5.js": "A free JavaScript tool used to draw graphics in a web page. This simulator is built with p5.js.",
            "spatial grid": "A trick for finding nearby particles quickly. The space is chopped into cubes, and each particle only checks the particles in its own cube and the cubes next to it.",
            "Hydrogen": "The simplest element. 1 proton, usually 0 neutrons, 1 electron.",
            "Sodium": "Element number 11. It likes to give away 1 electron and become Na⁺.",
            "Chlorine": "Element number 17. It likes to take 1 extra electron and become Cl⁻.",
            "Carbon": "Element number 6. Can make 4 covalent bonds, which is why carbon is the base of all life.",
            "Oxygen": "Element number 8. Makes 2 covalent bonds. The O in H₂O and CO₂.",
            "Nitrogen": "Element number 7. Makes 3 covalent bonds. The main gas in the air you breathe.",
            "subshell": "A subdivision of an electron shell. The inner shell only has one subshell, called s. Shell 2 has s and p. Shell 3 has s, p, and d. Shell 4 and beyond also have f. Each subshell holds a different number of electrons and has a different 3D shape.",
            "Aufbau": "A German word meaning 'building up.' In chemistry, it's the rule that electrons fill the lowest-energy orbitals first, one at a time. It's how atoms decide which shell each new electron goes into.",
            "probability cloud": "A 3D region of space around an atom's nucleus where an electron is most likely to be found. Real electrons don't have a single exact position — they spread out over their orbital. The cloud is a picture of where they might be.",
            "Morse potential": "A math formula that describes how bonds behave. Unlike a simple spring, a Morse bond pushes back hard when squeezed, pulls back when stretched a bit, but loses its grip when stretched too far. Real bonds behave like this, which is why they can break.",
            "tunneling": "A strange quantum effect where a particle can pass through a barrier that should stop it. Real electrons do this in atoms and electronic devices. It's part of why the sun shines.",
            "alpha decay": "A type of radioactive decay where a heavy nucleus shoots out a small clump of 2 protons and 2 neutrons (a helium-4 nucleus). The original nucleus becomes a lighter element.",
            "beta decay": "A type of radioactive decay where a neutron turns into a proton (or a proton into a neutron), with a fast electron (or positron) flying out. The nucleus changes into a neighboring element.",
            "half-life": "The time it takes for half of a group of radioactive nuclei to decay. Uranium-238 has a half-life of 4.5 billion years. Carbon-14 has a half-life of 5,700 years.",
            "VSEPR": "Valence Shell Electron Pair Repulsion. A theory in chemistry that says the electron pairs around an atom (both bonded and unbonded) push each other as far apart as they can. This is what sets the angles between bonds — why water is bent at 104.5° and methane is a tetrahedron at 109.5°.",
            "lone pair": "A pair of electrons in an atom's outer shell that aren't shared with another atom. Water's oxygen has two lone pairs, which take up space and push the H-O-H angle smaller than the tetrahedral ideal.",
            "stable": "A nucleus that doesn't decay. Most common atoms (carbon-12, oxygen-16, iron-56) have stable nuclei. Unstable nuclei eventually fall apart on their own.",
            "radiation": "Particles or energy shot out by radioactive decay. Alpha radiation is heavy and stops easily; beta radiation is fast-moving electrons that can get through paper; gamma radiation is high-energy light that can pass through thin metal."
        };

        // Helper: wrap a word as a clickable glossary term.
        // Usage in templates: ${gloss('nucleus')} or ${gloss('the strong force', 'strong nuclear force')}
        function gloss(term, keyOverride) {
            const key = keyOverride || term;
            return `<span class="gloss" data-term="${key}">${term}</span>`;
        }

        // Page content, defined as functions so we can interpolate glossary links.
        const helpPages = [
            // ---------- Page 1: Welcome ----------
            () => `
                <h3>Welcome to the 3D Particle Simulator</h3>
                <p>This is a <em>playground</em> for exploring how the smallest pieces of matter behave. You can add ${gloss('particles', 'electron')}, put together whole ${gloss('atoms', 'atom')} and ${gloss('molecules', 'molecule')}, heat things up, cool things down, and watch what happens.</p>
                <p>The simulator runs what's called ${gloss('cartoon physics')} — simple rules that capture the big ideas of how atoms work, but leave out the deep details. Think of it as a good drawing of real physics, not a photo.</p>
                <h4>What you can do here</h4>
                <ul>
                    <li>Drop single particles (protons, neutrons, electrons) into the space and see how they push and pull on each other.</li>
                    <li>Build whole atoms from the periodic table and watch ${gloss('electron', 'electron')}s settle into ${gloss('shell', 'shell')}s.</li>
                    <li>Make pre-built molecules like water or methane and see their shapes.</li>
                    <li>Change physics settings — ${gloss('gravity')}, temperature, ${gloss('electric field')} — to see how matter responds.</li>
                    <li>Try one of the "Preset" scenarios for instant demos.</li>
                </ul>
                <h4>How to look around</h4>
                <p>Click and drag to spin the view. Scroll wheel to zoom. Right-click drag to pan (slide) the view sideways.</p>
                <p><strong>Tip:</strong> Any word with a dotted yellow underline — like ${gloss('atom')} — is a glossary term. Click it to see what it means.</p>
            `,

            // ---------- Page 2: The three basic particles ----------
            () => `
                <h3>The three basic particles</h3>
                <p>Almost everything you see is built from just three tiny particles. In this simulator they look like colored balls.</p>
                <h4><span class="colorDot" style="background: rgb(255, 80, 80)"></span>Proton (red)</h4>
                <p>A ${gloss('proton')} has a <strong>positive</strong> ${gloss('charge')}. It lives in the center of an atom. Every proton pushes every other proton away — they don't like each other. But something else keeps them stuck together (we'll get to that). The number of protons in an atom is what decides which ${gloss('element')} it is.</p>
                <h4><span class="colorDot" style="background: rgb(150, 150, 150)"></span>Neutron (gray)</h4>
                <p>A ${gloss('neutron')} has <strong>no charge</strong>. It's about the same size and weight as a proton. Its main job is to help hold the protons together. A ${gloss('nucleus')} with only protons and no neutrons usually flies apart (hydrogen is the lucky exception — its one proton has nothing to fight with).</p>
                <h4><span class="colorDot" style="background: rgb(100, 150, 255)"></span>Electron (small blue)</h4>
                <p>An ${gloss('electron')} has a <strong>negative</strong> charge. It's about 1/1836 the ${gloss('mass')} of a proton — really tiny. Electrons zip around the nucleus and decide how atoms stick to each other. All of chemistry is really about electrons.</p>
                <h4>The charge rule</h4>
                <p>This is the most important rule in the whole simulator: <strong>opposite charges pull together, same charges push apart.</strong> Two protons (both +) push each other. A proton and an electron (+ and −) pull each other. This is called the ${gloss('Coulomb force')}.</p>
            `,

            // ---------- Page 3: Nuclei and elements ----------
            () => `
                <h3>Nuclei and elements</h3>
                <p>A ${gloss('nucleus')} is a tight clump of protons and neutrons stuck in the middle of an atom. You can watch one form: add a few protons and neutrons close to each other and they'll glue together.</p>
                <p>Wait — protons all have the same positive charge, so they should push each other apart. So why don't nuclei explode?</p>
                <h4>The strong force</h4>
                <p>There's another force called the ${gloss('strong nuclear force')}. It's much stronger than the electric push between protons, but it only reaches across a very tiny distance. When protons and neutrons are touching, the strong force wins and they stick. Pull them apart just a little, and the strong force disappears. That's why a nucleus is so small and tight.</p>
                <h4>What makes it an element?</h4>
                <p>The <strong>number of protons</strong> is all that matters for telling which element you have:</p>
                <ul>
                    <li>1 proton = ${gloss('Hydrogen')} (H)</li>
                    <li>2 protons = Helium (He)</li>
                    <li>6 protons = ${gloss('Carbon')} (C)</li>
                    <li>8 protons = ${gloss('Oxygen')} (O)</li>
                    <li>79 protons = Gold (Au)</li>
                    <li>92 protons = Uranium (U)</li>
                </ul>
                <p>The neutrons don't change the element — they just change how heavy the atom is. Two atoms of the same element with different numbers of neutrons are called ${gloss('isotope')}s.</p>
                <p>When nuclei form in this simulator, their element label (like "C" or "Fe") appears in the entity list on the right.</p>
            `,

            // ---------- Page 4: Atoms, ions, and shells ----------
            () => `
                <h3>Atoms, ions, and electron shells</h3>
                <p>An ${gloss('atom')} is a nucleus with electrons buzzing around it. A <strong>neutral</strong> atom has the same number of electrons as protons — the plus and minus charges cancel out.</p>
                <h4>Electron shells</h4>
                <p>Electrons don't fly around randomly. They live in ${gloss('shell', 'shell')}s — rough zones at set distances from the nucleus. In this simulator you see shells as faint blue spheres around each atom. The shells fill in order from closest to farthest:</p>
                <ul>
                    <li><strong>Shell 1:</strong> up to 2 electrons</li>
                    <li><strong>Shell 2:</strong> up to 8 electrons</li>
                    <li><strong>Shell 3:</strong> up to 18 electrons</li>
                    <li>And so on for bigger atoms.</li>
                </ul>
                <p>One twist (the ${gloss('Aufbau')} order): from potassium on, the next shell starts filling before the one below it is full. Potassium is 2, 8, 8, 1, not 2, 8, 9, and iron is 2, 8, 14, 2. The simulator follows that order; right-click an atom to see its full configuration.</p>
                <p>A real electron doesn't move on a simple circle; it lives in a 3D cloud called an ${gloss('orbital')}. This simulator draws those clouds by default (s spheres, p dumbbells, d lobes). Turn off "Quantum Orbitals" in the Realism panel to see the old planet-style circles.</p>
                <h4>Ions: atoms with a charge</h4>
                <p>If an atom loses or gains an electron, it becomes an ${gloss('ion')}. The charge no longer balances out.</p>
                <ul>
                    <li><strong>${gloss('Sodium')} (Na)</strong> likes to give up 1 electron, becoming Na⁺ (sodium with a <em>plus</em> charge).</li>
                    <li><strong>${gloss('Chlorine')} (Cl)</strong> likes to take 1 extra electron, becoming Cl⁻ (chlorine with a <em>minus</em> charge).</li>
                </ul>
                <p>Click <strong>Na⁺</strong> or <strong>Cl⁻</strong> in the controls to add these ions.</p>
                <p>The ${gloss('net charge')} of any atom in the simulator is shown in the label: Na⁺, Fe²⁺, Cl⁻, and so on.</p>
                <h4>Why shells matter</h4>
                <p>Atoms are happiest when their outer shell is full. Sodium has 1 lonely electron in its outer shell — it'd rather dump it. Chlorine has 7 electrons in its outer shell and really wants one more to fill it up. That's why they're so eager to team up. Watch what happens when a Na⁺ meets a Cl⁻...</p>
            `,

            // ---------- Page 5: Bonds ----------
            () => `
                <h3>Bonds: how atoms stick together</h3>
                <p>A ${gloss('bond')} is what holds two atoms together to make a molecule. There are two main kinds in this simulator.</p>
                <h4>Ionic bond</h4>
                <p>An ${gloss('ionic bond')} forms when one atom flat-out gives an electron to another. Now one atom is positive, the other is negative, and the Coulomb force glues them together.</p>
                <p><strong>Classic example:</strong> table salt, NaCl. Sodium hands its spare electron to chlorine. Sodium becomes Na⁺, chlorine becomes Cl⁻, and they snap together like magnets.</p>
                <p>Try the "Ionic Mix (Na + Cl)" preset to watch this happen. You'll see Na⁺ and Cl⁻ ions drifting around, and eventually they pair up.</p>
                <h4>Covalent bond</h4>
                <p>A ${gloss('covalent bond')} is different. Here the atoms <em>share</em> electrons instead of giving them away. The shared electrons spend time between both nuclei, and that's what holds them together.</p>
                <p><strong>Examples:</strong> H₂ (hydrogen gas), H₂O (water), CO₂, CH₄ (methane). Most of what's inside you is held together by covalent bonds.</p>
                <p>Not every atom can make the same number of bonds. This is called ${gloss('valence')}:</p>
                <ul>
                    <li>Hydrogen: 1 bond</li>
                    <li>Oxygen: 2 bonds</li>
                    <li>Nitrogen: 3 bonds</li>
                    <li>Carbon: 4 bonds</li>
                </ul>
                <h4>Bonds as springs</h4>
                <p>In this simulator every bond acts like a tiny ${gloss('spring force', 'spring force')}. Each bond has a favorite length — the ${gloss('equilibrium bond length')}. Squeeze the atoms too close and the bond pushes back. Pull them too far apart and the bond pulls them back.</p>
                <p>If you stretch a bond too much (like from heat or an electric field), it will snap. This is called ${gloss('dissociation')}.</p>
                <p>You see bonds drawn as faint gray lines between atoms.</p>
            `,

            // ---------- Page 6: Molecules ----------
            () => `
                <h3>Molecules</h3>
                <p>A ${gloss('molecule')} is a group of atoms held together by bonds. Once a molecule forms, its label (like H₂O or CH₄) shows up in the entity list on the right and also floats above it in the 3D view (if labels are on).</p>
                <h4>Molecular formulas</h4>
                <p>The label follows ${gloss('Hill notation')}: carbon first, then hydrogen, then everything else in alphabet order. So methane is CH₄, not HC₄.</p>
                <h4>Pre-built molecules you can add</h4>
                <ul>
                    <li><strong>Water (H₂O):</strong> one oxygen, two hydrogens. The atoms form a bent shape with about a 104.5° angle between the H–O–H.</li>
                    <li><strong>Salt (NaCl):</strong> ionic, so it's really a pair stuck together by charge.</li>
                    <li><strong>Hydrogen gas (H₂), Oxygen (O₂), Nitrogen (N₂):</strong> two atoms of the same element joined by a covalent bond.</li>
                    <li><strong>Carbon dioxide (CO₂):</strong> a linear molecule with a carbon in the middle.</li>
                    <li><strong>Methane (CH₄):</strong> a tetrahedron — a carbon with four hydrogens pointing to the corners of a 4-sided pyramid. The bond angle is 109.5°.</li>
                    <li><strong>Ammonia (NH₃):</strong> like methane but with one hydrogen replaced by nothing, so it's a little pyramid.</li>
                    <li><strong>Ethane (C₂H₆), Ethene (C₂H₄):</strong> two carbons with hydrogens attached — the building blocks of organic chemistry.</li>
                </ul>
                <h4>Can molecules form on their own?</h4>
                <p>Yes! If you drop the right atoms in close to each other and at low enough ${gloss('temperature')}, they can find each other and form bonds. Try adding a few Na⁺ and Cl⁻ ions and waiting — you'll see NaCl molecules form and the log will announce "Ionic bond formed."</p>
                <p>If bonds can form, they can also break. Turn up the temperature and you'll see molecules shaking apart. Or check "Unbreakable Bonds" to keep them stable.</p>
            `,

            // ---------- Page 7: Forces ----------
            () => `
                <h3>The forces at work</h3>
                <p>Every moment, the simulator adds up all the pushes and pulls on every particle, then moves it a tiny bit. Here's what's doing the pushing and pulling.</p>
                <h4>1. Coulomb force (electric)</h4>
                <p>The ${gloss('Coulomb force')} between any two charged particles. Opposite signs attract, same signs repel. Gets weaker with distance — if you double the gap, the force is only a quarter as strong. This is the main force between charges.</p>
                <h4>2. Strong nuclear force</h4>
                <p>Acts only between protons and neutrons when they're practically touching. Very short reach, but extremely powerful. This is what holds a nucleus together despite all those protons pushing each other.</p>
                <h4>3. Lennard-Jones force</h4>
                <p>The ${gloss('Lennard-Jones')} rule describes a gentle ${gloss('van der Waals force')} between two neutral atoms. At medium distances they pull together a little. Get them too close and they push hard. This is why gases condense into liquids.</p>
                <h4>4. Shell-overlap repulsion</h4>
                <p>When two atoms' electron shells start to overlap, they push apart. Your hand doesn't go through a table for this reason — the atoms refuse to overlap.</p>
                <h4>5. Pauli exclusion (for bound electrons)</h4>
                <p>A simplified version of ${gloss('Pauli exclusion')}. It makes electrons in the same shell of the same atom spread out around the nucleus instead of clumping on one side.</p>
                <h4>6. Bond springs</h4>
                <p>Each bond between two atoms pulls or pushes them toward their favorite distance. Bonds behave like tiny springs.</p>
                <h4>7. Gravity</h4>
                <p>Regular ${gloss('gravity')} — every particle pulls on every other one. At real-world atom scales, gravity is almost zero compared to the Coulomb force. But in this simulator you can crank it up with a slider and see what a big gravity does.</p>
                <h4>8. Electric field</h4>
                <p>An outside push that you can turn on. If you set an ${gloss('electric field')} pointing right, all positive particles feel a push to the right, and negatives feel a push to the left. Great for pulling salt apart or for seeing currents.</p>
            `,

            // ---------- Page 8: Energy and temperature ----------
            () => `
                <h3>Energy, temperature, and the thermostat</h3>
                <p>Every moving particle has ${gloss('kinetic energy')} — the energy it has because it's moving. Fast particles have a lot; slow particles have a little.</p>
                <h4>What is temperature?</h4>
                <p>${gloss('Temperature', 'temperature')} in this simulator is really just the <strong>average kinetic energy</strong> of all the free particles. Hot = particles bouncing around fast. Cold = particles moving slowly.</p>
                <p>You'll see the current temperature in the bottom-left info panel, labeled "Avg KE."</p>
                <h4>The temperature slider</h4>
                <p>The "Target Temp" slider sets what the simulator <em>wants</em> the temperature to be. A ${gloss('thermostat')} then gently speeds up or slows down the particles every few frames to match. Drag it high to boil things; drag it low to freeze them in place.</p>
                <h4>What hot does</h4>
                <ul>
                    <li>Atoms bounce harder. Bonds stretch more.</li>
                    <li>Stretched-out bonds can snap. Molecules break apart.</li>
                    <li>Electrons held loosely to their atoms can get knocked off and fly away.</li>
                </ul>
                <h4>What cold does</h4>
                <ul>
                    <li>Atoms move slowly. They can stick together more easily.</li>
                    <li>Bonds form and last. Molecules survive.</li>
                    <li>Ions drift toward each other and form crystals.</li>
                </ul>
                <p>Try the "NaCl Crystal Lattice" preset — it starts with low temperature so the salt structure stays put. Crank up the temperature slider and watch the ${gloss('crystal')} shake itself apart!</p>
            `,

            // ---------- Page 9: Visual cues ----------
            () => `
                <h3>Visual cues: what all the extra lines and shapes mean</h3>
                <h4>Floating labels</h4>
                <p>Turn on "Floating Labels" in the Display panel. Every atom, ion, and molecule gets a text tag in the 3D view. Atoms show their element and charge (like "Fe" or "Na⁺"). Molecules show their ${gloss('Hill notation', 'Hill notation')} formula. Free particles show <em>e⁻</em>, <em>p⁺</em>, or <em>n</em>.</p>
                <h4>Electron shells (blue spheres)</h4>
                <p>Faint blue spheres around each atom mark the ${gloss('shell', 'shell')}s where electrons live. More shells = bigger atoms.</p>
                <h4>Bond lines (gray)</h4>
                <p>Gray lines connect any two atoms that are ${gloss('bond', 'bond')}ed together. Every line is one bond.</p>
                <h4>Velocity arrows (green)</h4>
                <p>Tiny green arrows show how fast and in what direction each free particle is moving. This is its ${gloss('velocity')}.</p>
                <h4>Photon rings (yellow)</h4>
                <p>When an electron gets caught by a nucleus and joins a shell, a yellow expanding ring appears. This stands in for a ${gloss('photon')} — the flash of light a real atom gives off when this happens.</p>
                <h4>Trails</h4>
                <p>Turn on "Trails" and each free particle leaves a fading color trail behind it. Helpful for seeing how things are swinging around or orbiting.</p>
                <h4>The grid (red, green, blue axes)</h4>
                <p>The three thick colored lines are the X (red), Y (green), and Z (blue) axes. They help you tell which way is which when you spin the view around.</p>
                <h4>Stats bubble (top center)</h4>
                <p>Shows ${gloss('FPS')} (how smooth the simulation is running), plus the number of particles, nuclei, and molecules alive right now.</p>
            `,

            // ---------- Page 10: Controls walkthrough ----------
            () => `
                <h3>The control panel</h3>
                <p>The left-side panel has six sections. Click any section title to collapse or expand it.</p>
                <h4>Add Particles</h4>
                <p>Drop single protons, neutrons, or electrons. Drop pre-made Na⁺ or Cl⁻ ions. Use the dropdowns to pick any element (H through Og) and add a whole atom, or pick a pre-built molecule. "Random Fill" sprays 80–250 random particles into the space — great for chaos.</p>
                <h4>Presets</h4>
                <p>One-click demos. More on these on the next page.</p>
                <h4>Simulation</h4>
                <ul>
                    <li><strong>Pause:</strong> freeze time. You can still spin the camera.</li>
                    <li><strong>Step:</strong> advance exactly one physics step. Only works while paused.</li>
                    <li><strong>📷 reset camera:</strong> puts the view back to default.</li>
                    <li><strong>📸 snapshot:</strong> saves the 3D view as a PNG.</li>
                    <li><strong>Containment Sphere:</strong> an invisible elastic wall (the faint rings) that keeps everything in view so particles keep meeting.</li>
                    <li><strong>Speed:</strong> how fast physics runs. 0.1× is slow motion; 3× is fast-forward.</li>
                    <li><strong>Unbreakable Bonds:</strong> bonds can't break no matter what. Good for building stable structures.</li>
                    <li><strong>Verlet Integration:</strong> switches between two ways of calculating motion. ${gloss('Verlet integration')} is more accurate; ${gloss('Euler method')} is simpler but can drift over time. Leave this on unless you're curious.</li>
                </ul>
                <h4>Display</h4>
                <p>Turn any visual layer on or off: floating labels, bond lines, electron shells, velocity arrows, the grid, particle trails, photon flashes.</p>
                <h4>Physics</h4>
                <ul>
                    <li><strong>Electric Field:</strong> set an outside push (X, Y, Z). Charged particles will drift in that direction.</li>
                    <li><strong>Gravity:</strong> crank this up to make particles attract each other like planets.</li>
                    <li><strong>Target Temp:</strong> how hot to keep the simulation.</li>
                </ul>
                <h4>Entity list (right side)</h4>
                <p>Live count of everything in the simulation. <strong>Hover any row</strong> to make matching particles blink gold. Really handy in a crowded scene — hover "Electron" to pick them out from a mess.</p>
                <h4>Keyboard</h4>
                <p><span class="kbd">Space</span> pause / resume · <span class="kbd">N</span> step (pauses first if running) · <span class="kbd">[</span> <span class="kbd">]</span> slower / faster · <span class="kbd">R</span> reset camera · <span class="kbd">P</span> snapshot · <span class="kbd">G</span> graphs · <span class="kbd">L</span> labels · <span class="kbd">T</span> trails · <span class="kbd">H</span> this help · <span class="kbd">Esc</span> close the inspector.</p>
                <p>Inside the help modal and the tour: <span class="kbd">←</span> <span class="kbd">→</span> to flip pages, <span class="kbd">Esc</span> to close.</p>
            `,

            // ---------- Page 11: Presets ----------
            () => `
                <h3>Presets: one-click demos</h3>
                <p>Clicking any preset clears the current scene and sets up a new one. Here's what each shows off.</p>
                <h4>H₂ Gas Cloud</h4>
                <p>A cloud of hydrogen gas molecules (H₂). Watch them bounce around like real gas. The gentle ${gloss('van der Waals force', 'van der Waals force')} makes them sometimes stick and unstick.</p>
                <h4>Ionic Mix (Na + Cl)</h4>
                <p>15 sodium ions (Na⁺) and 15 chloride ions (Cl⁻). Cool and slow. Watch opposite charges find each other and pair up into NaCl molecules. Over time, they'll form chains and clumps — the start of a salt ${gloss('crystal')}!</p>
                <h4>Water Cluster</h4>
                <p>12 water molecules. Notice the bent shape of each one. Water's bent shape is the reason ice floats and why water is such a good solvent.</p>
                <h4>Plasma (hot ions)</h4>
                <p>30 bare protons and 30 free electrons at very high temperature. This is ${gloss('plasma')} — what the sun is made of. It's too hot for atoms to form. Try slowly turning the temperature down and watch atoms start to appear as electrons get captured.</p>
                <h4>NaCl Crystal Lattice</h4>
                <p>A neat 3×3×3 grid of sodium and chloride ions — a tiny ${gloss('lattice')}. Bonds are locked so the structure survives. Crank up the temperature to shake it apart, or turn it way down and watch it stay perfectly still.</p>
                <h4>Nucleon Soup (hot)</h4>
                <p>40 protons and 40 neutrons at very high temperature. Watch them collide and stick together, forming little nuclei of different sizes. This is a very cartoony version of what happens inside stars or in the first moments after the Big Bang.</p>
            `,

            // ---------- Page 12: Realism — what this sim does and doesn't get right ----------
            () => `
                <h3>Realism: what's faked, what's real-ish</h3>
                <p>This sim used to fake a <em>lot</em>. Some of those fakes were fixed. Some of them can be toggled. A few still remain because fixing them honestly would break the sim or make it boring.</p>

                <h4>🎛️ The Realism panel</h4>
                <p>Open the "Realism" section in the controls on the left. You'll find nine toggles. They all default to sensible choices, but you can experiment.</p>

                <h4>✅ <span class="gloss" data-term="orbital">Orbital</span> shapes (toggleable, on by default)</h4>
                <p>Old version: electrons moved in perfect circles around the nucleus, like tiny planets. That's wrong.</p>
                <p>Now: each bound electron is assigned a subshell (s, p, d, or f) based on which electron it is for that atom. Then its position is sampled from the probability cloud for that shape:</p>
                <ul>
                    <li><strong>s orbitals</strong> form fuzzy spheres around the nucleus</li>
                    <li><strong>p orbitals</strong> form two-lobed dumbbells along the x, y, or z axis</li>
                    <li><strong>d orbitals</strong> form more complex shapes: four lobes in a plane, or two lobes plus a ring</li>
                </ul>
                <p>Turn it off to see the old simple-circle behavior.</p>
                <p><strong>Still faked:</strong> real orbitals are quantum probability distributions, not visible blobs. We cheat by moving the electron between sampled points to suggest a cloud shape.</p>

                <h4>✅ Bond angles (toggleable, on by default)</h4>
                <p>Old version: bonds were just springs pulling atoms toward the right distance, with no care for the angle between bonds.</p>
                <p>Now: when an atom has two or more bonds, a "bending" force pulls those bonds toward the right angle based on VSEPR theory:</p>
                <ul>
                    <li>Water (O with 2 bonds): 104.5° bend</li>
                    <li>Ammonia (N with 3 bonds): 107° pyramid</li>
                    <li>Methane (C with 4 bonds): 109.5° tetrahedron</li>
                    <li>Ethene (C with 3 bonds): 120° triangle</li>
                    <li>CO₂ (C with 2 bonds): 180° straight line</li>
                </ul>

                <h4>✅ Bond orders: single, double, triple bonds</h4>
                <p>Old version: every covalent bond was identical.</p>
                <p>Now: some molecules have double or triple bonds. O₂ has a double bond (O=O), N₂ has a triple bond (N≡N), CO₂ has two double bonds (O=C=O), ethene has a C=C double bond. You see them rendered as two or three parallel lines. Higher-order bonds are <em>shorter</em> and <em>stiffer</em>, just like in real molecules.</p>

                <h4>✅ Morse potential for bond breaking (toggleable, on by default)</h4>
                <p>Old version: bonds were simple springs. That means the pull-back force grew without limit when you stretched them — the spring never "gave up."</p>
                <p>Now: bonds use the <strong>Morse potential</strong>, which matches real bonds much better. A Morse bond:</p>
                <ul>
                    <li>Pushes back very hard when squeezed too close (like a real bond)</li>
                    <li>Pulls back strongly when slightly stretched</li>
                    <li><em>Loses its grip</em> when stretched too far — the force fades to zero</li>
                </ul>
                <p>This means bonds now genuinely break when you pull them apart (or heat things up enough), the way they really do in chemistry.</p>

                <h4>✅ Radioactive decay (toggleable, off by default)</h4>
                <p>Old version: a uranium atom would sit there forever.</p>
                <p>Now (when enabled): unstable nuclei really do fall apart.</p>
                <ul>
                    <li><strong>Alpha decay:</strong> heavy nuclei (past bismuth, Z > 83) can shoot out a Helium-4 nucleus (2 protons + 2 neutrons) at high speed. Watch for the orange flash.</li>
                    <li><strong>Beta-minus decay:</strong> nuclei with too many neutrons convert one neutron into a proton, emitting a fast-moving electron. Watch for the green flash.</li>
                    <li><strong>Beta-plus decay:</strong> nuclei with too few neutrons convert one proton into a neutron, emitting a positron (antimatter electron). Watch for the pink flash, and for the positron annihilating when it meets an electron.</li>
                </ul>
                <p>Which nuclei count as stable comes from the real list of stable isotopes (up to bismuth): lead-208 and gold-197 stay put, while carbon-14 beta-decays to nitrogen-14. Use the ΔN box next to the element picker to make lighter or heavier isotopes.</p>
                <p>Half-lives are sped up massively so you can see it happen. Real uranium-238 takes 4.5 billion years to half-decay. Here you'll see it happen in seconds.</p>
                <p><strong>Try it:</strong> add a Uranium atom, turn on "Radioactive Decay", and wait.</p>

                <h4>⚗️ Electron tunneling (toggleable, off by default)</h4>
                <p>Old version: no quantum weirdness at all.</p>
                <p>Now (when enabled): about 0.2% of the time, a bound electron will randomly "tunnel" to a position the old rules would not allow. This hints at one real quantum effect — particles really can pass through barriers they classically couldn't.</p>
                <p><strong>Still faked:</strong> real tunneling is much more subtle and depends on barrier height and width. We're doing a cartoon of the effect, not simulating it.</p>

                <h4>⚗️ True-scale mode (toggleable, off by default)</h4>
                <p>Real atoms are mostly empty space. The nucleus is about 100,000 times smaller than the whole atom. If we drew everything to true scale, the nucleus would be invisible.</p>
                <p>Turning on "True-Scale Atoms" shrinks the nucleus particles dramatically so you can get a better feel for that emptiness. The physics doesn't change — only what you see.</p>

                <h4>🚫 Still faked (and probably always will be)</h4>
                <ul>
                    <li><strong>Speeds are slow motion.</strong> Real electrons move at a significant fraction of the speed of light. Real molecules vibrate trillions of times per second. A computer screen updates 60 times per second. The sim <em>has</em> to slow things down — even the fastest speed setting (3×) is still billions of times slower than reality.</li>
                    <li><strong>Force ratios are wrong.</strong> In real atoms the Coulomb force is roughly <em>39 orders of magnitude</em> stronger than gravity. If we used that ratio, gravity would be numerical noise and the simulation would behave identically whether gravity was on or off. So we cheat — but the cheat is what makes the gravity slider fun.</li>
                    <li><strong>Electrons really are probability waves, not balls.</strong> We draw balls because balls are easier to see.</li>
                    <li><strong>No full quantum mechanics.</strong> Real physics has superposition, entanglement, and interference. Our "tunneling" toggle is a tiny hint at one piece of this, not the real thing.</li>
                    <li><strong>Bond chemistry is still simplified.</strong> Lone pairs are drawn (Display → Lone Pairs) and shape the bond angles, but they are not simulated as electrons. We don't model hybrid orbitals, resonance, aromaticity, or how molecules twist around single bonds.</li>
                </ul>
                <p>If a chemistry teacher tells you something that disagrees with this simulator — <strong>trust the teacher</strong>, not the sim. This thing is a learning toy, not a research tool.</p>
            `,

            // ---------- Page 13: Try this ----------
            () => `
                <h3>Try this: fun experiments</h3>
                <h4>1. Build a hydrogen atom from scratch</h4>
                <p>Clear everything. Add one proton. Add one electron. Wait. The electron should eventually get caught by the proton and start orbiting (a low Target Temp helps: a fast electron flies past instead of being captured). You'll see a yellow ${gloss('photon')} flash when it gets captured.</p>
                <h4>2. Rip an atom apart with an electric field</h4>
                <p>Add a hydrogen atom. Turn on a big electric field (say, Ex = 2). The positive nucleus gets pushed one way and the electron gets yanked the other. With enough field, the atom will break.</p>
                <h4>3. Watch salt form</h4>
                <p>Run the "Ionic Mix" preset. Let it run for a minute. You'll see little Na⁺–Cl⁻ pairs forming, then longer chains as the lattice starts to build up.</p>
                <h4>4. Melt a crystal</h4>
                <p>Start with "NaCl Crystal Lattice" preset. The bonds are locked and temperature is low. Turn unbreakable bonds OFF and slowly raise the temperature. At some point the lattice will fall apart.</p>
                <h4>5. Make a mini solar system</h4>
                <p>Clear everything, add a few atoms (argon or neon: neutral and unreactive), crank gravity (G) to 0.3, and set the temperature low (0.1). Watch them fall toward each other and clump. The thermostat keeps bleeding off the speed they gain, so you get a slowly collapsing cluster rather than clean planet-style orbits. (Loose neutrons are a poor choice: two neutrons that touch fuse into a cluster.)</p>
                <h4>6. Build methane and see its shape</h4>
                <p>Add a methane molecule. Pause the sim. Spin the camera — the four hydrogens point to the corners of a 4-sided pyramid (a tetrahedron). That 109.5° bond angle is why methane is non-polar.</p>
                <h4>7. Compare Euler vs Verlet</h4>
                <p>Add a hydrogen atom. Let it settle. Now turn ${gloss('Verlet integration')} off and watch for a long time — you may see the electron slowly drift outward over many minutes. Turn Verlet back on — much more stable.</p>
                <h4>8. Watch nuclear fusion (sort of)</h4>
                <p>Run "Nucleon Soup (hot)." Watch clusters form. This is a cartoon of the first moments after the Big Bang. The sim won't tell you which nuclei are realistic — many won't be — but it's fun to watch.</p>
                <p style="margin-top:18px;"><strong>Have fun!</strong> The simulator doesn't grade you and nothing can really break.</p>
            `
        ];

        let currentHelpPage = 0;

        function openHelpModal() {
            const bd = document.getElementById('helpModalBackdrop');
            if (!bd) return;
            currentHelpPage = 0;
            renderHelpPage();
            bd.classList.add('open');
            bd.setAttribute('aria-hidden', 'false');
        }

        function closeHelpModal() {
            const bd = document.getElementById('helpModalBackdrop');
            if (!bd) return;
            bd.classList.remove('open');
            bd.setAttribute('aria-hidden', 'true');
            hideGlossPopup();
        }

        function renderHelpPage() {
            const body = document.getElementById('helpPageBody');
            const prevBtn = document.getElementById('helpPrevBtn');
            const nextBtn = document.getElementById('helpNextBtn');
            const pageLabel = document.getElementById('helpPageLabel');
            const dots = document.getElementById('helpDots');
            if (!body) return;
            const n = helpPages.length;
            currentHelpPage = Math.max(0, Math.min(n - 1, currentHelpPage));
            body.innerHTML = helpPages[currentHelpPage]();
            body.scrollTop = 0;
            if (prevBtn) prevBtn.disabled = currentHelpPage === 0;
            if (nextBtn) nextBtn.disabled = currentHelpPage === n - 1;
            if (pageLabel) pageLabel.textContent = `${currentHelpPage + 1} / ${n}`;
            if (dots) {
                let html = '';
                for (let i = 0; i < n; i++) {
                    html += `<span class="dot ${i === currentHelpPage ? 'active' : ''}" data-dot="${i}" title="Page ${i + 1}"></span>`;
                }
                dots.innerHTML = html;
            }
            hideGlossPopup();
        }

        function showGlossPopup(term, anchorEl) {
            const popup = document.getElementById('glossPopup');
            if (!popup) return;
            const def = glossary[term];
            if (!def) { hideGlossPopup(); return; }
            popup.innerHTML = `<span class="glossTerm">${term}</span>${def}`;
            popup.classList.add('open');
            // Position near the anchor, keeping it on screen
            const rect = anchorEl.getBoundingClientRect();
            const popupWidth = 320;
            const popupMaxHeight = 200;
            let left = rect.left;
            let top = rect.bottom + 6;
            // If too close to right edge, shift left
            if (left + popupWidth > window.innerWidth - 10) {
                left = window.innerWidth - popupWidth - 10;
            }
            // If too close to bottom edge, show above instead
            if (top + popupMaxHeight > window.innerHeight - 10) {
                top = rect.top - popupMaxHeight - 6;
                if (top < 10) top = 10;
            }
            popup.style.left = left + 'px';
            popup.style.top = top + 'px';
        }

        function hideGlossPopup() {
            const popup = document.getElementById('glossPopup');
            if (popup) popup.classList.remove('open');
        }

        // Wire up modal interactions
        function initHelpModal() {
            const helpBtn = document.getElementById('helpBtn');
            const backdrop = document.getElementById('helpModalBackdrop');
            const closeX = document.querySelector('#helpModal .closeX');
            const prevBtn = document.getElementById('helpPrevBtn');
            const nextBtn = document.getElementById('helpNextBtn');
            const dots = document.getElementById('helpDots');
            const body = document.getElementById('helpPageBody');

            if (helpBtn) helpBtn.addEventListener('click', openHelpModal);
            if (closeX) closeX.addEventListener('click', closeHelpModal);
            // Click outside modal card closes it
            if (backdrop) backdrop.addEventListener('click', (e) => {
                if (e.target === backdrop) closeHelpModal();
            });
            if (prevBtn) prevBtn.addEventListener('click', () => {
                if (currentHelpPage > 0) { currentHelpPage--; renderHelpPage(); }
            });
            if (nextBtn) nextBtn.addEventListener('click', () => {
                if (currentHelpPage < helpPages.length - 1) { currentHelpPage++; renderHelpPage(); }
            });
            if (dots) dots.addEventListener('click', (e) => {
                const t = e.target;
                if (t && t.classList.contains('dot')) {
                    const i = parseInt(t.getAttribute('data-dot'), 10);
                    if (!isNaN(i)) { currentHelpPage = i; renderHelpPage(); }
                }
            });
            // Glossary term clicks via event delegation on the page body
            if (body) body.addEventListener('click', (e) => {
                const t = e.target;
                if (t && t.classList && t.classList.contains('gloss')) {
                    e.stopPropagation();
                    const term = t.getAttribute('data-term');
                    showGlossPopup(term, t);
                } else {
                    hideGlossPopup();
                }
            });
            // Click anywhere else to close the glossary popup
            document.addEventListener('click', (e) => {
                const popup = document.getElementById('glossPopup');
                if (!popup || !popup.classList.contains('open')) return;
                if (popup.contains(e.target)) return;
                if (e.target.classList && e.target.classList.contains('gloss')) return;
                hideGlossPopup();
            });
            // Keyboard: arrows to flip pages, Esc to close (only when modal open)
            document.addEventListener('keydown', (e) => {
                if (!backdrop || !backdrop.classList.contains('open')) return;
                if (e.key === 'Escape') { closeHelpModal(); e.preventDefault(); }
                else if (e.key === 'ArrowLeft' && currentHelpPage > 0) {
                    currentHelpPage--; renderHelpPage(); e.preventDefault();
                }
                else if (e.key === 'ArrowRight' && currentHelpPage < helpPages.length - 1) {
                    currentHelpPage++; renderHelpPage(); e.preventDefault();
                }
            });
        }

        // =================================================================
        //  ENTITY INFO MODAL  (click on a 3D label or entity list item)
        // =================================================================
        // Knowledge base of every labelable thing in the simulator:
        //  - subatomic particles
        //  - every element H..Og (with "generative" etymology/notes)
        //  - every molecule in moleculeConfigs
        //  - plus ions (Na⁺, Cl⁻, Fe²⁺ …) handled by derivation

        // Short physics/alias note for the three fundamental particle types.
        const particleInfo = {
            electron: {
                name: 'Electron',
                formula: 'e⁻',
                alsoKnown: 'β⁻ (when emitted in beta decay); "negatron" in old texts',
                description: 'A fundamental, point-like particle carrying exactly one unit of negative electric charge (−e). It is a lepton — it does not feel the strong nuclear force — and is one of the stablest particles known; no decay has ever been observed. Electrons fill the orbitals around every atomic nucleus and are the charge carriers responsible for electric current, chemical bonding, and almost every chemical reaction.',
                facts: [
                    ['Charge', '−1 e (−1.602×10⁻¹⁹ C)'],
                    ['Mass', '9.109×10⁻³¹ kg  (≈ 1/1836 of a proton)'],
                    ['Spin', '½ (fermion)'],
                    ['Family', 'Lepton, 1st generation'],
                    ['Discovered', '1897, J. J. Thomson']
                ]
            },
            proton: {
                name: 'Proton',
                formula: 'p⁺',
                alsoKnown: 'Hydrogen nucleus (¹H⁺); "H⁺"',
                description: 'A positively charged baryon made of two up quarks and one down quark (uud), bound together by the strong force via gluons. Protons live in the atomic nucleus alongside neutrons. The number of protons in a nucleus is the element — one proton is hydrogen, six is carbon, ninety-two is uranium. The free proton is extremely stable (no decay has been confirmed experimentally).',
                facts: [
                    ['Charge', '+1 e'],
                    ['Mass', '1.673×10⁻²⁷ kg (1.0073 u)'],
                    ['Spin', '½'],
                    ['Quark content', 'uud'],
                    ['Discovered', '1917–1919, Ernest Rutherford']
                ]
            },
            neutron: {
                name: 'Neutron',
                formula: 'n',
                alsoKnown: 'Nucleon (shared with proton)',
                description: 'An electrically neutral baryon made of one up quark and two down quarks (udd). Neutrons glue protons together in the nucleus by contributing extra strong-force binding without adding electrostatic repulsion. A free neutron is unstable — it decays into a proton, an electron, and an antineutrino with a half-life of about 10 minutes. Inside a stable nucleus it can live indefinitely.',
                facts: [
                    ['Charge', '0'],
                    ['Mass', '1.675×10⁻²⁷ kg (1.0087 u)  — slightly heavier than a proton'],
                    ['Spin', '½'],
                    ['Quark content', 'udd'],
                    ['Free half-life', '≈ 10.2 minutes'],
                    ['Discovered', '1932, James Chadwick']
                ]
            },
            positron: {
                name: 'Positron',
                formula: 'e⁺',
                alsoKnown: 'Antielectron; β⁺ (when emitted in beta-plus decay); the antimatter partner of the electron',
                description: 'A positron is the antimatter counterpart of an electron: same mass, same spin, but positive charge. Predicted by Paul Dirac in 1928 as a consequence of combining quantum mechanics with special relativity, and discovered by Carl Anderson in 1932 in cosmic-ray tracks. Positrons are emitted in beta-plus (β⁺) decay of proton-rich nuclei — this is exactly what you see in this simulator when a proton converts into a neutron. When a positron meets an electron, they annihilate and convert their rest mass into two back-to-back gamma-ray photons (511 keV each). That annihilation signal is what makes PET — positron emission tomography — work: a patient is injected with a positron-emitting tracer and the pairs of gamma rays are detected around the body.',
                facts: [
                    ['Charge', '+1 e (opposite of electron)'],
                    ['Mass', '9.109×10⁻³¹ kg  (identical to electron)'],
                    ['Spin', '½ (antifermion)'],
                    ['Lifetime (alone)', 'Stable'],
                    ['Lifetime (near matter)', 'Microseconds — annihilates with an electron'],
                    ['Annihilation products', '2 γ-rays (511 keV each), back-to-back'],
                    ['Predicted', '1928, Paul Dirac'],
                    ['Discovered', '1932, Carl Anderson'],
                    ['Medical use', 'PET scans (positron emission tomography)']
                ]
            }
        };

        // Element data keyed by symbol. For each entry:
        //   name      – the element's common English name
        //   etymology – where the name comes from (the "generative" explanation)
        //   summary   – 1–3 sentences on what it is / is used for
        const elementInfo = {
            'H':  { name:'Hydrogen',  etymology:'Greek hydro- (water) + -genes (forming) — "water-forming", named by Lavoisier because it produces water when burned.',
                    summary:'The lightest and most abundant element in the universe — about 75% of all normal matter. One proton, (usually) no neutrons, one electron. Fuel for stars and a central player in acids, water, and organic chemistry.' },
            'He': { name:'Helium',    etymology:'Greek helios (sun) — first detected in the Sun\'s spectrum in 1868 before being found on Earth.',
                    summary:'A noble gas: chemically inert, monatomic, and the second most abundant element in the cosmos. Formed by fusion in stars and by alpha decay of heavy nuclei.' },
            'Li': { name:'Lithium',   etymology:'Greek lithos (stone) — discovered in a mineral and named to contrast with sodium/potassium (discovered in plants).',
                    summary:'The lightest metal, soft and silvery. Central to rechargeable batteries and to lithium-salt mood stabilizers.' },
            'Be': { name:'Beryllium', etymology:'From the mineral beryl, ultimately from Greek bēryllos (aquamarine / emerald).',
                    summary:'A hard, stiff, low-density metal. Transparent to X-rays, useful in aerospace alloys — but toxic in dust form.' },
            'B':  { name:'Boron',     etymology:'From borax, an Arabic-derived name for the mineral sodium borate (buraq).',
                    summary:'A metalloid. Key in glass (Pyrex), semiconductor doping, and strong lightweight composites.' },
            'C':  { name:'Carbon',    etymology:'Latin carbo (coal, charcoal).',
                    summary:'The backbone of organic chemistry and of all known life. Forms four covalent bonds, leading to a combinatorial explosion of compounds. Appears as diamond, graphite, graphene, nanotubes, and fullerenes.' },
            'N':  { name:'Nitrogen',  etymology:'Greek nitron (native soda / saltpeter) + -gen (forming) — "saltpeter-forming".',
                    summary:'Makes up 78% of Earth\'s atmosphere as diatomic N₂. Essential to amino acids and DNA. Inert as N₂ because of its triple bond, but reactive once split.' },
            'O':  { name:'Oxygen',    etymology:'Greek oxys (sharp / acidic) + -genes (forming) — Lavoisier\'s name, thinking it was needed to make acids (it isn\'t, universally).',
                    summary:'The element of fire, rust, and respiration. Second most electronegative element — so it pulls electrons strongly and forms the O–H bonds that give water its character.' },
            'F':  { name:'Fluorine',  etymology:'From the mineral fluorite, from Latin fluere (to flow), because fluorite was used as a smelting flux.',
                    summary:'The most electronegative and most reactive element. Attacks almost everything. Tamed as fluoride in toothpaste and as inert PTFE (Teflon).' },
            'Ne': { name:'Neon',      etymology:'Greek neos (new) — named because it was a newly discovered noble gas.',
                    summary:'Inert noble gas that glows brilliant red-orange in a discharge tube — the original "neon sign" color.' },
            'Na': { name:'Sodium',    etymology:'English soda (the mineral); symbol Na from Latin natrium, from Egyptian natron.',
                    summary:'A soft, silvery alkali metal that reacts violently with water. Ubiquitous as Na⁺ in seawater and biology — it runs your nerves.' },
            'Mg': { name:'Magnesium', etymology:'From Magnesia, a district in Thessaly, Greece, known for its mineral deposits.',
                    summary:'A light, strong metal used in alloys; the central atom in chlorophyll, which makes photosynthesis possible.' },
            'Al': { name:'Aluminum',  etymology:'From Latin alumen (alum, a mineral salt). British English: aluminium.',
                    summary:'The most abundant metal in Earth\'s crust, light and corrosion-resistant thanks to a self-forming oxide skin.' },
            'Si': { name:'Silicon',   etymology:'Latin silex / silicis (flint).',
                    summary:'A metalloid. The backbone of rocks (as SiO₂ / silicates) and of every microchip — silicon\'s semiconducting property runs the digital world.' },
            'P':  { name:'Phosphorus',etymology:'Greek phōsphoros (light-bringer) — white phosphorus glows in air.',
                    summary:'Exists in multiple allotropes (white, red, black). Biologically essential: backbone of DNA/RNA, energy currency as ATP, and bone as calcium phosphate.' },
            'S':  { name:'Sulfur',    etymology:'Latin sulphur, of uncertain origin; known since antiquity as "brimstone".',
                    summary:'Yellow nonmetal. Found in amino acids, vulcanized rubber, gunpowder, and sulfuric acid — the most produced industrial chemical.' },
            'Cl': { name:'Chlorine',  etymology:'Greek chlōros (pale green) — after its color as a gas.',
                    summary:'A pale green, choking gas; extremely reactive. Tamed as Cl⁻ in table salt and as the disinfectant in drinking water and pools.' },
            'Ar': { name:'Argon',     etymology:'Greek argos (lazy / inactive) — it refuses to react.',
                    summary:'A noble gas, 0.93% of Earth\'s atmosphere. Used as an inert shield in welding and in incandescent bulbs.' },
            'K':  { name:'Potassium', etymology:'English potash (plant ashes in a pot); symbol K from Latin kalium, from Arabic al-qalī.',
                    summary:'A soft, silvery alkali metal, even more reactive than sodium. K⁺ ions run the other half of your nerve signals.' },
            'Ca': { name:'Calcium',   etymology:'Latin calx (lime, limestone).',
                    summary:'A soft gray alkaline-earth metal. Structural metal of bones, teeth, and seashells as calcium phosphate / calcium carbonate.' },
            'Sc': { name:'Scandium',  etymology:'Latin Scandia (Scandinavia) — discovered there in 1879.',
                    summary:'Rare, light transition metal used in strong aluminum-scandium alloys for aerospace and sports gear.' },
            'Ti': { name:'Titanium',  etymology:'From the Titans of Greek mythology — gods of immense strength.',
                    summary:'Strong, light, corrosion-resistant. Used in jet engines, medical implants, and white paint pigment (TiO₂).' },
            'V':  { name:'Vanadium',  etymology:'From Vanadís, a Norse goddess — named for its many colorful compounds.',
                    summary:'A hard transition metal. Small amounts toughen steel dramatically (vanadium steel).' },
            'Cr': { name:'Chromium',  etymology:'Greek chrōma (color) — its compounds come in a rainbow of colors.',
                    summary:'Shiny, hard metal. Plated onto steel for corrosion resistance and mirror finishes; the red in rubies is Cr³⁺.' },
            'Mn': { name:'Manganese', etymology:'From the same root as magnesium, via a confusing Latin lineage (magnes).',
                    summary:'Essential for steelmaking and for life (enzymes, photosynthesis). The dark pigment in old glass and ancient cave art.' },
            'Fe': { name:'Iron',      etymology:'Old English iren; symbol Fe from Latin ferrum.',
                    summary:'The most-used metal on Earth. Its nucleus is among the most tightly bound of all (only nickel-62 edges it out), which is why fusion in massive stars stalls at iron. Carries oxygen in your blood via hemoglobin.' },
            'Co': { name:'Cobalt',    etymology:'German Kobold (goblin) — miners blamed mysterious ore poisonings on mine goblins.',
                    summary:'Transition metal used in batteries, high-temperature alloys, and the deep-blue pigment cobalt blue. Core of vitamin B₁₂.' },
            'Ni': { name:'Nickel',    etymology:'German Kupfernickel ("devil\'s copper") — an ore that looked like copper but yielded none.',
                    summary:'A silvery transition metal. Used in stainless steel, coins, and rechargeable batteries.' },
            'Cu': { name:'Copper',    etymology:'Latin cuprum, from Cyprus (Cyprium aes — "metal of Cyprus").',
                    summary:'Reddish, highly conductive metal. The backbone of electrical wiring and plumbing; bronze (Cu+Sn) defined an age.' },
            'Zn': { name:'Zinc',      etymology:'German Zink, possibly from Zinke (prong/tooth) — after how the metal forms in crucibles.',
                    summary:'Brittle, bluish-white metal. Galvanizes steel against rust, alloyed with copper to make brass, and an essential trace nutrient.' },
            'Ga': { name:'Gallium',   etymology:'Latin Gallia (France) — discoverer Lecoq de Boisbaudran\'s homeland.',
                    summary:'A metal that melts in your hand (m.p. 29.8 °C). GaAs and GaN are key semiconductors for LEDs and fast electronics.' },
            'Ge': { name:'Germanium', etymology:'Latin Germania (Germany).',
                    summary:'A metalloid. Predicted by Mendeleev ("eka-silicon") before discovery. Used in infrared optics and early transistors.' },
            'As': { name:'Arsenic',   etymology:'From Greek arsenikon (yellow orpiment) via Syriac / Persian roots.',
                    summary:'Notoriously toxic metalloid. Also a semiconductor dopant (n-type silicon) and ingredient in GaAs.' },
            'Se': { name:'Selenium',  etymology:'Greek selēnē (Moon) — paired with tellurium (tellus = earth), discovered together.',
                    summary:'Nonmetal. Electrical conductivity varies with light (photocells, early xerography). Trace nutrient in tiny amounts, toxic in larger.' },
            'Br': { name:'Bromine',   etymology:'Greek brōmos (stench) — after its reeking red-brown vapor.',
                    summary:'One of only two liquid elements at room temperature (the other is mercury). Used in flame retardants and historically in photography.' },
            'Kr': { name:'Krypton',   etymology:'Greek kryptos (hidden) — it hid in tiny amounts in the atmosphere.',
                    summary:'Noble gas. Used in high-performance lighting and, formerly, as the international definition of the meter.' },
            'Rb': { name:'Rubidium',  etymology:'Latin rubidus (deep red) — after the color of its spectral lines.',
                    summary:'Very soft, highly reactive alkali metal. Used in some atomic clocks and specialty research.' },
            'Sr': { name:'Strontium', etymology:'From Strontian, a village in Scotland where its ore was found.',
                    summary:'Burns bright red — the red in fireworks and road flares. Sr-90 is a long-lived fallout isotope.' },
            'Y':  { name:'Yttrium',   etymology:'From Ytterby, a village in Sweden whose quarry also gave us Tb, Er, and Yb.',
                    summary:'A rare-earth-adjacent metal. Used in red phosphors (old CRTs), YAG laser crystals, and superconductors.' },
            'Zr': { name:'Zirconium', etymology:'Persian zargun (gold-colored) — named for the gem zircon.',
                    summary:'A hard, corrosion-resistant metal. Cladding for nuclear fuel rods; zirconia (ZrO₂) mimics diamond as a gem.' },
            'Nb': { name:'Niobium',   etymology:'Greek Niobe, daughter of Tantalus — paired mythologically with tantalum.',
                    summary:'Superconducting metal. Nb-Ti wires make most MRI and particle-accelerator magnets.' },
            'Mo': { name:'Molybdenum',etymology:'Greek molybdos (lead) — ore was confused with lead.',
                    summary:'Refractory transition metal. Hardens steel and plays a role in nitrogen-fixing enzymes.' },
            'Tc': { name:'Technetium',etymology:'Greek technētos (artificial) — the first element produced artificially.',
                    summary:'All isotopes are radioactive. Tc-99m is the workhorse of nuclear-medicine imaging.' },
            'Ru': { name:'Ruthenium', etymology:'Latin Ruthenia (Russia).',
                    summary:'Platinum-group metal. Used in hard-disk coatings and as a catalyst.' },
            'Rh': { name:'Rhodium',   etymology:'Greek rhodon (rose) — from the pink color of its salts.',
                    summary:'A precious platinum-group metal. Key in automotive catalytic converters.' },
            'Pd': { name:'Palladium', etymology:'From the asteroid Pallas, discovered just before the element.',
                    summary:'Another catalytic converter metal; absorbs huge volumes of hydrogen, making it a candidate for hydrogen storage.' },
            'Ag': { name:'Silver',    etymology:'Old English seolfor; symbol Ag from Latin argentum.',
                    summary:'Highest electrical and thermal conductivity of any metal. Photography, jewelry, and germ-killing coatings.' },
            'Cd': { name:'Cadmium',   etymology:'Greek kadmeia (calamine) — cadmium was isolated from calamine ores.',
                    summary:'Soft, bluish metal. Used in NiCd batteries and bright yellow/red pigments; toxic.' },
            'In': { name:'Indium',    etymology:'From indigo — the element\'s two bright indigo-blue spectral lines.',
                    summary:'Soft metal. Indium tin oxide (ITO) is the transparent conductor on nearly every touchscreen.' },
            'Sn': { name:'Tin',       etymology:'Old English tin; symbol Sn from Latin stannum.',
                    summary:'Soft, silvery metal. Forms bronze with copper; coats "tin" cans (actually steel) to prevent rust.' },
            'Sb': { name:'Antimony',  etymology:'Medieval Latin antimonium; symbol Sb from Latin stibium, the kohl used in ancient makeup.',
                    summary:'Metalloid. Hardens lead in car batteries and bullets; used as a flame retardant.' },
            'Te': { name:'Tellurium', etymology:'Latin tellus (earth).',
                    summary:'A brittle metalloid. Used in some solar cells (CdTe) and as a glass colorant.' },
            'I':  { name:'Iodine',    etymology:'Greek iōdēs (violet) — its vapor is violet.',
                    summary:'Dark purple-black crystals that sublime. Essential trace nutrient (thyroid hormones) and a classic disinfectant.' },
            'Xe': { name:'Xenon',     etymology:'Greek xenos (stranger / foreigner).',
                    summary:'Noble gas used in high-intensity lamps, plasma displays, and ion-engine thrusters on spacecraft.' },
            'Cs': { name:'Cesium',    etymology:'Latin caesius (sky-blue) — after the blue lines in its atomic spectrum.',
                    summary:'The most electropositive stable element. Cs-133\'s hyperfine transition defines the SI second.' },
            'Ba': { name:'Barium',    etymology:'Greek barys (heavy) — ores of barium are dense.',
                    summary:'Soft, silvery alkaline-earth metal. Barium sulfate is swallowed as X-ray contrast; barium salts give green fireworks.' },
            'La': { name:'Lanthanum', etymology:'Greek lanthanein (to lie hidden).',
                    summary:'First of the lanthanide series. Used in camera lenses and hybrid-car battery hydrogen storage (NiMH).' },
            'Ce': { name:'Cerium',    etymology:'From the dwarf planet Ceres, discovered just before the element.',
                    summary:'Most abundant rare-earth. CeO₂ is a polishing compound and an automotive-catalyst oxygen buffer.' },
            'Pr': { name:'Praseodymium', etymology:'Greek prasios (leek-green) + didymos (twin) — "green twin", paired with neodymium.',
                    summary:'Rare-earth metal used in super-strong magnets, welding goggles, and yellow ceramic pigments.' },
            'Nd': { name:'Neodymium', etymology:'Greek neos (new) + didymos (twin) — "new twin" to Pr.',
                    summary:'Core of the strongest permanent magnets (Nd₂Fe₁₄B). In many wind-turbine generators and in hard-drive motors.' },
            'Pm': { name:'Promethium',etymology:'From Prometheus, the Titan who stole fire from the gods.',
                    summary:'Only radioactive lanthanide. Used as a beta source for glow paint and thin nuclear batteries.' },
            'Sm': { name:'Samarium',  etymology:'From the mineral samarskite, named for Russian mining official V. Samarsky-Bykhovets.',
                    summary:'Used in samarium-cobalt magnets that tolerate very high temperatures.' },
            'Eu': { name:'Europium',  etymology:'Named for the continent of Europe.',
                    summary:'Rare-earth. Provides the red (and blue) phosphors in TV screens and anti-counterfeit marks on euro banknotes.' },
            'Gd': { name:'Gadolinium',etymology:'For Johan Gadolin, Finnish chemist who pioneered rare-earth chemistry.',
                    summary:'Strongly paramagnetic. Gd-based complexes are the standard contrast agents in MRI scans.' },
            'Tb': { name:'Terbium',   etymology:'From Ytterby, Sweden (same quarry as Y, Er, Yb).',
                    summary:'Provides the green phosphor in fluorescent lamps and color TVs.' },
            'Dy': { name:'Dysprosium',etymology:'Greek dysprositos (hard to get at).',
                    summary:'Added to neodymium magnets to let them keep their strength at high temperatures (electric motors, wind turbines).' },
            'Ho': { name:'Holmium',   etymology:'Latin Holmia (Stockholm).',
                    summary:'Has the highest magnetic permeability of any element. Used in specialty lasers and high-field magnets.' },
            'Er': { name:'Erbium',    etymology:'From Ytterby, Sweden.',
                    summary:'Erbium-doped fiber amplifiers boost the light signals that carry the world\'s internet traffic.' },
            'Tm': { name:'Thulium',   etymology:'From Thule, the ancient name for a mythical far-northern land.',
                    summary:'Rarest stable lanthanide. Used in portable X-ray sources and some lasers.' },
            'Yb': { name:'Ytterbium', etymology:'From Ytterby, Sweden.',
                    summary:'Used in the most accurate optical atomic clocks ever built.' },
            'Lu': { name:'Lutetium',  etymology:'Latin Lutetia, the ancient Roman name for Paris.',
                    summary:'Densest and heaviest lanthanide. Used in PET-scan detector crystals.' },
            'Hf': { name:'Hafnium',   etymology:'Latin Hafnia (Copenhagen).',
                    summary:'Absorbs neutrons well — used in nuclear-reactor control rods and in transistor gate insulators (HfO₂).' },
            'Ta': { name:'Tantalum',  etymology:'From Tantalus of Greek myth (doomed to "tantalizing" eternal thirst).',
                    summary:'Corrosion-proof refractory metal. Tantalum capacitors are in nearly every phone and laptop.' },
            'W':  { name:'Tungsten',  etymology:'Swedish tung sten (heavy stone); symbol W from German Wolfram.',
                    summary:'Highest melting point of any metal (3422 °C). Light-bulb filaments, drill bits, and armor-piercing rounds.' },
            'Re': { name:'Rhenium',   etymology:'Latin Rhenus (the Rhine river).',
                    summary:'One of the rarest stable elements. Used in jet-engine superalloys and catalysts.' },
            'Os': { name:'Osmium',    etymology:'Greek osmē (smell) — osmium tetroxide has a sharp odor.',
                    summary:'Densest naturally occurring element. Used in very hard alloys (old fountain-pen tips, electrical contacts).' },
            'Ir': { name:'Iridium',   etymology:'Latin iris (rainbow) — after the many colors of its salts.',
                    summary:'One of the densest and most corrosion-resistant metals. The global iridium spike in 66-Myr-old rock is the signature of the asteroid that ended the dinosaurs.' },
            'Pt': { name:'Platinum',  etymology:'Spanish platina (little silver).',
                    summary:'A noble, precious metal. Catalytic converter, jewelry, and the standard for the kilogram (until 2019).' },
            'Au': { name:'Gold',      etymology:'Old English gold; symbol Au from Latin aurum (shining dawn).',
                    summary:'Unreactive, dense, and malleable. The traditional monetary metal; microelectronics uses it for corrosion-free contacts and wire bonds.' },
            'Hg': { name:'Mercury',   etymology:'Named for the Roman messenger god; symbol Hg from Greek hydrargyros ("water-silver").',
                    summary:'The only metal liquid at room temperature. Used historically in thermometers and barometers; toxic.' },
            'Tl': { name:'Thallium',  etymology:'Greek thallos (green shoot) — after its bright green spectral line.',
                    summary:'Soft, gray, highly toxic metal. Used in some infrared optics and — infamously — as a poison in thriller novels.' },
            'Pb': { name:'Lead',      etymology:'Old English lēad; symbol Pb from Latin plumbum (source of "plumbing").',
                    summary:'Heavy, soft, malleable metal. Used for millennia in pipes, pigments, and solder; removed from most products because of its cumulative neurotoxicity.' },
            'Bi': { name:'Bismuth',   etymology:'Likely from German Wismut, possibly weiße Masse ("white mass").',
                    summary:'A heavy, brittle metal with a subtle pink hue. The least toxic heavy metal; active ingredient in Pepto-Bismol.' },
            'Po': { name:'Polonium',  etymology:'Named by Marie Curie for her native Poland.',
                    summary:'Intensely radioactive. Pure alpha emitter; used in some anti-static brushes and as a notorious poison.' },
            'At': { name:'Astatine',  etymology:'Greek astatos (unstable).',
                    summary:'The rarest naturally occurring element. All isotopes short-lived. At any given moment only a fraction of a gram exists in the whole Earth\'s crust.' },
            'Rn': { name:'Radon',     etymology:'From radium (it is produced by radium\'s decay).',
                    summary:'Radioactive noble gas. Seeps out of uranium-bearing rock into basements and is the second leading cause of lung cancer.' },
            'Fr': { name:'Francium',  etymology:'Named for France.',
                    summary:'The heaviest alkali metal, extremely unstable — at any moment the entire crustal inventory weighs only grams.' },
            'Ra': { name:'Radium',    etymology:'Latin radius (ray) — because it emits penetrating radiation.',
                    summary:'Discovered by the Curies. Glowed blue-green in the dark; used on watch dials until its carcinogenicity was understood.' },
            'Ac': { name:'Actinium',  etymology:'Greek aktis / aktinos (ray).',
                    summary:'First element of the actinide series. Glows pale blue in the dark from self-irradiation.' },
            'Th': { name:'Thorium',   etymology:'For Thor, the Norse god of thunder.',
                    summary:'Weakly radioactive. A potential fuel for next-generation ("thorium") nuclear reactors.' },
            'Pa': { name:'Protactinium', etymology:'Greek prōtos (first) + actinium — it decays into actinium.',
                    summary:'Rare, radioactive actinide. Used in some radiometric dating of marine sediments.' },
            'U':  { name:'Uranium',   etymology:'Named for the planet Uranus, discovered a few years earlier.',
                    summary:'The heaviest primordial element. U-235 fissions — the first atomic bombs and most nuclear reactors run on it.' },
            'Np': { name:'Neptunium', etymology:'For Neptune (the planet beyond Uranus, just as Np sits beyond U).',
                    summary:'First transuranic element synthesized (1940). Precursor to plutonium-239 in reactors.' },
            'Pu': { name:'Plutonium', etymology:'For Pluto (continuing the Uranus / Neptune sequence).',
                    summary:'Pu-239 fissions easily — used in nuclear weapons and mixed-oxide reactor fuel. Pu-238 is the heat source in RTGs for Mars rovers and deep-space probes.' },
            'Am': { name:'Americium', etymology:'For the Americas.',
                    summary:'Ionizing smoke detectors use a speck of Am-241 — its alpha particles ionize air to form a small steady current.' },
            'Cm': { name:'Curium',    etymology:'Honoring Pierre and Marie Curie.',
                    summary:'Intensely radioactive. Used as an alpha-particle source on Mars rovers\' X-ray spectrometers.' },
            'Bk': { name:'Berkelium', etymology:'For Berkeley, California — birthplace of most transuranics.',
                    summary:'Synthetic actinide. Only research quantities have ever been made.' },
            'Cf': { name:'Californium',etymology:'For California, and UC Berkeley.',
                    summary:'Strong neutron emitter. Used to start up nuclear reactors and as a portable neutron source in oilfield logging.' },
            'Es': { name:'Einsteinium', etymology:'Honoring Albert Einstein.',
                    summary:'First found in the debris of the 1952 "Ivy Mike" hydrogen-bomb test. Produced only in trace amounts.' },
            'Fm': { name:'Fermium',   etymology:'Honoring Enrico Fermi.',
                    summary:'Last element that can be formed by neutron bombardment. Heavier elements must be made by ion-beam fusion.' },
            'Md': { name:'Mendelevium', etymology:'Honoring Dmitri Mendeleev, creator of the periodic table.',
                    summary:'Synthetic. First element made one atom at a time.' },
            'No': { name:'Nobelium',  etymology:'Honoring Alfred Nobel.',
                    summary:'Synthetic actinide. All isotopes are short-lived; exists only in research labs.' },
            'Lr': { name:'Lawrencium',etymology:'Honoring Ernest Lawrence, inventor of the cyclotron.',
                    summary:'Last actinide. Fleeting, synthetic; made atom-by-atom.' },
            'Rf': { name:'Rutherfordium', etymology:'Honoring Ernest Rutherford.',
                    summary:'First "transactinide". Half-lives of seconds or less.' },
            'Db': { name:'Dubnium',   etymology:'For the town of Dubna, Russia, site of the JINR heavy-ion lab.',
                    summary:'Superheavy synthetic element. Only a few atoms have ever existed.' },
            'Sg': { name:'Seaborgium',etymology:'Honoring Glenn T. Seaborg, co-discoverer of multiple transuranics (the first element named after a living person).',
                    summary:'Superheavy, synthetic, short-lived.' },
            'Bh': { name:'Bohrium',   etymology:'Honoring Niels Bohr.',
                    summary:'Superheavy synthetic element. Transient existence only.' },
            'Hs': { name:'Hassium',   etymology:'Latin Hassia (Hesse, Germany) — home of GSI, where it was made.',
                    summary:'Superheavy transition metal. Chemistry studied on a handful of atoms.' },
            'Mt': { name:'Meitnerium',etymology:'Honoring Lise Meitner, co-discoverer of nuclear fission.',
                    summary:'Synthetic superheavy element. Produced atom-by-atom by ion-beam fusion.' },
            'Ds': { name:'Darmstadtium', etymology:'For Darmstadt, Germany — home of GSI where it was first synthesized.',
                    summary:'Superheavy synthetic element.' },
            'Rg': { name:'Roentgenium', etymology:'Honoring Wilhelm Röntgen, discoverer of X-rays.',
                    summary:'Superheavy synthetic. Predicted to be a coinage-metal analog of gold.' },
            'Cn': { name:'Copernicium', etymology:'Honoring Nicolaus Copernicus.',
                    summary:'Superheavy. Predicted to be a gas or volatile liquid — most unusual for a metal.' },
            'Nh': { name:'Nihonium',  etymology:'Japanese Nihon (Japan) — first element discovered in Asia.',
                    summary:'Superheavy synthetic element, discovered at RIKEN.' },
            'Fl': { name:'Flerovium', etymology:'Honoring Soviet physicist Georgy Flyorov.',
                    summary:'Superheavy element near the predicted "island of stability" — comparatively (still briefly) long-lived.' },
            'Mc': { name:'Moscovium', etymology:'For Moscow Oblast, site of the JINR lab.',
                    summary:'Superheavy synthetic element.' },
            'Lv': { name:'Livermorium', etymology:'For Lawrence Livermore National Laboratory.',
                    summary:'Superheavy synthetic element.' },
            'Ts': { name:'Tennessine', etymology:'For the state of Tennessee — home to Oak Ridge National Lab.',
                    summary:'Superheavy halogen-group element; only a handful of atoms have ever existed.' },
            'Og': { name:'Oganesson', etymology:'Honoring Yuri Oganessian: with Glenn Seaborg, one of only two people to have an element named after them while still alive.',
                    summary:'Currently the heaviest known element. Nominally a noble gas, though predicted to behave more like a solid at room temperature. A handful of atoms exist in total.' }
        };

        // Molecule data — keyed by the "Hill"-like label the simulator actually
        // produces from its formula-ordering routine:
        //   C first (if present), then H (if present), then other elements in
        //   ALPHABETICAL order. Counts > 1 become trailing digits.
        //
        // That means the keys here are often NOT the formulas chemists write:
        //   NH₃ → "H3N"   NaCl → "ClNa"   SO₂ → "O2S"   NaOH → "HNaO"
        // If you ever want to look up by a human-familiar formula (e.g. from
        // the entity list), use the `moleculeAliases` map below, which maps
        // chemists' formulas to the sim's Hill-style key.
        const moleculeInfo = {
            'H2O': {
                name: 'Water',
                formula: 'H₂O',
                alsoKnown: 'Dihydrogen monoxide (systematic IUPAC); oxidane',
                description: 'Two hydrogen atoms covalently bonded to one oxygen atom at an angle of about 104.5°. The O–H bonds are polar, so the molecule is a small electric dipole — hydrogen bonding between molecules is what makes water a liquid at room temperature, why ice floats, and why salt dissolves. Water is the universal biological solvent and covers about 71% of Earth\'s surface.',
                facts: [
                    ['Molar mass', '18.015 g/mol'],
                    ['Geometry', 'Bent (104.5°)'],
                    ['Phase (STP)', 'Liquid'],
                    ['Boiling point', '100 °C'],
                    ['Key role', 'Solvent of life']
                ]
            },
            'HO': {
                name: 'Hydroxyl radical',
                formula: '•OH',
                alsoKnown: 'Hydroxyl free radical; "OH radical"; atmospheric "detergent"',
                description: 'A highly reactive fragment: one oxygen bonded to one hydrogen, with a single unpaired electron on the oxygen. In the sim this appears when a water molecule loses a hydrogen or an O bonds a lone H. In the real atmosphere, the hydroxyl radical is the "detergent of the troposphere" — it scavenges methane, CO, and most other pollutants. It is also the key damaging species in radiation chemistry and oxidative stress inside cells.',
                facts: [
                    ['Molar mass', '17.007 g/mol'],
                    ['Unpaired e⁻', '1 (radical)'],
                    ['Typical lifetime', 'Milliseconds to seconds (atmosphere)'],
                    ['Role', 'Atmospheric oxidation; cell-damaging ROS']
                ]
            },
            'H2O2': {
                name: 'Hydrogen peroxide',
                formula: 'H₂O₂',
                alsoKnown: 'Dioxidane; "peroxide"; bleach at 3–35 %',
                description: 'Two oxygens joined by a single O–O bond, each also bonded to one hydrogen. The weak O–O bond makes H₂O₂ unstable — it breaks down to water and oxygen, often vigorously. A common antiseptic at 3 %; a powerful bleach at 35 %; and a rocket-engine monopropellant when very concentrated. Living cells make it as a side product of metabolism and then destroy it with catalase.',
                facts: [
                    ['Molar mass', '34.015 g/mol'],
                    ['Bond broken', 'O–O (≈ 146 kJ/mol, weak)'],
                    ['Decomposes to', 'H₂O + ½ O₂'],
                    ['Common uses', 'Antiseptic, bleach, propellant']
                ]
            },
            'H2': {
                name: 'Hydrogen gas',
                formula: 'H₂',
                alsoKnown: 'Dihydrogen; molecular hydrogen; protium gas',
                description: 'The simplest molecule — two hydrogen atoms sharing one pair of electrons via a single covalent bond. It is the most abundant molecule in the universe, fuels stars, and is a promising clean fuel on Earth (burning only makes water). Very flammable: the mixture with air is explosive across a wide range of concentrations.',
                facts: [
                    ['Molar mass', '2.016 g/mol'],
                    ['Bond', 'Single covalent (H–H)'],
                    ['Boiling point', '−252.9 °C'],
                    ['Discovery', 'Henry Cavendish, 1766']
                ]
            },
            'O2': {
                name: 'Oxygen gas',
                formula: 'O₂',
                alsoKnown: 'Dioxygen; molecular oxygen',
                description: 'Two oxygen atoms joined by a double covalent bond. About 21% of Earth\'s atmosphere. Produced by photosynthesis and consumed by respiration — the molecule that lets animals breathe and fires burn. Despite the simple "double bond" picture, O₂ is actually a diradical (triplet ground state) with two unpaired electrons, which is why it is weakly paramagnetic and why liquid oxygen is pale blue.',
                facts: [
                    ['Molar mass', '31.998 g/mol'],
                    ['Bond', 'Double covalent (O=O)'],
                    ['Atmosphere', '≈ 20.95 % by volume'],
                    ['Boiling point', '−183 °C']
                ]
            },
            'O3': {
                name: 'Ozone',
                formula: 'O₃',
                alsoKnown: 'Trioxygen',
                description: 'Three oxygen atoms in a bent chain. Pungent (you can smell it near copy machines and after lightning). In the stratosphere, the ozone layer absorbs most of the Sun\'s UV-B and UV-C radiation, shielding life. At ground level, though, it is a pollutant and lung irritant — a key component of smog.',
                facts: [
                    ['Molar mass', '47.998 g/mol'],
                    ['Geometry', 'Bent (≈ 116.8°)'],
                    ['Stratospheric role', 'Absorbs UV-B / UV-C'],
                    ['Tropospheric role', 'Pollutant, smog component']
                ]
            },
            'N2': {
                name: 'Nitrogen gas',
                formula: 'N₂',
                alsoKnown: 'Dinitrogen; molecular nitrogen',
                description: 'Two nitrogen atoms locked together by a triple covalent bond — one of the strongest chemical bonds known (≈ 945 kJ/mol). This is why N₂ makes up 78% of the atmosphere without doing much chemistry. Breaking it is the bottleneck for fertilizer production, done at huge industrial scale by the Haber-Bosch process.',
                facts: [
                    ['Molar mass', '28.014 g/mol'],
                    ['Bond', 'Triple covalent (N≡N)'],
                    ['Atmosphere', '≈ 78.09 % by volume'],
                    ['Boiling point', '−195.8 °C']
                ]
            },
            'NO': {
                name: 'Nitric oxide',
                formula: 'NO',
                alsoKnown: 'Nitrogen monoxide; nitrogen(II) oxide; the "NO" signaling molecule',
                description: 'A small, reactive free radical: one N double-bonded to one O, with an unpaired electron. Produced by internal combustion and by the lightning-driven nitrogen cycle. Inside the body, NO is an important signaling molecule — it relaxes blood vessels, lowers blood pressure, and is the mechanism behind nitroglycerin for heart patients. Bob Furchgott, Louis Ignarro, and Ferid Murad shared the 1998 Nobel Prize in Medicine for figuring that out.',
                facts: [
                    ['Molar mass', '30.006 g/mol'],
                    ['Unpaired e⁻', '1 (radical)'],
                    ['Role', 'Vasodilator signaling in mammals'],
                    ['Industrial note', 'Formed in vehicle engines → smog precursor']
                ]
            },
            'NO2': {
                name: 'Nitrogen dioxide',
                formula: 'NO₂',
                alsoKnown: 'Nitrogen(IV) oxide; reddish-brown component of smog',
                description: 'A reddish-brown, pungent, toxic gas, one of the few strongly colored common gases. Another odd-electron radical. The brown haze over polluted cities is largely NO₂. Reacts with water to form nitric acid (HNO₃), a major source of acid rain, and plays a central role in the photochemistry that produces ground-level ozone.',
                facts: [
                    ['Molar mass', '46.006 g/mol'],
                    ['Geometry', 'Bent (≈ 134°)'],
                    ['Color', 'Reddish-brown'],
                    ['Reacts w/ H₂O', '→ HNO₃ (nitric acid, acid rain)']
                ]
            },
            'N2O': {
                name: 'Nitrous oxide',
                formula: 'N₂O',
                alsoKnown: 'Laughing gas; dinitrogen monoxide; "whippet" gas',
                description: 'A linear molecule (N–N–O) used as a mild anesthetic, a dental-office calming agent, and the propellant in whipped-cream chargers. Also a potent greenhouse gas (about 270× more warming than CO₂, kilogram for kilogram, over a century) and today the largest ozone-depleting emission.',
                facts: [
                    ['Molar mass', '44.013 g/mol'],
                    ['Geometry', 'Linear (N–N–O)'],
                    ['Medical use', 'Anesthesia / analgesia'],
                    ['GWP (100 yr)', '≈ 273× CO₂']
                ]
            },
            'CO': {
                name: 'Carbon monoxide',
                formula: 'CO',
                alsoKnown: 'Carbonic oxide; "CO"; the silent killer',
                description: 'A carbon and an oxygen joined by a formal triple bond — isoelectronic with N₂. Colorless, odorless, and highly toxic: it binds hemoglobin 200× more tightly than O₂, blocking oxygen delivery to tissues. Produced by incomplete combustion (faulty heaters, car exhaust, fire smoke). In industrial chemistry it is a valuable building block — the "syngas" (CO + H₂) fed into methanol and Fischer–Tropsch fuel synthesis.',
                facts: [
                    ['Molar mass', '28.010 g/mol'],
                    ['Bond', 'Triple-ish (1 σ + 2 π; formal charges)'],
                    ['Toxicity', 'Binds hemoglobin ~200× tighter than O₂'],
                    ['Industrial use', 'Syngas feedstock (CO + H₂)']
                ]
            },
            'CO2': {
                name: 'Carbon dioxide',
                formula: 'CO₂',
                alsoKnown: 'Carbonic anhydride; "dry ice" (solid form)',
                description: 'A linear molecule: O=C=O, with carbon in the middle double-bonded to each oxygen. Produced by respiration and combustion, consumed by photosynthesis. Its accumulating concentration in the atmosphere (now ≈ 420 ppm, up from ≈ 280 ppm pre-industrial) is the dominant driver of anthropogenic climate change. Beyond the atmosphere, CO₂ dissolves in water to form carbonic acid (H₂CO₃) — the fizz in soda and, over centuries, the acidification of the oceans.',
                facts: [
                    ['Molar mass', '44.009 g/mol'],
                    ['Geometry', 'Linear'],
                    ['Bonds', 'Two C=O double bonds'],
                    ['Sublimes at', '−78.5 °C (1 atm)']
                ]
            },
            'CH4': {
                name: 'Methane',
                formula: 'CH₄',
                alsoKnown: 'Marsh gas; natural gas (main component); firedamp',
                description: 'The simplest hydrocarbon: one carbon bonded to four hydrogens in a perfect tetrahedron (109.5° bond angles). Natural gas is mostly methane. Produced by swamps, rice paddies, livestock digestion, and leaking gas infrastructure. As a greenhouse gas, methane traps roughly 80× more heat than CO₂ over 20 years, though it breaks down faster.',
                facts: [
                    ['Molar mass', '16.043 g/mol'],
                    ['Geometry', 'Tetrahedral (109.5°)'],
                    ['Boiling point', '−161.5 °C'],
                    ['GWP (20 yr)', '≈ 80× CO₂']
                ]
            },
            'H3N': {
                name: 'Ammonia',
                formula: 'NH₃',
                alsoKnown: 'Azane (systematic IUPAC); spirits of hartshorn (old). (Written "H₃N" here because the simulator puts H before N in its formulas.)',
                description: 'A nitrogen atom bonded to three hydrogens with a lone pair on top — trigonal-pyramidal, like an umbrella. Pungent, alkaline, water-soluble. Industrial ammonia (the Haber-Bosch process) is the foundation of synthetic fertilizer and indirectly feeds roughly half the world\'s population. Excreted by animals as part of nitrogen waste.',
                facts: [
                    ['Molar mass', '17.031 g/mol'],
                    ['Geometry', 'Trigonal pyramidal'],
                    ['Boiling point', '−33.3 °C'],
                    ['Industrial use', 'Fertilizer (≈ 80 %)']
                ]
            },
            'C2H6': {
                name: 'Ethane',
                formula: 'C₂H₆',
                alsoKnown: 'Dimethyl; bimethyl',
                description: 'Two carbon atoms bonded to each other and each carrying three hydrogens — two tetrahedra sharing a single C–C bond. Second simplest alkane (after methane), colorless, odorless, flammable. The second-most-common hydrocarbon in natural gas, and a feedstock for ethylene production in the petrochemical industry.',
                facts: [
                    ['Molar mass', '30.069 g/mol'],
                    ['Geometry', 'Tetrahedral at each C'],
                    ['Boiling point', '−89 °C'],
                    ['Class', 'Alkane (saturated)']
                ]
            },
            'C2H4': {
                name: 'Ethene',
                formula: 'C₂H₄',
                alsoKnown: 'Ethylene (common name); the plant ripening hormone',
                description: 'Two carbon atoms joined by a double bond, each also bonded to two hydrogens — a flat, planar molecule with 120° bond angles around each carbon. The world\'s most-produced organic chemical, polymerized into polyethylene (plastic bags, bottles). Also a plant hormone: a ripe banana emits ethene, which ripens the ones next to it.',
                facts: [
                    ['Molar mass', '28.054 g/mol'],
                    ['Geometry', 'Planar (120°)'],
                    ['Bond', 'C=C double bond'],
                    ['Main use', 'Polyethylene plastic']
                ]
            },
            'C2H2': {
                name: 'Ethyne',
                formula: 'C₂H₂',
                alsoKnown: 'Acetylene (common name)',
                description: 'Two carbons joined by a triple bond, each carrying one hydrogen — a rigid, linear molecule with 180° bond angles. Burns with an extremely hot flame in pure oxygen (≈ 3100 °C) — the reason oxy-acetylene torches are used to cut and weld steel. Also the feedstock for PVC and a huge range of other organic chemistry.',
                facts: [
                    ['Molar mass', '26.038 g/mol'],
                    ['Geometry', 'Linear (180°)'],
                    ['Bond', 'C≡C triple bond'],
                    ['Famous use', 'Oxy-acetylene welding / cutting']
                ]
            },
            'CH2': {
                name: 'Methylene (carbene)',
                formula: ':CH₂',
                alsoKnown: 'Methylidene; methylene radical',
                description: 'A "carbene" — a carbon with only two bonds and a lone pair or two unpaired electrons. Extraordinarily reactive, this fragment usually exists only fleetingly before inserting into other molecules. In the simulator you\'ll typically see it as a transient state on the way between CH₄, CH₃, and other species.',
                facts: [
                    ['Molar mass', '14.027 g/mol'],
                    ['Class', 'Carbene (electron-deficient carbon)'],
                    ['Lifetime', 'Extremely short in normal conditions']
                ]
            },
            'CH3': {
                name: 'Methyl radical',
                formula: '•CH₃',
                alsoKnown: 'Methyl free radical',
                description: 'A carbon with three hydrogens and one unpaired electron. Highly reactive; normally just an intermediate. Real-world chemistry sees methyl radicals in flames, atmospheric methane oxidation, and combustion engines — all stepping-stones between CH₄ and CO₂.',
                facts: [
                    ['Molar mass', '15.035 g/mol'],
                    ['Class', 'Free radical'],
                    ['Geometry', 'Planar (trigonal)']
                ]
            },
            'CH': {
                name: 'Methylidyne radical',
                formula: '•CH',
                alsoKnown: 'CH radical; methylidyne',
                description: 'One carbon and one hydrogen: an extremely reactive radical detected in flames, comets, and interstellar clouds. In fact, CH was one of the first molecules ever identified in space (in 1937).',
                facts: [
                    ['Molar mass', '13.019 g/mol'],
                    ['Class', 'Radical'],
                    ['Notable', 'First molecule detected in interstellar space']
                ]
            },
            'ClH': {
                name: 'Hydrogen chloride',
                formula: 'HCl',
                alsoKnown: 'Muriatic acid (in water); hydrochloric acid',
                description: 'A single covalent H–Cl bond, very polar. As a gas it is sharp-smelling and corrosive. Dissolved in water it is hydrochloric acid — one of the seven classic strong acids and a workhorse of industry. Your stomach makes hydrochloric acid to digest food.',
                facts: [
                    ['Molar mass', '36.458 g/mol'],
                    ['Bond', 'H–Cl (very polar covalent)'],
                    ['In water', 'Hydrochloric acid (strong acid)'],
                    ['Biological', 'Stomach acid (pH ≈ 1–2)']
                ]
            },
            'FH': {
                name: 'Hydrogen fluoride',
                formula: 'HF',
                alsoKnown: 'Hydrofluoric acid (aqueous)',
                description: 'A single H–F bond — the most polar bond of any diatomic. Unusual among the hydrogen halides for its strong hydrogen bonding. Hydrofluoric acid in solution is a weak acid by pH, but terrifyingly dangerous: it dissolves glass and silicate minerals, penetrates skin quickly, and attacks bone.',
                facts: [
                    ['Molar mass', '20.006 g/mol'],
                    ['Bond', 'H–F (most polar H–X bond)'],
                    ['Special', 'Attacks glass and silica'],
                    ['Aqueous', 'Weak acid, extremely toxic']
                ]
            },
            'BrH': {
                name: 'Hydrogen bromide',
                formula: 'HBr',
                alsoKnown: 'Hydrobromic acid (aqueous)',
                description: 'Colorless, pungent gas with an H–Br single bond. In water it becomes hydrobromic acid — a strong acid, stronger than HCl. Used in organic synthesis for brominating carbon skeletons.',
                facts: [
                    ['Molar mass', '80.912 g/mol'],
                    ['Aqueous', 'Hydrobromic acid (strong acid)'],
                    ['Use', 'Organic-synthesis brominating reagent']
                ]
            },
            'HI': {
                name: 'Hydrogen iodide',
                formula: 'HI',
                alsoKnown: 'Hydroiodic acid (aqueous)',
                description: 'A single H–I bond. In water it forms hydroiodic acid, the strongest of the binary hydrogen halide acids. A common reducing agent in organic chemistry.',
                facts: [
                    ['Molar mass', '127.912 g/mol'],
                    ['Aqueous', 'Hydroiodic acid (strongest HX acid)'],
                    ['Role', 'Strong reducing agent']
                ]
            },
            'H2S': {
                name: 'Hydrogen sulfide',
                formula: 'H₂S',
                alsoKnown: 'Sulfane; sewer gas; "rotten egg" gas',
                description: 'Two hydrogens bonded to a sulfur — the sulfur analog of water, but bent at ≈ 92°. Famous for smelling like rotten eggs, and famous for being lethal: your nose actually loses the ability to smell it at high concentrations, right when it\'s most dangerous. Produced by anaerobic bacteria, volcanoes, and decomposing organic matter.',
                facts: [
                    ['Molar mass', '34.08 g/mol'],
                    ['Geometry', 'Bent (≈ 92°)'],
                    ['Smell', 'Rotten eggs (low concentrations)'],
                    ['Warning', 'Olfactory fatigue hides high concentrations']
                ]
            },
            'O2S': {
                name: 'Sulfur dioxide',
                formula: 'SO₂',
                alsoKnown: 'Sulfurous anhydride. (Written "O₂S" here because the simulator orders elements alphabetically when no C is present — O before S.)',
                description: 'A bent molecule (≈ 119°) with two S=O bonds. Pungent, choking gas emitted by burning coal and oil, by volcanoes, and by refining metal ores. Reacts with atmospheric water and oxygen to form sulfuric acid (H₂SO₄), the main driver of acid rain in the 20th century before emission controls.',
                facts: [
                    ['Molar mass', '64.066 g/mol'],
                    ['Geometry', 'Bent (≈ 119°)'],
                    ['Environmental', 'Precursor of acid rain (→ H₂SO₄)'],
                    ['Use', 'Wine preservative (sulfites), refrigerant (old)']
                ]
            },
            'O3S': {
                name: 'Sulfur trioxide',
                formula: 'SO₃',
                alsoKnown: 'Sulfuric anhydride. (Written "O₃S" here because the simulator orders elements alphabetically — O before S.)',
                description: 'A planar, triangular molecule with three S=O bonds. Industrial intermediate in the production of sulfuric acid: SO₃ + H₂O → H₂SO₄. Fumes aggressively in moist air and is acutely corrosive.',
                facts: [
                    ['Molar mass', '80.066 g/mol'],
                    ['Geometry', 'Trigonal planar'],
                    ['Reacts w/ H₂O', '→ H₂SO₄ (sulfuric acid)'],
                    ['Industrial role', 'Contact process, step to sulfuric acid']
                ]
            },
            'ClNa': {
                name: 'Sodium chloride',
                formula: 'NaCl',
                alsoKnown: 'Table salt; halite; common salt; rock salt. (Written "ClNa" here because the simulator orders elements alphabetically — Cl before Na.)',
                description: 'Not really a molecule — an ionic compound. A sodium atom gives up its single outer electron to a chlorine atom; the resulting Na⁺ and Cl⁻ ions attract each other in a 3D cubic lattice. Dissolves readily in water because H₂O dipoles pry the ions apart. Essential for life (nerves, hydration) and a civilization-defining preservative.',
                facts: [
                    ['Molar mass', '58.443 g/mol'],
                    ['Bond type', 'Ionic (Na⁺ + Cl⁻)'],
                    ['Structure', 'Cubic lattice (in solid)'],
                    ['Melts at', '801 °C']
                ]
            },
            'FNa': {
                name: 'Sodium fluoride',
                formula: 'NaF',
                alsoKnown: 'Fluoride (in toothpaste context); villiaumite (mineral form). (Sim puts F before Na alphabetically.)',
                description: 'A white ionic crystal of Na⁺ and F⁻ in the same rock-salt lattice as NaCl. Added in trace amounts to drinking water and toothpaste to prevent tooth decay — the fluoride ion converts tooth enamel to fluorapatite, which is harder and more acid-resistant than ordinary hydroxyapatite.',
                facts: [
                    ['Molar mass', '41.988 g/mol'],
                    ['Bond type', 'Ionic (Na⁺ + F⁻)'],
                    ['Famous use', 'Dental caries prevention']
                ]
            },
            'BrNa': {
                name: 'Sodium bromide',
                formula: 'NaBr',
                alsoKnown: '(Sim puts Br before Na alphabetically.)',
                description: 'An ionic compound of Na⁺ and Br⁻. Historically used as a sedative and anticonvulsant, and still used today in some veterinary medicine and in oil-well drilling fluids.',
                facts: [
                    ['Molar mass', '102.894 g/mol'],
                    ['Bond type', 'Ionic (Na⁺ + Br⁻)']
                ]
            },
            'INa': {
                name: 'Sodium iodide',
                formula: 'NaI',
                alsoKnown: '(Sim puts I before Na alphabetically.)',
                description: 'Na⁺ and I⁻ in an ionic lattice. Added to table salt ("iodized salt") to prevent iodine deficiency, which causes goiter and developmental problems. NaI crystals doped with thallium are also a classic scintillator for detecting gamma radiation.',
                facts: [
                    ['Molar mass', '149.894 g/mol'],
                    ['Bond type', 'Ionic (Na⁺ + I⁻)'],
                    ['Famous use', 'Iodized salt; gamma-ray scintillator']
                ]
            },
            'ClK': {
                name: 'Potassium chloride',
                formula: 'KCl',
                alsoKnown: 'Sylvite (mineral); "lite salt" (low-sodium table salt). (Sim orders Cl before K alphabetically.)',
                description: 'K⁺ and Cl⁻ in a rock-salt-like lattice. Used as a potassium-rich fertilizer, as the low-sodium substitute in "lite" salt, and — controversially — as the stopping agent in lethal injection protocols.',
                facts: [
                    ['Molar mass', '74.551 g/mol'],
                    ['Bond type', 'Ionic (K⁺ + Cl⁻)'],
                    ['Agriculture', 'Major potash fertilizer']
                ]
            },
            'FK': {
                name: 'Potassium fluoride',
                formula: 'KF',
                alsoKnown: '(Sim orders F before K.)',
                description: 'Ionic compound of K⁺ and F⁻. A source of fluoride in organic fluorination chemistry and in some etching reagents.',
                facts: [
                    ['Molar mass', '58.097 g/mol'],
                    ['Bond type', 'Ionic (K⁺ + F⁻)']
                ]
            },
            'Cl2Mg': {
                name: 'Magnesium chloride',
                formula: 'MgCl₂',
                alsoKnown: 'Bischofite (mineral); sea-water Mg source',
                description: 'Mg²⁺ paired with two Cl⁻ ions. Extracted on an industrial scale from seawater and used as a road de-icer, a tofu coagulant ("nigari"), and the starting material for making metallic magnesium.',
                facts: [
                    ['Molar mass', '95.211 g/mol'],
                    ['Bond type', 'Ionic (Mg²⁺ + 2 Cl⁻)'],
                    ['Uses', 'De-icer; tofu coagulant; Mg metal source']
                ]
            },
            'CaCl2': {
                name: 'Calcium chloride',
                formula: 'CaCl₂',
                alsoKnown: 'Rock salt alternative; "DampRid" desiccant',
                description: 'Ca²⁺ and two Cl⁻ ions. Strongly hygroscopic — pulls water right out of the air — so it\'s used as a desiccant, a road-and-sidewalk ice-melter that works at lower temperatures than NaCl, and a brine for chilling.',
                facts: [
                    ['Molar mass', '110.984 g/mol'],
                    ['Bond type', 'Ionic (Ca²⁺ + 2 Cl⁻)'],
                    ['Key property', 'Strongly hygroscopic']
                ]
            },
            'MgO': {
                name: 'Magnesium oxide',
                formula: 'MgO',
                alsoKnown: 'Magnesia; periclase (mineral); "milk of magnesia" ingredient (as hydroxide)',
                description: 'An ionic compound of Mg²⁺ and O²⁻ in a rock-salt lattice. Extremely high melting point (2852 °C) makes it a premier refractory — lining furnaces and steel-making crucibles. A classic antacid (though more often sold as Mg(OH)₂).',
                facts: [
                    ['Molar mass', '40.304 g/mol'],
                    ['Bond type', 'Ionic (Mg²⁺ + O²⁻)'],
                    ['Melts at', '2852 °C'],
                    ['Use', 'Refractory lining; antacid']
                ]
            },
            'CaO': {
                name: 'Calcium oxide',
                formula: 'CaO',
                alsoKnown: 'Quicklime; burnt lime; "lime"',
                description: 'An ionic compound of Ca²⁺ and O²⁻. Made by heating limestone (CaCO₃) to drive off CO₂. Reacts vigorously — and exothermically — with water to form slaked lime (Ca(OH)₂). One of civilization\'s oldest chemicals: the base of mortar, plaster, and modern cement.',
                facts: [
                    ['Molar mass', '56.077 g/mol'],
                    ['Made from', 'CaCO₃ (limestone) at ≈ 825 °C'],
                    ['Reacts w/ H₂O', 'Strongly exothermic → Ca(OH)₂'],
                    ['Use', 'Cement, mortar, steel-making flux']
                ]
            },
            'FeO': {
                name: 'Iron(II) oxide',
                formula: 'FeO',
                alsoKnown: 'Ferrous oxide; wüstite (mineral)',
                description: 'Ionic compound with Fe²⁺ and O²⁻. A black, nonstoichiometric solid — real-life samples are usually iron-deficient. An intermediate in steel-making and a component of some ceramics and pigments.',
                facts: [
                    ['Molar mass', '71.844 g/mol'],
                    ['Oxidation', 'Fe²⁺ (ferrous)'],
                    ['Color', 'Black']
                ]
            },
            'Fe2O3': {
                name: 'Iron(III) oxide',
                formula: 'Fe₂O₃',
                alsoKnown: 'Ferric oxide; hematite (mineral); red rust',
                description: 'The most common iron oxide, and the red of Mars, rust, and barn paint. Fe³⁺ and O²⁻ in a corundum-like lattice. The chief ore of iron and the basis for magnetic media (before spinning-disk platters moved to more exotic alloys).',
                facts: [
                    ['Molar mass', '159.687 g/mol'],
                    ['Color', 'Red-brown (hematite)'],
                    ['Famous as', 'Red rust; principal iron ore; Mars dust']
                ]
            },
            'Al2O3': {
                name: 'Aluminum oxide',
                formula: 'Al₂O₃',
                alsoKnown: 'Alumina; corundum (crystalline); "sapphire" / "ruby" when trace-doped',
                description: 'Al³⁺ and O²⁻ in a tough, transparent crystal lattice. Single-crystal corundum doped with a trace of chromium is ruby; with titanium/iron, sapphire. Industrially, alumina is the feedstock for aluminum metal via the Hall–Héroult process and a leading abrasive (sandpaper, grinding wheels) thanks to its hardness.',
                facts: [
                    ['Molar mass', '101.961 g/mol'],
                    ['Hardness', 'Mohs 9 (second only to diamond)'],
                    ['Famous forms', 'Ruby, sapphire, sandpaper grit'],
                    ['Industrial use', 'Aluminum metal source']
                ]
            },
            'O2Si': {
                name: 'Silicon dioxide',
                formula: 'SiO₂',
                alsoKnown: 'Silica; quartz (crystalline); glass (amorphous); sand (mostly). (Sim orders O before Si alphabetically — "O₂Si".)',
                description: 'Each Si is tetrahedrally bonded to four O\'s, each O shared between two Si\'s — an infinite 3D network rather than a discrete molecule. Makes up the bulk of Earth\'s crust. Melted and cooled slowly it becomes quartz; melted and quenched it becomes glass; beach sand is mostly weathered quartz grains.',
                facts: [
                    ['Molar mass', '60.083 g/mol'],
                    ['Structure', 'Infinite Si–O–Si network'],
                    ['Forms', 'Quartz, glass, sand, opal'],
                    ['Fun fact', 'Backbone of the semiconductor industry (as oxide on Si wafers)']
                ]
            },
            'HNaO': {
                name: 'Sodium hydroxide',
                formula: 'NaOH',
                alsoKnown: 'Caustic soda; lye. (Sim orders H, Na, O alphabetically — "HNaO".)',
                description: 'An ionic compound of Na⁺ with the hydroxide ion OH⁻. A classic strong base: dissolves aluminum, saponifies fats into soap, and cleans drains by eating hair and grease. Industrially enormous — produced alongside chlorine in the chlor-alkali process.',
                facts: [
                    ['Molar mass', '39.997 g/mol'],
                    ['Bond type', 'Ionic (Na⁺ + OH⁻)'],
                    ['Key use', 'Soap-making (saponification); drain cleaner; pulp and paper']
                ]
            },
            'CHN': {
                name: 'Hydrogen cyanide',
                formula: 'HCN',
                alsoKnown: 'Prussic acid; formonitrile. (Sim writes formula as "CHN".)',
                description: 'A linear H–C≡N molecule. Infamously toxic — blocks the electron transport chain in mitochondria — and famously almond-scented (though only to some people). Also a likely prebiotic building block: hydrogen cyanide can polymerize into amino-acid precursors, and it has been detected in comets and interstellar clouds.',
                facts: [
                    ['Molar mass', '27.026 g/mol'],
                    ['Geometry', 'Linear (H–C≡N)'],
                    ['Toxicity', 'Blocks mitochondrial respiration'],
                    ['Astrochemistry', 'Found in comets; possible prebiotic precursor']
                ]
            },
            'CH2O': {
                name: 'Formaldehyde',
                formula: 'CH₂O',
                alsoKnown: 'Methanal; formalin (aqueous)',
                description: 'The simplest aldehyde: a C=O with two H\'s on the carbon. Pungent, irritating, and carcinogenic. Used to preserve biological specimens, to make resins (phenol-formaldehyde glues — the stuff holding plywood together), and in the manufacture of many common plastics.',
                facts: [
                    ['Molar mass', '30.026 g/mol'],
                    ['Geometry', 'Planar (C=O, two C–H bonds)'],
                    ['Uses', 'Preservative; resin building block'],
                    ['Classification', 'Known human carcinogen']
                ]
            },
            'CH4O': {
                name: 'Methanol',
                formula: 'CH₃OH',
                alsoKnown: 'Methyl alcohol; wood alcohol; MeOH',
                description: 'The simplest alcohol: methyl group + hydroxyl. Historically made by dry-distilling wood, today produced on a huge scale from syngas. A fuel, a solvent, and a feedstock for formaldehyde. Highly toxic to humans — metabolized to formic acid, which attacks the optic nerve (hence "drinking wood alcohol causes blindness").',
                facts: [
                    ['Molar mass', '32.042 g/mol'],
                    ['Boiling point', '64.7 °C'],
                    ['Toxicity', 'Metabolized → formic acid → blindness / death'],
                    ['Industrial', 'Fuel, solvent, formaldehyde feedstock']
                ]
            },
            'C2H6O': {
                name: 'Ethanol',
                formula: 'C₂H₅OH',
                alsoKnown: 'Ethyl alcohol; drinking alcohol; grain alcohol; EtOH',
                description: 'Two carbons, a hydroxyl, and the other hydrogens — the alcohol in beer, wine, and spirits, produced for ten thousand years by yeast fermenting sugar. Also a solvent, a fuel additive (E10, E85), a disinfectant, and (with some irony) a building-block feedstock.',
                facts: [
                    ['Molar mass', '46.068 g/mol'],
                    ['Boiling point', '78.4 °C'],
                    ['Biological', 'Depressant; CNS-active; metabolized by ADH'],
                    ['Everyday uses', 'Beverages, fuel additive, hand sanitizer']
                ]
            },
            'CH4N2O': {
                name: 'Urea',
                formula: '(NH₂)₂CO',
                alsoKnown: 'Carbamide; the first "organic" compound synthesized from inorganic ingredients',
                description: 'A carbonyl (C=O) with two –NH₂ groups attached. Mammals excrete waste nitrogen as urea in urine. Friedrich Wöhler\'s 1828 synthesis of urea from ammonium cyanate is often cited as the death blow to "vitalism" — the idea that organic compounds needed a life force to be made. A huge fraction of nitrogen fertilizer is urea.',
                facts: [
                    ['Molar mass', '60.056 g/mol'],
                    ['Role in biology', 'Main nitrogenous waste in mammals'],
                    ['Historical', 'Wöhler, 1828 — birth of organic synthesis'],
                    ['Industrial', 'Leading N fertilizer worldwide']
                ]
            },
            'C6H6': {
                name: 'Benzene',
                formula: 'C₆H₆',
                alsoKnown: 'Phene (historical); benzol',
                description: 'Six carbons in a flat hexagonal ring, each bonded to one hydrogen, with six π-electrons delocalized around the ring — the classic "aromatic" compound. The structure was famously inferred by Kekulé, who claimed to have dreamt of a snake biting its own tail. Benzene rings are everywhere in organic chemistry — in paints, plastics, drugs, dyes. Benzene itself is carcinogenic; today it\'s mainly a feedstock, not a finished product.',
                facts: [
                    ['Molar mass', '78.114 g/mol'],
                    ['Geometry', 'Planar hexagonal ring'],
                    ['Bonds', '6 π-electrons, delocalized (aromatic)'],
                    ['Note', 'Human carcinogen']
                ]
            },
            'C2H4O': {
                name: 'Acetaldehyde',
                formula: 'CH₃CHO',
                alsoKnown: 'Ethanal; ethyl aldehyde',
                description: 'Two carbons, one double-bonded to an oxygen (the carbonyl C=O) and carrying a methyl group. The metabolic intermediate your liver produces when it breaks down ethanol — and the chief culprit in hangovers. Industrially a huge feedstock, especially for making acetic acid.',
                facts: [
                    ['Molar mass', '44.053 g/mol'],
                    ['Boiling point', '20.2 °C'],
                    ['Biology', 'Toxic ethanol metabolite (hangover cause)'],
                    ['Industrial', 'Precursor to acetic acid, polymers']
                ]
            },
            'HKO': {
                name: 'Potassium hydroxide',
                formula: 'KOH',
                alsoKnown: 'Caustic potash; lye. (Sim orders H, K, O alphabetically — "HKO".)',
                description: 'Ionic compound of K⁺ with the hydroxide ion OH⁻. A strong base, very similar in chemistry to NaOH but more soluble and often preferred in biodiesel production and in making soft (liquid/soft) soaps.',
                facts: [
                    ['Molar mass', '56.105 g/mol'],
                    ['Bond type', 'Ionic (K⁺ + OH⁻)'],
                    ['Key use', 'Biodiesel catalyst; soft soaps; alkaline batteries (electrolyte)']
                ]
            },
            'C6H12O6': {
                name: 'Glucose',
                formula: 'C₆H₁₂O₆',
                alsoKnown: 'Dextrose (D-glucose); blood sugar; grape sugar',
                description: 'A six-carbon sugar — the universal fuel of life on Earth. Made by plants through photosynthesis, burned by nearly every organism through glycolysis → the citric acid cycle → the electron transport chain. In solution it spends most of its time as a ring (α- or β- pyranose). Polymerizes into starch, glycogen (energy storage), and cellulose (plant structure).',
                facts: [
                    ['Molar mass', '180.156 g/mol'],
                    ['Biological role', 'Universal cellular fuel'],
                    ['Polymers', 'Starch, glycogen, cellulose'],
                    ['Blood-sugar', '≈ 90 mg/dL (≈ 5 mmol/L) in humans']
                ]
            },

            // --- Diatomic hydrides / small radicals ---------------------------
            'HHe': {
                name: 'Helium hydride',
                formula: 'HeH⁺ (cation) / HeH (neutral)',
                alsoKnown: 'Hydridohelium(1+); "the first molecule ever"',
                description: 'A hydrogen bonded to a helium — and astonishingly, this is believed to have been the very first molecular species to form in the universe, roughly 100,000 years after the Big Bang, when protons and neutral helium atoms combined. The charged form HeH⁺ is stable and even spectroscopically detectable; the neutral HeH is only a fleeting, weakly-bound Rydberg-like species because a neutral helium has no strong desire to bond. HeH⁺ was finally confirmed in space in 2019, inside the planetary nebula NGC 7027.',
                facts: [
                    ['Molar mass', '≈ 5.01 g/mol'],
                    ['Historical', 'Likely the universe\'s first molecule (~100,000 yr after the Big Bang)'],
                    ['First detected in space', '2019, nebula NGC 7027'],
                    ['Neutral form', 'Not stably bound — exists as an excimer/Rydberg state']
                ]
            },
            'HB': {
                name: 'Boron monohydride',
                formula: 'BH',
                alsoKnown: 'Borylene; the BH radical',
                description: 'A single boron bonded to a single hydrogen. Neutral BH is a highly reactive radical (boron only has three valence electrons, so it ends up electron-deficient). Mainly studied as an astrochemical species, in high-temperature boron plasmas, and as a fleeting intermediate in boron chemistry.',
                facts: [
                    ['Molar mass', '11.819 g/mol'],
                    ['Class', 'Diatomic radical'],
                    ['Boron valence', 'Electron-deficient (only 3 valence e⁻)']
                ]
            },
            'HBe': {
                name: 'Beryllium monohydride',
                formula: 'BeH',
                alsoKnown: 'Beryllium hydride radical; the BeH radical',
                description: 'A beryllium bonded to a single hydrogen — a short-lived radical with an unpaired electron on beryllium. Mostly encountered in flames, stellar atmospheres, and laboratory molecular-beam studies. The bulk compound you might have heard of — beryllium hydride, BeH₂ — is a polymer and quite different.',
                facts: [
                    ['Molar mass', '10.020 g/mol'],
                    ['Class', 'Diatomic radical'],
                    ['Where seen', 'Stellar spectra, laboratory beams']
                ]
            },
            'HLi': {
                name: 'Lithium hydride',
                formula: 'LiH',
                alsoKnown: 'LiH diatomic; lithium monohydride',
                description: 'One lithium bonded to one hydrogen, one of the most polar small molecules known (strongly Li⁺H⁻ in character). The gas-phase LiH diatomic is a classic benchmark in quantum chemistry because it has only four electrons. Bulk lithium hydride is a white crystalline salt used as a hydrogen-storage material and, as lithium-6 deuteride, as the fusion fuel in staged thermonuclear weapons.',
                facts: [
                    ['Molar mass', '7.95 g/mol'],
                    ['Bond', 'Highly polar Li–H (mostly ionic)'],
                    ['Electrons', '4, a standard quantum-chemistry test case'],
                    ['Bulk form', 'LiH salt; ⁶LiD is thermonuclear fusion fuel']
                ]
            },

            // --- Noble-gas / exotic van der Waals complexes --------------------
            // Any label mixing a noble gas (He/Ne/Ar) with another element is
            // not a "real" covalent molecule in normal conditions. It is either
            // an excimer (only stable in an excited electronic state) or a
            // weakly-bound van der Waals complex held together by London forces.
            'He2': {
                name: 'Dihelium',
                formula: 'He₂',
                alsoKnown: 'Helium dimer; He–He van der Waals complex',
                description: 'Two helium atoms loosely stuck together. Helium\'s closed-shell configuration means there is no real covalent bond here — this is a van der Waals complex, held together by the faintest of London dispersion forces (binding energy under 0.001 eV, one of the weakest chemical interactions known). The dimer only exists below about 1 K and has a bond length around 50 Å — larger than most real molecules. Its excimer cousin He₂* (electronically excited) is used in excimer lasers.',
                facts: [
                    ['Binding energy', '≈ 10⁻⁷ eV (vanishingly weak)'],
                    ['Bond length', '≈ 52 Å (absurdly long)'],
                    ['Stable at', '< 1 K, ultracold gas'],
                    ['Cousin', 'He₂* excimer — UV laser source']
                ]
            },
            'HeO': {
                name: 'Helium monoxide',
                formula: 'HeO',
                alsoKnown: 'Helium-oxygen complex; HeO excimer',
                description: 'An exotic He + O pairing. Helium is extremely unreactive — its atoms prefer to stay noble — so HeO only exists as an excimer (electronically excited state) or a very weakly bound complex. Such species are of interest in plasma physics, stellar atmospheres, and laser chemistry, but not something you\'d encounter in everyday chemistry.',
                facts: [
                    ['Class', 'Exotic noble-gas complex / excimer'],
                    ['Binding', 'Very weak or only excited-state'],
                    ['Context', 'Plasma physics, astrochemistry, excimer lasers']
                ]
            },
            'FHe': {
                name: 'Helium monofluoride',
                formula: 'HeF',
                alsoKnown: 'He–F excimer; parent of HHeF (a predicted metastable)',
                description: 'A helium atom paired with a fluorine atom. The ground state is only marginally bound, but the excimer (HeF*) is real enough to have been observed spectroscopically. The related three-atom molecule HHeF has been predicted theoretically to be metastable — it would be the first true helium-containing covalent compound — but has never been confirmed experimentally.',
                facts: [
                    ['Class', 'Noble-gas excimer / exotic species'],
                    ['Relevance', 'Related to the predicted HHeF helium compound'],
                    ['Where studied', 'Laser chemistry and molecular-beam experiments']
                ]
            },
            'HeN': {
                name: 'Helium-nitrogen complex',
                formula: 'HeN',
                alsoKnown: 'He·N van der Waals adduct',
                description: 'A helium atom loosely associated with a nitrogen atom. Pure helium-nitrogen pairings are exotic: helium doesn\'t form real covalent bonds, and atomic N is highly reactive on its own. The pair is mostly a van der Waals complex studied in molecular-beam experiments.',
                facts: [
                    ['Class', 'Van der Waals / exotic complex'],
                    ['Context', 'Molecular-beam spectroscopy']
                ]
            },
            'CHe': {
                name: 'Carbon-helium complex',
                formula: 'CHe',
                alsoKnown: 'C·He van der Waals adduct',
                description: 'A lone carbon atom weakly associated with a helium atom. No genuine C–He chemical bond exists in the ground state — helium refuses to share or donate electrons — so this is a van der Waals complex. Relevant to helium-droplet spectroscopy, where researchers embed single atoms/molecules in tiny liquid-helium clusters to study them.',
                facts: [
                    ['Class', 'Van der Waals complex'],
                    ['Technique', 'Helium-nanodroplet isolation spectroscopy']
                ]
            },
            'BHe': {
                name: 'Boron-helium complex',
                formula: 'BHe',
                alsoKnown: 'B·He van der Waals adduct',
                description: 'A boron atom paired with a helium atom. As with other helium-X pairings, no true chemical bond forms in the ground state — helium\'s closed shell refuses to cooperate — so this is a van der Waals complex of interest mainly to spectroscopists.',
                facts: [
                    ['Class', 'Van der Waals complex'],
                    ['Context', 'Laboratory molecular-beam and matrix-isolation studies']
                ]
            },
            'HeLi': {
                name: 'Helium-lithium complex',
                formula: 'LiHe',
                alsoKnown: 'Li·He van der Waals adduct',
                description: 'A lithium atom weakly bound to a helium atom. The neutral complex is barely bound (a few meV) — one of the weakest chemical interactions known outside dihelium itself. Its cation (LiHe⁺) is more strongly bound because the Li⁺ polarizes the He electron cloud. Studied primarily in ultracold atomic physics.',
                facts: [
                    ['Neutral binding', '≈ few meV'],
                    ['Cation LiHe⁺', 'More strongly bound (Li⁺ polarizes He)'],
                    ['Context', 'Ultracold mixtures, quantum gases']
                ]
            },
            'HeNe': {
                name: 'Helium-neon complex',
                formula: 'HeNe',
                alsoKnown: 'He·Ne van der Waals dimer; the gas mix inside HeNe lasers',
                description: 'A helium atom loosely paired with a neon atom. Another van der Waals complex, slightly more tightly bound than dihelium but still extraordinarily weak. You\'ll recognize the element pair from HeNe gas lasers — the classic red 632.8 nm laser tube — although in those lasers the two gases aren\'t chemically combined; the helium just helps transfer energy to excited neon atoms that do the lasing.',
                facts: [
                    ['Class', 'Van der Waals complex'],
                    ['Famous mix', 'HeNe gas laser (lasing is on Ne, pumped via He)'],
                    ['Laser wavelength', '632.8 nm (classic red)']
                ]
            },
            'LiNe': {
                name: 'Lithium-neon complex',
                formula: 'LiNe',
                alsoKnown: 'Li·Ne van der Waals adduct',
                description: 'A lithium atom paired with a neon atom. As with other alkali-metal + noble-gas pairs, the ground state is weakly van der Waals bound; it\'s a model system for studying spin-orbit effects and ultracold collisions in mixed atomic gases.',
                facts: [
                    ['Class', 'Van der Waals complex'],
                    ['Context', 'Ultracold atomic physics, spin-orbit studies']
                ]
            },

            // --- Metal hydrides (diatomic XH radicals) -------------------------
            // These are one-metal-one-hydrogen radicals. In bulk, many of these
            // elements form normal salt-like hydrides (NaH, KH, MgH₂, TiH₂, etc.);
            // the diatomic gas-phase species here are the fundamental building
            // blocks, usually seen in flames, stellar atmospheres, and plasmas.
            'HNa': {
                name: 'Sodium monohydride',
                formula: 'NaH',
                alsoKnown: 'NaH radical (gas phase); sodium hydride',
                description: 'A sodium atom covalently (mostly ionically) bonded to one hydrogen. The solid ionic form NaH is a strong, moisture-sensitive reducing agent used in organic synthesis (e.g. deprotonating alcohols and ketones). The gas-phase diatomic seen here is the isolated-molecule cousin — bright in stellar spectra, especially in cool stars.',
                facts: [
                    ['Molar mass', '23.998 g/mol'],
                    ['Bulk form', 'NaH — saline hydride, strong base'],
                    ['Where seen (gas)', 'Sunspot and cool-star spectra']
                ]
            },
            'HMg': {
                name: 'Magnesium monohydride',
                formula: 'MgH',
                alsoKnown: 'MgH radical',
                description: 'A magnesium atom bonded to one hydrogen, an odd-electron radical. Gas-phase MgH is a classic tracer in red-dwarf star atmospheres — its spectral bands are strong enough that astronomers use them to measure stellar magnesium abundances. The bulk compound MgH₂ is a promising solid-state hydrogen-storage material.',
                facts: [
                    ['Molar mass', '25.313 g/mol'],
                    ['Class', 'Diatomic radical'],
                    ['Famous in astronomy', 'MgH bands in cool stellar spectra']
                ]
            },
            'HK': {
                name: 'Potassium monohydride',
                formula: 'KH',
                alsoKnown: 'KH radical (gas phase); potassium hydride',
                description: 'A potassium atom with a single hydrogen. The bulk ionic compound KH is an even stronger base and reducing agent than NaH. In the gas phase, KH is a short-lived diatomic studied in alkali-metal plasma experiments.',
                facts: [
                    ['Molar mass', '40.106 g/mol'],
                    ['Bulk form', 'KH — saline hydride, very strong base']
                ]
            },
            'HTi': {
                name: 'Titanium monohydride',
                formula: 'TiH',
                alsoKnown: 'TiH radical (gas phase)',
                description: 'A titanium atom with a single hydrogen, another gas-phase diatomic radical seen in cool-star atmospheres and titanium plasmas. The related bulk hydride TiH₂ is used industrially — when heated it releases hydrogen cleanly, making it useful as a foaming agent in metal casting and as a hydrogen source.',
                facts: [
                    ['Molar mass', '48.874 g/mol'],
                    ['Class', 'Diatomic radical'],
                    ['Bulk form', 'TiH₂ — H₂ storage and foaming agent']
                ]
            },
            'HV': {
                name: 'Vanadium monohydride',
                formula: 'VH',
                alsoKnown: 'VH radical',
                description: 'A vanadium atom bonded to one hydrogen — a gas-phase transition-metal hydride radical seen mainly in laboratory molecular-beam experiments and the atmospheres of the coolest stars.',
                facts: [
                    ['Molar mass', '51.949 g/mol'],
                    ['Class', 'Transition-metal diatomic radical']
                ]
            },
            'HFe': {
                name: 'Iron monohydride',
                formula: 'FeH',
                alsoKnown: 'FeH radical',
                description: 'An iron atom with one hydrogen. Famous among astronomers: the FeH "Wing-Ford" bands in the near-infrared are one of the strongest spectral signatures of M-dwarf and L-dwarf stars and have been used to measure their magnetic fields via Zeeman splitting.',
                facts: [
                    ['Molar mass', '56.853 g/mol'],
                    ['Class', 'Transition-metal diatomic radical'],
                    ['Famous in astronomy', 'Wing-Ford bands (M/L dwarfs); magnetic-field diagnostic']
                ]
            },
            'HCo': {
                name: 'Cobalt monohydride',
                formula: 'CoH',
                alsoKnown: 'CoH radical',
                description: 'A cobalt atom covalently bonded to one hydrogen. Another gas-phase transition-metal hydride radical, studied in molecular-beam spectroscopy for what it reveals about metal-H bonding and spin-orbit interactions.',
                facts: [
                    ['Molar mass', '59.941 g/mol'],
                    ['Class', 'Transition-metal diatomic radical']
                ]
            },

            // --- Small main-group radicals -------------------------------------
            'HN': {
                name: 'Imidogen (NH radical)',
                formula: '•NH',
                alsoKnown: 'Imidyl; the NH free radical; nitrogen hydride',
                description: 'A nitrogen atom bonded to a single hydrogen — an open-shell radical with two unpaired electrons (a triplet ground state, like O₂). NH is an important intermediate in combustion chemistry and in the atmospheric nitrogen cycle, and has been detected in comets, interstellar gas, and the atmospheres of hot gas-giant planets.',
                facts: [
                    ['Molar mass', '15.015 g/mol'],
                    ['Ground state', 'Triplet (two unpaired electrons)'],
                    ['Where seen', 'Flames, comets, interstellar clouds, hot Jupiters']
                ]
            },

            // --- Exotic main-group / metalloid pairings -----------------------
            'BeLi': {
                name: 'Beryllium-lithium dimer',
                formula: 'BeLi',
                alsoKnown: 'BeLi gas-phase diatomic',
                description: 'A beryllium atom paired with a lithium atom. An exotic metal-metal diatomic with an unusual bonding character — two very different electronegativities and only a few valence electrons between them. Studied theoretically and in ultracold-atom experiments; no bulk analog.',
                facts: [
                    ['Class', 'Metal-metal diatomic (exotic)'],
                    ['Molar mass', '15.953 g/mol']
                ]
            },
            'CLi': {
                name: 'Lithium carbide (CLi radical)',
                formula: 'LiC',
                alsoKnown: 'CLi radical (gas phase)',
                description: 'A carbon paired with a lithium, a gas-phase radical that lives on the way to forming bulk lithium carbides. The best-known bulk lithium carbide is Li₂C₂. Its organic cousin, lithium acetylide (LiC≡CH), is a workhorse reagent: it adds to carbonyl groups to build longer carbon chains.',
                facts: [
                    ['Class', 'Diatomic radical'],
                    ['Bulk relative', 'Li₂C₂ (lithium acetylide) — organic reagent']
                ]
            },
            'LiSi': {
                name: 'Lithium silicide',
                formula: 'LiSi',
                alsoKnown: 'Li-Si intermetallic (diatomic gas phase); the simplest lithium-silicon compound',
                description: 'A lithium atom paired with a silicon atom. The gas-phase dimer is exotic, but the family of lithium silicides — Li₁₂Si₇, Li₇Si₃, Li₁₃Si₄, Li₂₂Si₅ — are big news in battery research, because silicon anodes bind huge amounts of lithium per unit mass (much more than graphite) and the lithium-silicide phases are what the anode cycles through during charging.',
                facts: [
                    ['Class', 'Intermetallic dimer'],
                    ['Famous relatives', 'LixSiy phases in Li-ion battery anodes']
                ]
            },
            'BeSi': {
                name: 'Beryllium-silicon dimer',
                formula: 'BeSi',
                alsoKnown: 'BeSi exotic diatomic',
                description: 'A beryllium atom paired with a silicon atom. A rarely-encountered diatomic species; beryllium and silicon together are of interest to materials scientists chiefly as part of ceramic composites (like beryllium silicate gems — beryl, emerald, aquamarine — which are Be₃Al₂Si₆O₁₈), not as a stand-alone molecule.',
                facts: [
                    ['Class', 'Exotic main-group diatomic'],
                    ['Bulk relatives', 'Beryl, emerald, aquamarine (Be₃Al₂Si₆O₁₈)']
                ]
            },
            'BeP': {
                name: 'Beryllium-phosphorus dimer',
                formula: 'BeP',
                alsoKnown: 'BeP exotic diatomic',
                description: 'A beryllium atom paired with a phosphorus atom. Another rare gas-phase diatomic, studied primarily theoretically. The bulk compound Be₃P₂ (beryllium phosphide) is an obscure material with II-V semiconductor character.',
                facts: [
                    ['Class', 'Exotic main-group diatomic'],
                    ['Bulk', 'Be₃P₂ — II-V semiconductor']
                ]
            },

            // --- More noble-gas / exotic van der Waals adducts ---------------
            'HNe': {
                name: 'Neon hydride',
                formula: 'HNe (neutral) / NeH⁺ (cation)',
                alsoKnown: 'NeH⁺ is detectable; HNe neutral is only very weakly bound',
                description: 'A hydrogen paired with a neon. The neutral pair has essentially no real bond — neon is noble — though the cation NeH⁺ is a firmly-bound diatomic (analogous to HeH⁺) detected spectroscopically and considered a candidate astrochemical species. The neutral HNe seen here is a van der Waals / excimer-class species.',
                facts: [
                    ['Class', 'Exotic noble-gas complex / cation'],
                    ['Cation NeH⁺', 'Detectable; candidate astrochemical molecule']
                ]
            },
            'BeHe': {
                name: 'Beryllium-helium complex',
                formula: 'BeHe',
                alsoKnown: 'Be·He van der Waals adduct',
                description: 'A beryllium atom paired with a helium atom. The neutral pair is only weakly bound by dispersion forces — like most He-X pairings. Beryllium-helium is of interest because beryllium is the simplest multi-electron atom amenable to very accurate quantum-chemistry benchmarks.',
                facts: [
                    ['Class', 'Van der Waals complex'],
                    ['Why studied', 'Quantum-chemistry benchmark system']
                ]
            },
            'HeNa': {
                name: 'Helium-sodium complex',
                formula: 'HeNa',
                alsoKnown: 'Na·He van der Waals adduct',
                description: 'A sodium atom loosely paired with a helium atom. Another alkali-metal + noble-gas van der Waals complex — very weakly bound — relevant to ultracold atomic physics and to sodium-in-helium-droplet spectroscopy.',
                facts: [
                    ['Class', 'Van der Waals complex'],
                    ['Technique', 'Helium-nanodroplet spectroscopy of Na']
                ]
            },
            'CrHe': {
                name: 'Chromium-helium complex',
                formula: 'CrHe',
                alsoKnown: 'Cr·He van der Waals adduct',
                description: 'A chromium atom paired with a helium atom. Like other transition-metal + noble-gas pairings, this is a very weakly bound complex studied in helium-droplet experiments and as a quantum-chemistry test case.',
                facts: [
                    ['Class', 'Van der Waals complex'],
                    ['Context', 'Helium-droplet isolation of transition-metal atoms']
                ]
            },
            'CaHe': {
                name: 'Calcium-helium complex',
                formula: 'CaHe',
                alsoKnown: 'Ca·He van der Waals adduct',
                description: 'A calcium atom paired with a helium atom. Another weakly-bound alkaline-earth + noble-gas complex. Calcium-in-helium-droplet experiments use this kind of interaction to isolate single calcium atoms in an ultracold matrix for high-precision spectroscopy.',
                facts: [
                    ['Class', 'Van der Waals complex'],
                    ['Context', 'High-precision Ca atomic spectroscopy in He droplets']
                ]
            },
            'HeY': {
                name: 'Yttrium-helium complex',
                formula: 'YHe',
                alsoKnown: 'Y·He van der Waals adduct',
                description: 'A yttrium atom paired with a helium atom. A van der Waals complex studied in rare-earth / transition-metal atomic spectroscopy — researchers trap single Y atoms inside liquid-helium droplets to probe their behavior without interference from a surrounding chemical environment.',
                facts: [
                    ['Class', 'Van der Waals complex'],
                    ['Context', 'Atomic spectroscopy of Y in helium matrices']
                ]
            },
            'HeNb': {
                name: 'Niobium-helium complex',
                formula: 'NbHe',
                alsoKnown: 'Nb·He van der Waals adduct',
                description: 'A niobium atom paired with a helium atom. Same physics family as other transition-metal + He pairings — very weak dispersion binding, used in helium-droplet single-atom isolation experiments.',
                facts: [
                    ['Class', 'Van der Waals complex']
                ]
            },
            'HePd': {
                name: 'Palladium-helium complex',
                formula: 'PdHe',
                alsoKnown: 'Pd·He van der Waals adduct',
                description: 'A palladium atom paired with a helium atom. Palladium is famous for absorbing huge amounts of molecular hydrogen gas; the Pd-He interaction is qualitatively different (no real bonding) but has been studied for the same reason it\'s been studied for other metals — to understand how noble-gas matrices affect transition-metal electronic states.',
                facts: [
                    ['Class', 'Van der Waals complex']
                ]
            },
            'HeTe': {
                name: 'Tellurium-helium complex',
                formula: 'TeHe',
                alsoKnown: 'Te·He van der Waals adduct',
                description: 'A tellurium atom paired with a helium atom. A weakly-bound main-group + noble-gas complex, of interest in studies of heavy-atom relativistic effects on van der Waals binding.',
                facts: [
                    ['Class', 'Van der Waals complex']
                ]
            },

            // --- Three-atom exotica ------------------------------------------
            'CHHe': {
                name: 'CH-helium complex',
                formula: 'CH·He',
                alsoKnown: 'Methylidyne + helium van der Waals adduct',
                description: 'A methylidyne radical (CH) loosely associated with a helium atom. The CH radical itself was the first molecule identified in interstellar space (1937); the CH-He van der Waals complex is a model system for studying how a noble-gas bath affects a simple radical\'s rotation and spectroscopy — the kind of measurement used to interpret interstellar observations of CH.',
                facts: [
                    ['Class', 'Radical-noble gas van der Waals complex'],
                    ['Context', 'Astrochemistry / radical spectroscopy'],
                    ['CH itself', 'First molecule detected in interstellar space (1937)']
                ]
            },
            'HBeN': {
                name: 'HBeN (hydridoberyllium nitride)',
                formula: 'HBeN',
                alsoKnown: 'H-Be-N; a linear laboratory-detected molecule',
                description: 'A three-atom linear molecule: hydrogen bonded to beryllium bonded to a nitrogen. Genuinely detected in matrix-isolation infrared experiments (trap Be + NH₃ in frozen argon, shine a laser, get HBeN along with other beryllium-nitrogen species). Of interest in main-group chemistry as a simple example of a Be=N multiple bond.',
                facts: [
                    ['Class', 'Linear triatomic'],
                    ['Detected in', 'Matrix-isolation IR experiments'],
                    ['Interest', 'Be=N multiple bonding']
                ]
            },

            // --- More noble-gas / halide-noble-gas van der Waals complexes ---
            'ClHe': {
                name: 'Chlorine-helium complex',
                formula: 'ClHe',
                alsoKnown: 'Cl·He van der Waals adduct',
                description: 'A single chlorine atom loosely paired with a helium atom. The neutral ground state is only weakly bound (dispersion forces), but the excimer HeCl* is relevant in excimer-laser chemistry — excited noble-gas halides are the lasing species in a whole family of ultraviolet lasers (XeCl, KrF, ArF, etc.), used in photolithography and LASIK surgery.',
                facts: [
                    ['Class', 'Van der Waals complex / excimer'],
                    ['Related to', 'Noble-gas halide (NGX) excimer lasers']
                ]
            },
            'ArHe': {
                name: 'Argon-helium complex',
                formula: 'ArHe',
                alsoKnown: 'Ar·He van der Waals dimer',
                description: 'Two noble-gas atoms weakly stuck together by London dispersion forces. Slightly more bound than dihelium but still among the weakest of chemical interactions. Extensively studied as a benchmark system for high-accuracy quantum-chemistry calculations of intermolecular forces.',
                facts: [
                    ['Class', 'Van der Waals dimer'],
                    ['Binding', 'Very weak (dispersion only)'],
                    ['Use', 'Benchmark for dispersion-force theory']
                ]
            },
            'HeK': {
                name: 'Helium-potassium complex',
                formula: 'KHe',
                alsoKnown: 'K·He van der Waals adduct',
                description: 'A potassium atom loosely paired with a helium atom. Like other alkali-metal + noble-gas pairs, only weakly bound. K-in-helium-droplet experiments use this kind of interaction to isolate single potassium atoms for high-resolution atomic spectroscopy.',
                facts: [
                    ['Class', 'Van der Waals complex'],
                    ['Context', 'Helium-nanodroplet spectroscopy of K atoms']
                ]
            },
            'HeTl': {
                name: 'Thallium-helium complex',
                formula: 'TlHe',
                alsoKnown: 'Tl·He van der Waals adduct',
                description: 'A thallium atom paired with a helium atom. A weakly-bound post-transition-metal / noble-gas van der Waals complex, studied for what it reveals about relativistic effects on the Tl 6p electron.',
                facts: [
                    ['Class', 'Van der Waals complex'],
                    ['Interest', 'Relativistic effects in heavy atoms']
                ]
            },

            // --- Methylidyne (CH) + metal linear triatomics ------------------
            // Real species: you'd form these by reacting a metal vapor with
            // methane in a matrix, and they've been detected by IR spectroscopy.
            'CHLi': {
                name: 'Lithium methylidyne',
                formula: 'LiCH',
                alsoKnown: 'LiCH linear triatomic',
                description: 'A three-atom linear molecule: Li–C–H. Produced by reacting laser-ablated lithium vapor with methane in a frozen argon matrix. Of interest in theoretical chemistry as a minimal model of organolithium species, which are workhorse reagents in organic synthesis (butyl lithium, phenyl lithium, etc.).',
                facts: [
                    ['Class', 'Linear triatomic'],
                    ['Context', 'Matrix-isolation studies of metal-methane reactions'],
                    ['Parent class', 'Organolithiums — crucial synthetic reagents']
                ]
            },
            'CHCa': {
                name: 'Calcium methylidyne',
                formula: 'CaCH',
                alsoKnown: 'CaCH gas-phase radical',
                description: 'A Ca–C–H molecule with an open-shell (radical) ground state. Studied in cold-molecule experiments because its simple structure and heavy Ca atom make it a good candidate for laser cooling to ultracold temperatures — part of the push toward using molecules (not just atoms) as platforms for precision measurement and quantum simulation.',
                facts: [
                    ['Class', 'Open-shell triatomic radical'],
                    ['Context', 'Cold-molecule / laser-cooling research']
                ]
            },
            'CHFe': {
                name: 'Iron methylidyne',
                formula: 'FeCH',
                alsoKnown: 'FeCH gas-phase species',
                description: 'A three-atom linear species with an iron-carbon bond. Of interest as a minimal model for how iron activates C–H bonds — a key step in the chemistry of iron-containing enzymes (like cytochrome P450, which metabolizes drugs in your liver) and iron-catalyzed industrial processes like Fischer-Tropsch synthesis.',
                facts: [
                    ['Class', 'Open-shell triatomic'],
                    ['Interest', 'Iron C–H activation chemistry'],
                    ['Real-world relevance', 'Cytochrome P450, Fischer-Tropsch catalysis']
                ]
            },

            // --- Main-group / metalloid hydride radicals ---------------------
            'HSi': {
                name: 'Silylidyne (SiH radical)',
                formula: '•SiH',
                alsoKnown: 'Silicon monohydride; the SiH radical',
                description: 'A silicon atom bonded to a single hydrogen, an open-shell radical. Highly reactive. A central intermediate in plasma-enhanced chemical vapor deposition (PECVD) of thin-film silicon — the process used to lay down amorphous silicon for solar cells and thin-film transistors — and in combustion chemistry of silane (SiH₄).',
                facts: [
                    ['Molar mass', '29.094 g/mol'],
                    ['Class', 'Open-shell diatomic radical'],
                    ['Industrial role', 'Key intermediate in PECVD of silicon thin films']
                ]
            },
            'HP': {
                name: 'Phosphinidene (PH radical)',
                formula: '•PH',
                alsoKnown: 'Phosphorus monohydride; the PH radical',
                description: 'A phosphorus atom with one hydrogen, a triplet-ground-state radical (two unpaired electrons, like O₂ or NH). Studied in flames and laboratory plasmas as a key intermediate in PH₃ (phosphine) chemistry. Its parent, phosphine, is found in the atmospheres of Jupiter and Saturn, where deep convection dredges up phosphorus compounds.',
                facts: [
                    ['Molar mass', '31.982 g/mol'],
                    ['Ground state', 'Triplet (like O₂ and NH)'],
                    ['Where seen', 'Flames and PH₃ plasmas (parent PH₃ on Jupiter and Saturn)']
                ]
            },

            // --- Transition-metal / post-transition-metal hydride radicals --
            'HSc': {
                name: 'Scandium monohydride',
                formula: 'ScH',
                alsoKnown: 'ScH radical',
                description: 'A scandium atom covalently bonded to one hydrogen. The simplest 3d-transition-metal hydride, and a model system for studying how d-electrons participate in metal-H bonding. Detected spectroscopically in the laboratory; predicted to exist in the atmospheres of cool M-type stars.',
                facts: [
                    ['Class', 'Transition-metal diatomic radical'],
                    ['Significance', 'Simplest 3d-block MH benchmark system']
                ]
            },
            'HTc': {
                name: 'Technetium monohydride',
                formula: 'TcH',
                alsoKnown: 'TcH radical',
                description: 'A technetium atom bonded to one hydrogen — remarkable mainly because every isotope of technetium is radioactive, so this is the only transition-metal hydride that has to be handled behind shielding. Studied via laser ablation of a Tc target in a hydrogen-loaded matrix.',
                facts: [
                    ['Class', 'Transition-metal diatomic radical'],
                    ['Special', 'All Tc isotopes are radioactive']
                ]
            },
            'HRh': {
                name: 'Rhodium monohydride',
                formula: 'RhH',
                alsoKnown: 'RhH radical',
                description: 'A rhodium atom bonded to one hydrogen. Rhodium is a workhorse hydrogenation catalyst in industry (Wilkinson\'s catalyst, Rh-catalyzed hydroformylation) — and the diatomic RhH is a textbook model for the metal-H intermediates that appear in the catalytic cycle of those reactions.',
                facts: [
                    ['Class', 'Transition-metal diatomic radical'],
                    ['Industrial relevance', 'Model for Rh hydrogenation catalysis'],
                    ['Famous catalyst', 'Wilkinson\'s catalyst, hydroformylation']
                ]
            },
            'HPt': {
                name: 'Platinum monohydride',
                formula: 'PtH',
                alsoKnown: 'PtH radical',
                description: 'A platinum atom bonded to a single hydrogen. Platinum is the premier heterogeneous hydrogenation catalyst (platinum nanoparticles activate H₂ on contact), and PtH is the isolated-molecule analog of the surface Pt–H species that form on those catalysts. Widely studied in catalysis and in fuel-cell research.',
                facts: [
                    ['Class', 'Transition-metal diatomic radical'],
                    ['Industrial relevance', 'Pt hydrogenation catalysis; fuel cells']
                ]
            },
            'HTl': {
                name: 'Thallium monohydride',
                formula: 'TlH',
                alsoKnown: 'TlH radical',
                description: 'A thallium atom paired with one hydrogen. A heavy main-group diatomic where relativistic effects on thallium\'s 6p electron significantly change the bond strength and length compared to what non-relativistic theory predicts. Used as a benchmark for relativistic quantum-chemistry methods.',
                facts: [
                    ['Class', 'Heavy main-group diatomic'],
                    ['Interest', 'Benchmark for relativistic quantum chemistry']
                ]
            },

            // ============================================================
            //  NOTABLE — full entries
            // ============================================================

            'HS': {
                name: 'Mercapto radical (SH)',
                formula: '•SH',
                alsoKnown: 'Sulfanyl radical; hydrogen sulfide radical; the sulfur analog of hydroxyl (OH)',
                description: 'A single hydrogen bonded to a sulfur atom, with one unpaired electron — the sulfur twin of the famous OH radical. Detected in interstellar clouds, comets, and the atmosphere of Titan, and produced in every combustion of sulfur-containing fuels. The thiol group (–SH) it represents is biologically huge: cysteine residues in proteins use –SH groups to form disulfide bridges, the covalent bonds that hold many protein structures together (and why a permanent wave works on your hair — it\'s literally rearranging disulfide bonds in keratin).',
                facts: [
                    ['Molar mass', '33.07 g/mol'],
                    ['Class', 'Open-shell diatomic radical'],
                    ['Where seen', 'Interstellar medium, Titan, combustion plumes'],
                    ['Biology link', 'Parent of thiol (–SH) functional groups in proteins']
                ]
            },
            'H2F': {
                name: 'FH₂ (F···H-H transition complex / FH₂⁺ cation)',
                formula: 'FH₂ or FH₂⁺',
                alsoKnown: 'Fluoronium (for the cation); the transition region of the F + H₂ reaction',
                description: 'Famously the fleeting intermediate of F + H₂ → HF + H, *the* most-studied chemical reaction in the history of chemical kinetics, known down to its individual quantum states from crossed-molecular-beam experiments. The protonated cation FH₂⁺ is a stable, well-characterized ion detected in astrochemistry contexts. It was a showcase system for the reaction-dynamics methods honored by the 1986 Nobel Prize in Chemistry (Herschbach, Lee, Polanyi): Polanyi\'s infrared glow measurements and Lee\'s crossed beams showed how the energy released ends up as vibration of the new HF bond.',
                facts: [
                    ['Class', 'Reactive transition state / cation'],
                    ['Historical significance', 'Benchmark of the reaction dynamics honored by the 1986 Nobel Prize'],
                    ['Why famous', 'Benchmark reaction for chemical kinetics theory']
                ]
            },
            'BeS': {
                name: 'Beryllium sulfide',
                formula: 'BeS',
                alsoKnown: 'BeS — a II-VI wide-bandgap semiconductor',
                description: 'A beryllium atom bonded to a sulfur atom. Unlike most entries on this page, BeS is a genuine bulk solid: it crystallizes in the zinc-blende (diamond-like) structure and behaves as a wide-bandgap II-VI semiconductor, studied in the same family as ZnS, ZnSe, and CdTe for optoelectronic applications. Beryllium-based materials are difficult to work with because beryllium compounds are highly toxic, so BeS is more of a theoretical/benchmark material than an industrially used one.',
                facts: [
                    ['Molar mass', '41.08 g/mol'],
                    ['Crystal structure', 'Zinc-blende (like ZnS, diamond variant)'],
                    ['Class', 'II-VI wide-bandgap semiconductor'],
                    ['Caution', 'All beryllium compounds are highly toxic']
                ]
            },

            // ============================================================
            //  FAMILY — lithium-transition-metal diatomics (battery model systems)
            // ============================================================
            // These all belong to the "simplest model of lithium on transition metals"
            // family, relevant to battery research. They share a description.

            'CrLi': {
                name: 'Lithium-chromium dimer',
                formula: 'LiCr',
                alsoKnown: 'Model diatomic for Li intercalation into Cr-based battery cathodes',
                description: 'A lithium atom bonded to a chromium atom. Individually exotic, but part of the research family of lithium-transition-metal diatomics studied as the simplest models for how lithium interacts with transition-metal surfaces — directly relevant to lithium-ion battery chemistry, where lithium ions slip into and out of metal-oxide host lattices during charge/discharge cycles. The bulk chromium-lithium phases themselves aren\'t practical battery materials, but the theoretical framework extends to commercially important cathodes like Li(Ni,Mn,Co)O₂.',
                facts: [
                    ['Class', 'Lithium–transition-metal diatomic'],
                    ['Research context', 'Model for Li-ion battery cathode chemistry']
                ]
            },
            'FeLi': {
                name: 'Lithium-iron dimer',
                formula: 'LiFe',
                alsoKnown: 'Gas-phase Li-Fe diatomic; model system for LiFePO₄ chemistry',
                description: 'A lithium atom bonded to an iron atom. The Li-Fe diatomic is the simplest stand-in for more practically important lithium-iron compounds — most notably LiFePO₄ (lithium iron phosphate), one of the most important cathode materials in modern EV batteries because of its stability, low cost, and non-toxicity (no cobalt). The gas-phase diatomic is studied theoretically to calibrate how DFT calculations handle Li-TM bonding.',
                facts: [
                    ['Class', 'Lithium–transition-metal diatomic'],
                    ['Research context', 'LiFePO₄ cathode chemistry (EV batteries)']
                ]
            },
            'LiMo': {
                name: 'Lithium-molybdenum dimer',
                formula: 'LiMo',
                alsoKnown: 'Gas-phase Li-Mo diatomic',
                description: 'A lithium atom bonded to molybdenum. Related bulk compounds (Li₂MoO₄, lithium molybdate) have been studied as cathode materials; the diatomic itself is a theoretical model system for lithium-on-molybdenum bonding. Molybdenum oxides and sulfides intercalate lithium, making MoS₂ a researched battery anode material.',
                facts: [
                    ['Class', 'Lithium–transition-metal diatomic'],
                    ['Research context', 'Li-MoS₂ and lithium molybdate battery chemistry']
                ]
            },
            'LiRu': {
                name: 'Lithium-ruthenium dimer',
                formula: 'LiRu',
                alsoKnown: 'Gas-phase Li-Ru diatomic',
                description: 'A lithium atom bonded to ruthenium. Bulk lithium ruthenates (Li₂RuO₃ and related) are active-research cathode materials capable of high voltage and high capacity. The gas-phase diatomic is a benchmark for calibrating theoretical methods before applying them to the complex bulk structures.',
                facts: [
                    ['Class', 'Lithium–transition-metal diatomic'],
                    ['Research context', 'Li₂RuO₃ high-capacity cathode research']
                ]
            },
            'LiRh': {
                name: 'Lithium-rhodium dimer',
                formula: 'LiRh',
                alsoKnown: 'Gas-phase Li-Rh diatomic',
                description: 'A lithium atom bonded to rhodium. An exotic member of the lithium-transition-metal dimer family. Less directly battery-relevant than the Fe, Mo, or Ru variants (rhodium is rare and expensive), but of interest for fundamental studies of Li-TM bonding trends across the periodic table.',
                facts: [
                    ['Class', 'Lithium–transition-metal diatomic']
                ]
            },

            // ============================================================
            //  TEMPLATE ENTRIES — brief classifications
            // ============================================================

            // Helium van der Waals adducts — weakly-bound complexes studied in
            // helium-droplet spectroscopy and as quantum-chemistry benchmarks.
            'HeS': {
                name: 'Sulfur-helium complex',
                formula: 'SHe',
                alsoKnown: 'S·He van der Waals adduct',
                description: 'A sulfur atom loosely paired with a helium atom. Like other noble-gas + main-group vdW complexes, only weakly dispersion-bound. Of theoretical interest in calibrating quantum chemistry for open-shell atoms.',
                facts: [['Class', 'Van der Waals complex']]
            },
            'He2S': {
                name: 'Sulfur–dihelium cluster (S·He₂)',
                formula: 'SHe₂',
                alsoKnown: 'S·He₂ van der Waals trimer',
                description: 'A sulfur atom loosely associated with two helium atoms. An exotic weakly-bound cluster; the sim produces these three-atom van der Waals complexes when sulfur happens to be surrounded by helium. Not a stable molecule outside ultracold conditions.',
                facts: [['Class', 'Van der Waals trimer']]
            },
            'GeHe': {
                name: 'Germanium-helium complex',
                formula: 'GeHe',
                alsoKnown: 'Ge·He van der Waals adduct',
                description: 'A germanium atom loosely paired with a helium atom. Weakly dispersion-bound — part of the broad family of transition/post-transition metal van der Waals complexes with helium.',
                facts: [['Class', 'Van der Waals complex']]
            },
            'AsHe': {
                name: 'Arsenic-helium complex',
                formula: 'AsHe',
                alsoKnown: 'As·He van der Waals adduct',
                description: 'An arsenic atom loosely paired with a helium atom. Another weakly-bound main-group + noble-gas complex. Studied in helium-droplet matrix isolation of As atoms.',
                facts: [['Class', 'Van der Waals complex']]
            },
            'HeMo': {
                name: 'Molybdenum-helium complex',
                formula: 'MoHe',
                alsoKnown: 'Mo·He van der Waals adduct',
                description: 'A molybdenum atom paired with a helium atom. A typical transition-metal + noble-gas vdW complex; of interest in helium-droplet single-atom isolation experiments for Mo spectroscopy.',
                facts: [['Class', 'Van der Waals complex']]
            },
            'HeRh': {
                name: 'Rhodium-helium complex',
                formula: 'RhHe',
                alsoKnown: 'Rh·He van der Waals adduct',
                description: 'A rhodium atom paired with a helium atom. Weakly-bound transition-metal + noble-gas complex.',
                facts: [['Class', 'Van der Waals complex']]
            },
            'HeXe': {
                name: 'Xenon-helium complex',
                formula: 'XeHe',
                alsoKnown: 'Xe·He van der Waals dimer',
                description: 'Two noble-gas atoms loosely bound by dispersion forces. Studied as a benchmark for accurate van der Waals potentials — useful because both atoms are closed-shell, keeping the quantum chemistry relatively clean.',
                facts: [['Class', 'Van der Waals dimer (two noble gases)']]
            },
            'HeMg': {
                name: 'Magnesium-helium complex',
                formula: 'MgHe',
                alsoKnown: 'Mg·He van der Waals adduct',
                description: 'A magnesium atom paired with a helium atom. Another alkaline-earth + noble-gas vdW complex — relevant to helium-droplet spectroscopy of Mg.',
                facts: [['Class', 'Van der Waals complex']]
            },
            'HeSm': {
                name: 'Samarium-helium complex',
                formula: 'SmHe',
                alsoKnown: 'Sm·He van der Waals adduct',
                description: 'A samarium (lanthanide) atom paired with a helium atom. Helium-droplet experiments on lanthanides study atomic magnetic moments and spectroscopy without interference from a chemical environment.',
                facts: [['Class', 'Lanthanide-noble gas vdW complex']]
            },
            'HeYb': {
                name: 'Ytterbium-helium complex',
                formula: 'YbHe',
                alsoKnown: 'Yb·He van der Waals adduct',
                description: 'An ytterbium (lanthanide) atom paired with helium. Yb is a favorite for ultracold atomic physics; Yb-in-He-droplet experiments probe its electronic structure in an ultra-cold matrix.',
                facts: [['Class', 'Lanthanide-noble gas vdW complex']]
            },
            'HAr': {
                name: 'Argon hydride',
                formula: 'HAr (neutral) / ArH⁺ (argonium cation)',
                alsoKnown: 'Argonium (cation); first noble-gas molecular ion detected in space',
                description: 'The neutral HAr is barely bound, but the cation ArH⁺ (argonium) is a real astrochemical species detected in the Crab Nebula supernova remnant in 2013 — the first noble-gas molecular ion ever observed in space. ArH⁺ is used by astronomers as a tracer of purely atomic interstellar gas, because it only survives in environments where H₂ is absent.',
                facts: [
                    ['Class', 'Noble-gas hydride / astrochemistry tracer'],
                    ['Detection', 'Crab Nebula, 2013 (Herschel Space Observatory)'],
                    ['Significance', 'Tracer of purely atomic interstellar gas']
                ]
            },

            // Transition-metal dimers (molybdenum variants, etc.) — gas-phase
            // homo- and heterometallic species studied in molecular-beam experiments.
            'MoNa': {
                name: 'Sodium-molybdenum dimer',
                formula: 'NaMo',
                alsoKnown: 'Na·Mo gas-phase diatomic',
                description: 'A sodium atom bonded to a molybdenum atom. An exotic alkali + transition-metal diatomic, studied theoretically for its unusual bonding character (Na has one valence electron, Mo has six). No bulk analog.',
                facts: [['Class', 'Alkali–transition-metal diatomic']]
            },
            'MoSc': {
                name: 'Scandium-molybdenum dimer',
                formula: 'ScMo',
                alsoKnown: 'Sc·Mo gas-phase diatomic',
                description: 'A scandium atom bonded to a molybdenum atom. A transition-metal heterodimer studied in molecular-beam experiments to understand how d-electrons from different metals combine in a bond.',
                facts: [['Class', 'Transition-metal heterodimer']]
            },
            'MoTi': {
                name: 'Titanium-molybdenum dimer',
                formula: 'TiMo',
                alsoKnown: 'Ti·Mo gas-phase diatomic',
                description: 'Titanium paired with molybdenum. Bulk Ti-Mo alloys are real and industrially useful (high-strength, corrosion-resistant), but the gas-phase diatomic is an exotic lab species.',
                facts: [
                    ['Class', 'Transition-metal heterodimer'],
                    ['Bulk relatives', 'Ti-Mo alloys used in aerospace and medical implants']
                ]
            },
            'CCr': {
                name: 'Carbon-chromium diatomic',
                formula: 'CCr',
                alsoKnown: 'CCr gas-phase species',
                description: 'A carbon atom bonded to a chromium atom. Gas-phase metal-carbide diatomics like this are studied for what they reveal about C-metal bonding, directly relevant to chromium carbide (Cr₃C₂) coatings used on wear-resistant industrial surfaces.',
                facts: [
                    ['Class', 'Metal-carbide diatomic'],
                    ['Bulk relative', 'Cr₃C₂ hard coatings']
                ]
            },
            'BrLi': {
                name: 'Lithium bromide (diatomic)',
                formula: 'LiBr',
                alsoKnown: 'Lithium bromide — bulk is an ionic salt',
                description: 'The gas-phase LiBr diatomic molecule, the single-molecule form of the bulk ionic salt. Solid LiBr is highly hygroscopic and used industrially as a desiccant in absorption-refrigeration systems and air-conditioning. In the sim it appears as a two-atom "molecule" because the simplified physics can\'t represent extended ionic lattices.',
                facts: [
                    ['Molar mass', '86.85 g/mol'],
                    ['Bulk form', 'Hygroscopic ionic solid — industrial desiccant'],
                    ['Use', 'LiBr absorption chillers in large HVAC systems']
                ]
            }
        };

        // Map from chemist-friendly formulas to the Hill key used in moleculeInfo.
        // Covers the common cases where the two differ, so the entity list or
        // a human-typed query still resolves correctly.
        const moleculeAliases = {
            'NH3':   'H3N',
            'NaCl':  'ClNa',
            'NaF':   'FNa',
            'NaBr':  'BrNa',
            'NaI':   'INa',
            'KCl':   'ClK',
            'KF':    'FK',
            'MgCl2': 'Cl2Mg',
            'SO2':   'O2S',
            'SO3':   'O3S',
            'SiO2':  'O2Si',
            'HCl':   'ClH',
            'HF':    'FH',
            'HBr':   'BrH',
            'NaOH':  'HNaO',
            'KOH':   'HKO',
            'HCN':   'CHN',
            'OH':    'HO',
            'CH3OH': 'CH4O',
            'CH3CH3':'C2H6',
            'C2H5OH':'C2H6O',
            'CH3CHO':'C2H4O'
        };

        // =====================================================================
        //  POTENTIAL DISCOVERIES — classifier + session log
        // =====================================================================
        // For each new molecule the sim produces, classify it:
        //   'common'   — familiar, expected. NOT logged as a discovery.
        //   'unknown'  — not in our database. Logged (cyan/blue).
        //   'notable'  — real, but chemically unusual (noble-gas compounds,
        //                hypervalent, notorious radicals). Logged (orange).
        //   'anomaly'  — the cartoon has produced something that contradicts
        //                real chemistry rules. Logged (red). E.g. noble-gas
        //                covalent to another noble gas, H with more than 1 bond.
        // Also attaches a short "why it matters" note and the element list.

        // Noble gases (per our periodic categorization).
        const NOBLE_GASES = new Set(['He','Ne','Ar','Kr','Xe','Rn','Og']);
        // Halogens (often relevant for flagging):
        const HALOGENS_SET = new Set(['F','Cl','Br','I','At','Ts']);
        // Metals (broadly — anything from the metal categories). We use
        // PERIODIC_CATEGORIES for this, checked at runtime below.

        function _parseCompositionHill(label) {
            // Parse a Hill-form label like "H2O" or "C2H6O" into {H:2, O:1}.
            // Note: the sim already supplies the composition dict in most
            // places, but we provide this fallback for any path that hands
            // us just a string.
            const out = {};
            const re = /([A-Z][a-z]?)(\d*)/g;
            let m;
            while ((m = re.exec(label)) !== null) {
                if (!m[1]) continue;
                out[m[1]] = (out[m[1]] || 0) + (m[2] ? parseInt(m[2], 10) : 1);
            }
            return out;
        }

        function classifyDiscovery(label, composition) {
            // Returns { tier, note } where tier is 'common' | 'unknown' | 'notable' | 'anomaly'.
            if (!composition || Object.keys(composition).length === 0) {
                composition = _parseCompositionHill(label || '');
            }
            const elements = Object.keys(composition);
            const elementCountTotal = Object.values(composition).reduce((a,b) => a+b, 0);

            // Quick facts about the mix
            const nobleGases = elements.filter(e => NOBLE_GASES.has(e));
            const halogens = elements.filter(e => HALOGENS_SET.has(e));
            const hasH = !!composition['H'];
            const hasC = !!composition['C'];
            const hasO = !!composition['O'];
            const hasN = !!composition['N'];

            // Is it in our database (direct or via alias)?
            let inDB = false;
            try {
                if (typeof moleculeInfo !== 'undefined' && moleculeInfo[label]) inDB = true;
                else if (typeof moleculeAliases !== 'undefined' && moleculeAliases[label]
                         && moleculeInfo[moleculeAliases[label]]) inDB = true;
            } catch (_e) {}

            // ANOMALIES — things that shouldn't form per real-world rules.
            // We bias toward flagging these since they're the most interesting.
            // Note language is crafted to be educational: each note should teach
            // real chemistry, not just say "weird."
            //
            // Rule 1: two or more DIFFERENT noble gases in one molecule. Real
            //         noble-gas compounds (XeF6, KrF2, ArH+) never pair two
            //         noble gases covalently.
            if (nobleGases.length >= 2 && new Set(nobleGases).size >= 2) {
                const ngList = [...new Set(nobleGases)].join('+');
                return { tier: 'anomaly', note: `Multi-noble-gas compound (${ngList}) — noble gases don't bond to each other in reality. No such molecule is known outside sub-kelvin helium droplet experiments. Cartoon physics artifact.` };
            }
            // Rule 2: noble gas repeated (e.g. "He2") with another element AND
            //         a total atom count > 2. Real noble gases are monatomic
            //         outside very exotic vdW adducts.
            if (nobleGases.length === 1 && composition[nobleGases[0]] >= 2 && elementCountTotal >= 3) {
                const ng = nobleGases[0];
                const n = composition[ng];
                return { tier: 'anomaly', note: `Polyatomic ${ng}${n} cluster — ${ng} gas is normally monatomic. Two+ ${ng} atoms only associate weakly via van der Waals forces, not covalent bonds. Cartoon artifact.` };
            }

            // NOTABLE — real but unusual molecules
            //
            // Noble-gas compounds that ARE real (XeF2, XeF4, XeF6, KrF2,
            // ArH, ArH+, HeH+, etc.) are already in our database or aliases;
            // if we see a noble-gas compound NOT in the DB, it's unknown/notable.
            if (nobleGases.length === 1) {
                const ng = nobleGases[0];
                // ArH, HeH, etc. with H are real cations
                if (hasH && elements.length === 2) {
                    if (inDB) return { tier: 'common', note: '' };
                    return {
                        tier: 'notable',
                        note: `Noble-gas hydride (${ng}+H) — only a few real examples exist: HeH⁺ (the universe's first molecule), ArH⁺ (detected in the Crab Nebula), and a handful of matrix-isolation species. Worth investigating whether this specific ${ng}H is genuine or a sim artifact.`
                    };
                }
                // Xe/Kr + F are real (XeF2, XeF4, XeF6, KrF2). Others aren't.
                if (halogens.length >= 1 && (ng === 'Xe' || ng === 'Kr')) {
                    if (inDB) return { tier: 'common', note: '' };
                    return {
                        tier: 'notable',
                        note: `${ng}-halogen compound — ${ng} genuinely forms real compounds with fluorine (${ng}F₂, ${ng === 'Xe' ? 'XeF₄, XeF₆, XeO₃' : 'KrF₂ only, barely'}). Check this specific formula against literature.`
                    };
                }
                // Other noble-gas compounds are anomalies with contextual notes
                if (!inDB) {
                    // Differentiate between very-inert (He, Ne) and less-inert (Ar, Kr, Xe, Rn)
                    const veryInert = (ng === 'He' || ng === 'Ne');
                    const partnerSummary = elements.filter(e => e !== ng).join('+') || '?';
                    if (veryInert) {
                        return {
                            tier: 'anomaly',
                            note: `${ng} + ${partnerSummary} compound — ${ng} is among the most inert elements in reality. Its only known "compounds" are extremely weak van der Waals clusters seen in sub-kelvin experiments. This is almost certainly a cartoon physics artifact where the sim's bonding rules let a covalent bond form that shouldn't exist.`
                        };
                    } else {
                        return {
                            tier: 'anomaly',
                            note: `${ng} + ${partnerSummary} compound — ${ng} can form a handful of real compounds (${ng === 'Xe' ? 'XeF₂, XeO₃, XeO₄' : ng === 'Kr' ? 'KrF₂' : ng === 'Ar' ? 'HArF in a matrix' : 'rare'}), but this specific combination isn't documented. Likely a sim artifact, but worth searching the literature.`
                        };
                    }
                }
            }

            // Hydrogen with multiple partners (hypervalent H)?
            if (hasH && composition['H'] > 2 && elements.length >= 2) {
                // H3O+ (hydronium) is real; H2O2 (peroxide) is real. Others like
                // "H4Si" are SiH4 silane. These are usually fine. We don't flag.
            }

            // UNKNOWN
            if (!inDB) {
                return {
                    tier: 'unknown',
                    note: `Not in the info database. Could be a genuine chemical rarity worth investigating, or a quirk of cartoon physics letting atoms bond in ways real chemistry wouldn't. Worth a quick search of "${label} molecule" in a chemistry reference.`
                };
            }

            return { tier: 'common', note: '' };
        }

        // Session storage for discoveries
        const _discoveriesBySession = new Map(); // key = label, value = { tier, note, count, firstFrame, composition }
        let _discoveriesCurrentFilter = 'all';

        function recordDiscovery(label, composition) {
            if (!label) return;
            // Skip single-element labels (they're just atoms)
            if (/^[A-Z][a-z]?\d*$/.test(label)) return;
            const existing = _discoveriesBySession.get(label);
            if (existing) {
                existing.count++;
                return;
            }
            const { tier, note } = classifyDiscovery(label, composition);
            if (tier === 'common') return;  // not worth logging
            _discoveriesBySession.set(label, {
                label,
                tier,
                note,
                count: 1,
                firstFrame: typeof frameCount !== 'undefined' ? frameCount : 0,
                firstSimTime: typeof simTime !== 'undefined' ? simTime : 0,
                composition: { ...composition }
            });
            refreshDiscoveriesPanel();
        }

        function refreshDiscoveriesPanel() {
            const listEl = document.getElementById('discoveriesList');
            if (!listEl) return;
            const items = [..._discoveriesBySession.values()]
                .filter(d => _discoveriesCurrentFilter === 'all' || d.tier === _discoveriesCurrentFilter)
                // Order: anomalies first, then notable, then unknown, then by count desc
                .sort((a, b) => {
                    const tierRank = { anomaly: 0, notable: 1, unknown: 2, common: 3 };
                    const r = tierRank[a.tier] - tierRank[b.tier];
                    if (r !== 0) return r;
                    return b.count - a.count;
                });

            if (items.length === 0) {
                listEl.innerHTML = '<div class="empty">(no discoveries yet — run the sim and watch for flagged events)</div>';
                return;
            }

            const tierIcon = { unknown: '🔬', notable: '📘', anomaly: '⚠️' };
            const tierLabel = { unknown: 'Unknown', notable: 'Notable', anomaly: 'Anomaly' };

            // Build HTML
            listEl.innerHTML = items.map(d => {
                const elts = Object.entries(d.composition)
                    .map(([el, n]) => n > 1 ? `${el}×${n}` : el)
                    .join(', ');
                return `
                    <div class="discovery tier-${d.tier}" data-label="${d.label}">
                        <div class="head">
                            <span>
                                <span class="tier-label">${tierIcon[d.tier]} ${tierLabel[d.tier]}</span>
                                <span class="formula">${d.label}</span>
                            </span>
                            <span class="count">×${d.count}</span>
                        </div>
                        <div class="note">${d.note}</div>
                        <div class="elements">Elements: ${elts}</div>
                    </div>
                `;
            }).join('');

            // Wire clicks on each discovery to open the info modal for that label
            listEl.querySelectorAll('.discovery').forEach(el => {
                el.addEventListener('click', () => {
                    const lbl = el.getAttribute('data-label');
                    // (called openEntityInfoModal, which does not exist, so rows
                    // were not clickable despite the caveat text saying they are)
                    if (lbl) openInfoModal(lbl);
                });
            });
        }

        function toggleDiscoveriesPanel() {
            const panel = document.getElementById('discoveriesPanel');
            if (panel) panel.classList.toggle('open');
            refreshDiscoveriesPanel();
            if (panel && panel.classList.contains('open')) {
                try { Achievements.notify('discoveries_opened'); } catch(_e){}
            }
        }

        // Wire up on DOM ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', _initDiscoveriesUI);
        } else {
            _initDiscoveriesUI();
        }
        function _initDiscoveriesUI() {
            const toggleBtn = document.getElementById('toggleDiscoveriesBtn');
            const closeBtn  = document.getElementById('discoveriesClose');
            const clearBtn  = document.getElementById('discoveriesClear');
            if (toggleBtn) toggleBtn.addEventListener('click', toggleDiscoveriesPanel);
            if (closeBtn)  closeBtn.addEventListener('click', toggleDiscoveriesPanel);
            if (clearBtn)  clearBtn.addEventListener('click', () => {
                _discoveriesBySession.clear();
                refreshDiscoveriesPanel();
            });
            document.querySelectorAll('#discoveriesPanel .filter-row button').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('#discoveriesPanel .filter-row button').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    _discoveriesCurrentFilter = btn.getAttribute('data-filter');
                    refreshDiscoveriesPanel();
                });
            });
        }

        // =====================================================================
        //  ACHIEVEMENTS / STUDY GUIDE
        // =====================================================================
        // Study-guide-as-achievements. Each one teaches a chemistry or physics
        // concept the user just demonstrated. Progress persists in localStorage.
        // Event hooks scattered through the code call Achievements.notify(event, payload).

        const ACHIEVEMENTS = [
            // --- Getting started ---
            { id: 'first_atom',        cat: 'Getting Started', icon: '⚛️',  name: 'First Atom', desc: 'You added your first atom. Atoms are the smallest unit of an element that retains its identity.', hint: 'Add any atom from the Add Particles panel.' },
            { id: 'first_molecule',    cat: 'Getting Started', icon: '💧',  name: 'First Molecule', desc: 'You added a pre-built molecule. Molecules are groups of atoms held together by chemical bonds.', hint: 'Add any molecule using the molecule dropdown.' },
            { id: 'first_photon',      cat: 'Getting Started', icon: '💡',  name: "Let There Be Light", desc: 'You fired your first photon. Light is both wave and particle — the same photons can interfere like waves.', hint: 'Press the Shine Light button.' },
            { id: 'open_glossary',     cat: 'Getting Started', icon: '📖',  name: 'Knowledge Seeker', desc: 'You opened the Glossary. Every element, particle, and molecule in the sim is documented there.', hint: 'Click the 📖 Glossary button.' },
            { id: 'run_preset',        cat: 'Getting Started', icon: '🎬',  name: 'Scene Setter', desc: 'You loaded a preset scenario. Presets are pre-built scenes showing specific physics phenomena.', hint: 'Pick any preset from the Presets section.' },

            // --- Atomic diversity ---
            { id: 'add_noble_gas',     cat: 'Atomic Diversity', icon: '🎈',  name: 'Loner (Noble Gas)', desc: 'You added a noble gas. Noble gases have complete outer electron shells — they almost never form bonds.', hint: 'Add He, Ne, Ar, Kr, Xe, Rn, or Og.' },
            { id: 'add_halogen',       cat: 'Atomic Diversity', icon: '🧂',  name: 'Salt Maker (Halogen)', desc: "You added a halogen. Halogens are one electron short of a full shell, making them aggressively reactive. They're why table salt exists.", hint: 'Add F, Cl, Br, I, At, or Ts.' },
            { id: 'add_alkali',        cat: 'Atomic Diversity', icon: '🔥',  name: 'Dangerous Metal', desc: 'You added an alkali metal. These have a single loose outer electron, so they react explosively with water. Sodium and potassium are the classic demos.', hint: 'Add Li, Na, K, Rb, Cs, or Fr.' },
            { id: 'add_transition',    cat: 'Atomic Diversity', icon: '🔩',  name: 'Tool Builder', desc: "You added a transition metal. These are the workhorses of industry — iron, copper, gold, titanium. They form bonds using d-orbital electrons.", hint: 'Add Fe, Cu, Au, Ti, Mn, or any d-block metal.' },
            { id: 'add_actinide',      cat: 'Atomic Diversity', icon: '☢️',  name: 'Glow in the Dark', desc: 'You added an actinide. Every actinide is radioactive. Uranium and plutonium power reactors and bombs; americium powers smoke detectors.', hint: 'Add U, Th, Pu, Am, or any actinide.' },

            // --- Chemistry ---
            { id: 'covalent_bond',     cat: 'Chemistry', icon: '🔗',  name: 'Covalent Connection', desc: 'A covalent bond formed. Covalent bonds share electrons between atoms — the bond that holds water, DNA, and every molecule of life together.', hint: 'Let two non-metal atoms meet.' },
            { id: 'ionic_pair',        cat: 'Chemistry', icon: '⚡',  name: 'Ionic Attraction', desc: "An ionic pair formed. Ionic bonds are attractions between positively and negatively charged ions — that's what 'salt' is.", hint: 'Create a metal + non-metal ion pair, like Na⁺ and Cl⁻.' },
            { id: 'made_water',        cat: 'Chemistry', icon: '💧',  name: 'The Universal Solvent', desc: "You made water. H₂O's bent geometry and hydrogen-bond network make it the most important solvent in chemistry.", hint: 'Add a Water molecule.' },
            { id: 'organic',           cat: 'Chemistry', icon: '🌿',  name: 'Spark of Life', desc: "You made an organic molecule — one with carbon. Carbon's four bonding sites let it build chains, rings, and every biomolecule.", hint: 'Make any molecule containing C (methane, ethanol, benzene…).' },
            { id: 'hydrogen_bond',     cat: 'Chemistry', icon: '💞',  name: 'Sticky Water', desc: "You witnessed hydrogen bonding. This weak but directional attraction is why water has surface tension, why ice floats, and why DNA's two strands hold together.", hint: 'Make 2+ waters with hydrogen bonding on.' },
            { id: 'radical',           cat: 'Chemistry', icon: '😤',  name: 'Loose Cannon (Radical)', desc: "You formed a radical — a species with an unpaired electron. Radicals are why ozone holes happen, why rust forms, and how your body ages.", hint: 'Form OH, NO, CH₃, or any open-shell fragment.' },

            // --- Nuclear physics ---
            { id: 'alpha_decay',       cat: 'Nuclear', icon: '🎯',  name: 'Alpha Decay', desc: 'You witnessed alpha decay — a nucleus spit out a helium-4 core. This is how uranium slowly becomes lead over billions of years.', hint: 'Enable Radioactive Decay and add a heavy nucleus.' },
            { id: 'beta_decay',        cat: 'Nuclear', icon: '📡',  name: 'Beta Decay', desc: "You witnessed beta decay — a neutron converted to a proton and emitted an electron. This is how carbon-14 dating works: C-14 → N-14 + β⁻.", hint: 'Enable Radioactive Decay and wait.' },
            { id: 'annihilation',      cat: 'Nuclear', icon: '💥',  name: 'Matter Meets Antimatter', desc: 'An electron and a positron annihilated, releasing gamma photons. This is how PET scans work — positrons annihilate inside your body and the gammas are detected.', hint: 'Add a positron, let it meet an electron.' },
            { id: 'fusion',            cat: 'Nuclear', icon: '⭐',  name: 'Star Fire', desc: "Two protons fused into a multi-nucleon cluster. This is how the sun works: hydrogen fusing into helium, releasing the energy that lights the universe.", hint: 'Put many protons near each other so they cluster.' },

            // --- Light & quantum ---
            { id: 'photon_absorbed',   cat: 'Light & Quantum', icon: '🎨',  name: 'Absorbed', desc: "An atom absorbed a photon. This is how atomic spectroscopy works — atoms absorb specific wavelengths matching their electron transitions.", hint: 'Shine a photon at an atom at the right wavelength.' },
            { id: 'photon_emitted',    cat: 'Light & Quantum', icon: '✨',  name: 'Emission Line', desc: "An excited atom relaxed and emitted a photon. Neon signs, sodium lamps, and stellar spectra all work this way.", hint: 'Wait for an excited atom to spontaneously emit.' },
            { id: 'double_slit_open',  cat: 'Light & Quantum', icon: '⚛️',  name: 'Wave-Particle Duality', desc: "You opened the double-slit demo. This is THE experiment that proves light is a wave AND a particle, simultaneously.", hint: 'Open the ⚛ Double-Slit panel.' },
            { id: 'double_slit_pts',   cat: 'Light & Quantum', icon: '🎲',  name: 'The Quantum Weirdness', desc: "You switched double-slit to particle-hit mode. Even one photon at a time, the interference pattern still emerges. Nobody knows why.", hint: 'In the Double-Slit panel, tap Particle hits.' },
            { id: 'auto_emit',         cat: 'Light & Quantum', icon: '🔆',  name: 'Steady Beam', desc: 'You turned on auto-emit. A continuous stream of photons is how lasers, flashlights, and stars behave.', hint: 'Check the Auto-emit box in the Add panel.' },

            // --- Explorer ---
            { id: 'open_graphs',       cat: 'Explorer', icon: '📊',  name: 'Data Dashboard', desc: "You opened the live graphs. Temperature, energy, molecule counts — all tracked over time.", hint: 'Click 📊 Graphs.' },
            { id: 'open_discoveries',  cat: 'Explorer', icon: '🔬',  name: 'Anomaly Hunter', desc: "You opened the Discoveries panel. This flags unusual, anomalous, or unrecognized molecules the sim produces.", hint: 'Click 🔬 Discoveries.' },
            { id: 'took_tour',         cat: 'Explorer', icon: '🎓',  name: 'Orientation', desc: "You took the guided tour. Now you know where the main features live.", hint: 'Click 🎓 Take the Tour or retake via Help.' },
            { id: 'change_temp',       cat: 'Explorer', icon: '🌡️',  name: 'Hot and Cold', desc: "You changed the simulation temperature. Temperature is molecular kinetic energy — higher = faster motion.", hint: 'Adjust the Temperature slider.' },
            { id: 'clear_scene',       cat: 'Explorer', icon: '🧹',  name: 'Tabula Rasa', desc: 'You cleared the scene. Sometimes the best experiment starts with an empty slate.', hint: 'Click the Clear button.' },
        ];

        const Achievements = (function() {
            const STORAGE_KEY = 'quantum_achievements_v1';
            let earned = {};  // id -> { time: ISO string }

            function _load() {
                try {
                    const raw = localStorage.getItem(STORAGE_KEY);
                    if (raw) earned = JSON.parse(raw) || {};
                } catch (_e) { earned = {}; }
            }
            function _save() {
                try { localStorage.setItem(STORAGE_KEY, JSON.stringify(earned)); } catch (_e) {}
            }

            function isEarned(id) { return !!earned[id]; }

            function _playDing() {
                // Short "ding" via Web Audio API — no asset file needed. Keeps
                // the sim self-contained. Muted if AudioContext isn't available.
                try {
                    const AudioCtx = window.AudioContext || window.webkitAudioContext;
                    if (!AudioCtx) return;
                    const ctx = new AudioCtx();
                    // Two-note arpeggio: C6 → G6, short and bright
                    const t0 = ctx.currentTime;
                    const notes = [ { f: 1046.5, t: 0 }, { f: 1568.0, t: 0.09 } ];
                    notes.forEach(n => {
                        const osc = ctx.createOscillator();
                        const gain = ctx.createGain();
                        osc.type = 'sine';
                        osc.frequency.value = n.f;
                        osc.connect(gain);
                        gain.connect(ctx.destination);
                        // Envelope: fast attack, ~180ms decay
                        gain.gain.setValueAtTime(0, t0 + n.t);
                        gain.gain.linearRampToValueAtTime(0.18, t0 + n.t + 0.008);
                        gain.gain.exponentialRampToValueAtTime(0.001, t0 + n.t + 0.22);
                        osc.start(t0 + n.t);
                        osc.stop(t0 + n.t + 0.25);
                    });
                    // Clean up the context after it's done
                    setTimeout(() => { try { ctx.close(); } catch (_e) {} }, 600);
                } catch (_e) { /* silent */ }
            }

            function _showToast(ach) {
                const stack = document.getElementById('achievementToastStack');
                if (!stack) return;
                const toast = document.createElement('div');
                toast.className = 'achievement-toast';
                toast.innerHTML = `
                    <div class="icon">${ach.icon}</div>
                    <div class="title-row">
                        <span>📓 Journal Entry</span>
                    </div>
                    <div class="name">${ach.name}</div>
                    <div class="desc">${ach.desc}</div>
                `;
                stack.appendChild(toast);
                // Force reflow so transition fires
                void toast.offsetWidth;
                toast.classList.add('show');
                // Auto-dismiss after 5s
                setTimeout(() => {
                    toast.classList.remove('show');
                    setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 400);
                }, 5000);
            }

            function unlock(id) {
                if (earned[id]) return false;
                const ach = ACHIEVEMENTS.find(a => a.id === id);
                if (!ach) return false;
                earned[id] = { time: new Date().toISOString() };
                _save();
                _playDing();
                _showToast(ach);
                refreshAchievementsPanel();
                return true;
            }

            // Public dispatch: call from anywhere in the code with an event
            // keyword and an optional payload. Pattern is intentionally loose
            // so we can add rules without touching the call sites.
            function notify(event, payload) {
                payload = payload || {};
                switch (event) {
                    case 'atom_added':
                        unlock('first_atom');
                        // Category-specific ones:
                        if (payload.symbol && typeof PERIODIC_CATEGORIES !== 'undefined') {
                            const cat = PERIODIC_CATEGORIES[payload.symbol];
                            if (cat === 'noble-gas')       unlock('add_noble_gas');
                            // Group 17 membership (astatine is categorized as a
                            // metalloid, but the hint lists it as a halogen)
                            if (cat === 'halogen' || HALOGENS_SET.has(payload.symbol)) unlock('add_halogen');
                            if (cat === 'alkali-metal')    unlock('add_alkali');
                            if (cat === 'transition-metal') unlock('add_transition');
                            if (cat === 'actinide')        unlock('add_actinide');
                        }
                        break;
                    case 'molecule_added':
                        unlock('first_molecule');
                        // Special cases by id:
                        if (payload.id === 'water' || payload.displayName === 'Water (H₂O)') {
                            unlock('made_water');
                        }
                        if (payload.composition && payload.composition.C) {
                            unlock('organic');
                        }
                        break;
                    case 'photon_fired':        unlock('first_photon'); break;
                    case 'photon_absorbed':     unlock('photon_absorbed'); break;
                    case 'photon_emitted':      unlock('photon_emitted'); break;
                    case 'glossary_opened':     unlock('open_glossary'); break;
                    case 'preset_loaded':       unlock('run_preset'); break;
                    case 'bond_formed':
                        if (payload.kind === 'covalent') unlock('covalent_bond');
                        if (payload.kind === 'ionic')    unlock('ionic_pair');
                        break;
                    case 'hydrogen_bond':       unlock('hydrogen_bond'); break;
                    case 'radical_formed':      unlock('radical'); break;
                    case 'alpha_decay':         unlock('alpha_decay'); break;
                    case 'beta_decay':          unlock('beta_decay'); break;
                    case 'annihilation':        unlock('annihilation'); break;
                    case 'fusion':              unlock('fusion'); break;
                    case 'double_slit_opened':  unlock('double_slit_open'); break;
                    case 'double_slit_particles': unlock('double_slit_pts'); break;
                    case 'auto_emit_on':        unlock('auto_emit'); break;
                    case 'graphs_opened':       unlock('open_graphs'); break;
                    case 'discoveries_opened':  unlock('open_discoveries'); break;
                    case 'tour_taken':          unlock('took_tour'); break;
                    case 'temp_changed':        unlock('change_temp'); break;
                    case 'scene_cleared':       unlock('clear_scene'); break;
                }
            }

            function resetAll() {
                earned = {};
                _save();
                refreshAchievementsPanel();
            }

            _load();

            return { notify, isEarned, resetAll, unlock, _earned: () => earned };
        })();

        function refreshAchievementsPanel() {
            const listEl = document.getElementById('achievementsList');
            if (!listEl) return;
            // Group by category
            const byCat = {};
            ACHIEVEMENTS.forEach(a => {
                if (!byCat[a.cat]) byCat[a.cat] = [];
                byCat[a.cat].push(a);
            });

            let html = '';
            let earnedCount = 0;
            const total = ACHIEVEMENTS.length;
            Object.keys(byCat).forEach(cat => {
                html += `<div class="ach-category"><div class="category-title">${cat}</div>`;
                byCat[cat].forEach(a => {
                    const unlocked = Achievements.isEarned(a.id);
                    if (unlocked) earnedCount++;
                    html += `
                        <div class="ach-row ${unlocked ? 'unlocked' : ''}">
                            <div class="ach-icon">${a.icon}</div>
                            <div>
                                <div class="ach-name">${a.name}</div>
                                <div class="ach-desc">${unlocked ? a.desc : '???'}</div>
                                ${!unlocked ? `<div class="ach-hint">Hint: ${a.hint}</div>` : ''}
                            </div>
                        </div>
                    `;
                });
                html += `</div>`;
            });
            listEl.innerHTML = html;

            // Progress bar
            const pct = total ? Math.round((earnedCount / total) * 100) : 0;
            const fill = document.getElementById('achievementsProgressFill');
            const lbl = document.getElementById('achievementsProgressLabel');
            if (fill) fill.style.width = pct + '%';
            if (lbl) lbl.textContent = `${earnedCount} / ${total} recorded (${pct}%)`;
        }

        function toggleAchievementsPanel() {
            const panel = document.getElementById('achievementsPanel');
            if (panel) panel.classList.toggle('open');
            refreshAchievementsPanel();
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', _initAchievementsUI);
        } else {
            _initAchievementsUI();
        }
        function _initAchievementsUI() {
            const toggleBtn = document.getElementById('toggleAchievementsBtn');
            const closeBtn  = document.getElementById('achievementsClose');
            const resetBtn  = document.getElementById('achievementsReset');
            if (toggleBtn) toggleBtn.addEventListener('click', toggleAchievementsPanel);
            if (closeBtn)  closeBtn.addEventListener('click', toggleAchievementsPanel);
            if (resetBtn) resetBtn.addEventListener('click', () => {
                if (confirm('Clear all journal entries? You can re-earn every entry by interacting with the sim.')) {
                    Achievements.resetAll();
                }
            });
            refreshAchievementsPanel();
        }

        // =====================================================================
        //  GUIDED LESSONS
        // =====================================================================
        // Data-driven scripted walkthroughs. Each lesson is an object with a
        // title, summary, difficulty, and an ordered list of steps. Each step
        // has title, body (HTML), an optional setup() action that runs on
        // entering, and an optional waitFor condition that gates the Continue
        // button until satisfied (e.g. wait for a bond to form).

        const LESSONS = [
            {
                id: 'building_atom',
                title: 'Building an Atom from Scratch',
                summary: 'Start with the three fundamental particles and watch an atom assemble itself.',
                difficulty: 'intro',
                steps: [
                    {
                        title: 'The three building blocks',
                        body: `<p>Every atom in the universe is made of just three kinds of particles:</p><ul><li><strong>Protons</strong> — positive charge, in the nucleus</li><li><strong>Neutrons</strong> — no charge, in the nucleus</li><li><strong>Electrons</strong> — negative charge, in a cloud around the nucleus</li></ul><p>Let's build hydrogen — the simplest atom — from scratch.</p>`,
                        setup: (api) => { api.clearScene(); api.setTemp(0.3); }
                    },
                    {
                        title: 'Adding a proton',
                        body: `<p>I've added a single proton (red). On its own, it's a bare hydrogen ion — <code>H⁺</code>. It's what acids release into water.</p><p>Now let's give it an electron.</p>`,
                        setup: (api) => { api.addParticle('proton'); }
                    },
                    {
                        title: 'The electron joins',
                        body: `<p>Give the electron a moment — it will be captured by the proton's positive charge and settle into orbit. That's <strong>neutral hydrogen</strong>, the simplest atom, which makes up 75% of all normal matter in the universe.</p>`,
                        setup: (api) => { api.addParticle('electron'); }
                    },
                    {
                        title: 'Adding a neutron (isotope)',
                        body: `<p>Adding a neutron doesn't change the element — it makes an <strong>isotope</strong>. One proton = hydrogen, regardless of neutron count. Hydrogen has three natural isotopes:</p><ul><li>H (1p, 0n) — regular hydrogen</li><li>D or ²H (1p, 1n) — deuterium, heavy hydrogen</li><li>T or ³H (1p, 2n) — tritium, radioactive</li></ul>`,
                        setup: (api) => { api.addParticle('neutron'); }
                    },
                    {
                        title: 'That\'s an atom',
                        body: `<p>You've built hydrogen from first principles. From here: more protons → heavier elements. More/fewer electrons → ions. All chemistry comes from rearranging these three particle types.</p>`
                    }
                ]
            },
            {
                id: 'first_molecule',
                title: 'Making Your First Molecule',
                summary: 'Watch two hydrogens pair into H₂, then see water pre-assembled with its famous bent geometry.',
                difficulty: 'intro',
                steps: [
                    {
                        title: 'Two lonely hydrogens',
                        body: `<p>Two H atoms in empty space. Each would be more stable sharing electrons with a partner. Watch when they drift close.</p>`,
                        setup: (api) => { api.clearScene(); api.setTemp(0.2); api.addAtom('H'); api.addAtom('H'); }
                    },
                    {
                        title: 'H₂ forms',
                        body: `<p>A <strong>covalent bond</strong> formed — the two hydrogens are now sharing electrons. Each "sees" 2 electrons instead of 1, which feels like having a full outer shell (very stable). This same pattern is behind every covalent bond in every organic molecule on Earth.</p>`,
                        waitFor: 'event:bond_formed'
                    },
                    {
                        title: 'Water — the bent molecule',
                        body: `<p>Now watch water, pre-assembled. Its two H atoms form a ~<strong>104.5° bent angle</strong> around the central O. That bend is why water is polar, why it dissolves salt, and why ice floats.</p>`,
                        setup: (api) => { api.clearScene(); api.addMolecule('water'); api.setTemp(0.15); }
                    },
                    {
                        title: 'Watch it vibrate',
                        body: `<p>O-H bonds are springs, not rigid rods. At any non-zero temperature the molecule vibrates. That vibration is <em>thermal energy</em> — what we feel as heat. Crank the Target Temp high enough and the bonds break.</p>`
                    }
                ]
            },
            {
                id: 'states_of_matter',
                title: 'The States of Matter',
                summary: 'Take the same molecules and watch them shift between solid, liquid, gas, and plasma as temperature changes.',
                difficulty: 'intro',
                steps: [
                    {
                        title: 'Cold — close and slow',
                        body: `<p>12 water molecules at very low temperature. They cluster, moving slowly. Particles held in place by intermolecular forces — this is the solid/liquid regime.</p>`,
                        setup: (api) => { api.clearScene(); api.setTemp(0.05); for (let i = 0; i < 12; i++) api.addMolecule('water'); }
                    },
                    {
                        title: 'Warmer — liquid',
                        body: `<p>Higher temperature. Molecules move faster, stay close but flow around each other. This is the <strong>liquid</strong> phase — H-bonds constantly forming and breaking on picosecond timescales.</p>`,
                        setup: (api) => { api.setTemp(0.5); }
                    },
                    {
                        title: 'Hot — gas',
                        body: `<p>Now the molecules have enough kinetic energy to escape each other entirely. They fly in straight lines until they collide. That's <strong>gas</strong>. Particles fill all available space.</p>`,
                        setup: (api) => { api.setTemp(3.5); }
                    },
                    {
                        title: 'Extremely hot — plasma',
                        body: `<p>At high enough temperatures, molecular bonds break and eventually electrons are stripped from atoms. That's <strong>plasma</strong> — the fourth state of matter. Stars, lightning, fusion reactors.</p>`,
                        setup: (api) => { api.setTemp(8.0); }
                    }
                ]
            },
            {
                id: 'ionic_vs_covalent',
                title: 'Ionic vs Covalent Bonding',
                summary: 'NaCl vs H₂O — two bond types with completely different behavior.',
                difficulty: 'medium',
                steps: [
                    {
                        title: 'Two ways to bond',
                        body: `<p>Atoms bond in two main ways:</p><ul><li><strong>Ionic</strong>: one atom gives an electron to another. Ions attract via Coulomb force. (Na⁺ + Cl⁻ = NaCl)</li><li><strong>Covalent</strong>: atoms <em>share</em> electrons equally. (H-O-H)</li></ul><p>The difference comes down to electronegativity — how badly each atom wants the electron.</p>`,
                        setup: (api) => { api.clearScene(); api.setTemp(0.2); }
                    },
                    {
                        title: 'Na⁺ meets Cl⁻',
                        body: `<p>Sodium cation and chloride anion in the scene. Electron transfer has already happened in our cartoon — Na missing one, Cl has an extra. Watch them pair up.</p>`,
                        setup: (api) => { api.addIon('Na', 1); api.addIon('Cl', -1); },
                        waitFor: 'event:bond_formed'
                    },
                    {
                        title: 'Ionic pair formed',
                        body: `<p>Na⁺ and Cl⁻ snap together. In real NaCl crystals this pattern extends — each Na⁺ surrounded by 6 Cl⁻ in a cubic lattice. That's why salt grains are cubic. Dissolve in water and the ions separate again.</p>`
                    },
                    {
                        title: 'Now compare to covalent',
                        body: `<p>I've added water alongside. Compare:</p><ul><li>NaCl: 2 atoms, electrons transferred, held by electrostatic attraction</li><li>H₂O: 3 atoms, electrons shared</li></ul><p>Both are "bonds" but behave very differently. Ionic compounds dissociate in water; covalent ones generally don't.</p>`,
                        setup: (api) => { api.addMolecule('water'); }
                    }
                ]
            },
            {
                id: 'brownian_motion',
                title: 'Brownian Motion',
                summary: 'The random jitter of atoms that proved atoms exist. Einstein won his Nobel partly for this.',
                difficulty: 'medium',
                steps: [
                    {
                        title: 'A famous observation',
                        body: `<p>1827: Robert Brown looked at pollen grains in water under a microscope. They jittered randomly. 80 years later Einstein worked out why: the pollen was being kicked by <em>water molecules</em> Brown couldn't see. One of the strongest proofs that matter is made of atoms.</p>`,
                        setup: (api) => { api.clearScene(); api.setTemp(1.2); }
                    },
                    {
                        title: 'A cloud of argon',
                        body: `<p>I've filled the scene with argon — noble gas, moves freely without bonding. Turn on motion trails in the Display panel to see paths. Pick any atom and watch — constantly kicked by neighbors, producing a "random walk."</p>`,
                        setup: (api) => { for (let i = 0; i < 30; i++) api.addAtom('Ar'); }
                    },
                    {
                        title: 'The math',
                        body: `<p>Einstein proved: for Brownian motion, average squared displacement grows <strong>linearly with time</strong>: <code>&lt;x²&gt; = 6Dt</code> in 3D. The coefficient D is the diffusion constant. This is why smells spread, why dye diffuses in water, why a sugar cube sweetens coffee without stirring.</p>`
                    }
                ]
            },
            {
                id: 'hydrogen_bonding',
                title: 'Hydrogen Bonding (Why Ice Floats)',
                summary: 'The weak, directional force between water molecules that shapes ice, proteins, and DNA.',
                difficulty: 'medium',
                steps: [
                    {
                        title: 'Water\'s quiet superpower',
                        body: `<p>Water boils at 100°C. Methane — similar size — boils at −161°C. Why the huge difference?</p><p><strong>Hydrogen bonds</strong>. Each water molecule's H atoms are slightly positive, each O's lone pairs slightly negative. So every water molecule lightly sticks to its neighbors. ~10× weaker than covalent bonds, but there are a lot of them.</p>`,
                        setup: (api) => { api.clearScene(); api.setTemp(0.08); }
                    },
                    {
                        title: 'Water molecules clustering',
                        body: `<p>10 waters at cold temperature. Each H points at a neighboring O's lone-pair region, forming a <strong>tetrahedral network</strong>. Make sure Hydrogen Bonding is enabled in the Realism panel.</p>`,
                        setup: (api) => { for (let i = 0; i < 10; i++) api.addMolecule('water'); }
                    },
                    {
                        title: 'Why ice floats',
                        body: `<p>When water freezes, the H-bond network locks into a rigid hexagonal lattice — with <em>lots of empty space</em>. Molecules are farther apart than in liquid water. Ice is LESS dense than water → floats. Lakes freeze top-down, protecting fish. Life evolved around this fact.</p>`
                    }
                ]
            },
            {
                id: 'radioactive_decay',
                title: 'Radioactive Decay',
                summary: 'Watch unstable nuclei fall apart — the basis of all radiometric dating.',
                difficulty: 'medium',
                steps: [
                    {
                        title: 'Not all nuclei are stable',
                        body: `<p>The strong nuclear force holds nuclei together, but only up to a point. Nuclei with bad proton/neutron ratios are <strong>unstable</strong> and decay:</p><ul><li><strong>Alpha</strong>: emits He-4 nucleus</li><li><strong>Beta⁻</strong>: neutron → proton + electron</li><li><strong>Beta⁺</strong>: proton → neutron + positron</li></ul>`,
                        setup: (api) => { api.clearScene(); api.enableDecay(); }
                    },
                    {
                        title: 'Uranium decays',
                        body: `<p>Uranium (Z=92), one of the heaviest near-stable elements. Real half-life: billions of years. Our cartoon speeds it up. Watch — U will emit an alpha particle and become thorium. This is how uranium dating measures the age of rocks.</p>`,
                        setup: (api) => { api.addAtom('U'); },
                        waitFor: 'event:alpha_decay'
                    },
                    {
                        title: 'Beta decay — carbon dating',
                        body: `<p>Carbon with extra neutrons (<code>¹⁴C</code>) undergoes beta decay: neutron → proton + electron. Result: C-14 → N-14. This is the basis of <strong>carbon-14 dating</strong>, used in archaeology up to ~50,000 years.</p>`,
                        // C-14 = default C-12 plus 2 neutrons (this passed 8, which
                        // would have made C-20)
                        setup: (api) => { api.clearScene(); api.enableDecay(); api.addAtom('C', 2); },
                        waitFor: 'event:beta_decay'
                    }
                ]
            },
            {
                id: 'noble_gas',
                title: 'Why Noble Gases Don\'t React',
                summary: 'The most boring column of the periodic table — and why we use them for balloons and MRIs.',
                difficulty: 'medium',
                steps: [
                    {
                        title: 'The lonely column',
                        body: `<p>The far right column — He, Ne, Ar, Kr, Xe, Rn — has full outer electron shells. Nothing to gain by bonding. Result: they don't react. Helium gas stays helium gas forever.</p>`,
                        setup: (api) => { api.clearScene(); api.setTemp(0.5); }
                    },
                    {
                        title: 'He refuses to react',
                        body: `<p>Helium atoms among hydrogens. H atoms will pair up into H₂ quickly. He atoms will drift through unchanged — no bonds, no reactions, just bouncing.</p>`,
                        setup: (api) => { for (let i = 0; i < 6; i++) api.addAtom('He'); for (let i = 0; i < 6; i++) api.addAtom('H'); }
                    },
                    {
                        title: 'The rare exceptions',
                        body: `<p>Under extreme conditions a few noble-gas compounds DO exist: <strong>XeF₂, XeF₄, XeF₆</strong> (Xe fluorides); <strong>KrF₂</strong>; <strong>ArH⁺</strong> (found in the Crab Nebula); <strong>HeH⁺</strong> (believed to be the first molecule ever formed in the universe). Otherwise, noble gases stay noble.</p>`
                    }
                ]
            },
            {
                id: 'annihilation',
                title: 'Matter Meets Antimatter',
                summary: 'Electrons and positrons destroy each other in a burst of light. This is how PET scans work.',
                difficulty: 'advanced',
                steps: [
                    {
                        title: 'Every particle has an anti-',
                        body: `<p>For every particle there's an <strong>antiparticle</strong> — same mass, opposite charge. The electron's antiparticle is the <strong>positron</strong>. When they meet, both vanish and their mass becomes energy: E = mc². The energy emerges as light.</p>`,
                        setup: (api) => { api.clearScene(); api.setTemp(0.2); }
                    },
                    {
                        title: 'Annihilation event',
                        body: `<p>Electrons and positrons in the scene. When one meets one, flash: both gone, two gamma photons flying in opposite directions. Real gammas are 511 keV; our cartoon shows them as bright white flashes.</p>`,
                        setup: (api) => { for (let i = 0; i < 4; i++) api.addParticle('electron'); for (let i = 0; i < 4; i++) api.addParticle('positron'); },
                        waitFor: 'event:annihilation'
                    },
                    {
                        title: 'PET scans',
                        body: `<p>Medical PET scans use this exact reaction. Patient gets a positron-emitting tracer. Positrons annihilate inside tissue, producing pairs of gammas flying exactly opposite. Detectors around the patient catch both, triangulate the origin. Reconstruct the metabolism map → see the tumor.</p>`
                    }
                ]
            },
            {
                id: 'absorption_emission',
                title: 'Atomic Absorption & Emission',
                summary: 'Atoms absorb only specific colors — which is how we know what stars are made of.',
                difficulty: 'advanced',
                steps: [
                    {
                        title: 'Electron ladders',
                        body: `<p>The quantum weirdness: electrons in atoms can only exist at specific energy levels, like steps on a ladder. To move up, an electron must absorb EXACTLY the right amount of energy — matching the gap — from a photon of the right wavelength.</p>`,
                        setup: (api) => { api.clearScene(); api.setTemp(0.1); }
                    },
                    {
                        title: 'Shine light at hydrogen',
                        body: `<p>Hydrogen atoms in the scene. Ground-state hydrogen only absorbs <strong>ultraviolet</strong>, so I've tuned the light to <strong>122 nm</strong>: hydrogen's Lyman-alpha line. Press <strong>Shine Light</strong> (or tick Auto-emit) and watch for an atom to absorb, glow, and a moment later re-emit at the same wavelength in a random direction.</p><p>Then try 532 nm green: it sails straight through, because no hydrogen transition matches it.</p>`,
                        setup: (api) => { for (let i = 0; i < 8; i++) api.addAtom('H'); api.setShineWavelength(122); },
                        waitFor: 'event:photon_absorbed'
                    },
                    {
                        title: 'How we see stars',
                        body: `<p>Shine sunlight through a prism: a rainbow with thin <em>dark lines</em> at specific wavelengths. Those are <strong>Fraunhofer lines</strong> — colors absorbed by atoms in the sun's atmosphere. Match them to known spectra → know what the sun is made of. This technique, <strong>spectroscopy</strong>, is how we know the composition of every star and galaxy.</p>`
                    }
                ]
            },
            {
                id: 'double_slit',
                title: 'The Double-Slit Experiment',
                summary: 'The experiment that proves light is both wave and particle. The weirdest result in physics.',
                difficulty: 'advanced',
                steps: [
                    {
                        title: 'The most famous experiment',
                        body: `<p>Light source, barrier with two slits, screen behind. If light is a <strong>wave</strong> → interference pattern (alternating bright/dark bands). If light is a <strong>particle</strong> → two bright spots. What actually happens? Both.</p>`,
                        setup: (api) => { api.clearScene(); }
                    },
                    {
                        title: 'Open the demo',
                        body: `<p>Click <strong>⚛ Double-Slit</strong> in the Display section. A wave-optics demo panel opens. Try:</p><ul><li>Both slits — full interference pattern</li><li>One slit — fringes disappear</li><li>Particle hits — dots accumulate but still form the pattern</li></ul><p>Drag the wavelength slider and watch fringe spacing change.</p>`
                    },
                    {
                        title: 'The real weirdness',
                        body: `<p>In the real experiment, send photons ONE AT A TIME — they still build up the interference pattern. A single photon seems to go through BOTH slits and interfere with itself. If you put detectors at the slits, interference vanishes. The measurement changes the outcome. Feynman: "Nobody understands quantum mechanics."</p>`
                    }
                ]
            },
            {
                id: 'fusion',
                title: 'How Stars Burn — Fusion',
                summary: 'Protons crashing into helium, with some mass becoming energy. What powers every star.',
                difficulty: 'advanced',
                steps: [
                    {
                        title: 'At the center of a star',
                        body: `<p>The sun outputs 3.8 × 10²⁶ watts — has for 4.5 billion years. How? <strong>Fusion</strong>. Four protons combine into one He-4 nucleus. The He weighs slightly less than the protons did. Missing mass comes out as energy: E = mc². Requires 15 million degrees.</p>`,
                        setup: (api) => { api.clearScene(); api.setTemp(0.2); }
                    },
                    {
                        title: 'Protons fusing',
                        body: `<p>Many protons stuffed together, and the temperature cranked way up, like a tiny star core. Protons repel each other, so only fast collisions get close enough for the strong nuclear force to grab them. Watch for two to fuse into a 2-proton cluster.</p>`,
                        // Hot: at the lesson's starting 0.2 the protons could never
                        // get over their Coulomb barrier, so this step never finished.
                        setup: (api) => { api.setTemp(8.0); for (let i = 0; i < 30; i++) api.addParticle('proton'); },
                        waitFor: 'event:fusion'
                    },
                    {
                        title: 'Fusion on Earth',
                        body: `<p>Fusion would solve energy — no carbon, fuel is seawater. Problem: containing 150-million-degree plasma long enough for net energy gain. December 2022, NIF achieved "ignition" for the first time. Commercial fusion still decades out. Meanwhile the sun does it for free — every second of sunlight is proton fusion 8 minutes ago.</p>`
                    }
                ]
            }
        ];

        const LessonEngine = (function() {
            let currentLesson = null;
            let currentStepIdx = 0;
            let waitConditionMet = false;
            let waitHandler = null;

            const api = {
                clearScene: () => { if (typeof clearParticles === 'function') clearParticles(); },
                setTemp: (t) => {
                    targetTemperature = t;
                    const slider = select('#tempSlider');
                    if (slider) slider.value(t);
                    const span = select('#tempValue');
                    if (span) span.html(t.toFixed(1));
                },
                // Lessons pass element symbols ('H', 'Na'). These used to be
                // lower-cased and looked up directly ('h', 'na'), which matched
                // nothing in atomConfigs, so every lesson step that added an atom
                // or ion added nothing (and waits such as "a bond to form" could
                // never finish). extraN is a neutron offset from the default isotope.
                addAtom: (elementSymbol, extraN) => {
                    const type = resolveAtomType(elementSymbol);
                    if (!type) { logEvent(`Lesson error: unknown element "${elementSymbol}"`, 'other'); return; }
                    addAtom(type, typeof extraN === 'number' ? extraN : 0);
                },
                addParticle: (type) => { if (typeof addParticle === 'function') addParticle(type, true); },
                addMolecule: (key) => { if (typeof addMolecule === 'function') addMolecule(key); },
                addIon: (symbol, charge) => {
                    const type = resolveAtomType(symbol);
                    if (!type) { logEvent(`Lesson error: unknown element "${symbol}"`, 'other'); return; }
                    addIon(type, charge);
                },
                setShineWavelength: (nm) => {
                    const slider = document.getElementById('shineWavelength');
                    if (!slider) return;
                    slider.value = nm;
                    slider.dispatchEvent(new Event('input'));
                },
                enableDecay: () => {
                    useNuclearDecay = true;
                    const cb = document.getElementById('nuclearDecayCheckbox');
                    if (cb) cb.checked = true;
                }
            };

            function prettyEventLabel(evName) {
                const labels = {
                    'bond_formed': 'a bond to form',
                    'alpha_decay': 'alpha decay',
                    'beta_decay': 'beta decay',
                    'annihilation': 'electron/positron annihilation',
                    'fusion': 'a fusion event',
                    'photon_absorbed': 'photon absorption',
                    'photon_emitted': 'photon emission',
                    'hydrogen_bond': 'hydrogen bonding'
                };
                return labels[evName] || evName;
            }

            function installWaitHandler(condition, waitEl, nextBtn) {
                if (waitHandler && waitHandler.cleanup) waitHandler.cleanup();
                waitHandler = null;
                if (condition.startsWith('event:')) {
                    const eventName = condition.slice(6);
                    waitEl.innerHTML = `⏳ <em>Waiting for: ${prettyEventLabel(eventName)}</em>`;
                    nextBtn.disabled = true;
                    const origNotify = Achievements.notify;
                    const wrapped = function(evName, payload) {
                        try { origNotify.call(Achievements, evName, payload); } catch(_e){}
                        if (evName === eventName && !waitConditionMet) {
                            waitConditionMet = true;
                            waitEl.innerHTML = `✓ <strong>${prettyEventLabel(eventName)}</strong> happened! You can continue.`;
                            waitEl.classList.add('met');
                            nextBtn.disabled = false;
                        }
                    };
                    Achievements.notify = wrapped;
                    waitHandler = { cleanup: () => { Achievements.notify = origNotify; } };
                }
            }

            function renderStep() {
                if (!currentLesson) return;
                const step = currentLesson.steps[currentStepIdx];
                if (!step) { exit(); return; }

                const headerEl = document.getElementById('lessonHeaderTitle');
                headerEl.innerHTML = `<span>🎯 ${currentLesson.title}</span><button class="closeBtn" id="lessonPanelClose">×</button>`;
                const x = document.getElementById('lessonPanelClose');
                if (x) x.addEventListener('click', exit);

                const total = currentLesson.steps.length;
                document.getElementById('lessonStepNum').textContent = `Step ${currentStepIdx + 1} of ${total}`;
                document.getElementById('lessonStepTitle').textContent = step.title;
                document.getElementById('lessonStepBody').innerHTML = step.body;
                document.getElementById('lessonProgressFill').style.width = ((currentStepIdx + 1) / total * 100) + '%';

                const prevBtn = document.getElementById('lessonBtnPrev');
                const nextBtn = document.getElementById('lessonBtnNext');
                prevBtn.disabled = (currentStepIdx === 0);
                nextBtn.textContent = (currentStepIdx === total - 1) ? 'Finish' : 'Continue →';

                if (typeof step.setup === 'function') {
                    try { step.setup(api); } catch (e) { console.error('Lesson setup error:', e); }
                }

                const waitEl = document.getElementById('lessonWaiting');
                if (step.waitFor) {
                    waitConditionMet = false;
                    waitEl.style.display = 'block';
                    waitEl.classList.remove('met');
                    installWaitHandler(step.waitFor, waitEl, nextBtn);
                } else {
                    waitEl.style.display = 'none';
                    waitConditionMet = true;
                    nextBtn.disabled = false;
                }
            }

            function start(lessonId) {
                const lesson = LESSONS.find(l => l.id === lessonId);
                if (!lesson) return;
                currentLesson = lesson;
                currentStepIdx = 0;
                document.getElementById('lessonsListPanel').classList.remove('open');
                document.getElementById('lessonPanel').classList.add('open');
                renderStep();
            }

            function next() {
                if (!currentLesson || !waitConditionMet) return;
                if (currentStepIdx >= currentLesson.steps.length - 1) { exit(); return; }
                currentStepIdx++;
                renderStep();
            }

            function prev() {
                if (!currentLesson || currentStepIdx === 0) return;
                currentStepIdx--;
                renderStep();
            }

            function exit() {
                if (waitHandler && waitHandler.cleanup) waitHandler.cleanup();
                waitHandler = null;
                currentLesson = null;
                currentStepIdx = 0;
                document.getElementById('lessonPanel').classList.remove('open');
            }

            return { start, next, prev, exit };
        })();

        function refreshLessonsList() {
            const container = document.getElementById('lessonsListContainer');
            if (!container) return;
            container.innerHTML = LESSONS.map(l => `
                <button class="lesson-btn" data-lesson-id="${l.id}">
                    <div class="lesson-title">
                        <span class="lesson-difficulty lesson-difficulty-${l.difficulty}">${l.difficulty}</span>
                        ${l.title}
                    </div>
                    <div class="lesson-summary">${l.summary}</div>
                </button>
            `).join('');
            container.querySelectorAll('.lesson-btn').forEach(btn => {
                btn.addEventListener('click', () => LessonEngine.start(btn.getAttribute('data-lesson-id')));
            });
        }

        function toggleLessonsList() {
            const panel = document.getElementById('lessonsListPanel');
            if (!panel) return;
            panel.classList.toggle('open');
            if (panel.classList.contains('open')) refreshLessonsList();
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', _initLessonsUI);
        } else {
            _initLessonsUI();
        }
        function _initLessonsUI() {
            const openBtn = document.getElementById('lessonsBtn');
            const closeListBtn = document.getElementById('lessonsListClose');
            const nextBtn = document.getElementById('lessonBtnNext');
            const prevBtn = document.getElementById('lessonBtnPrev');
            const exitBtn = document.getElementById('lessonBtnExit');
            if (openBtn) openBtn.addEventListener('click', toggleLessonsList);
            if (closeListBtn) closeListBtn.addEventListener('click', toggleLessonsList);
            if (nextBtn) nextBtn.addEventListener('click', () => LessonEngine.next());
            if (prevBtn) prevBtn.addEventListener('click', () => LessonEngine.prev());
            if (exitBtn) exitBtn.addEventListener('click', () => LessonEngine.exit());
        }

        // This handles three source formats:
        //   - entity list li with data-entity-key  (e.g. "Electron", "H", "Fe+2", "H2O", "NaCl")
        //   - 3D floating label text              (e.g. "H", "Fe²⁺", "e⁻", "p⁺", "n", "H2O")
        // Returns { title, formula, alsoKnown, description, facts } or null.
        function lookupEntityInfo(rawKey) {
            if (!rawKey) return null;
            const key = String(rawKey).trim();

            // Direct particle matches — from entity list (capitalized) or from glyphs.
            const particleAliases = {
                'Electron': 'electron', 'electron': 'electron', 'e⁻': 'electron', 'e-': 'electron',
                'Proton':   'proton',   'proton':   'proton',   'p⁺': 'proton',   'p+': 'proton',
                'Neutron':  'neutron',  'neutron':  'neutron',  'n':  'neutron',
                'Positron': 'positron', 'positron': 'positron', 'e⁺': 'positron', 'e+': 'positron'
            };
            if (particleAliases[key]) {
                const pi = particleInfo[particleAliases[key]];
                return {
                    title: pi.name, formula: pi.formula,
                    alsoKnown: pi.alsoKnown, description: pi.description, facts: pi.facts
                };
            }

            // Molecule label — try the raw key (sim-style Hill formula like
            // "H2O", "CO2", "ClNa") first, then fall back to a chemist-friendly
            // alias ("NaCl", "NH3", "SO2" …) via the alias map.
            let molKey = null;
            if (moleculeInfo[key]) molKey = key;
            else if (moleculeAliases[key] && moleculeInfo[moleculeAliases[key]]) molKey = moleculeAliases[key];
            if (molKey) {
                const m = moleculeInfo[molKey];
                return {
                    title: m.name, formula: m.formula,
                    alsoKnown: m.alsoKnown, description: m.description, facts: m.facts
                };
            }

            // Strip charge suffix for ion / nucleus lookup. We accept both
            // the sim's native format (⁺/⁻ superscripts, normal digits — e.g.
            // "Fe⁺2", "Al⁻3") and fully-superscripted forms (Fe²⁺, Al³⁺),
            // plus ASCII variants ("Fe+2", "Cl-1").
            // Note: Unicode superscript digits 1/2/3 (¹²³) live in the Latin-1
            // Supplement block (U+00B9, U+00B2, U+00B3), NOT in the Superscripts
            // block at U+2070. We list them explicitly.
            const superToNum = {
                '⁰':'0','¹':'1','²':'2','³':'3','⁴':'4','⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9',
                '⁺':'+','⁻':'-'
            };
            let cleaned = key.replace(/[\u2070-\u2079\u207A\u207B\u00B9\u00B2\u00B3]/g, ch => superToNum[ch] || ch);
            // Extract charge like "+2", "-1", "+", "-"
            let charge = 0;
            const m1 = cleaned.match(/^([A-Za-z]+)(?:(\d*)([+-])|([+-])(\d*))?$/);
            if (m1) {
                const sym = m1[1];
                if (m1[2] !== undefined && m1[3]) {
                    const n = m1[2] ? parseInt(m1[2], 10) : 1;
                    charge = (m1[3] === '+' ? 1 : -1) * n;
                    cleaned = sym;
                } else if (m1[4]) {
                    const n = m1[5] ? parseInt(m1[5], 10) : 1;
                    charge = (m1[4] === '+' ? 1 : -1) * n;
                    cleaned = sym;
                } else {
                    cleaned = sym;
                }
            }
            // Now try element symbol lookup. Normalize capitalization: first
            // letter upper, rest lower (matches periodic-table convention).
            const sym = cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
            if (elementInfo[sym]) {
                const el = elementInfo[sym];
                let chargeLabel = '';
                if (charge > 0) chargeLabel = charge === 1 ? '⁺' : `${charge}⁺`;
                else if (charge < 0) chargeLabel = charge === -1 ? '⁻' : `${-charge}⁻`;
                const titleSuffix = charge === 0 ? '' : ` ion (${sym}${chargeLabel})`;
                const ionNote = charge === 0
                    ? ''
                    : (charge > 0
                        ? ` In this view the atom is a <strong>cation</strong> (${sym}${chargeLabel}) — it has lost ${Math.abs(charge)} electron${Math.abs(charge) > 1 ? 's' : ''} and carries a net charge of ${charge > 0 ? '+' : ''}${charge}.`
                        : ` In this view the atom is an <strong>anion</strong> (${sym}${chargeLabel}) — it has gained ${Math.abs(charge)} electron${Math.abs(charge) > 1 ? 's' : ''} and carries a net charge of ${charge}.`);
                return {
                    title: el.name + titleSuffix,
                    formula: sym + chargeLabel,
                    alsoKnown: `Symbol ${sym}` + (chargeLabel ? `  ·  ${sym}${chargeLabel}` : ''),
                    description: el.summary + ionNote,
                    facts: [
                        ['Symbol', sym],
                        ['Etymology', el.etymology],
                        ...(charge !== 0 ? [['Net charge', (charge > 0 ? '+' : '') + charge]] : [])
                    ]
                };
            }
            return null;
        }

        // Build the inner HTML for the modal from a lookup result.
        function renderEntityInfo(info) {
            if (!info) return '<p>No information available for this entity.</p>';
            let html = '';
            if (info.alsoKnown) {
                html += `<p class="alsoKnown">Also known as: ${info.alsoKnown}</p>`;
            }
            html += `<p>${info.description}</p>`;
            if (info.facts && info.facts.length > 0) {
                html += '<h4>Quick facts</h4><div class="factGrid">';
                for (const [k, v] of info.facts) {
                    html += `<div class="k">${k}</div><div class="v">${v}</div>`;
                }
                html += '</div>';
            }
            return html;
        }

        function openInfoModal(rawKey) {
            const info = lookupEntityInfo(rawKey);
            const bd = document.getElementById('infoModalBackdrop');
            const titleEl = document.getElementById('infoModalTitle');
            const formulaEl = document.getElementById('infoModalFormula');
            const bodyEl = document.getElementById('infoBody');
            if (!bd || !titleEl || !bodyEl) return;
            // Replace the title text node while preserving the <span class="formula">.
            if (!info) {
                titleEl.firstChild.nodeValue = String(rawKey);
                if (formulaEl) formulaEl.textContent = '';
                bodyEl.innerHTML = `<p>No information on file for <strong>${rawKey}</strong> yet.</p>`;
            } else {
                titleEl.firstChild.nodeValue = info.title + ' ';
                if (formulaEl) formulaEl.textContent = info.formula ? `(${info.formula})` : '';
                bodyEl.innerHTML = renderEntityInfo(info);
            }
            bd.classList.add('open');
            bd.setAttribute('aria-hidden', 'false');
            bodyEl.scrollTop = 0;
        }

        function closeInfoModal() {
            const bd = document.getElementById('infoModalBackdrop');
            if (!bd) return;
            bd.classList.remove('open');
            bd.setAttribute('aria-hidden', 'true');
        }

        function initInfoModal() {
            const bd = document.getElementById('infoModalBackdrop');
            const closeX = document.getElementById('infoCloseX');
            const closeBtn = document.getElementById('infoCloseBtn');
            if (closeX) closeX.addEventListener('click', closeInfoModal);
            if (closeBtn) closeBtn.addEventListener('click', closeInfoModal);
            // Click outside the modal card closes it
            if (bd) bd.addEventListener('click', (e) => {
                if (e.target === bd) closeInfoModal();
            });
            // Escape key closes (only if this modal is the one open)
            document.addEventListener('keydown', (e) => {
                if (bd && bd.classList.contains('open') && e.key === 'Escape') {
                    closeInfoModal();
                    e.preventDefault();
                }
            });

            // Entity list clicks (event delegation — the list re-renders often)
            const entityListEl = document.getElementById('entityList');
            if (entityListEl) {
                entityListEl.addEventListener('click', (e) => {
                    const li = e.target && e.target.closest
                        ? e.target.closest('li[data-entity-key]') : null;
                    if (!li) return;
                    const raw = li.getAttribute('data-entity-key');
                    if (!raw) return;
                    openInfoModal(raw);
                });
            }

            // 3D floating label clicks. Delegated on #labelLayer —
            // the label pool mutates on every frame.
            const labelLayer = document.getElementById('labelLayer');
            if (labelLayer) {
                labelLayer.addEventListener('click', (e) => {
                    const t = e.target;
                    if (!t || !t.classList || !t.classList.contains('floatLabel')) return;
                    const text = (t.textContent || '').trim();
                    if (!text) return;
                    e.stopPropagation();
                    openInfoModal(text);
                });
            }
        }

        // =================================================================
        //  COMPREHENSIVE GLOSSARY
        // =================================================================
        // Full searchable / filterable / categorized reference to every
        // particle, element, and molecule known to the simulator. Opens
        // from the 📖 Glossary button in the top bar.

        // Periodic-table group metadata. Maps element symbol → category string.
        // Used for the "Metals / Nonmetals / Noble gases / Metalloids" filter
        // chips in the glossary.
        const PERIODIC_CATEGORIES = (() => {
            const m = {};
            // Alkali metals
            ['Li','Na','K','Rb','Cs','Fr'].forEach(s => m[s] = 'alkali-metal');
            // Alkaline earth
            ['Be','Mg','Ca','Sr','Ba','Ra'].forEach(s => m[s] = 'alkaline-earth');
            // Transition metals (3d, 4d, 5d, 6d — d-block)
            ['Sc','Ti','V','Cr','Mn','Fe','Co','Ni','Cu','Zn',
             'Y','Zr','Nb','Mo','Tc','Ru','Rh','Pd','Ag','Cd',
             'Hf','Ta','W','Re','Os','Ir','Pt','Au','Hg',
             'Rf','Db','Sg','Bh','Hs','Mt','Ds','Rg','Cn'].forEach(s => m[s] = 'transition-metal');
            // Post-transition (poor) metals
            ['Al','Ga','In','Sn','Tl','Pb','Bi','Po',
             'Nh','Fl','Mc','Lv'].forEach(s => m[s] = 'post-transition-metal');
            // Metalloids
            ['B','Si','Ge','As','Sb','Te','At'].forEach(s => m[s] = 'metalloid');
            // Reactive nonmetals
            ['H','C','N','O','P','S','Se'].forEach(s => m[s] = 'nonmetal');
            // Halogens
            ['F','Cl','Br','I','Ts'].forEach(s => m[s] = 'halogen');
            // Noble gases
            ['He','Ne','Ar','Kr','Xe','Rn','Og'].forEach(s => m[s] = 'noble-gas');
            // Lanthanides
            ['La','Ce','Pr','Nd','Pm','Sm','Eu','Gd','Tb','Dy','Ho','Er','Tm','Yb','Lu'].forEach(s => m[s] = 'lanthanide');
            // Actinides
            ['Ac','Th','Pa','U','Np','Pu','Am','Cm','Bk','Cf','Es','Fm','Md','No','Lr'].forEach(s => m[s] = 'actinide');
            return m;
        })();

        // Which periodic categories count as "metal"? Everything except nonmetal/halogen/noble-gas/metalloid.
        const METAL_CATEGORIES = new Set([
            'alkali-metal', 'alkaline-earth', 'transition-metal',
            'post-transition-metal', 'lanthanide', 'actinide'
        ]);

        // Human-readable labels for each periodic category (used as section titles).
        const CATEGORY_LABELS = {
            'alkali-metal': 'Alkali metals',
            'alkaline-earth': 'Alkaline-earth metals',
            'transition-metal': 'Transition metals',
            'post-transition-metal': 'Post-transition metals',
            'metalloid': 'Metalloids',
            'nonmetal': 'Reactive nonmetals',
            'halogen': 'Halogens',
            'noble-gas': 'Noble gases',
            'lanthanide': 'Lanthanides',
            'actinide': 'Actinides'
        };

        // Classify a molecule entry as organic/inorganic/radical. Keys on the
        // entry's natural name + formula.
        function classifyMolecule(key, entry) {
            const blob = `${entry.name} ${entry.formula || ''} ${entry.alsoKnown || ''}`.toLowerCase();
            const isRadical =
                blob.includes('radical') || blob.includes('excimer') ||
                blob.includes('exotic') || blob.includes('van der waals') ||
                blob.includes('carbene') || blob.includes('diradical');
            // An organic molecule contains carbon and hydrogen (the working
            // definition used here). CO, CO₂, and CN are borderline but
            // traditionally classed as inorganic in organic-chemistry texts.
            let containsC = false, containsH = false;
            // Look at the sim's Hill-style key which lists element letters
            // with optional digits.
            const tokenRegex = /([A-Z][a-z]?)/g;
            const syms = new Set();
            let match; while ((match = tokenRegex.exec(key)) !== null) syms.add(match[1]);
            if (syms.has('C')) containsC = true;
            if (syms.has('H')) containsH = true;
            const isOrganic = containsC && containsH;
            return { isRadical, isOrganic, containsC, containsH };
        }

        // Current glossary UI state
        const glossaryState = {
            query: '',
            filter: 'all',      // 'all' | 'particles' | 'elements' | 'molecules' | 'organics' | ...
            sort: 'category'    // 'category' | 'atomicNumber' | 'alpha'
        };

        // Build a flat list of ALL glossary entries, with a common shape.
        // type: 'particle' | 'element' | 'molecule'
        // Returns array of { key, type, title, formula, subtitle, searchBlob, meta }
        // where meta is auxiliary info used for sorting/grouping (atomicNumber, category, etc.).
        function buildGlossaryEntries() {
            const entries = [];

            // Particles
            if (typeof particleInfo !== 'undefined') {
                for (const [key, info] of Object.entries(particleInfo)) {
                    entries.push({
                        key: info.name,                 // use display name as clickable key
                        lookupKey: info.name,           // what to pass to openInfoModal
                        type: 'particle',
                        title: info.name,
                        formula: info.formula || '',
                        subtitle: info.alsoKnown || '',
                        searchBlob: `${info.name} ${info.formula || ''} ${info.alsoKnown || ''} ${info.description || ''}`.toLowerCase(),
                        meta: { order: { electron: 0, positron: 1, proton: 2, neutron: 3 }[key] ?? 99 }
                    });
                }
            }

            // Elements
            if (typeof elementInfo !== 'undefined') {
                const elementNamesRev = {};
                if (typeof elementNames !== 'undefined') {
                    for (const [num, sym] of Object.entries(elementNames)) elementNamesRev[sym] = +num;
                }
                // Build reverse map sym → lowercase element name key in atomConfigs,
                // so we can pull proton/neutron/electron counts for periodic squares.
                const symToConfigKey = {};
                if (typeof atomConfigs !== 'undefined') {
                    for (const [lowerName, cfg] of Object.entries(atomConfigs)) {
                        if (!cfg) continue;
                        const sym = elementNames[cfg.p];
                        if (sym) symToConfigKey[sym] = lowerName;
                    }
                }
                for (const [sym, info] of Object.entries(elementInfo)) {
                    const Z = elementNamesRev[sym] ?? 999;
                    const cat = PERIODIC_CATEGORIES[sym] || 'other';
                    const cfg = symToConfigKey[sym] && typeof atomConfigs !== 'undefined'
                                ? atomConfigs[symToConfigKey[sym]] : null;
                    entries.push({
                        key: sym,
                        lookupKey: sym,
                        type: 'element',
                        title: info.name,
                        formula: sym,
                        subtitle: `Z = ${Z} · ${CATEGORY_LABELS[cat] || 'Element'}`,
                        searchBlob: `${info.name} ${sym} ${info.etymology || ''} ${info.summary || ''}`.toLowerCase(),
                        meta: {
                            atomicNumber: Z,
                            category: cat,
                            protonCount:   cfg ? cfg.p : Z,
                            neutronCount:  cfg ? cfg.n : 0,
                            electronCount: cfg ? cfg.e : Z,
                            massNumber:    cfg ? (cfg.p + cfg.n) : Z
                        }
                    });
                }
            }

            // Molecules
            if (typeof moleculeInfo !== 'undefined') {
                for (const [key, info] of Object.entries(moleculeInfo)) {
                    const c = classifyMolecule(key, info);
                    entries.push({
                        key,
                        lookupKey: key,
                        type: 'molecule',
                        title: info.name,
                        formula: info.formula || key,
                        subtitle: info.alsoKnown ? info.alsoKnown.split(';')[0].trim() : '',
                        searchBlob: `${info.name} ${info.formula || ''} ${key} ${info.alsoKnown || ''} ${info.description || ''}`.toLowerCase(),
                        meta: {
                            isRadical: c.isRadical,
                            isOrganic: c.isOrganic,
                            containsC: c.containsC
                        }
                    });
                }
            }

            return entries;
        }

        // Apply the current search query and filter chip to the full entry list.
        function filterGlossaryEntries(all) {
            const q = glossaryState.query.trim().toLowerCase();
            const f = glossaryState.filter;
            return all.filter(e => {
                // Search — must match somewhere in the search blob
                if (q && !e.searchBlob.includes(q)) return false;
                // Filter chip
                if (f === 'all') return true;
                if (f === 'particles') return e.type === 'particle';
                if (f === 'elements')  return e.type === 'element';
                if (f === 'molecules') return e.type === 'molecule';
                if (f === 'organics')  return e.type === 'molecule' && e.meta.isOrganic;
                if (f === 'inorganics') return e.type === 'molecule' && !e.meta.isOrganic;
                if (f === 'radicals')  return e.type === 'molecule' && e.meta.isRadical;
                if (f === 'nobleGas')  return e.type === 'element' && e.meta.category === 'noble-gas';
                if (f === 'metalloids') return e.type === 'element' && e.meta.category === 'metalloid';
                if (f === 'metals')    return e.type === 'element' && METAL_CATEGORIES.has(e.meta.category);
                if (f === 'nonmetals') return e.type === 'element' &&
                                              (e.meta.category === 'nonmetal' || e.meta.category === 'halogen');
                return true;
            });
        }

        // Group entries into sections according to the current sort mode.
        // Returns array of { heading, items }.
        function groupGlossaryEntries(filtered) {
            const mode = glossaryState.sort;

            if (mode === 'alpha') {
                const sorted = [...filtered].sort((a, b) => a.title.localeCompare(b.title));
                return [{ heading: `All ${sorted.length} entries`, items: sorted }];
            }

            if (mode === 'atomicNumber') {
                // Particles first (bucket), then elements sorted by Z, then molecules alphabetical
                const particles = filtered.filter(e => e.type === 'particle')
                                          .sort((a, b) => (a.meta.order ?? 99) - (b.meta.order ?? 99));
                const elements  = filtered.filter(e => e.type === 'element')
                                          .sort((a, b) => (a.meta.atomicNumber ?? 999) - (b.meta.atomicNumber ?? 999));
                const molecules = filtered.filter(e => e.type === 'molecule')
                                          .sort((a, b) => a.title.localeCompare(b.title));
                const out = [];
                if (particles.length) out.push({ heading: `Particles (${particles.length})`, items: particles });
                if (elements.length)  out.push({ heading: `Elements, by atomic number (${elements.length})`, items: elements });
                if (molecules.length) out.push({ heading: `Molecules (${molecules.length})`, items: molecules });
                return out;
            }

            // Default: group by category
            // Particles: one section
            // Elements: one section per periodic category
            // Molecules: Organics / Inorganics / Radicals & exotics
            const buckets = new Map();
            const particles = filtered.filter(e => e.type === 'particle')
                                      .sort((a, b) => (a.meta.order ?? 99) - (b.meta.order ?? 99));
            if (particles.length) buckets.set('__particles', { heading: `Particles (${particles.length})`, items: particles });

            const elementCats = [
                'alkali-metal', 'alkaline-earth', 'transition-metal',
                'post-transition-metal', 'metalloid', 'nonmetal', 'halogen',
                'noble-gas', 'lanthanide', 'actinide'
            ];
            for (const cat of elementCats) {
                const items = filtered.filter(e => e.type === 'element' && e.meta.category === cat)
                                      .sort((a, b) => (a.meta.atomicNumber ?? 999) - (b.meta.atomicNumber ?? 999));
                if (items.length) {
                    buckets.set(cat, {
                        heading: `${CATEGORY_LABELS[cat]} (${items.length})`,
                        items
                    });
                }
            }

            const organics = filtered.filter(e => e.type === 'molecule' && e.meta.isOrganic && !e.meta.isRadical)
                                     .sort((a, b) => a.title.localeCompare(b.title));
            const inorganics = filtered.filter(e => e.type === 'molecule' && !e.meta.isOrganic && !e.meta.isRadical)
                                       .sort((a, b) => a.title.localeCompare(b.title));
            const radicals = filtered.filter(e => e.type === 'molecule' && e.meta.isRadical)
                                     .sort((a, b) => a.title.localeCompare(b.title));
            if (organics.length)   buckets.set('__organics',   { heading: `Organic molecules (${organics.length})`,   items: organics });
            if (inorganics.length) buckets.set('__inorganics', { heading: `Inorganic molecules (${inorganics.length})`, items: inorganics });
            if (radicals.length)   buckets.set('__radicals',   { heading: `Radicals & exotic species (${radicals.length})`, items: radicals });

            return [...buckets.values()];
        }

        function renderGlossary() {
            const body = document.getElementById('glossaryBody');
            const countEl = document.getElementById('glossaryCount');
            if (!body) return;
            const all = buildGlossaryEntries();
            const filtered = filterGlossaryEntries(all);
            const sections = groupGlossaryEntries(filtered);
            if (countEl) countEl.textContent = `${filtered.length} of ${all.length} entries`;

            if (filtered.length === 0) {
                body.innerHTML = `<div class="glossaryEmpty">No entries match. Try clearing the search or picking a different filter.</div>`;
                return;
            }

            let html = '';
            for (const section of sections) {
                html += `<div class="glossarySection">`;
                html += `<h3>${section.heading}</h3>`;
                html += `<div class="glossaryGrid">`;
                for (const e of section.items) {
                    const safeLookup = e.lookupKey.replace(/"/g, '&quot;');
                    if (e.type === 'element') {
                        // Periodic-table-style card with clickable p/n/e pills.
                        const m = e.meta || {};
                        const Z = m.atomicNumber;
                        const cat = m.category || 'other';
                        const catLabel = CATEGORY_LABELS[cat] || '';
                        const subtitle = Z && Z !== 999
                            ? `Z = ${Z} · A ≈ ${m.massNumber}${catLabel ? ' · ' + catLabel : ''}`
                            : (catLabel || '');
                        html += `<div class="glossaryCard elementCard" data-lookup="${safeLookup}">`;
                        html += `  <div class="periodicSquare cat-${cat}">`;
                        if (Z && Z !== 999) html += `<div class="atomicNumber">${Z}</div>`;
                        else html += `<div class="atomicNumber">&nbsp;</div>`;
                        html += `    <div class="atomicSymbol">${e.key}</div>`;
                        html += `    <div class="atomicName">${e.title}</div>`;
                        html += `  </div>`;
                        html += `  <div class="elementDetails">`;
                        html += `    <div class="elementName">${e.title}</div>`;
                        html += `    <div class="elementCategory">${subtitle}</div>`;
                        html += `    <div class="subatomicPills">`;
                        html += `      <span class="subatomicPill p" data-particle="Proton"  title="${m.protonCount} protons — click to learn what a proton is">p: ${m.protonCount}</span>`;
                        html += `      <span class="subatomicPill n" data-particle="Neutron" title="${m.neutronCount} neutrons (most common isotope) — click to learn about neutrons">n: ${m.neutronCount}</span>`;
                        html += `      <span class="subatomicPill e" data-particle="Electron" title="${m.electronCount} electrons in the neutral atom — click to learn about electrons">e: ${m.electronCount}</span>`;
                        html += `    </div>`;
                        html += `  </div>`;
                        html += `</div>`;
                    } else {
                        const formulaPart = e.formula ? `<span class="cardFormula">${e.formula}</span>` : '';
                        const subPart = e.subtitle ? `<div class="cardMeta">${e.subtitle}</div>` : '';
                        html += `<div class="glossaryCard" data-lookup="${safeLookup}">`;
                        html += `<div class="cardTitle">${e.title}${formulaPart ? ' ' + formulaPart : ''}</div>`;
                        html += subPart;
                        html += `</div>`;
                    }
                }
                html += `</div></div>`;
            }
            body.innerHTML = html;
        }

        function openGlossary() {
            const bd = document.getElementById('glossaryBackdrop');
            if (!bd) return;
            renderGlossary();
            bd.classList.add('open');
            bd.setAttribute('aria-hidden', 'false');
            try { Achievements.notify('glossary_opened'); } catch(_e){}
            // Focus the search box for instant typing
            const searchEl = document.getElementById('glossarySearch');
            if (searchEl) {
                searchEl.value = glossaryState.query;
                setTimeout(() => { try { searchEl.focus(); searchEl.select(); } catch (_) {} }, 30);
            }
        }

        function closeGlossary() {
            const bd = document.getElementById('glossaryBackdrop');
            if (!bd) return;
            bd.classList.remove('open');
            bd.setAttribute('aria-hidden', 'true');
        }

        function initGlossary() {
            const btn = document.getElementById('glossaryBtn');
            const bd = document.getElementById('glossaryBackdrop');
            const closeX = document.getElementById('glossaryCloseX');
            const search = document.getElementById('glossarySearch');
            const filters = document.getElementById('glossaryFilters');
            const sort = document.getElementById('glossarySort');
            const body = document.getElementById('glossaryBody');

            if (btn) btn.addEventListener('click', openGlossary);
            if (closeX) closeX.addEventListener('click', closeGlossary);
            if (bd) bd.addEventListener('click', (e) => {
                if (e.target === bd) closeGlossary();
            });
            if (search) {
                search.addEventListener('input', () => {
                    glossaryState.query = search.value || '';
                    renderGlossary();
                });
            }
            if (filters) {
                filters.addEventListener('click', (e) => {
                    const chip = e.target.closest('.filterChip');
                    if (!chip) return;
                    const next = chip.getAttribute('data-filter');
                    if (!next) return;
                    glossaryState.filter = next;
                    filters.querySelectorAll('.filterChip').forEach(c => c.classList.toggle('active', c === chip));
                    renderGlossary();
                });
            }
            if (sort) {
                sort.addEventListener('change', () => {
                    glossaryState.sort = sort.value;
                    renderGlossary();
                });
            }
            if (body) {
                body.addEventListener('click', (e) => {
                    // Pill click takes precedence — open the particle modal
                    const pill = e.target.closest('.subatomicPill');
                    if (pill) {
                        e.stopPropagation();
                        const particle = pill.getAttribute('data-particle');
                        if (particle && typeof openInfoModal === 'function') openInfoModal(particle);
                        return;
                    }
                    const card = e.target.closest('.glossaryCard');
                    if (!card) return;
                    const key = card.getAttribute('data-lookup');
                    if (!key) return;
                    // Open the detail modal on top — keep the glossary open underneath
                    if (typeof openInfoModal === 'function') openInfoModal(key);
                });
            }
            // Esc closes — only when the glossary is the frontmost modal (i.e.
            // the info modal is not also open)
            document.addEventListener('keydown', (e) => {
                if (!bd || !bd.classList.contains('open')) return;
                if (e.key !== 'Escape') return;
                const infoBd = document.getElementById('infoModalBackdrop');
                const infoOpen = infoBd && infoBd.classList.contains('open');
                if (infoOpen) return; // let the info modal's own handler close itself first
                closeGlossary();
                e.preventDefault();
            });
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initGlossary);
        } else {
            initGlossary();
        }

        // =================================================================
        //  UNKNOWN-MOLECULES PANEL
        // =================================================================
        // The panel is visible by default. It rebuilds its list whenever a new
        // unknown label is reported. Toggle via the × button on the panel or
        // the "⚠ Unknowns" button in the Display controls on the left.

        function formatComposition(comp) {
            if (!comp) return '';
            const parts = [];
            for (const [el, n] of Object.entries(comp)) {
                parts.push(el + (n > 1 ? n : ''));
            }
            return parts.join('·');
        }

        function refreshUnknownPanel() {
            const listEl = document.getElementById('unknownPanelList');
            if (!listEl) return;
            if (reportedUnknownLabels.size === 0) {
                listEl.innerHTML = '<li class="empty">(nothing yet — interesting reactions will show up here)</li>';
                return;
            }
            let html = '';
            for (const [label, comp] of reportedUnknownLabels) {
                const total = Object.values(comp).reduce((s, n) => s + n, 0);
                const safeLabel = label.replace(/"/g, '&quot;');
                const safeComp = JSON.stringify(comp).replace(/"/g, '&quot;');
                const tooltip = `${label} — ${formatComposition(comp)} (${total} atom${total === 1 ? '' : 's'})`;
                html += `<li data-label="${safeLabel}" data-comp="${safeComp}" title="Click to copy · ${tooltip}">`;
                html += `<span class="label">${label}</span>`;
                html += `<span class="comp">${total} atom${total === 1 ? '' : 's'}</span>`;
                html += `</li>`;
            }
            listEl.innerHTML = html;
        }

        function setUnknownPanelVisible(show) {
            unknownPanelVisible = !!show;
            const panel = document.getElementById('unknownPanel');
            const btn = document.getElementById('toggleUnknownPanelBtn');
            if (panel) panel.classList.toggle('hidden', !unknownPanelVisible);
            if (btn) {
                // subtle visual hint that it's currently on/off
                btn.style.opacity = unknownPanelVisible ? '1' : '0.65';
            }
        }

        function showCopyFeedback(msg) {
            const fb = document.getElementById('unknownPanelFeedback');
            if (!fb) return;
            fb.textContent = msg;
            clearTimeout(showCopyFeedback._t);
            showCopyFeedback._t = setTimeout(() => { fb.textContent = ''; }, 1800);
        }

        function copyTextToClipboard(text) {
            // Prefer async clipboard API; fall back to a hidden textarea
            if (navigator.clipboard && navigator.clipboard.writeText) {
                return navigator.clipboard.writeText(text).then(
                    () => true,
                    () => copyViaTextarea(text)
                );
            }
            return Promise.resolve(copyViaTextarea(text));
        }
        function copyViaTextarea(text) {
            try {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.focus();
                ta.select();
                const ok = document.execCommand('copy');
                document.body.removeChild(ta);
                return ok;
            } catch (_e) { return false; }
        }

        function initUnknownPanel() {
            // Initial render + initial visibility (hidden until something unknown
            // shows up; see updateMolecules)
            refreshUnknownPanel();
            setUnknownPanelVisible(false);

            // Close (×) on the panel itself: stays closed until reopened
            const hideBtn = document.getElementById('unknownPanelHide');
            if (hideBtn) hideBtn.addEventListener('click', () => {
                unknownPanelUserHidden = true;
                setUnknownPanelVisible(false);
            });

            // Toggle from Display controls
            const toggleBtn = document.getElementById('toggleUnknownPanelBtn');
            if (toggleBtn) toggleBtn.addEventListener('click', () => {
                unknownPanelUserHidden = unknownPanelVisible;   // closing by hand = stay closed
                setUnknownPanelVisible(!unknownPanelVisible);
            });

            // Clicking a line copies "label — composition" to clipboard
            const listEl = document.getElementById('unknownPanelList');
            if (listEl) {
                listEl.addEventListener('click', (e) => {
                    const li = e.target.closest('li[data-label]');
                    if (!li) return;
                    const label = li.getAttribute('data-label') || '';
                    const compRaw = li.getAttribute('data-comp') || '{}';
                    let compStr = '';
                    try { compStr = formatComposition(JSON.parse(compRaw)); } catch (_) {}
                    const payload = label + (compStr ? ` — ${compStr}` : '');
                    Promise.resolve(copyTextToClipboard(payload)).then(ok => {
                        showCopyFeedback(ok ? `Copied: ${payload}` : 'Copy failed — check clipboard permissions');
                    });
                });
            }

            // Copy-all button
            const copyAll = document.getElementById('unknownPanelCopyAll');
            if (copyAll) copyAll.addEventListener('click', () => {
                if (reportedUnknownLabels.size === 0) {
                    showCopyFeedback('No unknown labels yet');
                    return;
                }
                const lines = [];
                for (const [label, comp] of reportedUnknownLabels) {
                    lines.push(`${label}  ${JSON.stringify(comp)}`);
                }
                Promise.resolve(copyTextToClipboard(lines.join('\n'))).then(ok => {
                    showCopyFeedback(ok ? `Copied ${reportedUnknownLabels.size} label${reportedUnknownLabels.size === 1 ? '' : 's'}` : 'Copy failed');
                });
            });
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initUnknownPanel);
        } else {
            initUnknownPanel();
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initInfoModal);
        } else {
            initInfoModal();
        }

        // Run once DOM is ready (p5 setup has already run, but we do this
        // defensively in case the script is reordered).
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initHelpModal);
        } else {
            initHelpModal();
        }