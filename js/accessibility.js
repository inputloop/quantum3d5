/* accessibility.js -- names for what the simulator draws, so a screen reader can say what is there.
 *
 * The 3D stage and the live graphs are <canvas> elements that p5 creates at run time, so they cannot
 * be labelled in index.html. This script labels each canvas as it appears: the stage as an image
 * described by the live statistics line, each graph by the caption above it. It changes nothing
 * the simulation does.
 *
 * Copyright (C) 2026 Corwin Brust, Bryant Frankford and Contributors.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
(function () {
    'use strict';

    function captionFor(canvas) {
        // A graph's caption is the nearest .graphLabel before it in the same panel.
        let el = canvas.previousElementSibling;
        while (el) {
            if (el.classList && el.classList.contains('graphLabel')) {
                return el.textContent.replace(/\s+/g, ' ').trim();
            }
            el = el.previousElementSibling;
        }
        return '';
    }

    // The stage is the page's main content: give it the main landmark. The wrapper is
    // display: contents (css/accessibility.css), so the layout does not move. p5 may create the
    // canvas before it is attached, so this waits for a parent and is safe to call again.
    function landmark(canvas) {
        if (!canvas.classList.contains('p5Canvas') || !canvas.parentNode || canvas.closest('main')) return;
        if (canvas.closest('#graphsPanel, #doubleSlitPanel')) return;
        const main = document.createElement('main');
        main.id = 'stage';
        canvas.parentNode.insertBefore(main, canvas);
        main.appendChild(canvas);
    }

    function label(canvas) {
        landmark(canvas);
        if (canvas.hasAttribute('aria-label')) return;
        canvas.setAttribute('role', 'img');
        const caption = captionFor(canvas);
        if (caption) {
            canvas.setAttribute('aria-label', 'Graph: ' + caption);
        } else if (canvas.classList.contains('p5Canvas')) {
            canvas.setAttribute('aria-label',
                'The simulation stage: particles, atoms and molecules in 3D. ' +
                'Drag to rotate, scroll to zoom, right-drag to pan; press H for help.');
            if (document.getElementById('statsBubble')) {
                canvas.setAttribute('aria-describedby', 'statsBubble');
            }
        } else {
            canvas.setAttribute('aria-label', 'Drawing');
        }
    }

    function labelAll(root) {
        (root.querySelectorAll ? root.querySelectorAll('canvas') : []).forEach(label);
        if (root.tagName === 'CANVAS') label(root);
    }

    function start() {
        labelAll(document);
        new MutationObserver(function (records) {
            records.forEach(function (r) { r.addedNodes.forEach(function (n) { if (n.nodeType === 1) labelAll(n); }); });
        }).observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
}());
