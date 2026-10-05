# Performance notes

Measured on a laptop, headless Chrome with software rendering (so no frame-rate figures; real GPUs are faster):

- Heart model ready and first frame: about 1.7 s from page load (dev server, uncached).
- Sinus beat solved at load; every other rhythm solves on first open in 50 to 175 ms (AF 172 ms, AVNRT 161 ms, VT 81 ms, VF 48 ms), in a Web Worker so the interface stays responsive.
- Transfer: three.js about 6 MB unminified in dev (about 220 kB gzip in the production bundle), heart.glb 3.0 MB, graph.bin 3.4 MB, conduction.glb 1.1 MB. Total about 8 MB on first load.

Measures taken:
- The canvas renders only when something changes (camera, playback, selection), not every frame.
- The pixel ratio is capped at 2 and the total pixel count at about 3.6 million, so a 4K projector does not make the heart heavy to draw.
- The solver runs in an inline Web Worker; wave colouring runs in the shader.

Still to do (needs real devices): frame-rate checks on older iPads and school laptops, and a look at the first-load size on slow connections.
