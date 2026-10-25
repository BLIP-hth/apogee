/* ============================================================
   main.js  —  the 3D engine and interaction
   ------------------------------------------------------------
   Builds a rocket out of the labelled parts in rockets.js,
   lets you orbit and zoom, and shows a tooltip explaining each
   part when you hover over it.

   For now only the first rocket (Saturn V) is switched on. The
   rest are ready in the data and appear as "soon" in the dock.
   ============================================================ */

(function () {
  "use strict";

  const ACTIVE_KEYS = ["saturn-v", "starship", "falcon-9", "shuttle", "sls", "soyuz"];          // <- add more keys here to turn rockets on
  const ROCKETS = window.ROCKETS;
  const el = (id) => document.getElementById(id);

  /* ---------- scene, camera, renderer ---------- */
  const app = el("app");
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060c);
  scene.fog = new THREE.FogExp2(0x05060c, 0.0009);

  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 6000);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;      // compress highlights, cinematic
  renderer.toneMappingExposure = 1.0;
  app.appendChild(renderer.domElement);

  // ---- bloom post-processing (subtle glow on engines, sun, accents) ----
  // EffectComposer -> RenderPass -> UnrealBloomPass. render() routes through this.
  let composer = null, bloomPass = null;
  (function buildComposer() {
    if (!THREE.EffectComposer || !THREE.UnrealBloomPass) return;   // fail soft
    composer = new THREE.EffectComposer(renderer);
    composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    composer.setSize(window.innerWidth, window.innerHeight);
    composer.addPass(new THREE.RenderPass(scene, camera));
    bloomPass = new THREE.UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.42,   // strength - restrained so the rocket stays crisp, not hazy
      0.45,   // radius - tight, so the low-res blur mips never read as blocky halos
      0.9     // threshold - only genuinely bright things (engines, sun, exhaust) bloom
    );
    composer.addPass(bloomPass);
    // Final pass: gamma correction (the composer renders into a LINEAR target) PLUS a
    // per-pixel dither. Without the dither the bloom's smooth glow quantizes into
    // visible stepped rings around every flame on a dark sky (8-bit banding, the same
    // gotcha as the sky dome gradient).
    if (THREE.ShaderPass) composer.addPass(new THREE.ShaderPass({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader:
        "uniform sampler2D tDiffuse; varying vec2 vUv;" +
        "void main(){" +
        "  vec4 t = texture2D(tDiffuse, vUv);" +
        "  vec3 c = pow(max(t.rgb, 0.0), vec3(1.0 / 2.2));" +
        "  float n = (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;" +
        "  gl_FragColor = vec4(c + n, t.a);" +
        "}"
    }));
  })();
  // Graphics quality: High = bloom + god rays during launches; Low = plain crisp render.
  // Defaults Low on phones/tablets so the sim stays 60fps there; persisted per visitor.
  let QUALITY = (() => {
    try { const s = localStorage.getItem("apogee_fx"); if (s === "high" || s === "low") return s; } catch (e) {}
    const small = window.innerWidth <= 720 || (window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
    return small ? "low" : "high";
  })();
  // The explorer always uses the plain render (bloom made it hazy there); the composer
  // only takes over during a launch on High, where the sun and plumes earn the glow.
  function render() {
    if (composer && QUALITY === "high" && launchPhase !== "idle") composer.render();
    else renderer.render(scene, camera);
  }

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.autoRotate = false;               // the pose driver keeps the view steady
  controls.enableZoom = false;               // scroll now lays the rocket out, camera auto-fits
  controls.enablePan = false;
  controls.minDistance = 8;
  controls.maxDistance = 2000;
  controls.minPolarAngle = Math.PI * 0.06;   // stop the orbit flipping over the exact poles
  controls.maxPolarAngle = Math.PI * 0.94;
  const clock = new THREE.Clock();
  let explodeAmount = 0;                      // 0 = assembled upright, 1 = flat blueprint
  let camMode = "auto";                       // "auto" = site drives a clean pose, "user" = free orbit
  let launchPhase = "idle";                   // idle | countdown | flight | orbit | failed
  let xray = false;                           // X-ray cutaway: ghost all shells, reveal all internals
  let xrayAmt = 0;                            // eased X-ray factor

  // give metals something to reflect so parts look real, not flat
  (function buildEnvironment() {
    const c = document.createElement("canvas"); c.width = 64; c.height = 32;
    const x = c.getContext("2d");
    const g = x.createLinearGradient(0, 0, 0, 32);
    g.addColorStop(0, "#26374f"); g.addColorStop(0.55, "#0a0f1a"); g.addColorStop(1, "#04050a");
    x.fillStyle = g; x.fillRect(0, 0, 64, 32);
    const sun = x.createRadialGradient(15, 7, 0, 15, 7, 11);
    sun.addColorStop(0, "#ffffff"); sun.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = sun; x.fillRect(0, 0, 64, 32);
    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    scene.environment = pmrem.fromEquirectangular(tex).texture;
    tex.dispose(); pmrem.dispose();
  })();

  // procedural panel-line + rivet texture so painted metal reads as built, not smooth
  const GREEBLE = (function makeGreeble() {
    const c = document.createElement("canvas"); c.width = 512; c.height = 512;
    const x = c.getContext("2d");
    x.fillStyle = "#ffffff"; x.fillRect(0, 0, 512, 512);
    x.strokeStyle = "rgba(0,0,0,0.09)"; x.lineWidth = 2;
    for (let y = 0; y <= 512; y += 64) { x.beginPath(); x.moveTo(0, y); x.lineTo(512, y); x.stroke(); }
    for (let vx = 0; vx <= 512; vx += 128) { x.beginPath(); x.moveTo(vx, 0); x.lineTo(vx, 512); x.stroke(); }
    x.fillStyle = "rgba(0,0,0,0.11)";
    for (let y = 0; y <= 512; y += 64) for (let vx = 10; vx < 512; vx += 22) {
      x.beginPath(); x.arc(vx, y, 1.5, 0, Math.PI * 2); x.fill();
    }
    let s = 24680;                             // deterministic faint grime specks
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    x.fillStyle = "rgba(0,0,0,0.04)";
    for (let i = 0; i < 400; i++) x.fillRect(rnd() * 512, rnd() * 512, 2, 2);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(4, 6); t.anisotropy = 4; t.encoding = THREE.sRGBEncoding;
    return t;
  })();

  // soft round sprite for glowing points (fuel flow, etc.)
  const SOFT_DOT = (function () {
    // High-res (256px) so the sun glow, haze and clouds stay smooth when scaled up to
    // thousands of pixels. At 32px they upscaled ~100-300x into blocky, blotchy patches.
    const S = 256, c = document.createElement("canvas"); c.width = c.height = S;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.4, "rgba(255,255,255,0.7)");
    g.addColorStop(0.7, "rgba(255,255,255,0.28)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g; x.beginPath(); x.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); x.fill();
    const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
  })();

  // ---- smooth camera moves (orbit around the target, no flinging) ----
  // We interpolate the target plus a spherical offset (radius, phi, theta),
  // keeping the swing controlled instead of lerping through world space.
  let camTween = null;
  function orbitTo(endTarget, endCamPos, dur) {
    const startTarget = controls.target.clone();
    const s0 = new THREE.Spherical().setFromVector3(camera.position.clone().sub(startTarget));
    const s1 = new THREE.Spherical().setFromVector3(endCamPos.clone().sub(endTarget));
    let dTheta = s1.theta - s0.theta;                       // take the shortest way round
    while (dTheta > Math.PI) dTheta -= Math.PI * 2;
    while (dTheta < -Math.PI) dTheta += Math.PI * 2;
    camTween = { startTarget: startTarget, endTarget: endTarget.clone(), s0: s0, s1: s1, dTheta: dTheta, t: 0, dur: dur };
    controls.autoRotate = false;
  }

  /* ---------- lighting ---------- */
  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x0a0c14, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(60, 120, 80);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x6ea8ff, 0.6);
  rim.position.set(-80, 40, -60);
  scene.add(rim);
  const fill = new THREE.PointLight(0xffd9b3, 0.35, 600);
  fill.position.set(30, 20, 60);
  scene.add(fill);

  /* ---------- starfield (original clean crisp stars) ---------- */
  // registered in spaceLayers so the ground-launch world can still fade it out at
  // golden hour and back in as the rocket climbs.
  const spaceLayers = [];
  function setSpaceOpacity(f) {
    spaceLayers.forEach(l => { l.mat.opacity = l.base * f; });
  }
  (function stars() {
    const N = 1800, pos = new Float32Array(N * 3);
    let seed = 987654321;                     // tiny deterministic RNG (no Math.random)
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < N; i++) {
      const r = 600 + rnd() * 2200;
      const th = rnd() * Math.PI * 2, ph = Math.acos(rnd() * 2 - 1);
      pos[i * 3]     = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.cos(ph);
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color: 0xbcd2ff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.9 });
    scene.add(new THREE.Points(g, m));
    spaceLayers.push({ mat: m, base: 0.9 });
  })();

  /* ---------- launch platform (fades out as the rocket lays flat) ---------- */
  const padMeshes = [];
  (function platform() {
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(34, 34, 1.4, 64),
      new THREE.MeshStandardMaterial({ color: 0x0d1020, metalness: 0.4, roughness: 0.6, transparent: true })
    );
    disc.position.y = -0.7;
    scene.add(disc); padMeshes.push(disc);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(34, 0.25, 8, 96),
      new THREE.MeshBasicMaterial({ color: 0x5fb2ff, transparent: true })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.05;
    scene.add(ring); padMeshes.push(ring);
  })();

  /* ============================================================
     BUILD A ROCKET from its parts list
     Returns { group, height, componentMap }
     ============================================================ */
  function mat(color, metal, rough, detail) {
    const m = new THREE.MeshStandardMaterial({
      color: color,
      metalness: metal == null ? 0.2 : metal,
      roughness: rough == null ? 0.5 : rough,
      envMapIntensity: 0.5
    });
    if (detail) m.map = GREEBLE;               // subtle panel lines + rivets
    return m;
  }

  // a thin strut (cylinder) between two points, for trusses and thrust frames
  function strutMesh(mtl, a, b, thick) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length() || 0.001;
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(thick, thick, len, 6), mtl);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    return mesh;
  }

  // draw a US flag + vertical "UNITED STATES" onto a canvas, on a white body background
  function makeFlagTexture() {
    const c = document.createElement("canvas");
    c.width = 256; c.height = 512;
    const x = c.getContext("2d");
    x.fillStyle = "#eef0f4"; x.fillRect(0, 0, 256, 512);      // matches white body
    const fx = 52, fy = 26, fw = 152, fh = 100;
    const sh = fh / 13;
    for (let i = 0; i < 13; i++) {                            // 13 stripes
      x.fillStyle = (i % 2 === 0) ? "#b22234" : "#ffffff";
      x.fillRect(fx, fy + i * sh, fw, sh);
    }
    x.fillStyle = "#3c3b6e";                                  // blue canton
    x.fillRect(fx, fy, fw * 0.42, sh * 7);
    x.fillStyle = "#ffffff";                                  // simple star dots
    for (let r = 0; r < 4; r++) for (let cc = 0; cc < 5; cc++) {
      x.beginPath();
      x.arc(fx + 8 + cc * 11, fy + 8 + r * 11, 2.2, 0, Math.PI * 2);
      x.fill();
    }
    x.strokeStyle = "#c9ced8"; x.lineWidth = 1.5;
    x.strokeRect(fx, fy, fw, fh);
    x.save();                                                 // vertical lettering
    x.translate(128, 330); x.rotate(-Math.PI / 2);
    x.fillStyle = "#14161c";
    x.font = "bold 34px Arial, sans-serif";
    x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText("UNITED STATES", 0, 0);
    x.restore();
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    return t;
  }

  // waffle lattice texture for grid fins (dark cells + bright metal grid lines)
  function makeGridTexture() {
    const c = document.createElement("canvas"); c.width = 64; c.height = 64;
    const x = c.getContext("2d");
    x.fillStyle = "#31353f"; x.fillRect(0, 0, 64, 64);
    x.strokeStyle = "#aab0bc"; x.lineWidth = 3;
    const n = 6, s = 64 / n;
    for (let i = 0; i <= n; i++) {
      x.beginPath(); x.moveTo(i * s, 0); x.lineTo(i * s, 64); x.stroke();
      x.beginPath(); x.moveTo(0, i * s); x.lineTo(64, i * s); x.stroke();
    }
    return new THREE.CanvasTexture(c);
  }

  // matte black heat-shield tiles: a field of dark hexagons with faint seams (Starship belly)
  function makeTileTexture() {
    const c = document.createElement("canvas"); c.width = 96; c.height = 110;
    const x = c.getContext("2d");
    x.fillStyle = "#141414"; x.fillRect(0, 0, 96, 110);
    const r = 15, dx = r * Math.sqrt(3), dy = r * 1.5;
    x.strokeStyle = "#080808"; x.lineWidth = 2; x.fillStyle = "#181818";
    for (let row = -1; row < 6; row++) for (let col = -1; col < 6; col++) {
      const cx = col * dx + (row % 2 ? dx / 2 : 0), cy = row * dy;
      x.beginPath();
      for (let i = 0; i < 6; i++) { const a = Math.PI / 180 * (60 * i - 30); const px = cx + r * 0.95 * Math.cos(a), py = cy + r * 0.95 * Math.sin(a); i ? x.lineTo(px, py) : x.moveTo(px, py); }
      x.closePath(); x.fill(); x.stroke();
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
  }

  // vertical "SpaceX" wordmark + a small US flag, on a transparent decal for the white body.
  // High-res and drawn at a 1:6 aspect so it matches the decal plane (no stretching).
  function makeBrandTexture(text) {
    const W = 220, H = 1320;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const x = c.getContext("2d");
    x.clearRect(0, 0, W, H);
    // crisp small US flag near the top
    const fw = W * 0.60, fh = fw * 0.62, fx = (W - fw) / 2, fy = H * 0.05;
    x.fillStyle = "#b22234"; x.fillRect(fx, fy, fw, fh);
    x.fillStyle = "#ffffff";
    for (let i = 1; i < 13; i += 2) x.fillRect(fx, fy + Math.round(i * fh / 13), fw, Math.ceil(fh / 13) + 0.5);
    x.fillStyle = "#3c3b6e"; x.fillRect(fx, fy, fw * 0.42, Math.round(fh * 7 / 13));
    // vertical wordmark reading upward
    x.save();
    x.translate(W * 0.60, H * 0.60); x.rotate(-Math.PI / 2);
    x.fillStyle = "#20242c";
    x.font = "700 148px 'Helvetica Neue', Arial, sans-serif";
    x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText(text || "SpaceX", 0, 0);
    x.restore();
    const t = new THREE.CanvasTexture(c); t.anisotropy = 8; t.needsUpdate = true; return t;
  }

  // open-truss lattice decal (transparent gaps + near-black struts): verticals + X cross-bracing.
  // Applied to a double-sided cylinder shell so you see the far struts through the near gaps,
  // reading as the see-through interstage lattice between Soyuz's core and upper stage.
  function makeLatticeTexture() {
    const c = document.createElement("canvas"); c.width = 128; c.height = 72;
    const x = c.getContext("2d");
    x.clearRect(0, 0, 128, 72);
    x.strokeStyle = "#15150f"; x.lineCap = "round";
    x.lineWidth = 6;
    for (let i = 0; i <= 8; i++) { const px = i * 16; x.beginPath(); x.moveTo(px, 0); x.lineTo(px, 72); x.stroke(); }  // verticals
    x.lineWidth = 4;
    for (let i = 0; i < 8; i++) { const px = i * 16;                                                                   // X bracing
      x.beginPath(); x.moveTo(px, 0); x.lineTo(px + 16, 72); x.stroke();
      x.beginPath(); x.moveTo(px + 16, 0); x.lineTo(px, 72); x.stroke(); }
    const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.repeat.set(12, 1); t.anisotropy = 4; return t;
  }

  // vertical СОЮЗ (red Cyrillic) + a small Russian tricolour, painted on a body-white decal
  // for the fairing. Filling the background with the fairing colour (rather than a transparent
  // canvas) lets the patch blend into the body, the same trick makeFlagTexture uses.
  function makeSoyuzTexture() {
    const W = 240, H = 920;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const x = c.getContext("2d");
    x.clearRect(0, 0, W, H);                                // transparent: only the markings draw (alphaTest cutout)
    // Russian tricolour (white / blue / red) near the top
    const fw = W * 0.56, fh = fw * 0.66, fx = (W - fw) / 2, fy = H * 0.045, bh = fh / 3;
    x.fillStyle = "#ffffff"; x.fillRect(fx, fy, fw, bh);
    x.fillStyle = "#0039a6"; x.fillRect(fx, fy + bh, fw, bh);
    x.fillStyle = "#d52b1e"; x.fillRect(fx, fy + 2 * bh, fw, bh);
    x.strokeStyle = "#c9ced8"; x.lineWidth = 1.5; x.strokeRect(fx, fy, fw, fh);
    // vertical СОЮЗ in red, reading upward
    x.save();
    x.translate(W * 0.54, H * 0.62); x.rotate(-Math.PI / 2);
    x.fillStyle = "#bf2a24";
    x.font = "700 152px Arial, sans-serif";
    x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText("СОЮЗ", 0, 0);
    x.restore();
    const t = new THREE.CanvasTexture(c); t.anisotropy = 8; t.needsUpdate = true; return t;
  }

  // agency logos, painted on a body-colour decal (so the patch blends into the body like the
  // flag). `kind`: "meatball" (round NASA insignia), "worm" (red NASA logotype), "esa",
  // "roscosmos" (Cyrillic wordmark). `bg` is the surface colour behind the logo.
  function makeLogoTexture(kind) {
    if (kind === "meatball") {
      const S = 340;
      const c = document.createElement("canvas"); c.width = c.height = S;
      const x = c.getContext("2d");
      x.clearRect(0, 0, S, S);                                                                       // transparent outside the disc
      const cx = S / 2, cy = S / 2, R = S * 0.44;
      x.fillStyle = "#0b3d91"; x.beginPath(); x.arc(cx, cy, R, 0, Math.PI * 2); x.fill();           // blue disc
      x.fillStyle = "#ffffff";                                                                       // stars
      [[0.30, 0.34, 2.4], [0.63, 0.27, 1.8], [0.71, 0.52, 2.6], [0.40, 0.63, 1.7], [0.55, 0.42, 2.0], [0.67, 0.70, 1.6], [0.33, 0.50, 1.5], [0.50, 0.60, 1.4]]
        .forEach(s => { x.beginPath(); x.arc(S * s[0], S * s[1], s[2], 0, Math.PI * 2); x.fill(); });
      x.save(); x.translate(cx, cy); x.rotate(-0.46);                                                // white orbit ellipse
      x.strokeStyle = "#ffffff"; x.lineWidth = S * 0.016; x.beginPath(); x.ellipse(0, 0, R * 0.86, R * 0.32, 0, 0, Math.PI * 2); x.stroke(); x.restore();
      x.strokeStyle = "#fc3d21"; x.lineWidth = S * 0.05; x.lineCap = "round";                        // red vector swoosh
      x.beginPath(); x.moveTo(cx - R * 0.6, cy + R * 0.24); x.quadraticCurveTo(cx + R * 0.05, cy - R * 0.02, cx + R * 0.66, cy - R * 0.34); x.stroke();
      x.fillStyle = "#ffffff"; x.font = "700 " + Math.round(S * 0.155) + "px Arial, sans-serif";     // NASA
      x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("NASA", cx, cy + R * 0.05);
      const t = new THREE.CanvasTexture(c); t.anisotropy = 8; return t;
    }
    const W = 512, H = 200;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const x = c.getContext("2d");
    x.clearRect(0, 0, W, H);                                // transparent: only the wordmark draws
    x.textAlign = "center"; x.textBaseline = "middle";
    if (kind === "worm") { x.fillStyle = "#fc3d21"; x.font = "800 132px Arial, sans-serif"; x.fillText("NASA", W / 2, H / 2 + 6); }
    else if (kind === "esa") { x.fillStyle = "#0a3a52"; x.font = "800 118px Arial, sans-serif"; x.fillText("ESA", W / 2, H / 2 + 4); }
    else if (kind === "roscosmos") { x.fillStyle = "#13315e"; x.font = "700 88px Arial, sans-serif"; x.fillText("РОСКОСМОС", W / 2, H / 2 + 4); }
    const t = new THREE.CanvasTexture(c); t.anisotropy = 8; return t;
  }

  // which broad role a part plays, used for exploding, fading and revealing
  function roleOf(kind) {
    if (kind === "stage" || kind === "cone" || kind === "nose") return "shell";
    if (kind === "internal") return "internal";
    if (kind === "rollpattern" || kind === "flag" || kind === "brand" || kind === "band" || kind === "soyuzmark" || kind === "logo") return "surface";
    return "attach";
  }

  function buildRocket(spec) {
    const group = new THREE.Group();
    const componentMap = {};                  // id -> { meshes, material, data, role, stage }
    const stageRange = {};                     // shell id -> { base, top }
    const stacked = spec.parts.filter(p => ["stage", "cone", "nose"].includes(p.kind));
    const baseR = stacked.length ? stacked[0].rb : 3;

    // While building an off-axis sub-assembly (a booster, the orbiter) this holds its
    // centre so every mesh in it explodes outward together as a rigid unit, instead of
    // each mesh flying off along its own radius (which would tear the orbiter apart).
    let _anchor = null;

    // helper to register a mesh under a component id
    function reg(part, mesh, material) {
      mesh.userData.cid = part.id;
      if (_anchor) mesh.userData.explodeAnchor = _anchor;
      if (!componentMap[part.id]) componentMap[part.id] = {
        meshes: [], material: material, data: part,
        role: roleOf(part.kind), stage: part.stage || part.id
      };
      componentMap[part.id].meshes.push(mesh);
      group.add(mesh);
    }

    // register a mesh under an EXPLICIT component id + role, when one builder emits
    // several distinct components (e.g. the SRB makes a ghostable casing shell, a
    // revealable propellant grain, a nozzle and joint bands from one part entry).
    // `data` must carry { id, label, purpose, stage } for the tooltip + reveal to work.
    function regAs(id, mesh, material, role, data) {
      mesh.userData.cid = id;
      if (_anchor) mesh.userData.explodeAnchor = _anchor;
      if (!componentMap[id]) componentMap[id] = {
        meshes: [], material: material, data: data, role: role, stage: data.stage || id
      };
      componentMap[id].meshes.push(mesh);
      group.add(mesh);
    }

    // build one rocket engine: a properly CURVED bell nozzle (lathed profile) with a
    // combustion chamber sitting at the throat. Top at yTop, at (x,z).
    function addEngine(p, mtl, x, z, yTop, hidden) {
      const h = p.h, rExit = p.r, rThroat = Math.max(0.08, p.r * 0.26);
      const put = (mesh) => { mesh.visible = !hidden; reg(p, mesh, mtl); };
      // bell profile: narrow throat curving out to the wide exit (bell shape, not a cone)
      const pts = [], N = 14;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const rr = rThroat + (rExit - rThroat) * Math.pow(t, 1.9);
        pts.push(new THREE.Vector2(Math.max(0.02, rr), -t * h));
      }
      const bellGeo = new THREE.LatheGeometry(pts, 36);
      const bell = new THREE.Mesh(bellGeo, mtl);
      bell.position.set(x, yTop, z); put(bell);
      // combustion chamber / injector sitting on the throat
      const chamber = new THREE.Mesh(new THREE.SphereGeometry(rThroat * 1.7, 18, 14), mtl);
      chamber.scale.y = 0.9; chamber.position.set(x, yTop + rThroat * 0.6, z); put(chamber);
    }

    // place a ring of engines (with an optional centre one), reused by F-1 and J-2
    function placeEngines(p, mtl, yTop, hidden) {
      const centerCount = (p.count % 2 === 1 && p.count >= 5) ? 1 : 0;
      const ring = p.count - centerCount;
      if (centerCount) addEngine(p, mtl, 0, 0, yTop, hidden);
      for (let i = 0; i < ring; i++) {
        const a = (i / ring) * Math.PI * 2;
        addEngine(p, mtl, Math.cos(a) * p.spread, Math.sin(a) * p.spread, yTop, hidden);
      }
    }

    // ---- pass 1: stacked body parts, bottom to top ----
    let y = 0;
    const topOf = {};                         // remembers the top height of each stacked part
    for (const p of stacked) {
      const m = mat(p.color, p.metal, p.rough, !p.truss);
      const yb = y, yt = y + p.h;
      if (p.truss) {
        // open lattice ring so students see the staging structure through it
        const N = 10, t = Math.max(0.06, p.rb * 0.03);
        const bR = p.rb, tR = p.rt == null ? p.rb : p.rt;
        for (let i = 0; i < N; i++) {
          const a = (i / N) * Math.PI * 2, a2 = ((i + 1) / N) * Math.PI * 2;
          const b0 = new THREE.Vector3(Math.cos(a) * bR, yb, Math.sin(a) * bR);
          const t0 = new THREE.Vector3(Math.cos(a) * tR, yt, Math.sin(a) * tR);
          const b1 = new THREE.Vector3(Math.cos(a2) * bR, yb, Math.sin(a2) * bR);
          reg(p, strutMesh(m, b0, t0, t), m);              // upright
          reg(p, strutMesh(m, t0, b1, t), m);              // diagonal
        }
        const ringB = new THREE.Mesh(new THREE.TorusGeometry(bR, t, 6, 40), m);
        ringB.rotation.x = Math.PI / 2; ringB.position.y = yb; reg(p, ringB, m);
        const ringT = new THREE.Mesh(new THREE.TorusGeometry(tR, t, 6, 40), m);
        ringT.rotation.x = Math.PI / 2; ringT.position.y = yt; reg(p, ringT, m);
      } else if (p.escape) {
        // launch escape system: lattice tower, solid motor, canted nozzles, nose ballast
        const h = p.h, rTow = p.rb * 0.42, rMot = p.rb * 0.72, t = Math.max(0.04, p.rb * 0.06);
        const towTop = yb + h * 0.4, motH = h * 0.34;
        for (let i = 0; i < 4; i++) {
          const a = i / 4 * Math.PI * 2 + Math.PI / 4, a2 = (i + 1) / 4 * Math.PI * 2 + Math.PI / 4;
          const b0 = new THREE.Vector3(Math.cos(a) * rTow, yb, Math.sin(a) * rTow);
          const t0 = new THREE.Vector3(Math.cos(a) * rTow * 0.8, towTop, Math.sin(a) * rTow * 0.8);
          const b1 = new THREE.Vector3(Math.cos(a2) * rTow, yb, Math.sin(a2) * rTow);
          reg(p, strutMesh(m, b0, t0, t), m);
          reg(p, strutMesh(m, t0, b1, t), m);
        }
        const motor = new THREE.Mesh(new THREE.CylinderGeometry(rMot, rMot, motH, 20), m);
        motor.position.y = towTop + motH / 2; reg(p, motor, m);
        for (let i = 0; i < 4; i++) {                     // canted escape nozzles
          const a = i / 4 * Math.PI * 2;
          const nz = new THREE.Mesh(new THREE.CylinderGeometry(0.05, p.rb * 0.2, motH * 0.5, 10, 1, true), m);
          nz.position.set(Math.cos(a) * rMot * 0.7, towTop + motH * 0.1, Math.sin(a) * rMot * 0.7);
          nz.rotation.z = -Math.cos(a) * 0.5; nz.rotation.x = Math.sin(a) * 0.5;
          reg(p, nz, m);
        }
        const nose = new THREE.Mesh(new THREE.ConeGeometry(rMot * 0.7, h * 0.26, 20), m);
        nose.position.y = towTop + motH + h * 0.13; reg(p, nose, m);
      } else if (p.kind === "nose") {
        const mesh = new THREE.Mesh(new THREE.ConeGeometry(p.rb, p.h, 48), m);
        mesh.position.y = y + p.h / 2; reg(p, mesh, m);
      } else {
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(p.rt, p.rb, p.h, 48, 1, false), m);
        mesh.position.y = y + p.h / 2; reg(p, mesh, m);
      }
      stageRange[p.id] = { base: y, top: y + p.h };
      y += p.h;
      topOf[p.id] = y;
    }
    const totalH = y;

    // ---- pass 2: attachments ----
    for (const p of spec.parts) {
      if (["stage", "cone", "nose"].includes(p.kind)) continue;
      const m = mat(p.color == null ? 0xffffff : p.color, p.metal, p.rough, p.kind === "boosters");

      if (p.kind === "nozzles") {
        const yBase = (p.attach === "orbiter") ? totalH * 0.32 : 0;
        placeEngines(p, m, yBase, false);
      }

      else if (p.kind === "thrust") {
        // thrust structure: a ring plus radial beams that hold the engines
        const r = baseR * 0.82, yc = p.y == null ? 1.6 : p.y;
        const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.28, 8, 36), m);
        ring.rotation.x = Math.PI / 2; ring.position.y = yc; reg(p, ring, m);
        for (let i = 0; i < 8; i++) {
          const a = i / 8 * Math.PI * 2;
          reg(p, strutMesh(m, new THREE.Vector3(0, yc, 0),
            new THREE.Vector3(Math.cos(a) * r, yc, Math.sin(a) * r), 0.16), m);
        }
      }

      else if (p.kind === "avionics") {
        // a ring of equipment boxes around a stage (the guidance electronics)
        const sr = stageRange[p.stage]; if (!sr) continue;
        const yc = (sr.base + sr.top) / 2, bh = (sr.top - sr.base) * 0.62, r = p.r;
        for (let i = 0; i < p.count; i++) {
          const a = i / p.count * Math.PI * 2;
          const box = new THREE.Mesh(new THREE.BoxGeometry(r * 0.34, bh, r * 0.26), m);
          box.position.set(Math.cos(a) * r, yc, Math.sin(a) * r); box.rotation.y = -a;
          reg(p, box, m);
        }
      }

      else if (p.kind === "rcs") {
        // reaction control thruster quads around a stage (small steering jets)
        const sr = stageRange[p.stage]; if (!sr) continue;
        const yc = sr.base + (sr.top - sr.base) * (p.yFrac == null ? 0.6 : p.yFrac), r = p.r;
        for (let j = 0; j < 4; j++) {
          const a = j / 4 * Math.PI * 2 + Math.PI / 4;
          const blk = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.4), m);
          blk.position.set(Math.cos(a) * r, yc, Math.sin(a) * r); blk.rotation.y = -a; reg(p, blk, m);
          for (let k = 0; k < 2; k++) {
            const nz = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 0.24, 8), m);
            nz.position.set(Math.cos(a) * (r + 0.2), yc - 0.12 + k * 0.24, Math.sin(a) * (r + 0.2));
            nz.rotation.z = -Math.cos(a) * Math.PI / 2; nz.rotation.x = Math.sin(a) * Math.PI / 2;
            reg(p, nz, m);
          }
        }
      }

      else if (p.kind === "heatshield") {
        // blunt shield on the base of the capsule that takes the reentry heat
        const sr = stageRange[p.stage]; if (!sr) continue;
        const dome = new THREE.Mesh(new THREE.SphereGeometry(p.r, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.34), m);
        dome.position.y = sr.base + 0.15; dome.rotation.x = Math.PI; reg(p, dome, m);
      }

      else if (p.kind === "fins") {
        if (p.leg) {
          // landing legs STOWED flat against the body base. Tagged so the launch sim can hide
          // these and swap in fresh hinged legs that swing out for the touchdown.
          for (let i = 0; i < p.count; i++) {
            const a = (i / p.count) * Math.PI * 2 + Math.PI / 4;
            const strut = new THREE.Mesh(new THREE.BoxGeometry(p.t, p.h, p.w), m);
            strut.position.set(Math.cos(a) * (baseR + p.t * 0.5), p.h * 0.46, Math.sin(a) * (baseR + p.t * 0.5));
            strut.rotation.y = -a;
            strut.userData.legPart = true;
            reg(p, strut, m);
          }
        } else {
          const yBias = p.yBias == null ? 0 : p.yBias;
          const yc = (yBias > 0) ? totalH * yBias : p.h / 2;
          // grid fins render as a flat titanium waffle panel; plain fins stay solid boxes
          const fm = p.grid ? mat(p.color || 0x585d68, p.metal != null ? p.metal : 0.6, p.rough != null ? p.rough : 0.45) : m;
          if (p.grid) { fm.map = makeGridTexture(); fm.needsUpdate = true; }
          const geo = new THREE.BoxGeometry(p.t, p.h, p.w);
          for (let i = 0; i < p.count; i++) {
            const a = (i / p.count) * Math.PI * 2 + Math.PI / 4;
            const fin = new THREE.Mesh(geo, fm);
            fin.position.set(Math.cos(a) * (baseR + p.w / 2), yc, Math.sin(a) * (baseR + p.w / 2));
            fin.rotation.y = -a;
            reg(p, fin, fm);
          }
        }
      }

      // ---- SLS-style five-segment solid rocket booster, built to CUTAWAY ----
      // One part entry emits four components: the casing SHELL (ghosts on reveal),
      // the propellant GRAIN with a hollow star bore (revealed on reveal), the
      // gimbaling NOZZLE and the field-JOINT bands (both stay solid, so the segment
      // count still reads once the casing goes see-through). Two boosters share each
      // component so hovering either shows one tooltip.
      else if (p.kind === "srb") {
        const off = baseR + p.r + 0.2;
        const r = p.r, h = p.h, seg = p.segments || 5;
        // vertical budget (fractions of total height, bottom to top)
        const aftH = h * 0.07, caseH = h * 0.66, fwdH = h * 0.06, fruH = h * 0.13, noseH = h * 0.08;
        const caseBase = aftH, caseTop = caseBase + caseH;

        // materials
        const caseM = mat(p.color, p.metal == null ? 0.35 : p.metal, p.rough == null ? 0.5 : p.rough, true);
        const skirtM = mat(0xd7dae2, 0.55, 0.45);
        const jointM = mat(0x9aa1ad, 0.7, 0.4);
        const nozM = mat(0x33363f, 0.7, 0.4);
        // propellant grain: matte cast APCP, warm grey. Own reveal material (starts hidden).
        const grainM = mat(p.grainColor || 0x8f887a, 0.1, 0.9, false);
        grainM.transparent = true; grainM.opacity = 0; grainM.depthWrite = false;
        const boreM = mat(0x35312a, 0.15, 0.9, false);        // dark charred bore lining
        boreM.transparent = true; boreM.opacity = 0; boreM.depthWrite = false; boreM.side = THREE.DoubleSide;
        // optional parachute-recovery pack (Shuttle SRBs came home under chutes; SLS ones don't)
        const chuteM = mat(0xd2d6de, 0.2, 0.6, false); chuteM.transparent = true; chuteM.opacity = 0; chuteM.depthWrite = false;
        const chuteData = { id:"srb-chute", stage:"srb", label:(p.recovery||{}).label || "Parachute Pack", purpose:(p.recovery||{}).purpose || "" };

        const shellData = p;                                    // casing uses the part's own label/purpose
        const grainData  = { id:"srb-grain",  stage:"srb", label:(p.grain||{}).label  || "Solid Propellant Grain", purpose:(p.grain||{}).purpose  || "" };
        const nozData    = { id:"srb-nozzle", stage:"srb", label:(p.nozzle||{}).label || "Booster Nozzle",         purpose:(p.nozzle||{}).purpose || "" };
        const jointData  = { id:"srb-joints", stage:"srb", label:(p.joints||{}).label || "Field Joints",           purpose:(p.joints||{}).purpose || "" };

        // a solid-propellant grain segment: outer disc of propellant with a hollow
        // bore (round or star) punched down the middle, extruded to `depth` and stood up.
        function grainSeg(outerR, boreShape, depth, x, z, yBase) {
          const shape = new THREE.Shape();
          shape.absarc(0, 0, outerR, 0, Math.PI * 2, false);
          shape.holes.push(boreShape);
          const geo = new THREE.ExtrudeGeometry(shape, { depth: depth, bevelEnabled: false, curveSegments: 48, steps: 1 });
          geo.rotateX(-Math.PI / 2);                            // extrude axis +Z -> stand up along +Y
          geo.computeVertexNormals();
          const mesh = new THREE.Mesh(geo, grainM);
          mesh.position.set(x, yBase, z); mesh.visible = false;
          regAs("srb-grain", mesh, grainM, "internal", grainData);
        }
        function roundBore(rad) {
          const p2 = new THREE.Path(); p2.absarc(0, 0, rad, 0, Math.PI * 2, true); return p2;
        }
        function starBore(ro, ri, points) {
          const p2 = new THREE.Path();
          for (let k = 0; k <= points * 2; k++) {
            const ang = -k / (points * 2) * Math.PI * 2;        // clockwise so it reads as a hole
            const rr = (k % 2) ? ri : ro;
            const px = Math.cos(ang) * rr, py = Math.sin(ang) * rr;
            k === 0 ? p2.moveTo(px, py) : p2.lineTo(px, py);
          }
          return p2;
        }

        for (let i = 0; i < p.count; i++) {
          const a = ((i / p.count) * Math.PI * 2) + (p.angle || 0) * Math.PI / 180;
          const cx = Math.cos(a) * off, cz = Math.sin(a) * off;
          _anchor = new THREE.Vector3(cx, 0, cz);          // this booster explodes as one unit

          // --- casing shell (ghostable) ---
          const aft = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.06, aftH, 32), skirtM);
          aft.position.set(cx, aftH / 2, cz); regAs("srb", aft, caseM, "shell", shellData);
          const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, caseH, 32), caseM);
          body.position.set(cx, caseBase + caseH / 2, cz); regAs("srb", body, caseM, "shell", shellData);
          const fwd = new THREE.Mesh(new THREE.CylinderGeometry(r, r, fwdH, 32), skirtM);
          fwd.position.set(cx, caseTop + fwdH / 2, cz); regAs("srb", fwd, caseM, "shell", shellData);
          const fru = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.42, r, fruH, 32), skirtM);
          fru.position.set(cx, caseTop + fwdH + fruH / 2, cz); regAs("srb", fru, caseM, "shell", shellData);
          const nose = new THREE.Mesh(new THREE.ConeGeometry(r * 0.42, noseH, 28), skirtM);
          nose.position.set(cx, caseTop + fwdH + fruH + noseH / 2, cz); regAs("srb", nose, caseM, "shell", shellData);
          // external systems tunnel: the cable/ordnance conduit running up the outboard side
          const tunH = caseH + fwdH;
          const tun = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.1, r * 0.1, tunH, 12), skirtM);
          const ta = a + Math.PI * 0.5;                          // set it a quarter around, facing away from core
          tun.position.set(cx + Math.cos(ta) * r * 1.02, caseBase + tunH / 2, cz + Math.sin(ta) * r * 1.02);
          regAs("srb", tun, caseM, "shell", shellData);

          // --- field-joint bands (stay solid: keeps the 5-segment read when ghosted) ---
          for (let s = 1; s < seg; s++) {
            const jy = caseBase + (caseH * s) / seg;
            const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.015, r * 0.05, 10, 40), jointM);
            ring.rotation.x = Math.PI / 2; ring.position.set(cx, jy, cz);
            regAs("srb-joints", ring, jointM, "attach", jointData);
          }

          // --- nozzle (stays solid) : lathed bell, throat tucked into the aft skirt ---
          const exitR = r * 0.6, throatR = r * 0.17, nozH = h * 0.1;
          const prof = [];
          for (let j = 0; j <= 12; j++) { const t = j / 12; prof.push(new THREE.Vector2(throatR + (exitR - throatR) * Math.pow(t, 1.7), -t * nozH)); }
          const noz = new THREE.Mesh(new THREE.LatheGeometry(prof, 28), nozM);
          noz.position.set(cx, aftH * 0.55, cz); regAs("srb-nozzle", noz, nozM, "attach", nozData);

          // --- propellant grain (revealed) : cylindrical bore below, star bore up top ---
          const gOut = r * 0.9;
          const aftGrainH = caseH * 0.62, fwdGrainH = caseH - aftGrainH;
          grainSeg(gOut, roundBore(r * 0.34), aftGrainH, cx, cz, caseBase);
          grainSeg(gOut, starBore(r * 0.42, r * 0.22, 11), fwdGrainH, cx, cz, caseBase + aftGrainH);
          // dark charred lining down the hollow bore, so it reads as a deep channel not a flat hole
          const bore = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.33, r * 0.33, caseH * 0.9, 22, 1, true), boreM);
          bore.position.set(cx, caseBase + caseH * 0.46, cz); bore.visible = false;
          regAs("srb-grain", bore, boreM, "internal", grainData);

          // recovery gear stowed in the forward frustum (Shuttle only)
          if (p.recovery) {
            const packH = fruH * 0.7;
            const pack = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.34, r * 0.34, packH, 18), chuteM);
            pack.position.set(cx, caseTop + fwdH + fruH * 0.45, cz); pack.visible = false;
            regAs("srb-chute", pack, chuteM, "internal", chuteData);
          }
        }
        _anchor = null;
      }

      // Strap-on boosters. Plain solid cones by default; if the part carries a
      // `tanks` list they become LIQUID-rocket cutaways (Soyuz): the tapered shell
      // ghosts on reveal to show each booster's own oxidiser + fuel tanks and engine,
      // making the "every booster is a little rocket" point that contrasts with the
      // solid SRBs. Tanks follow the cone taper so they nest inside the shell.
      else if (p.kind === "boosters") {
        const off = baseR + p.r + 0.15;
        const rt = (p.taper != null) ? p.taper : p.r;
        const liquid = Array.isArray(p.tanks);
        const rAt = (y) => p.r + (rt - p.r) * (y / p.h);     // shell radius at height y (0..h)
        const makeIm = (col, mt, rg) => { const im = mat(col, mt == null ? 0.3 : mt, rg == null ? 0.45 : rg, false); im.transparent = true; im.opacity = 0; im.depthWrite = false; return im; };
        const domeGeo = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
        for (let i = 0; i < p.count; i++) {
          const a = ((i / p.count) * Math.PI * 2) + (p.angle || 0) * Math.PI / 180;
          const cx = Math.cos(a) * off, cz = Math.sin(a) * off;
          _anchor = new THREE.Vector3(cx, 0, cz);          // this booster explodes as one unit
          const body = new THREE.Mesh(new THREE.CylinderGeometry(rt, p.r, p.h, 32), m);
          body.position.set(cx, p.h / 2, cz);
          liquid ? regAs(p.id, body, m, "shell", p) : reg(p, body, m);
          if (p.cone) {
            const cm = mat(p.coneColor || p.color, p.metal, p.rough, true);
            const cone = new THREE.Mesh(new THREE.ConeGeometry(rt, p.cone, 28), cm);
            cone.position.set(cx, p.h + p.cone / 2, cz);
            liquid ? regAs(p.id, cone, cm, "shell", p) : reg(p, cone, cm);
          }
          if (!liquid) continue;
          // internal tanks (each spans y0..y1 as fractions of h, tapered to nest in the shell)
          p.tanks.forEach(t => {
            const y0 = t.y0 * p.h, y1 = t.y1 * p.h, yc = (y0 + y1) / 2, h2 = y1 - y0;
            const rb2 = rAt(y0) * 0.82, rt2 = rAt(y1) * 0.82;
            const im = makeIm(t.color, t.metal, t.rough);
            const tid = p.id + "-" + t.id, td = { id: tid, stage: p.stage || p.id, label: t.label, purpose: t.purpose };
            const tank = new THREE.Mesh(new THREE.CylinderGeometry(rt2, rb2, h2, 24), im);
            tank.position.set(cx, yc, cz); tank.visible = false; regAs(tid, tank, im, "internal", td);
            const dT = new THREE.Mesh(domeGeo, im); dT.position.set(cx, y1, cz); dT.scale.set(rt2, rt2 * 0.5, rt2); dT.visible = false; regAs(tid, dT, im, "internal", td);
            const dB = new THREE.Mesh(domeGeo, im); dB.position.set(cx, y0, cz); dB.rotation.x = Math.PI; dB.scale.set(rb2, rb2 * 0.5, rb2); dB.visible = false; regAs(tid, dB, im, "internal", td);
          });
          // engine: a cluster of nozzles at the base
          if (p.engine) {
            const im = makeIm(0x33363f, 0.7, 0.4);
            const ec = p.engine.count || 4, er = p.engine.r || 0.32, eh = p.engine.h || 1.5, esp = p.engine.spread == null ? 0.55 : p.engine.spread;
            const ed = { id: p.id + "-eng", stage: p.stage || p.id, label: p.engine.label, purpose: p.engine.purpose };
            for (let k = 0; k < ec; k++) {
              const ea = k / ec * Math.PI * 2 + Math.PI / 4;
              const noz = new THREE.Mesh(new THREE.CylinderGeometry(er * 0.42, er, eh, 16, 1, true), im);
              noz.position.set(cx + Math.cos(ea) * esp, -eh * 0.15, cz + Math.sin(ea) * esp); noz.visible = false;
              regAs(p.id + "-eng", noz, im, "internal", ed);
            }
          }
        }
        _anchor = null;
      }

      // deployed solar-array wings radiating from a stage, for a spacecraft payload.
      // With p.reveal set they are hidden until the stage is opened (so the launch
      // silhouette stays clean and the arrays "deploy" on inspection, like the real ones).
      else if (p.kind === "panels") {
        const sr = stageRange[p.stage]; if (!sr) continue;
        const yc = sr.base + (p.yFrac == null ? 0.5 : p.yFrac) * (sr.top - sr.base);
        const reveal = !!p.reveal;
        const pm = mat(p.color || 0x2a4a8c, 0.35, 0.4, false);   // deep-blue solar cells
        const fm = mat(0xc2c7d0, 0.6, 0.4, false);               // light frame / mast
        if (reveal) [pm, fm].forEach(mm => { mm.transparent = true; mm.opacity = 0; mm.depthWrite = false; });
        const addP = (mesh, mtl) => { if (reveal) { mesh.visible = false; regAs(p.id, mesh, mtl, "internal", p); } else reg(p, mesh, mtl); };
        const inner = p.inner == null ? 2.6 : p.inner, len = p.len || 6, wid = p.wid || 2.6;
        for (let i = 0; i < p.count; i++) {
          const a = (i / p.count) * Math.PI * 2 + (p.angle || 0);
          const cxr = Math.cos(a), czr = Math.sin(a);
          const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, len * 0.4, 8), fm);
          mast.position.set(cxr * (inner + len * 0.18), yc, czr * (inner + len * 0.18));
          mast.rotation.y = -a; mast.rotation.z = Math.PI / 2; addP(mast, fm);
          // a tall flat wing standing vertically, extending radially outward
          const panel = new THREE.Mesh(new THREE.BoxGeometry(len, wid, 0.12), pm);
          panel.position.set(cxr * (inner + len / 2 + 0.3), yc, czr * (inner + len / 2 + 0.3));
          panel.rotation.y = -a; addP(panel, pm);
        }
      }

      // a vented ring (open cylinder split into wall segments with gaps between them),
      // e.g. Starship's hot-stage ring that lets the ship's exhaust blast through at staging
      else if (p.kind === "ring") {
        const sr = stageRange[p.stage];
        const yc = p.at != null ? p.at : (sr ? sr.top - (p.h || 2) / 2 : totalH);
        const rr = p.r, h = p.h || 2, seg = p.gaps || 12;
        const ratio = p.solid == null ? 0.72 : p.solid;     // fraction of each segment that is wall (rest is a vent gap)
        // solid framing bands top and bottom so the slots read as an intentional vented ring, not floating teeth
        const bandH = h * 0.24;
        for (const by of [yc - h / 2 + bandH / 2, yc + h / 2 - bandH / 2]) {
          const band = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr, bandH, 44, 1, true), m);
          band.position.y = by; reg(p, band, m);
        }
        // vented wall segments spanning the gap between the two bands
        const slotH = h - bandH * 2;
        for (let i = 0; i < seg; i++) {
          const a0 = (i / seg) * Math.PI * 2, span = (Math.PI * 2 / seg) * ratio;
          const wall = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr, slotH, 8, 1, true, a0, span), m);
          wall.position.y = yc; reg(p, wall, m);
        }
      }

      else if (p.kind === "spire") {
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r, p.h, 12), m);
        rod.position.y = totalH + p.h / 2;
        reg(p, rod, m);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(p.r * 2, p.r * 3, 12), m);
        tip.position.y = totalH + p.h + p.r * 1.5;
        reg(p, tip, m);
      }

      // The Shuttle orbiter, modelled to actually look like the real spaceplane:
      // a flattened fuselage with a rounded nose, black tile belly, double-delta
      // wings, a swept vertical tail, two OMS pods, three main engines clustered at
      // the tail, and a satellite tucked in the payload bay (revealed on click).
      // Everything shares one explode anchor so the whole orbiter peels away as a unit.
      else if (p.kind === "orbiter") {
        const off = baseR + 2.9;
        _anchor = new THREE.Vector3(off, 0, 0);
        const white = mat(p.color || 0xeef1f6, 0.12, 0.5);
        const black = mat(0x181a20, 0.25, 0.5);
        const dark = mat(0x2a2d36, 0.55, 0.4);
        const cy = totalH * 0.22;                          // aft (engine) plane in stack Y
        const FL = totalH * 0.66;                          // fuselage length nose-to-tail
        const flatX = 0.82, wideZ = 1.16;                  // squash belly-to-top, widen the span

        // fuselage: a smooth lathed body, flattened in X and widened in Z
        const prof = [[0.0, 2.0], [0.13, 2.3], [0.5, 2.3], [0.72, 2.1], [0.85, 1.6], [0.94, 0.95], [1.0, 0.18]]
          .map(([t, r]) => new THREE.Vector2(Math.max(0.05, r), t * FL));
        const orbData = p;                                 // fuselage shell uses the part's label/purpose
        const fus = new THREE.Mesh(new THREE.LatheGeometry(prof, 28), white);
        fus.scale.set(flatX, 1, wideZ); fus.position.set(off, cy, 0);
        regAs("orb", fus, white, "shell", orbData);        // ghosts on click to reveal the payload
        // black RCC nose cap
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.72, 16, 12), black);
        cap.scale.set(flatX, 1.5, wideZ); cap.position.set(off, cy + FL * 0.965, 0);
        regAs("orb", cap, black, "shell", orbData);
        // black thermal-tile belly slab on the inboard underside (faces the tank)
        const belly = new THREE.Mesh(new THREE.BoxGeometry(0.6, FL * 0.86, 3.2), black);
        belly.position.set(off - 1.5, cy + FL * 0.45, 0);
        regAs("orb", belly, black, "shell", orbData);

        // ---- wings, tail, OMS pods, body flap: solid frame (component "orb-body") ----
        const frameData = { id: "orb-body", stage: "orb", label: "Wings and Tail", purpose: "The delta wings and vertical tail let the orbiter glide down through the air and land on a runway like a very heavy aeroplane, with no engines running." };
        const wingWhite = mat(p.color || 0xeef1f6, 0.12, 0.5); wingWhite.side = THREE.DoubleSide;
        const cyc = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 1, 1).normalize(), Math.PI * 2 / 3);
        function wing(sign) {                              // double-delta planform, thin extrude
          const s = new THREE.Shape();
          s.moveTo(FL * 0.03, 0); s.lineTo(FL * 0.80, 0);
          s.lineTo(FL * 0.55, sign * 4.4); s.lineTo(FL * 0.20, sign * 9.8); s.closePath();
          const g = new THREE.ExtrudeGeometry(s, { depth: 0.5, bevelEnabled: false, steps: 1, curveSegments: 1 });
          g.translate(0, 0, -0.25); g.applyMatrix4(cyc);     // shape(foreaft,span,thick) -> world(Y,Z,X)
          const w = new THREE.Mesh(g, wingWhite); w.position.set(off - 0.2, cy, 0);
          regAs("orb-body", w, wingWhite, "attach", frameData);
        }
        wing(1); wing(-1);
        // vertical tail (swept fin standing on the outboard/top side, thin in Z)
        const ts = new THREE.Shape();
        ts.moveTo(0, FL * 0.03); ts.lineTo(0, FL * 0.28); ts.lineTo(6.2, FL * 0.22); ts.lineTo(6.2, FL * 0.10); ts.closePath();
        const tg = new THREE.ExtrudeGeometry(ts, { depth: 0.4, bevelEnabled: false, steps: 1, curveSegments: 1 });
        tg.translate(0, 0, -0.2);
        const tail = new THREE.Mesh(tg, white); tail.position.set(off + 1.3, cy, 0);
        regAs("orb-body", tail, white, "attach", frameData);
        // two OMS pods flanking the tail base
        for (const s of [-1, 1]) {
          const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.8, 4.2, 14), white);
          pod.rotation.x = -0.12; pod.position.set(off + 0.7, cy + FL * 0.11, s * 1.15);
          regAs("orb-body", pod, white, "attach", frameData);
        }
        // body flap under the engines
        const flap = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.4, 3.4), black);
        flap.position.set(off - 0.4, cy - 0.4, 0); regAs("orb-body", flap, black, "attach", frameData);

        // ---- three main engines clustered at the aft (this is where the engines live) ----
        const meData = { id: "me", stage: "orb", label: (p.engines || {}).label || "Main Engines (x3)", purpose: (p.engines || {}).purpose || "" };
        const bell = (dx, dz) => {
          const pts = [];
          for (let j = 0; j <= 10; j++) { const t = j / 10; pts.push(new THREE.Vector2(0.26 + (0.82 - 0.26) * Math.pow(t, 1.7), -t * 2.4)); }
          const b = new THREE.Mesh(new THREE.LatheGeometry(pts, 20), dark);
          b.position.set(off + dx, cy + 0.3, dz); regAs("me", b, dark, "attach", meData);
        };
        bell(0.7, 0); bell(-0.35, 0.95); bell(-0.35, -0.95);

        // ---- payload: a satellite stowed in the bay, revealed when the orbiter opens ----
        if (p.payload) {
          const pm = mat(p.payload.color || 0xcaa94a, 0.5, 0.45, false); pm.transparent = true; pm.opacity = 0; pm.depthWrite = false;
          const pd = { id: "orb-payload", stage: "orb", label: p.payload.label, purpose: p.payload.purpose };
          const put = (mesh) => { mesh.visible = false; regAs("orb-payload", mesh, pm, "internal", pd); };
          const satY = cy + FL * 0.5, satX = off + 0.4;    // sit in the bay, toward the top/outboard
          const drum = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 6, 18), pm);
          drum.position.set(satX, satY, 0); put(drum);
          const dish = new THREE.Mesh(new THREE.SphereGeometry(1.15, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), pm);
          dish.scale.y = 0.5; dish.position.set(satX + 0.9, satY + 3.2, 0); put(dish);
          for (const s of [-1, 1]) {                       // two solar panels
            const panel = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.4, 4.2), pm);
            panel.position.set(satX, satY, s * 4.2); put(panel);
          }
        }
        _anchor = null;
      }

      // black heat-shield tile field hugging the windward side of a stage (Starship belly).
      // Draws a partial cylinder over the stage body and, with p.noseH, continues the
      // stripe up over the nose cone above it.
      else if (p.kind === "tiles") {
        const sr = stageRange[p.stage]; if (!sr) continue;
        const start = p.start == null ? Math.PI * 0.55 : p.start, span = p.span == null ? Math.PI : p.span;
        const tm = mat(0x151515, 0.08, 0.82, false);
        tm.map = makeTileTexture(); tm.map.repeat.set(7, 26);
        tm.polygonOffset = true; tm.polygonOffsetFactor = -2; tm.polygonOffsetUnits = -2;
        const r = p.r, h = sr.top - sr.base, yc = (sr.base + sr.top) / 2;
        const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 48, 1, true, start, span), tm);
        body.position.y = yc; reg(p, body, tm);
        if (p.noseH) {
          const nm = tm.clone(); nm.map = tm.map;
          const cone = new THREE.Mesh(new THREE.ConeGeometry(r, p.noseH, 48, 1, true, start, span), nm);
          cone.position.y = sr.top + p.noseH / 2; reg(p, cone, nm);
        }
      }

      else if (p.kind === "rollpattern") {
        // black markings that hug the first stage (and its top junction)
        const fs = stacked[0];
        const r = fs.rb, top = fs.h;
        const bm = mat(p.color, 0.3, 0.55);
        // Decal-style depth bias so these thin black shells always render cleanly ON TOP of the
        // white body instead of z-fighting with it. The 0.6% radial gap is below the depth
        // buffer's precision at normal viewing distance, which showed up as a jagged black/white
        // comb across the strip. polygonOffset (plus a slightly bigger gap) removes the fight.
        bm.polygonOffset = true; bm.polygonOffsetFactor = -2; bm.polygonOffsetUnits = -2;
        const band = (radius, h, yc) => {
          const mesh = new THREE.Mesh(
            new THREE.CylinderGeometry(radius, radius, h, 48, 1, true), bm);
          mesh.position.y = yc; reg(p, mesh, bm);
        };
        const panel = (radius, h, yc, ts, tl) => {
          const mesh = new THREE.Mesh(
            new THREE.CylinderGeometry(radius, radius, h, 20, 1, true, ts, tl), bm);
          mesh.position.y = yc; reg(p, mesh, bm);
        };
        band(r * 1.012, top * 0.05, top * 0.06);          // band near the base
        band(r * 1.012, top * 0.05, top * 0.9);           // forward band
        // roll-tracking marking: a single clean black band with ONE intentional white bay for the
        // flag and lettering (centred on the flag angle PI/4). One deliberate notch reads far
        // cleaner than four quadrant panels, which left awkward white slits cutting the black.
        panel(r * 1.012, top * 0.2, top * 0.72, Math.PI / 4 + 0.62, Math.PI * 2 - 1.24);
      }

      else if (p.kind === "flag") {
        const fs = stacked[0];
        const r = fs.rb, top = fs.h;
        const tex = makeFlagTexture();
        const fm = new THREE.MeshStandardMaterial({ map: tex, metalness: 0.1, roughness: 0.8 });
        const a = Math.PI / 4;                             // face the opening camera angle
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(r * 0.8, top * 0.36), fm);
        plane.position.set(Math.cos(a) * r * 1.02, top * 0.66, Math.sin(a) * r * 1.02);
        plane.rotation.y = Math.PI / 2 - a;
        reg(p, plane, fm);
      }

      else if (p.kind === "brand") {
        const fs = stacked[0];
        const r = fs.rb;
        const tex = makeBrandTexture(p.text || "SpaceX");
        const bm2 = new THREE.MeshStandardMaterial({ map: tex, transparent: true, metalness: 0.1, roughness: 0.85 });
        const a = Math.PI / 4;                             // same camera-facing side as the flag/opening
        const wgt = r * 0.62;                              // width; plane keeps the texture's 1:6 aspect
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(wgt, wgt * 6), bm2);
        plane.position.set(Math.cos(a) * r * 1.015, fs.h * 0.52, Math.sin(a) * r * 1.015);
        plane.rotation.y = Math.PI / 2 - a;
        reg(p, plane, bm2);
      }

      else if (p.kind === "band") {
        // a thin coloured accent ring hugging a stage at a height fraction, depth-biased so it
        // sits proud of the body (Soyuz's orange + dark bands). p.lattice renders a see-through
        // near-black open truss instead (the interstage between the core and the upper stage).
        const sr = stageRange[p.stage]; if (!sr) continue;
        const r = (p.r == null ? 1.4 : p.r) * 1.012;
        const h = p.h == null ? 0.6 : p.h;
        const yc = sr.base + (p.yFrac == null ? 0.5 : p.yFrac) * (sr.top - sr.base);
        if (p.lattice) {
          const tex = makeLatticeTexture();
          const lm = new THREE.MeshStandardMaterial({ map: tex, color: p.color == null ? 0x171712 : p.color, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, metalness: 0.35, roughness: 0.72 });
          const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 48, 1, true), lm);
          mesh.position.y = yc; reg(p, mesh, lm);
        } else {
          const bm = mat(p.color, p.metal == null ? 0.35 : p.metal, p.rough == null ? 0.6 : p.rough);
          bm.polygonOffset = true; bm.polygonOffsetFactor = -2; bm.polygonOffsetUnits = -2;
          const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 48, 1, true), bm);
          mesh.position.y = yc; reg(p, mesh, bm);
        }
      }

      else if (p.kind === "soyuzmark") {
        // vertical СОЮЗ wordmark + Russian flag decal on the fairing (surface, fades on X-ray)
        const sr = stageRange[p.stage]; if (!sr) continue;
        const r = p.r == null ? 1.45 : p.r;
        const tex = makeSoyuzTexture();
        const dm = new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.3, metalness: 0.1, roughness: 0.8 });
        const a = Math.PI / 4;                             // same camera-facing side as the other decals
        const wgt = r * 0.5;                               // narrow so the flat patch hugs the curve without clipping
        const yc = sr.base + (p.yFrac == null ? 0.58 : p.yFrac) * (sr.top - sr.base);
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(wgt, wgt * (920 / 240)), dm);
        plane.position.set(Math.cos(a) * r * 1.03, yc, Math.sin(a) * r * 1.03);
        plane.rotation.y = Math.PI / 2 - a;
        reg(p, plane, dm);
      }

      else if (p.kind === "logo") {
        // agency logo decal on a stage (surface, fades on X-ray). Flat body-coloured patch that
        // blends into the body, same approach as the flag/soyuz decals.
        const sr = stageRange[p.stage]; if (!sr) continue;
        const r = p.r == null ? 1.5 : p.r;
        const tex = makeLogoTexture(p.logo);
        const dm = new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.3, metalness: 0.1, roughness: 0.8 });
        const a = p.angle == null ? Math.PI / 4 : p.angle;
        const asp = p.logo === "meatball" ? 1 : 2.56;      // width / height of the texture
        const wd = p.w == null ? r * 0.62 : p.w;
        const yc = sr.base + (p.yFrac == null ? 0.5 : p.yFrac) * (sr.top - sr.base);
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(wd, wd / asp), dm);
        plane.position.set(Math.cos(a) * r * 1.02, yc, Math.sin(a) * r * 1.02);
        plane.rotation.y = Math.PI / 2 - a;
        reg(p, plane, dm);
      }

      // ---- internal sub-components (hidden until the stage is opened) ----
      else if (p.kind === "internal") {
        const sr = stageRange[p.stage];
        if (!sr) continue;
        const im = mat(p.color, p.metal == null ? 0.25 : p.metal, p.rough == null ? 0.6 : p.rough, false);
        im.transparent = true; im.opacity = 0; im.depthWrite = false;
        const add = (mesh) => { mesh.visible = false; reg(p, mesh, im); };

        if (p.shape === "nozzles") {                       // detailed engine cluster at the stage base
          placeEngines(p, im, sr.base, true);
        } else if (p.shape === "disc") {                   // common bulkhead shared between two tanks
          const yc = sr.base + p.yFrac * (sr.top - sr.base);
          const dome = new THREE.SphereGeometry(p.r, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.4);
          const d = new THREE.Mesh(dome, im); d.position.y = yc; add(d);
        } else if (p.shape === "sphere") {                 // a pressurant / helium sphere
          const yc = sr.base + p.yFrac * (sr.top - sr.base);
          const s = new THREE.Mesh(new THREE.SphereGeometry(p.r, 20, 16), im);
          s.position.y = yc; add(s);
        } else if (p.shape === "lm") {                     // the folded lunar lander
          const yc = sr.base + p.yFrac * (sr.top - sr.base);
          const desc = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, 1.7, 8), im);
          desc.position.y = yc; add(desc);
          const asc = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 1.5, 8), im);
          asc.position.y = yc + 1.5; add(asc);
          for (let i = 0; i < 4; i++) {                     // four landing legs
            const a = i * Math.PI / 2 + Math.PI / 4;
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.2, 6), im);
            leg.position.set(Math.cos(a) * 1.8, yc - 1.2, Math.sin(a) * 1.8);
            leg.rotation.z = Math.cos(a) * 0.5; leg.rotation.x = -Math.sin(a) * 0.5;
            add(leg);
          }
        } else if (p.shape === "sat") {                    // a modelled satellite: bus + two deploying solar wings + dish
          const yc = sr.base + p.yFrac * (sr.top - sr.base);
          const rev = (mm) => { mm.transparent = true; mm.opacity = 0; mm.depthWrite = false; return mm; };
          const wingM = rev(mat(p.wing || 0x27407e, 0.35, 0.42, false));   // deep-blue solar cells
          const trimM = rev(mat(0xd6dae2, 0.5, 0.4, false));               // light frame / dish
          const R = p.r || 1.1, hb = p.h || 3.2;
          const bus = new THREE.Mesh(new THREE.BoxGeometry(R * 1.5, hb, R * 1.5), im);   // gold-foil body (im = p.color)
          bus.position.y = yc; add(bus);
          const wingLen = p.wingLen || 3.6, wingH = p.wingH || 1.9;
          for (const s of [-1, 1]) {                        // two wings deploy sideways, poking out past the fairing
            const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, R * 1.2, 8), trimM);
            arm.rotation.x = Math.PI / 2; arm.position.set(0, yc, s * (R * 1.1)); add(arm);
            const wing = new THREE.Mesh(new THREE.BoxGeometry(0.1, wingH, wingLen), wingM);
            wing.position.set(0, yc, s * (R + wingLen / 2 + 0.4)); add(wing);
          }
          const dish = new THREE.Mesh(new THREE.SphereGeometry(R * 0.72, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), trimM);
          dish.scale.y = 0.42; dish.position.set(R * 0.5, yc + hb * 0.5 + 0.25, 0); dish.rotation.z = -0.45; add(dish);
        } else if (p.shape === "stack") {                  // a flat-packed stack of satellites (Starlink dispenser)
          const yc = sr.base + p.yFrac * (sr.top - sr.base);
          const n = p.count || 10, H = p.h || 6, R = p.r || 3, gap = H / n;
          for (let k = 0; k < n; k++) {
            const plate = new THREE.Mesh(new THREE.BoxGeometry(R * 1.7, gap * 0.55, R * 1.7), im);
            plate.position.set(0, yc - H / 2 + gap * (k + 0.5), 0);
            plate.rotation.y = k * 0.12; add(plate);
          }
        } else if (p.shape === "feedline") {               // a fuel/oxidiser duct running along a tank
          // a thin pipe offset from the axis, spanning y0..y1 of the stage, with a
          // few support collars. Used for the SLS core LOX line that carries oxygen
          // from the top tank all the way down past the hydrogen tank to the engines.
          const y0 = sr.base + p.y0 * (sr.top - sr.base);
          const y1 = sr.base + p.y1 * (sr.top - sr.base);
          const len = Math.abs(y1 - y0), yc = (y0 + y1) / 2, off = p.off == null ? p.r * 4 : p.off;
          const pipe = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r, len, 16), im);
          pipe.position.set(off, yc, 0); add(pipe);
          const collars = Math.max(2, Math.round(len / 10));
          for (let k = 0; k < collars; k++) {
            const cy = y0 + (len * (k + 0.5)) / collars;
            const col = new THREE.Mesh(new THREE.TorusGeometry(p.r * 1.7, p.r * 0.4, 8, 16), im);
            col.rotation.x = Math.PI / 2; col.position.set(off, cy, 0); add(col);
          }
        } else {                                           // a propellant tank: cylinder + shallow domed ends
          const yc = sr.base + p.yFrac * (sr.top - sr.base);
          // caps: which ends get a dome. Tanks that share a common bulkhead skip the
          // inner end (the bulkhead part is that shared wall), so nothing overlaps.
          const caps = p.caps || "both";
          const body = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r, p.h, 32), im);
          body.position.y = yc; add(body);
          const dome = new THREE.SphereGeometry(p.r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
          const flat = 0.55;                                // shallow ellipsoidal domes, like the real tanks
          if (caps === "both" || caps === "top") {
            const dT = new THREE.Mesh(dome, im); dT.position.y = yc + p.h / 2; dT.scale.y = flat; add(dT);
          }
          if (caps === "both" || caps === "bot") {
            const dB = new THREE.Mesh(dome, im); dB.position.y = yc - p.h / 2; dB.scale.y = flat; dB.rotation.x = Math.PI; add(dB);
          }
          // (removed the little hoop "stringer" rings - at the silhouette they poked out
          // past the tank and read as glitchy dashes floating just outside the rocket)
        }
      }
    }

    return { group, height: totalH, componentMap, stageRange };
  }

  /* ============================================================
     STATE + swapping rockets
     ============================================================ */
  let current = null;                         // { group, height, componentMap }
  let activeRocket = null;                     // the rocket spec currently shown
  let hovered = null;                         // component id under cursor
  let focused = null;                         // component id the camera is focused on
  let appliedF = 0;                           // eased explode amount actually shown

  function showRocket(rocket) {
    if (current) {
      scene.remove(current.pivot);
      disposeGroup(current.group);
    }
    current = buildRocket(rocket);
    activeRocket = rocket;
    computeExplode(current);
    focused = null;
    explodeAmount = 0;
    camMode = "auto";
    if (typeof setXray === "function") setXray(false);

    // wrap the rocket in a pivot so it can tip over about its own middle
    const h = current.height;
    current.group.position.y = -h / 2;         // rocket centre at the pivot origin
    const pivot = new THREE.Group();
    pivot.position.set(0, h / 2, 0);           // assembled: base sits on the pad at y=0
    pivot.add(current.group);
    scene.add(pivot);
    current.pivot = pivot;

    // which stages can be opened to reveal internals (Layer 3)
    current.stagesWithInternals = new Set();
    current.revealAmt = {};
    Object.values(current.componentMap).forEach(c => {
      if (c.role === "internal") current.stagesWithInternals.add(c.stage);
    });
    current.stagesWithInternals.forEach(s => { current.revealAmt[s] = 0; });

    // frame the camera to the standing rocket
    controls.target.set(0, h * 0.5, 0);
    camera.position.set(h * 0.9, h * 0.55, h * 1.25);
    controls.update();

    renderPanel(rocket);
    setActiveChip(rocket.key);
    document.documentElement.style.setProperty("--accent", "#" + rocket.accent.toString(16).padStart(6, "0"));

    // LAUNCH button only for rockets that define a flight profile (launchStages);
    // the others are explorer-only. Sub-label names the current rocket.
    const canLaunch = Array.isArray(rocket.launchStages);
    const lb = el("launchBtn");
    if (lb) lb.style.display = canLaunch ? "" : "none";
    exitTour(true);                       // switching rockets ends a running tour upright
    resetChecklist();                     // every rocket runs its own go/no go poll
    const db = el("diffBtn"); if (db) db.style.display = canLaunch ? "" : "none";   // difficulty only matters for launches
  }

  /* ============================================================
     EXPLODED VIEW  (Layer 2)
     The rocket breaks apart VERTICALLY into its stages. Each whole
     stage (its shell, engines, fins, markings and internal tanks)
     moves together by one offset, so stages separate cleanly with an
     even gap and nothing overlaps. A single explode factor (0..1)
     from the zoom slides everything from home to home+offset.
     ============================================================ */
  function computeExplode(rc) {
    const H = rc.height;
    // order the shells bottom to top and lay them out with an even gap
    const shells = Object.keys(rc.stageRange)
      .map(id => ({ id: id, base: rc.stageRange[id].base, top: rc.stageRange[id].top }))
      .sort((a, b) => a.base - b.base);
    const GAP = H * 0.065;
    const stageOff = {};
    let cursor = shells.length ? shells[0].base : 0;
    shells.forEach((s, i) => {
      const h = s.top - s.base;
      const newBase = (i === 0) ? s.base : cursor + GAP;
      stageOff[s.id] = (newBase + h / 2) - (s.base + h / 2);   // vertical shift only
      cursor = newBase + h;
    });
    rc.stageOff = stageOff;
    // Every mesh gets an explode offset. Parts that belong to a stacked stage slide
    // vertically so the stack pulls apart into its stages. Off-axis parts (strap-on
    // boosters, the Shuttle orbiter) have no stage in the stack, so instead they peel
    // straight OUT sideways, along the direction of their sub-assembly centre, which
    // is what makes a side-mounted stack (Shuttle, SLS, Soyuz) actually break open.
    const OUT = H * 0.42;
    Object.keys(rc.componentMap).forEach(id => {
      const c = rc.componentMap[id];
      const stacked = rc.stageRange[c.stage] != null;
      c.meshes.forEach(m => {
        m.userData.home = m.position.clone();
        if (stacked) {
          m.userData.offset = new THREE.Vector3(0, stageOff[c.stage] || 0, 0);
        } else {
          const a = m.userData.explodeAnchor;
          const hx = a ? a.x : m.position.x, hz = a ? a.z : m.position.z;
          const r = Math.hypot(hx, hz) || 1;
          m.userData.offset = new THREE.Vector3((hx / r) * OUT, 0, (hz / r) * OUT);
        }
      });
    });
  }

  function applyExplode(rc, f) {
    Object.keys(rc.componentMap).forEach(id => {
      rc.componentMap[id].meshes.forEach(m => {
        if (!m.userData.home) return;
        m.position.copy(m.userData.home).addScaledVector(m.userData.offset, f);
      });
    });
  }

  const smooth = (t) => t * t * (3 - 2 * t);

  // ---- framing helpers -------------------------------------------------------
  const _box = new THREE.Box3();
  const _c0 = new THREE.Vector3();      // content centre measured UNROTATED (rocket-local)
  const _half = new THREE.Vector3();    // content half-extents, unrotated
  let _radius = 1;

  // Measure the rocket's own box with the pivot rotation temporarily removed, so we
  // get a stable ORIENTED box. Fitting this (instead of the live world AABB) avoids
  // the "bulge" where a long object's axis-aligned box balloons at 45 degrees and
  // makes the camera zoom out then back in mid-scroll. Matrices are refreshed first,
  // so there is no one-frame lag either.
  function measureContent() {
    if (!current) return false;
    const pivot = current.pivot, rot = pivot.rotation.z;
    pivot.rotation.z = 0; pivot.updateMatrixWorld(true);
    _box.makeEmpty();
    let any = false;
    Object.keys(current.componentMap).forEach(id => {
      current.componentMap[id].meshes.forEach(m => { if (m.visible !== false) { _box.expandByObject(m); any = true; } });
    });
    pivot.rotation.z = rot; pivot.updateMatrixWorld(true);   // restore
    if (!any || _box.isEmpty()) return false;
    _box.getCenter(_c0);
    _box.getSize(_half).multiplyScalar(0.5);
    _radius = _half.length();
    return true;
  }

  // world centre of the (rotated) content, so the camera looks at the true middle
  function contentCenter() {
    const pv = current.pivot.position, th = current.pivot.rotation.z;
    const c = Math.cos(th), s = Math.sin(th);
    const dx = _c0.x - pv.x, dy = _c0.y - pv.y;
    return new THREE.Vector3(pv.x + (c * dx - s * dy), pv.y + (s * dx + c * dy), pv.z + (_c0.z - pv.z));
  }

  // Mobile: the rocket lives in the clear band between the top chrome (topbar + hint
  // pill) and the bottom stack (info sheet / fleet dock / launch). We MEASURE that band
  // and hand fitDistFor + applyLeftBias a stage to fit + centre the rocket into, so text
  // never sits over the rocket. Desktop leaves _ms null (its framing is unchanged).
  let _ms = null, _topbarEl = null;
  function computeMobileStage() {
    const W = window.innerWidth, Hh = window.innerHeight;
    if (W > 720) { _ms = null; return; }
    _topbarEl = _topbarEl || document.querySelector(".topbar");
    let top = _topbarEl ? _topbarEl.getBoundingClientRect().bottom : 56;
    const hint = el("hint");
    if (hint && !hint.classList.contains("hide")) {
      const hb = hint.getBoundingClientRect().bottom;
      if (hb > top) top = hb;
    }
    top += 12;
    // bottom of the stage = the top of the highest visible bottom-docked element
    let botTop = Hh;
    ["panel", "launchBtn", "dock"].forEach(id => {
      const n = el(id);
      if (!n) return;
      const r = n.getBoundingClientRect();
      if (r.height > 0 && r.top > 0 && r.top < Hh && r.top < botTop) botTop = r.top;
    });
    botTop -= 10;
    const stageTop = Math.min(top, Hh * 0.5);
    const stageBot = Math.max(botTop, stageTop + 120);
    const stageH = stageBot - stageTop;
    const stageCentre = (stageTop + stageBot) / 2;
    _ms = {
      offY: Hh / 2 - stageCentre,                 // +ve view-offset lifts the rocket UP
      usableW: 0.9,
      usableH: Math.max(0.28, Math.min(0.96, stageH / Hh))
    };
  }

  // distance that fits the ORIENTED box silhouette (as seen along `dir`) to the view
  function fitDistFor(dir) {
    const th = current.pivot.rotation.z, c = Math.cos(th), s = Math.sin(th);
    const X = new THREE.Vector3(c, s, 0), Y = new THREE.Vector3(-s, c, 0), Z = new THREE.Vector3(0, 0, 1);
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, dir).normalize();
    const cUp = new THREE.Vector3().crossVectors(dir, right).normalize();
    const extR = _half.x * Math.abs(X.dot(right)) + _half.y * Math.abs(Y.dot(right)) + _half.z * Math.abs(Z.dot(right));
    const extU = _half.x * Math.abs(X.dot(cUp)) + _half.y * Math.abs(Y.dot(cUp)) + _half.z * Math.abs(Z.dot(cUp));
    const vFov = camera.fov * Math.PI / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    // desktop keeps clear of the right-side panel; mobile fits the rocket into the
    // measured clear stage (both width AND height) so it never spills into the chrome
    const mobile = window.innerWidth <= 720;
    const usableW = mobile ? (_ms ? _ms.usableW : 0.9) : 0.62;
    const distW = extR / (Math.tan(hFov / 2) * usableW);
    let distH = extU / Math.tan(vFov / 2);
    if (mobile && _ms) distH = extU / (Math.tan(vFov / 2) * _ms.usableH);
    const fit = Math.max(distW, distH) * 1.12 + _radius * 0.12;
    // Floor the distance to the content's own radius, so orbiting to an end-on view
    // (where the silhouette collapses to just the diameter) can never pull the camera
    // inside the long rocket and out the far end.
    return Math.max(fit, _radius * 1.12);
  }

  // the clean pose the camera wants: assembled 3/4 view eases to a slightly angled
  // blueprint view as the rocket lays flat
  const _aDir = new THREE.Vector3(0.9, 0.35, 1.25).normalize();
  function desiredDir() {
    const az = 0.32, el = 0.24;                              // ~18 deg round, ~14 deg up
    const bDir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
    return _aDir.clone().lerp(bDir, smooth(appliedF)).normalize();
  }

  function applyLeftBias() {
    const W = window.innerWidth, Hh = window.innerHeight;
    if (W <= 720) {
      // centre the rocket in the measured clear stage (constant, assembled OR flat) so
      // it sits between the top chrome and the bottom sheet, never under either
      const offY = _ms ? _ms.offY : 0;
      camera.setViewOffset(W, Hh, 0, offY, W, Hh);
    } else {
      const shift = 0.19 * W * Math.min(1, appliedF * 1.4);
      camera.setViewOffset(W, Hh, shift, 0, W, Hh);
    }
  }

  // AUTO: ease straight to the clean pose (no controls.update, so it is rock steady)
  function driveAuto(dt) {
    if (!measureContent()) return;
    computeMobileStage();
    const centre = contentCenter();
    const dir = desiredDir();
    const goalPos = centre.clone().add(dir.multiplyScalar(fitDistFor(dir)));
    const k = Math.min(1, dt * 4.5);
    controls.target.lerp(centre, k);
    camera.position.lerp(goalPos, k);
    camera.lookAt(controls.target);
    applyLeftBias();
  }

  // USER: let controls orbit freely, only override the distance to keep it framed
  function driveUserFit(dt) {
    if (!measureContent()) return;
    computeMobileStage();
    controls.target.lerp(contentCenter(), Math.min(1, dt * 2));
    const dir = camera.position.clone().sub(controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    const goalPos = controls.target.clone().add(dir.multiplyScalar(fitDistFor(dir)));
    camera.position.lerp(goalPos, Math.min(1, dt * 4));
    applyLeftBias();
  }

  function disposeGroup(g) {
    g.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }

  /* ============================================================
     HOVER: raycast + tooltip + highlight
     ============================================================ */
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerActive = false;
  const tip = document.createElement("div");
  tip.id = "tooltip";
  tip.style.cssText =
    "position:fixed;z-index:20;max-width:280px;padding:12px 14px;border-radius:7px;" +
    "background:var(--panel-solid);border:1px solid var(--line);" +
    "box-shadow:0 10px 30px rgba(0,0,0,.45);pointer-events:none;opacity:0;transform:translateY(6px);" +
    "transition:opacity .18s ease, transform .18s ease;font-family:var(--body);" +
    "max-height:min(calc(100vh - 24px),60vh);overflow-y:auto";
  tip.innerHTML = "";
  document.body.appendChild(tip);
  let tipPinned = false;                        // touch: a tapped part keeps its tooltip up

  // place near (x,y), flipping above when the measured box would clip the bottom edge
  function placeTip(x, y) {
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let tx = x + 16, ty = y + 16;
    if (ty + h > window.innerHeight - 12) ty = y - h - 16;
    ty = Math.min(Math.max(12, ty), Math.max(12, window.innerHeight - h - 12));
    tx = Math.min(Math.max(12, tx), Math.max(12, window.innerWidth - w - 12));
    tip.style.left = tx + "px";
    tip.style.top = ty + "px";
  }
  function fillTip(cid, x, y) {
    const d = current.componentMap[cid].data;
    tip.innerHTML =
      '<div style="font-family:var(--display);font-weight:600;font-size:14px;color:var(--text);margin-bottom:5px">' +
      d.label + "</div>" +
      '<div style="font-size:12.5px;line-height:1.55;color:#c9d1e0">' + d.purpose + "</div>";
    tip.style.opacity = "1";
    tip.style.transform = "translateY(0)";
    placeTip(x, y);                             // re-place with the real rendered size
  }

  function setHighlight(cid, on) {
    if (!current || !current.componentMap[cid]) return;
    const mtl = current.componentMap[cid].material;
    if (on) {
      mtl.emissive = new THREE.Color(0x5fb2ff);
      mtl.emissiveIntensity = 0.5;
    } else {
      mtl.emissiveIntensity = 0;
    }
  }

  function onMove(e) {
    const r = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    pointerActive = true;
    if (!tipPinned) placeTip(e.clientX, e.clientY);
    lastMoveX = e.clientX; lastMoveY = e.clientY;
  }
  let lastMoveX = 0, lastMoveY = 0;
  renderer.domElement.addEventListener("pointermove", onMove);
  renderer.domElement.addEventListener("pointerleave", () => { pointerActive = false; });

  // first thing the ray hits that is actually visible and clickable
  function pickCid() {
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(current.group.children, false);
    for (const h of hits) {
      if (h.object.visible !== false && !h.object.userData.noRay) return h.object.userData.cid;
    }
    return null;
  }

  function updateHover() {
    if (!current || launchPhase !== "idle") { tipPinned = false; clearHover(); return; }
    if (tipPinned) {
      // a tapped part keeps its tooltip until the next tap (or its rocket goes away)
      if (!hovered || !current.componentMap[hovered]) { tipPinned = false; clearHover(); }
      return;
    }
    if (!pointerActive) { clearHover(); return; }
    const cid = pickCid();
    if (cid === hovered) return;
    clearHover();
    if (cid && current.componentMap[cid]) {
      hovered = cid;
      setHighlight(cid, true);
      sfx("hover");
      fillTip(cid, lastMoveX, lastMoveY);
      renderer.domElement.style.cursor = "pointer";
      const hint = el("hint"); if (hint) hint.classList.add("hide");
    }
  }
  function clearHover() {
    if (hovered) { setHighlight(hovered, false); hovered = null; }
    tip.style.opacity = "0";
    tip.style.transform = "translateY(6px)";
    renderer.domElement.style.cursor = "grab";
  }

  /* ============================================================
     UI: info panel + dock chips
     ============================================================ */
  function renderPanel(r) {
    const panel = el("panel");
    panel.classList.add("swap");
    setTimeout(() => {
      const missions = r.missions.map(m =>
        "<li><b>" + m[0] + ".</b> " + m[1] + "</li>").join("");
      const build = r.build.map(p => "<p>" + p + "</p>").join("");
      const facts = (r.facts || []).map(f => "<li>" + f + "</li>").join("");
      const quickBits = [];
      if (r.engines) quickBits.push('<span><b>Engines</b> ' + r.engines + "</span>");
      if (r.flights) quickBits.push('<span><b>Flown</b> ' + r.flights + "</span>");
      let toured = false;
      try { toured = localStorage.getItem("apogee_toured") === "1"; } catch (e) {}
      const cue = toured ? "" : " cue";     // first-visit nudge on the Tour button
      panel.innerHTML =
        // --- peek (always visible; on mobile this is the collapsed bottom sheet) ---
        '<div class="p-org">' + r.flag + " " + r.org + " · " + r.status + "</div>" +
        '<div class="p-name">' + r.name + "</div>" +
        '<div class="p-sub">' + r.sub + "</div>" +
        '<button class="tour-start' + cue + '" id="tourBtn">▸ Tour this rocket</button>' +
        (r.claim ? '<div class="p-claim">' + r.claim + "</div>" : "") +
        '<button class="sheet-handle" id="sheetHandle">Details</button>' +

        // --- details (collapsible on mobile, always shown on desktop) ---
        '<div class="p-details">' +
        '<div class="sec-title">By the Numbers</div>' +
        '<div class="stats">' +
          stat("Height", r.height + " <small>m</small>", "how tall it stands") +
          stat("Diameter", r.diameter + " <small>m</small>", "width across the base") +
          stat("First flight", r.years.split(" ")[0], "its first launch") +
          stat("Liftoff thrust", r.thrust, "the push off the pad") +
          stat("Liftoff mass", r.mass, "fully fuelled weight") +
          stat("To low orbit", r.payloadLEO, "cargo it lifts to space") +
        "</div>" +
        (r.sizeVs ? '<div class="size-note">' + r.sizeVs + "</div>" : "") +
        (quickBits.length ? '<div class="quick">' + quickBits.join("") + "</div>" : "") +

        '<div class="sec-title warm">How It Was Built</div>' +
        '<div class="build">' + build + "</div>" +

        (facts ? '<div class="sec-title">Did You Know</div><ul class="facts">' + facts + "</ul>" : "") +

        '<div class="sec-title">Notable Missions</div>' +
        '<ul class="missions">' + missions + "</ul>" +
        "</div>";
      panel.classList.remove("swap");
    }, 180);
  }
  function stat(k, v, hint) {
    return '<div class="stat"><div class="k">' + k + '</div><div class="v">' + v + "</div>" +
      (hint ? '<span class="h">' + hint + "</span>" : "") + "</div>";
  }

  function buildDock() {
    const dock = el("dock");
    ROCKETS.forEach(r => {
      const on = ACTIVE_KEYS.includes(r.key);
      const chip = document.createElement("div");
      chip.className = "chip" + (on ? "" : " soon");
      chip.dataset.key = r.key;
      chip.innerHTML =
        '<div class="cn">' + r.name + "</div>" +
        '<div class="cm">' + (on ? r.org : "Coming soon") + "</div>";
      if (on) chip.addEventListener("click", () => showRocket(r));
      else { chip.style.opacity = "0.4"; chip.style.cursor = "default"; }
      dock.appendChild(chip);
    });
  }
  function setActiveChip(key) {
    document.querySelectorAll(".chip").forEach(c =>
      c.classList.toggle("active", c.dataset.key === key));
  }

  /* ============================================================
     LOOP + resize + start
     ============================================================ */
  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (composer) composer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener("resize", onResize);

  let lastHint = "";
  function setHint(txt) {
    const h = el("hint");
    if (!h || txt === lastHint) return;
    lastHint = txt;
    h.textContent = txt;
    h.classList.remove("hide");
  }

  let _openStage = null, _lastNow = null, _bgTimer = null;

  // One simulation step, split out from rendering so frameTick() can run several fixed
  // sub-steps to cover the real elapsed time. That keeps the launch advancing at a stable
  // rate even after the rAF loop was paused (window unfocused / occluded / hidden).
  function updateSim(dt) {
    if (launchPhase !== "idle") {                          // launch simulator has the wheel
      launchUpdate(dt);
      return;
    }
    // eased explode: only scrolling changes it, so focusing a part keeps the current
    // orientation (click a part on the upright rocket and it stays upright).
    appliedF += (explodeAmount - appliedF) * Math.min(1, dt * 6);
    if (current) applyExplode(current, appliedF);
    // tip the whole rocket onto its side as it lays out flat
    if (current) current.pivot.rotation.z = -(Math.PI / 2) * smooth(appliedF);
    // fade the launch pad out once it is off the ground
    const padOp = Math.max(0, 1 - appliedF * 2.2);
    padMeshes.forEach(m => { m.material.opacity = padOp; m.visible = padOp > 0.01; });
    // ---- camera ----
    if (camTween) {                                        // smooth orbit move (focus)
      camTween.t += dt;
      let k = Math.min(1, camTween.t / camTween.dur);
      k = k * k * (3 - 2 * k);                             // smoothstep
      const tgt = new THREE.Vector3().lerpVectors(camTween.startTarget, camTween.endTarget, k);
      const sph = new THREE.Spherical(
        THREE.MathUtils.lerp(camTween.s0.radius, camTween.s1.radius, k),
        THREE.MathUtils.lerp(camTween.s0.phi, camTween.s1.phi, k),
        camTween.s0.theta + camTween.dTheta * k);
      sph.makeSafe();
      camera.position.copy(tgt).add(new THREE.Vector3().setFromSpherical(sph));
      controls.target.copy(tgt);
      camera.lookAt(tgt);
      camera.clearViewOffset();
      if (camTween.t >= camTween.dur) camTween = null;
    } else if (focused) {                                 // sitting on a focused part
      controls.update();
      camera.clearViewOffset();
    } else if (camMode === "user") {                      // free orbit, auto distance
      controls.update();
      driveUserFit(dt);
    } else {                                              // clean, steady, centred pose
      driveAuto(dt);
    }
    _openStage = updateReveal(dt);
  }

  function frameTick() {
    const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    if (_lastNow == null) _lastNow = now;
    let elapsed = (now - _lastNow) / 1000;
    _lastNow = now;
    if (elapsed <= 0) elapsed = 1 / 60;
    // Foreground: small cap so a hiccup never jumps the sim. Hidden/occluded: Chrome
    // throttles our fallback timer to ~1Hz, so each tick must cover its full real
    // elapsed time or the flight crawls at a fraction of real speed.
    elapsed = Math.min(elapsed, document.hidden ? 3 : 0.5);
    const STEP = 0.05;
    while (elapsed > 1e-4) {                               // fixed sub-steps: stable + real-time
      updateSim(Math.min(STEP, elapsed));
      elapsed -= STEP;
    }
    // per-frame UI (once, not per sub-step)
    if (launchPhase === "idle" && TOUR) {
      // the tour caption is the narrator: keep the hint + helper buttons out of the frame
      el("reassemble").classList.remove("show");
      const th = el("hint"); if (th) th.classList.add("hide");
    } else if (launchPhase === "idle") {
      if (xray) setHint("X-ray on: every stage laid open at once · hover the tanks and engines · toggle X-ray to close");
      else if (_openStage) setHint(COARSE
        ? "Inside the stage: tap the tanks and engines · tap empty space to step out"
        : "Inside the stage: hover the tanks and engines · click empty space or ⟳ to step out");
      else if (focused) setHint(COARSE ? "Tap empty space to step back out" : "Click empty space or ⟳ to step back out");
      else if (appliedF < 0.06) setHint(COARSE
        ? "Tap any part to zoom in · Take it apart for the blueprint · drag to orbit"
        : "Click any part to zoom in · scroll to lay the rocket out flat · drag to orbit · X-ray to see inside");
      else setHint(COARSE
        ? "Tap any part to zoom in · Rebuild it to stand it back up"
        : "Click any part to zoom in · scroll back to stand it up · ⟳ to rebuild");
      el("reassemble").classList.toggle("show", !!focused || appliedF > 0.06);
      const ta = el("takeApart"), taLabel = explodeAmount > 0.5 ? "⟲ Rebuild it" : "⟳ Take it apart";
      if (ta && ta.textContent !== taLabel) ta.textContent = taLabel;
    }
    updateHover();
    render();
  }

  function animate() { requestAnimationFrame(animate); frameTick(); }
  // Keep the sim advancing when the tab is hidden/occluded. Chrome pauses rAF for hidden
  // pages, which used to freeze a launch at liftoff; a timer drives frameTick while hidden,
  // and frameTick covers the real elapsed time in fixed sub-steps so nothing stalls.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { if (!_bgTimer) _bgTimer = setInterval(frameTick, 40); }
    else { if (_bgTimer) { clearInterval(_bgTimer); _bgTimer = null; } _lastNow = null; }
  });
  // Watchdog: Chrome also throttles rAF to a crawl for OCCLUDED windows (covered by
  // another window, not hidden), which visibilitychange never reports. If the loop
  // stalls, keep the sim ticking so a launch behind another window still flies true.
  setInterval(() => {
    if (_lastNow != null && performance.now() - _lastNow > 300) frameTick();
  }, 250);

  /* ============================================================
     LAYER 3 REVEAL
     When you focus a stage that has internals, its shell fades to
     semi-transparent and lets clicks pass through, while the tanks
     and engines inside fade in. Returns the open stage id, if any.
     ============================================================ */
  function updateReveal(dt) {
    if (!current) return null;
    // which stage (if any) should be open right now
    let openStage = null;
    if (focused && current.componentMap[focused]) {
      const c = current.componentMap[focused];
      if (c.role === "internal") openStage = c.stage;
      else if (current.stagesWithInternals.has(focused)) openStage = focused;
    }
    // ease the global X-ray factor
    xrayAmt += ((xray ? 1 : 0) - xrayAmt) * Math.min(1, dt * 6);
    // ease each stage's reveal amount toward its target (focus opens one; X-ray opens all)
    current.stagesWithInternals.forEach(sid => {
      const target = (openStage === sid) ? 1 : 0;
      current.revealAmt[sid] += (target - current.revealAmt[sid]) * Math.min(1, dt * 6);
    });
    // apply to every component according to its role. X-ray ghosts EVERY shell and
    // reveals EVERY internal at once, so fold it in as a floor on each component's amount.
    Object.keys(current.componentMap).forEach(id => {
      const c = current.componentMap[id];
      const amt = Math.max(current.revealAmt[c.stage] || 0, xrayAmt);
      if (c.role === "shell" || c.role === "surface") {
        const op = 1 - 0.82 * amt;
        c.meshes.forEach(m => {
          m.material.transparent = amt > 0.01;
          m.material.opacity = op;
          m.material.depthWrite = amt < 0.02;
          m.userData.noRay = amt > 0.5;                    // let clicks reach the internals
          // Hide the panel-line / rivet texture while the shell is ghosted. At the
          // silhouette a see-through shell's dark texels floated as little dashes just
          // OUTSIDE the rocket - dropping the map keeps the ghost surface clean.
          const hideMap = amt > 0.35;
          if (hideMap && !m.userData.mapHidden && m.material.map) {
            m.userData.baseMap = m.material.map; m.material.map = null;
            m.material.needsUpdate = true; m.userData.mapHidden = true;
          } else if (!hideMap && m.userData.mapHidden) {
            m.material.map = m.userData.baseMap || null;
            m.material.needsUpdate = true; m.userData.mapHidden = false;
          }
        });
      } else if (c.role === "internal") {
        const vis = amt > 0.01;
        // Fade in while opening, then turn fully SOLID (opaque + writes depth) so each
        // part occludes its own back faces, the parts behind it, and the starfield.
        // This kills the see-through overlap distortion and the stars bleeding through.
        const solid = amt > 0.85;
        c.meshes.forEach(m => {
          m.visible = vis;
          m.material.transparent = !solid;
          m.material.opacity = solid ? 1 : amt;
          m.material.depthWrite = solid;
        });
      }
    });
    return openStage;
  }

  // snap every material back to solid/opaque and hide internals (used before launch,
  // where the reveal loop no longer runs, so a ghosted shell must not fly up see-through).
  function restoreMaterials() {
    if (!current) return;
    xrayAmt = 0;
    Object.keys(current.componentMap).forEach(id => {
      const c = current.componentMap[id];
      c.meshes.forEach(m => {
        if (c.role === "internal") {
          m.visible = false; m.material.transparent = false; m.material.opacity = 1; m.material.depthWrite = true;
        } else {
          m.material.transparent = false; m.material.opacity = 1; m.material.depthWrite = true;
          m.userData.noRay = false;
          if (m.userData.mapHidden) {                       // restore the panel-line texture
            m.material.map = m.userData.baseMap || null;
            m.material.needsUpdate = true; m.userData.mapHidden = false;
          }
        }
      });
    });
    current.stagesWithInternals.forEach(s => { current.revealAmt[s] = 0; });
  }

  /* ============================================================
     CLICK TO FOCUS  (intuitive travel: click a part, fly to it)
     ============================================================ */
  function focusPart(comp, distK) {
    const center = new THREE.Vector3();
    comp.meshes.forEach(m => center.add(m.getWorldPosition(new THREE.Vector3())));
    center.multiplyScalar(1 / comp.meshes.length);
    const box = new THREE.Box3();
    comp.meshes.forEach(m => box.expandByObject(m));
    const size = box.getSize(new THREE.Vector3()).length() || 12;
    const dist = (size * 1.5 + 6) * (distK || 1);
    const dir = camera.position.clone().sub(controls.target).normalize();
    focused = comp.data.id;
    sfx("click");
    orbitTo(center, center.clone().add(dir.multiplyScalar(dist)), 0.85);
  }
  // stand the rocket back up. The pose driver + eased appliedF animate the reframe,
  // so we just clear the state and let the loop bring it home.
  function reassembleView() {
    focused = null;
    explodeAmount = 0;
    camTween = null;
    camMode = "auto";
  }
  el("reassemble").addEventListener("click", reassembleView);

  /* Touch "take apart" toggle: drives the same explode state the scroll wheel does.
     The button itself only appears on coarse pointers (CSS @media pointer:coarse). */
  const COARSE = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  el("takeApart").addEventListener("click", () => {
    if (launchPhase !== "idle") return;
    exitTour();
    markToured();                               // engaged: retire the first-visit Tour glow
    focused = null; camTween = null; camMode = "auto";
    explodeAmount = explodeAmount > 0.5 ? 0 : 1;
    standDown();                                // taking it apart cancels a launch poll
  });

  /* ============================================================
     GUIDED TOUR  ("Tour this rocket")
     Flies the camera part to part with the same eased focus moves a
     click uses, narrating each part's purpose in a caption card. Any
     manual take-over (tap, drag, scroll, rocket switch, launch) ends
     the tour and hands the controls straight back.
     ============================================================ */
  let TOUR = null;
  const TOUR_DWELL = 7000;             // ms on each part before auto-advancing
  function tourHold() { if (TOUR && TOUR.timer) { clearTimeout(TOUR.timer); TOUR.timer = null; } }
  function tourArm() { tourHold(); if (TOUR && TOUR.playing) TOUR.timer = setTimeout(() => tourAdvance(1), TOUR_DWELL); }
  // restore=true (End tour button, tour finishing) stands the rocket back up; a manual
  // take-over (scroll, tap, Take apart) keeps the blueprint pose the user is now driving
  function exitTour(restore) {
    if (!TOUR) return;
    tourHold();
    if (TOUR.hl && current && current.componentMap[TOUR.hl]) setHighlight(TOUR.hl, false);
    TOUR = null;
    el("tour").classList.remove("show");
    el("panel").classList.remove("swap");
    if (restore) explodeAmount = 0;
    focused = null; camTween = null; camMode = "auto";
  }
  function tourShow(i) {
    const comp = current.componentMap[TOUR.steps[i]];
    if (!comp) { exitTour(); return; }
    if (TOUR.hl && current.componentMap[TOUR.hl]) setHighlight(TOUR.hl, false);
    TOUR.i = i; TOUR.hl = comp.data.id;
    setHighlight(TOUR.hl, true);
    camTween = null;
    focusPart(comp, 1.4);               // a touch wider than a click-zoom so each stop has context
    el("tourStep").textContent = "Stop " + (i + 1) + " of " + TOUR.steps.length + " · " + activeRocket.name;
    el("tourTitle").textContent = comp.data.label;
    el("tourBody").textContent = comp.data.purpose;
    el("tourPlay").textContent = TOUR.playing ? "Pause" : "Play";
    tourArm();
  }
  function tourAdvance(d) {
    if (!TOUR) return;
    const n = TOUR.i + d;
    if (n >= TOUR.steps.length) { exitTour(true); return; }   // rode it to the end: stand it back up
    if (n < 0) return;
    tourShow(n);
  }
  function startTour() {
    if (launchPhase !== "idle" || !current) return;
    exitTour();
    standDown();
    endIntro();
    markToured();
    setXray(false);
    explodeAmount = 1;                        // tour the flat blueprint: every part in its own
    focused = null; camTween = null; camMode = "auto";   // spot, and the floor disc fades away
    const steps = activeRocket.parts
      .filter(p => p.kind !== "internal" && current.componentMap[p.id])
      .map(p => p.id);
    if (!steps.length) return;
    TOUR = { steps: steps, i: -1, playing: true, timer: null, hl: null };
    el("panel").classList.add("swap");        // the caption card takes the stage
    el("tour").classList.add("show");
    // let the blueprint lay itself out before the first camera move
    el("tourStep").textContent = activeRocket.name;
    el("tourTitle").textContent = "Laying it all out";
    el("tourBody").textContent = "Every part gets its own spot on the blueprint. Here we go.";
    TOUR.timer = setTimeout(() => { if (TOUR) tourShow(0); }, 1100);
  }
  // first-visit Tour nudge: once the user engages anywhere, drop the soft glow for good
  function markToured() {
    try { localStorage.setItem("apogee_toured", "1"); } catch (e) {}
    document.querySelectorAll(".tour-start.cue").forEach(b => b.classList.remove("cue"));
  }
  function toggleSheet() { el("panel").classList.toggle("open"); }
  el("panel").addEventListener("click", e => {
    if (e.target.closest("#tourBtn")) { startTour(); return; }
    if (e.target.closest("#sheetHandle")) { toggleSheet(); markToured(); }
  });
  el("tourNext").addEventListener("click", () => tourAdvance(1));
  el("tourPrev").addEventListener("click", () => tourAdvance(-1));
  el("tourExit").addEventListener("click", () => exitTour(true));
  el("tourPlay").addEventListener("click", () => {
    if (!TOUR) return;
    TOUR.playing = !TOUR.playing;
    el("tourPlay").textContent = TOUR.playing ? "Pause" : "Play";
    tourArm();
  });

  // dragging = the user is taking manual control of the camera angle
  controls.addEventListener("start", () => { if (!camTween) camMode = "user"; });

  // detect a genuine click (not a drag) on the canvas
  let downX = 0, downY = 0;
  renderer.domElement.addEventListener("pointerdown", e => { downX = e.clientX; downY = e.clientY; exitTour(); });
  renderer.domElement.addEventListener("pointerup", e => {
    if (launchPhase !== "idle") return;
    if (Math.abs(e.clientX - downX) > 9 || Math.abs(e.clientY - downY) > 9) return; // a drag, not a click
    if (!current) return;
    const r = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    const cid = pickCid();
    if (cid && current.componentMap[cid]) {                 // click a part -> smoothly zoom into it
      camTween = null;                                      // cancel any in-flight move so it always responds
      markToured();                                         // engaged: retire the first-visit Tour glow
      focusPart(current.componentMap[cid]);
      if (e.pointerType === "touch") {                      // no hover on touch: pin the tooltip to the tap
        if (hovered && hovered !== cid) setHighlight(hovered, false);
        hovered = cid;
        setHighlight(cid, true);
        fillTip(cid, e.clientX, e.clientY);
        tipPinned = true;
        const hint = el("hint"); if (hint) hint.classList.add("hide");
      }
    } else {
      if (tipPinned) { tipPinned = false; clearHover(); }   // tap empty space -> let the tooltip go
      if (focused) {                                        // click empty space -> step back to the overview
        focused = null; camTween = null; camMode = "auto";
      }
    }
  });
  // scroll lays the rocket out flat / stands it back up (and drops any focus).
  // Normalised across mouse wheel and trackpad, with a clamped per-event step so a
  // mouse notch never jumps and a trackpad flick never overshoots.
  renderer.domElement.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (launchPhase !== "idle") return;
    let d = e.deltaY;
    if (e.deltaMode === 1) d *= 16;            // lines -> pixels
    else if (e.deltaMode === 2) d *= 400;      // pages -> pixels
    let step = d * 0.0024;                      // gain: a short scroll lays it flat
    step = Math.max(-0.16, Math.min(0.16, step)); // clamp so nothing jumps/overshoots
    focused = null;
    camTween = null;                            // never let a focus fly-in fight the scroll
    camMode = "auto";                           // scrolling re-centres to the clean pose
    explodeAmount = Math.max(0, Math.min(1, explodeAmount - step));
    standDown();                                // taking it apart cancels a launch poll
    exitTour();                                 // scrolling takes over from the tour
  }, { passive: false });

  /* Smooth momentum scrolling for the info panel + help list: ease scrollTop toward a
     target each frame so a mouse wheel feels buttery, not stepwise. Skipped entirely
     under prefers-reduced-motion (native scrolling takes over). */
  (function momentumScroll() {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    [el("panel"), document.querySelector(".help-list")].forEach(box => {
      if (!box) return;
      box.style.scrollBehavior = "auto";        // JS drives the easing, not CSS
      let target = null, raf = 0;
      function tick() {
        const d = target - box.scrollTop;
        if (Math.abs(d) < 0.6) { box.scrollTop = target; target = null; raf = 0; return; }
        box.scrollTop += d * 0.18;
        raf = requestAnimationFrame(tick);
      }
      box.addEventListener("wheel", e => {
        e.preventDefault();
        let d = e.deltaY;
        if (e.deltaMode === 1) d *= 16; else if (e.deltaMode === 2) d *= 400;
        if (target === null) target = box.scrollTop;
        target = Math.max(0, Math.min(box.scrollHeight - box.clientHeight, target + d));
        if (!raf) raf = requestAnimationFrame(tick);
      }, { passive: false });
    });
  })();

  /* ============================================================
     HOW TO USE  (only opens from the top-bar button)
     Each control is one entry in HELP_STEPS. To document a new
     feature, just add a line here and it appears automatically.
     ============================================================ */
  const HELP_STEPS = [
    ["Scroll", "to lay the rocket out flat and see every stage."],
    ["Click a part", "to zoom in and read what it does. Click a stage to reveal the tanks and engines inside."],
    ["Drag", "to orbit around it. Hover a part for its name."],
    ["X-ray", "reveals every internal tank and engine at once. Reassemble stands it back up."],
    ["Tour", "the ▸ Tour this rocket button in the info panel flies you part to part and explains each one. Tap, drag or scroll anytime to take over."],
    ["Launch", "runs the go no go poll first. Once every station is green the button arms and you fly off the golden-hour pad through staging to orbit. Falcon 9 and Starship land themselves; pick Hard mode to fly it yourself."],
    ["FX", "toggles the launch cinematics between High (bloom, god rays) and Low for slower devices. Phones start on Low."],
    ["Postcard", "the Postcard button saves a captioned snapshot of any view, on the pad or mid-flight."],
    ["Switch rockets", "with the fleet dock at the bottom: Saturn V, Starship, Falcon 9, Shuttle, SLS, Soyuz."]
    // add new features here and they show up in the guide automatically
  ];
  const helpOverlay = el("helpOverlay");
  function openHelp() {
    const name = activeRocket ? activeRocket.name : "rocket";
    el("helpSub").textContent = "A quick 3D tour of the " + name + ", inside and out.";
    el("helpList").innerHTML = HELP_STEPS.map(s => "<li><b>" + s[0] + "</b> " + s[1] + "</li>").join("");
    helpOverlay.classList.add("show");
  }
  const closeHelp = () => helpOverlay.classList.remove("show");
  el("helpBtn").addEventListener("click", openHelp);
  el("helpClose").addEventListener("click", closeHelp);
  helpOverlay.addEventListener("click", (e) => { if (e.target === helpOverlay) closeHelp(); });

  /* ---- share popover: X / WhatsApp / Telegram / Facebook + copy link ---- */
  const sharePop = el("sharePop"), shareBtn = el("shareBtn");
  const shareUrl = () => location.origin + location.pathname;   // auto-resolves to the live URL
  const shareText = "Explore legendary rockets in 3D and fly them to orbit.";
  const shareIntents = {
    x:  (u) => "https://twitter.com/intent/tweet?text=" + encodeURIComponent(shareText) + "&url=" + encodeURIComponent(u),
    wa: (u) => "https://wa.me/?text=" + encodeURIComponent(shareText + " " + u),
    fb: (u) => "https://www.facebook.com/sharer/sharer.php?u=" + encodeURIComponent(u)
  };
  const openShare = () => { sharePop.classList.add("show"); shareBtn.classList.add("on"); };
  const closeShare = () => { sharePop.classList.remove("show"); shareBtn.classList.remove("on"); };
  function fallbackCopy(text, done) {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); done(); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
  }
  if (shareBtn && sharePop) {
    shareBtn.addEventListener("click", (e) => { e.stopPropagation(); sharePop.classList.contains("show") ? closeShare() : openShare(); });
    sharePop.querySelectorAll(".share-ic").forEach(b => b.addEventListener("click", () => {
      // Open in a real new TAB (no window-features string). Passing "noopener" as features made
      // browsers open a small POPUP, and Telegram's share page renders broken in a popup (it needs
      // a full tab to redirect); X/Facebook/WhatsApp tolerate popups, Telegram does not. Null the
      // opener afterwards for the same security as noopener.
      const fn = shareIntents[b.dataset.net];
      if (fn) { const w = window.open(fn(shareUrl()), "_blank"); if (w) w.opener = null; }
    }));
    const cp = el("shCopy");
    if (cp) cp.addEventListener("click", () => {
      const url = shareUrl(), span = cp.querySelector("span"), old = span ? span.textContent : "";
      const done = () => { cp.classList.add("copied"); if (span) span.textContent = "Link copied"; toast("Link copied ✓"); setTimeout(() => { cp.classList.remove("copied"); if (span) span.textContent = old; }, 1600); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done).catch(() => fallbackCopy(url, done));
      else fallbackCopy(url, done);
    });
    document.addEventListener("click", (e) => { if (sharePop.classList.contains("show") && !sharePop.contains(e.target) && e.target !== shareBtn) closeShare(); });
    window.addEventListener("keydown", (e) => { if (e.key === "Escape") closeShare(); });
  }

  /* ---------- a little toast + a few hidden easter eggs ---------- */
  function toast(msg, dur) {
    const t = el("toast");
    t.textContent = msg; t.classList.add("show");
    clearTimeout(t._timer); t._timer = setTimeout(() => t.classList.remove("show"), dur || 3600);
  }
  // egg 1: the faint line inside the guide cycles through hidden facts
  const EGGS = [
    "The Saturn V was so loud its sound alone could have killed you up close.",
    "“The cosmos is within us. We are made of star stuff.”  (Carl Sagan, Cosmos)",
    "Its onboard computer had less memory than a single modern text message.",
    "“We used to look up at the sky and wonder at our place in the stars. Now we just look down, and worry about our place in the dirt.”  (Interstellar)",
    "The five F-1 engines gulped nearly three tonnes of propellant every second.",
    "“They should've sent a poet.”  (Contact, 1997)",
    "Twelve people have walked on the Moon. Every one of them rode a Saturn V.",
    "“Mankind was born on Earth. It was never meant to die here.”  (Interstellar)",
    "“My God, it's full of stars.”  (Arthur C. Clarke, 2001: A Space Odyssey)",
    "Fun fact: this whole rocket is drawn with code, not a single downloaded model.",
    "“Do not go gentle into that good night.”  (Dylan Thomas, recited in Interstellar)",
    "“Okay, Houston, we've had a problem here.”  (Apollo 13, April 1970)",
    "You found all the secrets. Ad astra, explorer. 🚀"
  ];
  let eggIdx = 0;
  el("helpEgg").addEventListener("click", () => { toast(EGGS[eggIdx % EGGS.length]); eggIdx++; });
  // egg 2: click the logo seven times
  let brandClicks = 0;
  document.querySelector(".brand").addEventListener("click", () => {
    if (++brandClicks === 7) { brandClicks = 0; toast("Made with love for the Moon. Han was here. 🌙"); }
  });
  // egg 3: the Konami code
  const KONAMI = ["arrowup", "arrowup", "arrowdown", "arrowdown", "arrowleft", "arrowright", "arrowleft", "arrowright", "b", "a"];
  let kProg = 0;
  window.addEventListener("keydown", (e) => {
    const k = (e.key || "").toLowerCase();
    kProg = (k === KONAMI[kProg]) ? kProg + 1 : (k === KONAMI[0] ? 1 : 0);
    if (kProg === KONAMI.length) { kProg = 0; toast("Cheat unlocked: infinite curiosity. To the Moon! 🚀🌙", 5000); }
  });

  // egg 4: a hidden message in the browser console, with a faint breadcrumb
  console.log("%c  /\\\n |==|\n |A |   Apogee\n |P |   We are made of star stuff.\n/____\\  — Carl Sagan",
    "color:#5fb2ff;font-family:monospace;line-height:1.35");
  console.log("%cPsst… type 'pale blue dot' anywhere. 🌍", "color:#8b96af");

  // egg 5: the Pale Blue Dot moment + type-a-secret-word triggers (a separate window
  // listener, so it coexists with the Konami + launch-control keydown handlers)
  function showPaleBlueDot() { el("pbd").classList.add("show"); }
  function hidePaleBlueDot() { el("pbd").classList.remove("show"); }
  el("pbd").addEventListener("click", hidePaleBlueDot);

  // egg 6: type "snow" — a gentle thank-you snowfall for a friend
  function showSnow() {
    if (el("snow")) return;                       // already falling, don't stack
    const box = document.createElement("div");
    box.id = "snow"; box.className = "snow";
    // three depth bands (far/mid/near) so the field reads with real parallax
    const BANDS = [
      { n: 40, size: [2, 5],  op: [.28, .5], dur: [15, 22], blur: 1.4, sway: [10, 26] }, // far
      { n: 34, size: [4, 8],  op: [.5, .78], dur: [10, 15], blur: .5,  sway: [22, 46] }, // mid
      { n: 20, size: [7, 13], op: [.75, .98], dur: [6.5, 10], blur: 0, sway: [40, 80] }  // near
    ];
    const rnd = (a, b) => a + Math.random() * (b - a);
    BANDS.forEach((band) => {
      for (let i = 0; i < band.n; i++) {
        const f = document.createElement("div");
        f.className = "snowflake";
        const s = rnd(band.size[0], band.size[1]);
        const sway = rnd(band.sway[0], band.sway[1]) * (Math.random() < .5 ? -1 : 1);
        f.style.width = f.style.height = s.toFixed(1) + "px";
        f.style.left = rnd(-2, 100).toFixed(2) + "vw";
        f.style.opacity = rnd(band.op[0], band.op[1]).toFixed(2);
        if (band.blur) f.style.filter = "blur(" + rnd(band.blur * .4, band.blur).toFixed(1) + "px)";
        f.style.setProperty("--sway", sway.toFixed(0) + "px");
        f.style.animationDuration = rnd(band.dur[0], band.dur[1]).toFixed(1) + "s";
        // negative delays so the sky is already full when it fades in (no empty start)
        f.style.animationDelay = (-rnd(0, band.dur[1])).toFixed(1) + "s";
        box.appendChild(f);
      }
    });
    document.body.appendChild(box);
    requestAnimationFrame(() => box.classList.add("show"));   // next frame → fade in
    // the thank-you rides in as a toast, same little box as the other eggs
    toast("Some friends are the reason you keep aiming higher.  Thank you, Snow.", 8000);
    box._timer = setTimeout(hideSnow, 8000);
  }
  function hideSnow() {
    const box = el("snow");
    if (!box) return;
    clearTimeout(box._timer);
    box.classList.add("leaving");                 // graceful fade-out
    setTimeout(() => { if (box.parentNode) box.remove(); }, 1300);
  }

  let typed = "";
  window.addEventListener("keydown", (e) => {
    const k = (e.key || "").toLowerCase();
    if (k.length === 1 && /[a-z]/.test(k)) {
      typed = (typed + k).slice(-16);
      if (typed.endsWith("palebluedot")) { typed = ""; showPaleBlueDot(); }
      else if (typed.endsWith("snow")) { typed = ""; showSnow(); }
      else if (typed.endsWith("cosmos") || typed.endsWith("sagan")) {
        typed = "";
        toast("The nitrogen in our DNA, the calcium in our teeth, the iron in our blood, the carbon in our apple pies were made in the interiors of collapsing stars. We are made of star stuff.  (Carl Sagan, Cosmos)", 7500);
      }
    } else if (k === "escape") { hidePaleBlueDot(); hideSnow(); }
  });

  /* ============================================================
     GROUND LAUNCH WORLD (Phase C)
     A golden-hour launch complex you fade to on LAUNCH: warm sky dome,
     low sun, ground apron, gantry tower, drifting clouds. As the rocket
     climbs, updateWorld() darkens the sky, fades the ground and clouds,
     fades the stars + a curved Earth in - so you ride ground -> space.
     ============================================================ */
  let PAD = null;
  const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
  const _cA = new THREE.Color(), _cB = new THREE.Color();
  function lerpCol(hexA, hexB, t) { return _cA.setHex(hexA).lerp(_cB.setHex(hexB), t); }

  // procedural Earth: blue oceans, lumpy green/tan continents, polar ice, soft cloud wisps.
  // Copyright-free (drawn to a canvas), deterministic (seeded), no external assets.
  function makeEarthTexture() {
    const c = document.createElement("canvas"); c.width = 512; c.height = 256;
    const x = c.getContext("2d");
    let s = 909091; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    // Overwhelmingly ocean so ANY viewing angle reads blue. Keep the blue MID-toned: very
    // light blues wash to white under the renderer's ACES tone-mapping.
    const og = x.createLinearGradient(0, 0, 0, 256);
    og.addColorStop(0, "#0c407e"); og.addColorStop(0.5, "#1666c2"); og.addColorStop(1, "#0c407e");
    x.fillStyle = og; x.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 34; i++) {                       // subtle darker ocean depth mottle only (no light patches)
      x.globalAlpha = 0.12 + rnd() * 0.16;
      x.fillStyle = "#0a3568";
      x.beginPath(); x.arc(rnd() * 512, rnd() * 256, 22 + rnd() * 64, 0, Math.PI * 2); x.fill();
    }
    x.globalAlpha = 1;
    const land = ["#2f8f3d", "#3f9a54", "#5a9b3e", "#8a8a4a"];
    for (let i = 0; i < 7; i++) {                        // just a few small green continents
      const cx = rnd() * 512, cy = 40 + rnd() * 176, r = 12 + rnd() * 28;
      x.fillStyle = land[(rnd() * land.length) | 0];
      for (let j = 0; j < 8; j++) {
        const a = rnd() * Math.PI * 2, d = rnd() * r;
        x.beginPath(); x.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r * (0.4 + rnd() * 0.6), 0, Math.PI * 2); x.fill();
      }
    }
    x.fillStyle = "#cfe0ee";                             // small, cool-tinted polar caps
    x.fillRect(0, 0, 512, 8); x.fillRect(0, 248, 512, 8);
    x.fillStyle = "#ffffff";                             // very sparse cloud wisps
    for (let i = 0; i < 6; i++) {
      x.globalAlpha = 0.08 + rnd() * 0.09;
      const cx = rnd() * 512, cy = rnd() * 256;
      for (let j = 0; j < 5; j++) x.beginPath(), x.arc(cx + (rnd() - 0.5) * 80, cy + (rnd() - 0.5) * 24, 8 + rnd() * 22, 0, Math.PI * 2), x.fill();
    }
    x.globalAlpha = 1;
    return new THREE.CanvasTexture(c);
  }

  function buildPadScene() {
    // one pad PER ROCKET: the tower, mount and catch hardware are sized to the vehicle,
    // so reusing the first rocket's pad let a wider rocket pass straight through them
    if (PAD && PAD.key === activeRocket.key) return;
    if (PAD) {
      scene.remove(PAD.group);
      PAD.group.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && o.material.dispose) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
      });
      PAD = null;
      // the steam/vent pools were sized for the old rocket too: rebuild them fresh
      if (smoke) { scene.remove(smoke.pts); smoke.geom.dispose(); smoke.pts.material.dispose(); smoke = null; }
      if (vents) { scene.remove(vents.pts); vents.geom.dispose(); vents.pts.material.dispose(); vents = null; }
    }
    const H = current.height;
    const bb = new THREE.Box3().setFromObject(current.group);
    const sz = bb.getSize(new THREE.Vector3());
    const baseR = Math.max(sz.x, sz.z) / 2 || H * 0.05;
    const g = new THREE.Group(); g.visible = false;

    // gradient sky dome (warm horizon -> deep violet), fades out into space
    // vY is computed PER-FRAGMENT (normalize in the fragment shader, not a coarse vertex varying)
    // so the horizon gradient is perfectly smooth, and a tiny per-pixel dither breaks up the
    // 8-bit colour banding that a large smooth gradient otherwise shows.
    const skyMat = new THREE.ShaderMaterial({
      uniforms: { top: { value: new THREE.Color(0x2a1e52) }, bottom: { value: new THREE.Color(0xffa24d) }, expo: { value: 0.8 }, alpha: { value: 1 } },
      vertexShader: "varying vec3 vW; void main(){ vec4 wp = modelMatrix*vec4(position,1.0); vW = wp.xyz; gl_Position = projectionMatrix*viewMatrix*wp; }",
      fragmentShader: "uniform vec3 top; uniform vec3 bottom; uniform float expo; uniform float alpha; varying vec3 vW; void main(){ float vY = normalize(vW).y; float t = pow(max(vY,0.0), expo); vec3 col = mix(bottom, top, t); float d = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233))) * 43758.5453); col += (d - 0.5) / 255.0; gl_FragColor = vec4(col, alpha); }",
      side: THREE.BackSide, depthWrite: false, transparent: true, fog: false
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 64, 40), skyMat);
    sky.renderOrder = -10; g.add(sky);

    // low, bloomed sun near the horizon (transparent so it can fade out with altitude).
    // depthWrite:false is important: the sphere still depth-TESTS (so the rocket and
    // gantry occlude it), but it no longer WRITES depth, so it cannot punch a hole in
    // the additive glow sprites layered on top of it. Without this the opaque disc culled
    // the bright centre of the glow and the sun showed a dark spot in its middle.
    // deep sunset sun: a smaller, unmistakably ORANGE disc with restrained glow, so it
    // reads as a low evening sun instead of an overexposed white blob
    const sun = new THREE.Mesh(new THREE.SphereGeometry(38, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffb668, transparent: true, depthWrite: false, fog: false }));
    sun.position.set(-1500, 150, -3200); g.add(sun);
    const sunGlow2 = new THREE.Sprite(new THREE.SpriteMaterial({ map: SOFT_DOT, color: 0xff8a3d, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    sunGlow2.scale.set(2800, 2800, 1); sunGlow2.position.copy(sun.position); g.add(sunGlow2);
    const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: SOFT_DOT, color: 0xff9a4d, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    sunGlow.scale.set(1400, 1400, 1); sunGlow.position.copy(sun.position); g.add(sunGlow);
    // god rays: a slow-turning radial streak sprite behind the sun (High FX only)
    const rayTex = (() => {
      const c = document.createElement("canvas"); c.width = c.height = 512;
      const x = c.getContext("2d");
      x.translate(256, 256);
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * Math.PI * 2 + Math.sin(i * 12.9898) * 0.05;
        const len = 150 + Math.abs(Math.sin(i * 78.233)) * 100;
        const grad = x.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
        grad.addColorStop(0, "rgba(255,255,255,0.20)");
        grad.addColorStop(1, "rgba(255,255,255,0)");
        x.strokeStyle = grad;
        x.lineWidth = 2 + (i % 3);
        x.beginPath(); x.moveTo(0, 0); x.lineTo(Math.cos(a) * len, Math.sin(a) * len); x.stroke();
      }
      return new THREE.CanvasTexture(c);
    })();
    const rays = new THREE.Sprite(new THREE.SpriteMaterial({ map: rayTex, color: 0xffa45c, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    rays.scale.set(3600, 3600, 1); rays.position.copy(sun.position); g.add(rays);
    // warm haze band low across the horizon, for golden-hour depth
    const haze = new THREE.Sprite(new THREE.SpriteMaterial({ map: SOFT_DOT, color: 0xffb98a, transparent: true, opacity: 0.34, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    haze.scale.set(9500, 1500, 1); haze.position.set(-300, 40, -3600); g.add(haze);

    // Coastal golden-hour pad (ocean + shoreline + sun-glint) is kept behind this flag so it can
    // be re-enabled later. Currently OFF: the plain full-ground launch pad is used. Flip to true
    // to restore the sea (the apron then shrinks to 700 so the ocean rings it).
    const COASTAL_PAD = false;

    // Everything at ground level lives in ONE group so the whole site can physically
    // fall away below as the rocket outruns it (and rise back to meet a returning
    // booster) instead of alpha-fading in place, which read as the pad "magically"
    // dissolving and reappearing.
    const site = new THREE.Group(); g.add(site);

    // Cape-style scrubland ground: blotchy olive greens painted onto a canvas texture so
    // the plain has real variation (a flat color read as pale and boring; smooth shader
    // gradients band, the known WebGL gotcha, so paint noise instead).
    const groundTex = (() => {
      const c = document.createElement("canvas"); c.width = c.height = 512;
      const x = c.getContext("2d");
      // painted DARK: the warm key light + ACES tonemapping wash big ground planes toward
      // pastel, so these tones are ~2x deeper than the target on-screen scrub green
      x.fillStyle = "#1c2a17"; x.fillRect(0, 0, 512, 512);
      let s = 4242; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
      const tones = ["#16220f", "#243617", "#12200e", "#2a3d1e", "#1a2c12", "#303f22"];
      for (let i = 0; i < 900; i++) {
        x.fillStyle = tones[(rnd() * tones.length) | 0];
        x.globalAlpha = 0.25 + rnd() * 0.5;
        const r = 4 + rnd() * 26;
        x.beginPath(); x.ellipse(rnd() * 512, rnd() * 512, r, r * (0.5 + rnd() * 0.7), rnd() * 3.2, 0, 7); x.fill();
      }
      x.globalAlpha = 1;
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(9, 9);
      return t;
    })();
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x9a9a8c, map: groundTex, roughness: 0.96, metalness: 0.0, fog: false });
    const ground = new THREE.Mesh(new THREE.CircleGeometry(COASTAL_PAD ? 700 : 4200, 64), groundMat);
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.1; site.add(ground);

    // concrete: faint panel seams painted once, shared by the apron and the access road
    const concTex = (() => {
      const c = document.createElement("canvas"); c.width = c.height = 256;
      const x = c.getContext("2d");
      x.fillStyle = "#565750"; x.fillRect(0, 0, 256, 256);   // dark so the ACES wash lands on real concrete grey
      let s = 777; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
      for (let i = 0; i < 260; i++) {           // mottle
        x.fillStyle = rnd() > 0.5 ? "#5e5f58" : "#4c4d46";
        x.globalAlpha = 0.35;
        x.fillRect(rnd() * 256, rnd() * 256, 2 + rnd() * 10, 2 + rnd() * 10);
      }
      x.globalAlpha = 0.6; x.strokeStyle = "#3c3d38"; x.lineWidth = 2;
      for (let i = 0; i <= 4; i++) {            // panel seams
        x.beginPath(); x.moveTo(i * 64, 0); x.lineTo(i * 64, 256); x.stroke();
        x.beginPath(); x.moveTo(0, i * 64); x.lineTo(256, i * 64); x.stroke();
      }
      x.globalAlpha = 1;
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      return t;
    })();
    const capeParts = [];                       // extra Cape meshes riding the site group
    const capeMesh = (mesh) => { site.add(mesh); capeParts.push(mesh); return mesh; };
    const apronTexScale = 4;
    const apronMat = new THREE.MeshStandardMaterial({ color: 0x8e8f87, map: concTex, roughness: 0.92, fog: false });
    apronMat.map = concTex.clone(); apronMat.map.wrapS = apronMat.map.wrapT = THREE.RepeatWrapping; apronMat.map.repeat.set(apronTexScale, apronTexScale);
    const apron = capeMesh(new THREE.Mesh(new THREE.CircleGeometry(baseR * 8, 48), apronMat));
    apron.rotation.x = -Math.PI / 2; apron.position.y = -0.02;
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x7e7f77, map: concTex.clone(), roughness: 0.92, fog: false });
    roadMat.map.wrapS = roadMat.map.wrapT = THREE.RepeatWrapping; roadMat.map.repeat.set(1, 40);
    const road = capeMesh(new THREE.Mesh(new THREE.PlaneGeometry(baseR * 2.6, 3200), roadMat));
    road.rotation.x = -Math.PI / 2; road.position.set(0, -0.05, baseR * 8 + 1580);
    // crawlerway heads away from the camera side so it reads as leading off to the horizon
    // scorch: the dark burn shadow every well-used pad wears around its flame trench
    const scorchTex = (() => {
      const c = document.createElement("canvas"); c.width = c.height = 256;
      const x = c.getContext("2d");
      const gr = x.createRadialGradient(128, 128, 8, 128, 128, 126);
      gr.addColorStop(0, "rgba(16,13,10,0.9)");
      gr.addColorStop(0.55, "rgba(24,20,15,0.55)");
      gr.addColorStop(1, "rgba(24,20,15,0)");
      x.fillStyle = gr; x.fillRect(0, 0, 256, 256);
      return new THREE.CanvasTexture(c);
    })();
    const scorchMat = new THREE.MeshBasicMaterial({ map: scorchTex, transparent: true, depthWrite: false, fog: false });
    const scorch = capeMesh(new THREE.Mesh(new THREE.PlaneGeometry(baseR * 7, baseR * 9), scorchMat));
    scorch.rotation.x = -Math.PI / 2; scorch.position.set(0, -0.008, baseR * 0.8);
    // distant set dressing so the horizon is not empty: an assembly hangar and fuel tanks
    const bldgMat = new THREE.MeshStandardMaterial({ color: 0x84888c, roughness: 0.7, metalness: 0.15, fog: false });
    const hangar = capeMesh(new THREE.Mesh(new THREE.BoxGeometry(340, 110, 230), bldgMat));
    hangar.position.set(-1500, 55, -750);
    const tankMat = new THREE.MeshStandardMaterial({ color: 0xdadbd6, roughness: 0.55, metalness: 0.25, fog: false });
    [[820, -1500], [960, -1430]].forEach(pz => {
      const tank = capeMesh(new THREE.Mesh(new THREE.CylinderGeometry(56, 56, 120, 20), tankMat));
      tank.position.set(pz[0], 60, pz[1]);
    });
    const lowBlock = capeMesh(new THREE.Mesh(new THREE.BoxGeometry(220, 42, 140), bldgMat));
    lowBlock.position.set(1650, 21, 620);
    // landing zone: its own concrete circle with a painted ring, well clear of the tower,
    // where a flyback booster sets down. Built ONLY for rockets that actually land on
    // legs (Falcon 9) — Saturn V expends its stages and Starship is caught at the tower.
    let lzX = null;
    if (activeRocket.recover && activeRocket.recover.mode === "legs") {
      lzX = -(baseR * 14 + 20);
      const lz = capeMesh(new THREE.Mesh(new THREE.CircleGeometry(baseR * 3.2, 40),
        new THREE.MeshStandardMaterial({ color: 0x74766e, roughness: 0.94, fog: false })));
      lz.rotation.x = -Math.PI / 2; lz.position.set(lzX, 0.02, 0);
      const lzRing = capeMesh(new THREE.Mesh(new THREE.RingGeometry(baseR * 2.3, baseR * 2.7, 40),
        new THREE.MeshBasicMaterial({ color: 0x3a3c36, fog: false })));
      lzRing.rotation.x = -Math.PI / 2; lzRing.position.set(lzX, 0.06, 0);
    }

    // coastal site: a deep-teal ocean ringing the apron, a pale wet-sand shoreline band, and a
    // golden sun-glint. All fade with altitude alongside the ground. Unlit (MeshBasic) so the
    // deep teal survives the bright key light + ACES wash (a lit water plane washes to flat grey,
    // same gotcha as the Earth and Soyuz). Three concentric, NON-OVERLAPPING bands (apron ->
    // shore -> ocean, each a little lower, a beach sloping to the sea): they must not overlap
    // radially, or the three transparent planes swap draw order and read as a colour flicker.
    // Kept behind COASTAL_PAD so the whole coastal look can be reused without rewriting it.
    let ocean = null, oceanMat = null, shore = null, shoreMat = null, glint = null, glintMat = null;
    if (COASTAL_PAD) {
      oceanMat = new THREE.MeshBasicMaterial({ color: 0x1c4a56, transparent: true, opacity: 1, fog: false });
      ocean = new THREE.Mesh(new THREE.RingGeometry(1000, 4900, 96), oceanMat);
      ocean.rotation.x = -Math.PI / 2; ocean.position.y = -0.55; ocean.renderOrder = -6; g.add(ocean);
      shoreMat = new THREE.MeshBasicMaterial({ color: 0x4f5850, transparent: true, opacity: 1, fog: false });
      shore = new THREE.Mesh(new THREE.RingGeometry(700, 1000, 96), shoreMat);
      shore.rotation.x = -Math.PI / 2; shore.position.y = -0.30; shore.renderOrder = -5; g.add(shore);
      // sun-glint: a soft additive golden patch elongated toward the sun's azimuth (mostly -Z, a touch -X)
      glintMat = new THREE.MeshBasicMaterial({ map: SOFT_DOT, color: 0xffb974, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      glint = new THREE.Mesh(new THREE.PlaneGeometry(1700, 5200), glintMat);
      glint.rotation.x = -Math.PI / 2; glint.position.set(-820, -0.4, -2000); glint.renderOrder = -4; g.add(glint);
    }
    // concrete pad + flame trench under the rocket
    const padTop = new THREE.Mesh(new THREE.CylinderGeometry(baseR * 2.4, baseR * 2.6, 1.2, 40),
      new THREE.MeshStandardMaterial({ color: 0x3a3630, roughness: 0.9, fog: false }));
    padTop.position.y = 0.5; site.add(padTop);
    const trench = new THREE.Mesh(new THREE.BoxGeometry(baseR * 1.1, 3, baseR * 5),
      new THREE.MeshStandardMaterial({ color: 0x111013, roughness: 1, fog: false }));
    trench.position.set(0, -1, 0); site.add(trench);

    // gantry / service tower beside the rocket
    const steel = new THREE.MeshStandardMaterial({ color: 0x4a4d55, roughness: 0.6, metalness: 0.7, fog: false });
    const gx = baseR * 2.1, gz = 0, gw = baseR * 0.9, gh = H * 0.98;
    const beam = (x, z, w, h, d, y) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), steel); m.position.set(x, y == null ? h / 2 : y, z); site.add(m); return m; };
    const t = Math.max(0.18, baseR * 0.09);
    // four corner columns + cross bracing
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(c => beam(gx + c[0] * gw / 2, gz + c[1] * gw / 2, t, gh, t));
    for (let yy = gh * 0.14; yy < gh; yy += gh * 0.14) {
      beam(gx, gz - gw / 2, gw, t * 0.7, t * 0.7, yy);
      beam(gx, gz + gw / 2, gw, t * 0.7, t * 0.7, yy);
      beam(gx - gw / 2, gz, t * 0.7, t * 0.7, gw, yy);
      beam(gx + gw / 2, gz, t * 0.7, t * 0.7, gw, yy);
    }
    // swing arms reaching toward the rocket
    for (let a = 0; a < 3; a++) { const arm = beam((gx) - gw * 0.5 - baseR * 0.6, gz, baseR * 1.3, t * 0.8, t * 0.8, gh * (0.35 + a * 0.24)); arm.position.x = gx - gw / 2 - baseR * 0.6; }
    // crane at the top: kept OUTSIDE the vehicle envelope so nothing flies through it
    beam(gx + baseR * 0.2, gz, baseR * 1.6, t, t, gh + t);

    // Starship catch arms ("chopsticks"): two arms on the tower that close to grab the
    // booster in mid-air. Hidden unless a tower-catch rocket is flown (shown in recovery).
    const towerTop = gh, alignR = baseR * 1.3;            // the flyback holds above this until lined up
    const catchArmY = gh * 0.75, catchX = baseR * 0.15;   // arms high on the tower so the tall booster dangles clear of the pad
    const armPivX = gx - gw / 2, armLen = armPivX - catchX, armT = t * 1.6;
    const mkArm = () => {
      const pv = new THREE.Group(); pv.position.set(armPivX, catchArmY, 0);
      const bm = new THREE.Mesh(new THREE.BoxGeometry(armLen, armT, armT * 1.5), steel);
      bm.position.x = -armLen / 2; pv.add(bm);
      const claw = new THREE.Mesh(new THREE.BoxGeometry(armT * 1.4, armT * 1.2, armT * 2.4), steel);
      claw.position.x = -armLen; pv.add(claw);
      site.add(pv); pv.visible = false; return pv;
    };
    const armL = mkArm(), armR = mkArm();

    // drifting clouds (warm-lit billboards low on the horizon)
    const clouds = [];
    const cloudTex = SOFT_DOT;
    let cs = 24680;
    const crnd = () => { cs = (cs * 16807) % 2147483647; return cs / 2147483647; };
    // Fewer, dimmer, higher clouds. Too many low warm billboards read as blotchy patches over
    // the pastel sea once the camera tips to a grazing angle on the climb; kept subtle + high.
    for (let i = 0; i < 9; i++) {
      const cm = new THREE.SpriteMaterial({ map: cloudTex, color: 0xffd9b0, transparent: true, opacity: 0.12, depthWrite: false, fog: false });
      const s = new THREE.Sprite(cm);
      const ang = crnd() * Math.PI * 2, rad = 1800 + crnd() * 2400;
      s.position.set(Math.cos(ang) * rad, 240 + crnd() * 430, Math.sin(ang) * rad);
      const sc = 520 + crnd() * 680; s.scale.set(sc * 1.7, sc, 1);
      g.add(s); clouds.push({ s: s, mat: cm, drift: 8 + crnd() * 12 });
    }

    // curved Earth (hidden until high up): procedural ocean + continents + clouds, lit by
    // the key light so it shows a day/night terminator, with a glowing atmosphere rim
    // Show the texture's OWN colours purely: color black kills the diffuse/lighting wash so
    // only the emissiveMap shows -> vivid blue oceans + green land, uniform, no pale shadow.
    const earthTex = makeEarthTexture();
    const earthMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissiveMap: earthTex, emissive: 0xffffff, emissiveIntensity: 0.72, roughness: 1, metalness: 0, transparent: true, opacity: 0, fog: false });
    const earth = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 32), earthMat);
    earth.position.y = -1360; earth.rotation.x = -1.35; earth.visible = false; g.add(earth);
    // vivid, tighter atmosphere rim (a thin shell reads as a glowing edge, not a grey band)
    const atmoMat = new THREE.MeshBasicMaterial({ color: 0x4da6ff, transparent: true, opacity: 0, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(1552, 48, 32), atmoMat);
    atmo.position.y = -1360; atmo.visible = false; g.add(atmo);

    scene.add(g);
    PAD = { group: g, key: activeRocket.key, lzX, towerTop, alignR, site, siteY: 0, skyMat, sun, sunGlow, sunGlow2, rays, haze, ground, groundMat, capeParts, padTop, trench, clouds, earth, earthMat, atmo, atmoMat, steel,
      ocean, oceanMat, shore, shoreMat, glint, glintMat,
      armL, armR, catchArmY, catchX, armOpenZ: baseR * 2.0, armClosedZ: baseR * 1.1 };
  }

  function enterPad() {
    buildPadScene();
    PAD.group.visible = true;
    PAD.siteY = 0; PAD.site.position.y = 0; PAD.site.visible = true;   // site back on the deck
    scene.background = new THREE.Color(0x05060c);   // space-dark behind the sky dome (shows once it fades)
    scene.fog = null;                                 // sky dome supplies the atmosphere
    setSpaceOpacity(0);                               // no stars at golden hour
    padMeshes.forEach(m => { m.visible = false; });   // hide the explorer's glowing disc
    worldA = 0;                                        // start the eased world altitude at the pad
    updateWorld();
  }
  function exitPad() {
    if (PAD) PAD.group.visible = false;
    scene.background = new THREE.Color(0x05060c);
    scene.fog = new THREE.FogExp2(0x05060c, 0.0009);
    setSpaceOpacity(1);
    camera.up.set(0, 1, 0);                           // undo any cinematic bank from the flight
    padMeshes.forEach(m => { m.visible = true; m.material.opacity = 1; });
  }

  // per-frame world evolution, driven by an eased "world altitude" (km)
  let worldA = 0;
  function updateWorld(dt) {
    if (!PAD) return;
    // while the camera is following the returning/landed booster (any phase before the final
    // orbit reveal), drive the world off the booster's height so the golden pad is present for
    // the descent AND the landed hold, instead of snapping to a space backdrop on touchdown.
    // While following the returning booster, the sky altitude flows CONTINUOUSLY from
    // wherever it was at separation (skyA0, anchored to the booster's height fraction) and
    // is rate-limited on the way down, so the space-dark sky re-warms to golden gradually
    // across the whole descent instead of lurching. Saturn V (no booster) is untouched.
    const onBooster = B && launchPhase !== "orbit" && B.camHold <= 0;
    const aTarget = onBooster
      ? B.skyA0 * clamp01(Math.max(0, B.y - B.landY) / B.h0)
      : L.alt;
    // Ease the world altitude toward the target. This does two things: it slows the sky's
    // pace so it never lurches, and it turns the orbit-reveal altitude SNAP (physics jumps
    // from ~60 to 120 km the instant orbit is reached) into a gentle ~2 s darkening that
    // rides along with the reveal camera, instead of cutting straight to black in one frame.
    const prevA = worldA;
    worldA += (aTarget - worldA) * Math.min(1, (dt || 0) * 1.7);
    if (onBooster) worldA = Math.max(worldA, prevA - B.skyRate * (dt || 0));   // bounded re-warm rate
    const a = worldA;
    const k = clamp01(a / 80);                        // 0 = pad, 1 = space (kept for other cues)
    const ks = smooth(k);
    // Sky colour eases through a TWILIGHT-BLUE midpoint instead of jumping straight from
    // golden to black through muddy brown, so the climb reads like a real day-to-space
    // gradient (golden hour -> dusk blue -> deep space) rather than a hard cut.
    const skyMix = (c0, cm, c1, aMid, aEnd) => (a <= aMid)
      ? lerpCol(c0, cm, smooth(clamp01(a / aMid)))
      : lerpCol(cm, c1, smooth(clamp01((a - aMid) / (aEnd - aMid))));
    // The blue -> space leg is spread over a wide altitude band (aMid 36 -> aEnd 88) so the
    // dusk lingers and the darkening is slow; the eased worldA finishes it off smoothly during
    // the orbit reveal, so there is no abrupt blue-to-black at the top.
    PAD.skyMat.uniforms.bottom.value.copy(skyMix(0xff8a3d, 0x315f8f, 0x05060c, 36, 88));
    PAD.skyMat.uniforms.top.value.copy(skyMix(0x2a1e52, 0x142a52, 0x02030a, 36, 88));
    // Keep the dome mostly opaque through the colour fade; only dissolve it high up, where
    // its colour already matches space, so the stars emerge instead of the dome suddenly
    // revealing flat-black background.
    PAD.skyMat.uniforms.alpha.value = 1 - clamp01((a - 52) / 36);
    // stars fade in through the dusk, but only once the ground has properly fallen away:
    // the starfield surrounds the scene, so with the ground up, low stars hung in the
    // air as bright dots against the grass
    setSpaceOpacity(clamp01((a - 34) / 48) * clamp01(-PAD.siteY / 600));
    // The sun and its glow set cleanly and are fully gone by the time the sky turns
    // space-black, so it never lingers as a brown smudge against the stars.
    const sf = 1 - smooth(clamp01((a - 10) / 52));    // 1 low down -> 0 by ~62 km
    PAD.sunGlow.material.opacity = 0.85 * sf;
    PAD.sunGlow2.material.opacity = 0.5 * sf;
    if (PAD.rays) PAD.rays.material.opacity = (QUALITY === "high" ? 0.15 : 0) * sf;
    // bloom stays nearly off at the pad (the golden hour is already bright and would wash
    // out white), grows in with altitude where the plume and sun earn the glow, then
    // TAPERS again in space: against pure black its low-res blur reads as a blocky
    // pattern around the flame, so up there less is more
    if (bloomPass) bloomPass.strength =
      (0.12 + 0.34 * smooth(clamp01(a / 7))) * (1 - 0.6 * smooth(clamp01((a - 35) / 40)));
    PAD.haze.material.opacity = 0.34 * (1 - smooth(clamp01(a / 34)));
    PAD.sun.material.opacity = sf;
    PAD.sun.visible = sf > 0.01;
    PAD.sun.material.color.copy(lerpCol(0xffb668, 0xff6a30, (1 - sf) * 0.7));
    // The ground no longer alpha-fades: the whole site physically falls away below as the
    // rocket outruns it (like every real launch video), and on a booster's return it rises
    // back into frame as the booster comes down to meet it, so nothing "magically" appears.
    let dropTarget;
    if (onBooster) {
      // keyed to the booster's real height: the pad slides into view during the final
      // descent, exactly when a real landing shot picks it up
      dropTarget = Math.max(0, (B.y - B.landY) - current.height * 1.2);
    } else {
      dropTarget = 2200 * smooth(clamp01((a - 2.5) / 14));
    }
    PAD.siteY += (-dropTarget - PAD.siteY) * Math.min(1, (dt || 0) * 1.6);
    PAD.site.position.y = PAD.siteY;
    PAD.site.visible = PAD.siteY > -2100;
    const gv = 1 - smooth(clamp01((a - 3) / 12));       // still used by the cloud fade + coastal flag
    if (PAD.ocean) {
      PAD.oceanMat.opacity = gv; PAD.ocean.visible = gv > 0.01;
      PAD.shoreMat.opacity = gv; PAD.shore.visible = gv > 0.01;
      PAD.glintMat.opacity = 0.5 * gv; PAD.glint.visible = gv > 0.01;
    }
    PAD.clouds.forEach(c => {
      c.mat.opacity = 0.12 * (1 - smooth(clamp01((a - 1.5) / 5)));   // gone by ~6.5km, before the grazing-angle band
      c.s.position.x += c.drift * 0.0; // drift handled in animate via dt; keep static offset here
    });
    // curved Earth fades in only high up, and is fully gone before a descending booster
    // reaches its curve (otherwise the booster clips down into the green Earth surface)
    const ev = clamp01((a - 58) / 22);
    PAD.earth.visible = ev > 0.01; PAD.earthMat.opacity = ev;
    PAD.atmo.visible = ev > 0.01; PAD.atmoMat.opacity = ev * 0.4;
  }

  /* ---------- ignition smoke / steam (Phase D) ---------- */
  let smoke = null;
  function buildSmoke() {
    if (smoke) return;
    const N = 240;
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({ map: SOFT_DOT, size: 42, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const pts = new THREE.Points(g, m); pts.renderOrder = 5; pts.frustumCulled = false;
    scene.add(pts);
    const parts = [];
    let s = 777;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < N; i++) parts.push({ x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0, life: 1, max: 1 });
    smoke = { pts, geom: g, parts, rnd, base: current.height };
  }
  function burstSmoke(power, cx) {
    if (!smoke) return;
    smoke.pts.visible = true;                  // may have been hidden by a previous reset
    const baseR = current.height * 0.09;
    smoke.parts.forEach(p => {
      const a = smoke.rnd() * Math.PI * 2, sp = (0.7 + smoke.rnd() * 1.7) * power;
      p.x = (cx || 0) + Math.cos(a) * baseR * (0.2 + smoke.rnd());   // burst where it lands, not at the mount
      p.z = Math.sin(a) * baseR * (0.2 + smoke.rnd());
      p.y = smoke.rnd() * 3;
      p.vx = Math.cos(a) * sp * 8; p.vz = Math.sin(a) * sp * 8;   // roll outward across the pad
      p.vy = (1.4 + smoke.rnd() * 3.4) * power;
      p.life = 0; p.max = 2.2 + smoke.rnd() * 2.4;                // linger longer
    });
  }
  function updateSmoke(dt) {
    if (!smoke) return;
    const pos = smoke.geom.attributes.position.array, col = smoke.geom.attributes.color.array;
    smoke.parts.forEach((p, i) => {
      if (p.life < p.max) {
        p.life += dt;
        p.vy += dt * 0.6; p.vx *= (1 - dt * 0.4); p.vz *= (1 - dt * 0.4);
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      }
      const t = p.life / p.max;
      const b = t < 1 ? (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85) * 0.4 : 0;   // warm steam, fades
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      col[i * 3] = b * 1.0; col[i * 3 + 1] = b * 0.88; col[i * 3 + 2] = b * 0.72;
    });
    smoke.geom.attributes.position.needsUpdate = true;
    smoke.geom.attributes.color.needsUpdate = true;
  }

  /* ---------- cryo vent vapor (pre-launch hold) ----------
     Wisps of boil-off vapor peel off the rocket's cryogenic tanks while it
     waits on the pad, drifting up and out then fading. They only emit during
     the countdown (venting stops at liftoff as the tanks pressurise) and the
     whole pool fades out with altitude alongside the ground. */
  let vents = null;
  function buildVents() {
    const bb = new THREE.Box3().setFromObject(current.group);
    const sz = bb.getSize(new THREE.Vector3());
    const R = Math.max(sz.x, sz.z) / 2 || current.height * 0.07;
    if (vents) { vents.R = R; vents.H = current.height; return; }  // refresh geometry for the new rocket
    const N = 130;
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({ map: SOFT_DOT, size: 16, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const pts = new THREE.Points(g, m); pts.renderOrder = 4; pts.frustumCulled = false;
    scene.add(pts);
    let s = 4242;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const parts = [];
    for (let i = 0; i < N; i++) parts.push({ x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0, life: 1, max: 1 });
    vents = { pts, geom: g, parts, rnd, R, H: current.height };
  }
  function spawnVent(p) {
    const V = vents, R = V.R, H = V.H, a = V.rnd() * Math.PI * 2;
    const hi = V.rnd() < 0.6;                                   // 60% upper-tank boil-off, 40% low base venting
    p.y = hi ? (0.45 + V.rnd() * 0.45) * H : (0.02 + V.rnd() * 0.12) * H;
    const rr = R * (0.95 + V.rnd() * 0.18);
    p.x = Math.cos(a) * rr; p.z = Math.sin(a) * rr;
    const out = 0.5 + V.rnd() * 1.4;
    p.vx = Math.cos(a) * out; p.vz = Math.sin(a) * out;
    p.vy = hi ? (0.4 + V.rnd() * 0.9) : (0.15 + V.rnd() * 0.5); // gentle drift up
    p.life = 0; p.max = 2.0 + V.rnd() * 2.2;
  }
  function updateVents(dt) {
    if (!vents) return;
    const emit = launchPhase === "countdown";                  // vent while holding; stop at liftoff
    const gv = 1 - clamp01((worldA - 4) / 16);                 // gone by low altitude, riding the ground fade
    vents.pts.visible = gv > 0.01;
    const pos = vents.geom.attributes.position.array, col = vents.geom.attributes.color.array;
    vents.parts.forEach((p, i) => {
      if (p.life >= p.max && emit && vents.rnd() < 0.28) spawnVent(p);  // trickle fresh puffs
      if (p.life < p.max) {
        p.life += dt;
        p.vy += dt * 0.15; p.vx *= (1 - dt * 0.25); p.vz *= (1 - dt * 0.25);
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      }
      const t = p.life / p.max;
      const b = (t < 1 ? (t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8) : 0) * 0.16 * gv;  // soft, fades in and out
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      col[i * 3] = b * 1.0; col[i * 3 + 1] = b * 0.97; col[i * 3 + 2] = b * 0.92;    // cool white, faint golden warmth
    });
    vents.geom.attributes.position.needsUpdate = true;
    vents.geom.attributes.color.needsUpdate = true;
  }

  /* ============================================================
     LAUNCH SIMULATOR
     Press LAUNCH -> fade to the golden-hour pad -> countdown ->
     ignition (smoke, shake) -> ride ground to space -> orbit / fail.
     EASY assists you; HARD is full manual and can fail. Esc aborts.
     ============================================================ */
  let difficulty = "easy";      // easy | hard
  const keys = {};              // held keys during flight
  const L = { t: 0, cd: 0, alt: 0, vy: 0, vx: 0, pitch: 90, throttle: 0, stageIndex: 0, fuel: [], shake: 0, baseY: 0, gforce: 0, calls: {}, relight: 0, stageCam: 0, reachedOrbit: false };
  let exhaust = null;
  const debris = [];            // jettisoned stages tumbling away after separation
  const EXPLORE_UI = ["panel", "dock", "reassemble", "takeApart", "hint", "launchBtn", "helpBtn", "xrayBtn", "fxBtn", "diffBtn", "shotBtn", "shareBtn"];

  // Mission commentary card: a small dialogue box explaining what each stage is doing and
  // why the rocket behaves the way it does. Entries are PACED (each holds ~4s so it can
  // actually be read; fast phases queue up) and LOGGED so the whole story can be reread
  // from the result card after the flight. guidance(msg) is the old one-liner wrapper.
  const NARR_HOLD = 4000;
  let narrQ = [], narrLast = 0, narrTimer = null;
  function narrate(title, body) {
    if (!title && !body) {                      // clear the card and any queue
      narrQ = [];
      if (narrTimer) { clearTimeout(narrTimer); narrTimer = null; }
      const g = el("guidance"); if (g) g.style.display = "none";
      return;
    }
    if (title && launchPhase !== "idle" && L.log) L.log.push({ title: title, body: body || "", alt: L.alt });
    narrQ.push({ title: title, body: body });
    if (narrQ.length > 2) narrQ.splice(0, narrQ.length - 2);   // never lag far behind the flight
    drainNarr();
  }
  function drainNarr() {
    if (narrTimer || !narrQ.length) return;
    const wait = Math.max(0, NARR_HOLD - (performance.now() - narrLast));
    if (wait > 0) { narrTimer = setTimeout(() => { narrTimer = null; drainNarr(); }, wait); return; }
    const n = narrQ.shift();
    narrLast = performance.now();
    const g = el("guidance");
    if (g) {
      g.style.display = "";
      g.innerHTML =
        (n.title ? '<div class="g-title">' + n.title + "</div>" : "") +
        (n.body ? '<div class="g-body">' + n.body + "</div>" : "");
    }
    if (narrQ.length) narrTimer = setTimeout(() => { narrTimer = null; drainNarr(); }, NARR_HOLD);
  }
  function guidance(msg) { narrate("", msg); }

  function startLaunch() {
    if (launchPhase !== "idle" || !current || !Array.isArray(activeRocket.launchStages)) return;
    if (!launchReady) return;                    // every station must call GO first
    launchReady = false;                         // consume the poll: nothing can re-fire this launch
    if (clTimer) { clearTimeout(clTimer); clTimer = null; }
    { const cl = el("checklist"); if (cl) cl.classList.remove("show"); }
    exitTour();
    endIntro();
    explodeAmount = 0; appliedF = 0; focused = null; camTween = null; camMode = "auto";
    setXray(false); restoreMaterials();
    applyExplode(current, 0);
    current.pivot.rotation.set(0, 0, 0);
    L.baseY = current.pivot.position.y;
    L.baseX = current.pivot.position.x;
    L.t = 0; L.alt = 0; L.vy = 0; L.vx = 0; L.down = 0; L.pitch = 90; L.throttle = 0;
    L.stageIndex = 0; L.shake = 0; L.gforce = 0; L.calls = {}; L.relight = 0; L.stageCam = 0; L.reachedOrbit = false;
    L.escX = 0; L.escY = 0;                        // post-separation pull-away drift
    L.log = [];                                    // the flight story, rereadable from the result card
    L.fuel = activeRocket.launchStages.map(() => 1);
    clearDebris(); clearBooster();
    EXPLORE_UI.forEach(id => { const e = el(id); if (e) e.style.display = "none"; });
    launchPhase = "countdown"; L.cd = 10; L.cdT = 0;
    guidance("Hold tight. Liftoff coming up.");
    // the countdown card names the rocket that is actually on the pad
    { const ct = document.querySelector(".cd-top");
      if (ct) ct.innerHTML = '<span class="cd-live"></span>' + activeRocket.name +
        (activeRocket.key === "saturn-v" ? " · AS-506" : "") + " · Live"; }
    // short fade from the dark explorer into the golden-hour pad
    fadeThenTo(() => {
      enterPad();
      buildExhaust();
      buildSmoke();
      buildVents();
      seatPadCamera();
      el("cdNum").textContent = L.cd;
      el("countdown").classList.add("show");
    });                                       // launchUpdate's sim clock runs the count from here
  }

  // fade to black, run mid() while hidden, fade back, then run done()
  function fadeThenTo(mid, done) {
    const f = el("fade");
    if (!f) { if (mid) mid(); if (done) done(); return; }
    f.classList.add("show");
    setTimeout(() => {
      if (mid) mid();
      f.classList.remove("show");
      if (done) setTimeout(done, 440);
    }, 440);
  }

  function seatPadCamera() {
    const H = current.height;
    camera.position.set(H * 0.85, H * 0.16, H * 1.5);
    controls.target.set(0, H * 0.45, 0);
    camera.lookAt(controls.target);
    camera.clearViewOffset();
  }

  const CALLS = { 10: "Guidance internal", 8: "Power transfer", 6: "Ignition sequence start", 4: "All engines running", 2: "Commit", 1: "Liftoff imminent", 0: "Liftoff" };
  // One tick of the count. Driven from launchUpdate's sim clock, NOT a setTimeout chain:
  // browsers clamp chained timers in background pages to one per minute, which froze the
  // count at T-6 for anyone who tabbed away. The sim clock is throttle-proof.
  function tickCountdown() {
    if (launchPhase !== "countdown") return;               // aborted mid-count
    el("cdNum").textContent = L.cd;
    if (CALLS[L.cd] != null) el("cdCall").textContent = CALLS[L.cd];
    playBeep(L.cd <= 0);
    if (L.cd <= 0) { ignite(); return; }
    L.cd--;
  }

  function ignite() {
    el("countdown").classList.remove("show");
    el("cockpit").classList.add("show");
    launchPhase = "flight";
    L.throttle = 1;                    // full thrust for both; HARD can trim it with S
    L.shake = 1;
    burstSmoke(1.9);
    callout("LIFTOFF", "We have cleared the tower");
    if (difficulty === "easy") {
      const st0 = activeRocket.launchStages[0];
      narrate("Liftoff · " + st0.name, st0.story || "Full throttle. The whole stack rides on its first stage.");
    } else {
      narrate("You have control", "Hold W for throttle, A and D to steer the pitch, SPACE to stage when a tank runs dry.");
    }
    const f = el("flash"); f.style.opacity = "0.5"; setTimeout(() => f.style.opacity = "0", 150);
    startRumble();
    setExhaust();                      // light the flame this very frame (no one-frame gap)
  }

  // Cinematic per-stage flame: a cluster of up to 5 engine flames (center + a 4-point ring).
  // Each flame is a coloured plume cone + a hot bright core cone. setExhaust() drives how many
  // show, their colour, width and length from the current stage's `flame` profile in rockets.js,
  // so S-IC reads as a broad fiery 5-engine cluster and S-IVB as a single slim blue-white plume.
  function buildExhaust() {
    if (exhaust && exhaust.parent) exhaust.parent.remove(exhaust);
    exhaust = new THREE.Group();
    // unit cones (height 1, radius 1) so we can scale length/width freely per stage per frame.
    // depthTest off so the downward flame is never hidden behind the pad at liftoff.
    const plumeGeo = new THREE.ConeGeometry(1, 1, 22, 1, true);
    const coreGeo = new THREE.ConeGeometry(1, 1, 16, 1, true);
    const units = [];
    // pool of 21 flame units (center + ring of 8 + ring of 12): enough to read Super
    // Heavy's engine cluster as a wall of flame while small stages just use a few.
    for (let i = 0; i < 21; i++) {
      // additive like the core, and FRONT faces only: rendering both cone walls doubled
      // up into ring/moire patterns around the flame whenever it was seen near end-on
      const plume = new THREE.Mesh(plumeGeo, new THREE.MeshBasicMaterial(
        { color: 0xff5a1e, transparent: true, opacity: 0.9, side: THREE.FrontSide, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
      plume.rotation.x = Math.PI; plume.renderOrder = 8; plume.visible = false; exhaust.add(plume);
      const core = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial(
        { color: 0xffffff, transparent: true, opacity: 0.85, side: THREE.FrontSide, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
      core.rotation.x = Math.PI; core.renderOrder = 9; core.visible = false; exhaust.add(core);
      units.push({ plume: plume, core: core });
    }
    exhaust.userData = { units: units };
    exhaust.visible = false;
    current.pivot.add(exhaust);
  }

  function driftClouds(dt) {
    if (!PAD) return;
    PAD.clouds.forEach(c => { c.s.position.x += c.drift * dt; if (c.s.position.x > 3200) c.s.position.x = -3200; });
    if (PAD.rays) PAD.rays.material.rotation += dt * 0.015;   // the god rays wheel slowly
  }

  /* ---------- ascent exhaust trail ---------- */
  // A continuous world-anchored emitter: every frame of powered flight it drops a few
  // lingering smoke particles at the engine plane, so the rocket draws a real climbing
  // trail. Emission thins with altitude (dense in thick air, gone in vacuum).
  let trail = null;
  const _zAxis = new THREE.Vector3(0, 0, 1);
  const _engPos = new THREE.Vector3();
  function engineWorldPos(out) {
    const H = current.height;
    const stage = activeRocket.launchStages[L.stageIndex];
    const key = stage && stage.key;
    const baseLocal = (key && current.stageRange[key]) ? current.stageRange[key].base : 0;
    return out.set(0, baseLocal - H / 2, 0)
      .applyAxisAngle(_zAxis, current.pivot.rotation.z)
      .add(current.pivot.position);
  }
  function buildTrail() {
    if (trail) return;
    const N = 220;
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({ map: SOFT_DOT, size: 30, sizeAttenuation: true, vertexColors: true,
      transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const pts = new THREE.Points(geo, m); pts.renderOrder = 5; pts.frustumCulled = false; pts.visible = false;
    scene.add(pts);
    const parts = [];
    for (let i = 0; i < N; i++) parts.push({ x: 0, y: -9999, z: 0, vx: 0, vy: 0, vz: 0, life: 1, max: 1 });
    let s = 90210; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    trail = { pts, geom: geo, parts, rnd, head: 0, acc: 0 };
  }
  function updateTrail(dt) {
    // emit while an engine is actually burning, thinning out as the air does
    const stage = activeRocket.launchStages && activeRocket.launchStages[L.stageIndex];
    const burning = launchPhase === "flight" && stage && L.throttle > 0.02 && L.fuel[L.stageIndex] > 0;
    const density = 1 - smooth(clamp01(worldA / 45));
    if (burning && density > 0.03 && current) {
      buildTrail();
      trail.pts.visible = true;
      trail.acc += dt * 45 * density;                       // up to ~45 particles/second low down
      const H = current.height;
      let n = Math.floor(trail.acc); trail.acc -= n;
      if (n > 0) engineWorldPos(_engPos);
      while (n-- > 0) {
        const p = trail.parts[trail.head++ % trail.parts.length];
        const r = trail.rnd;
        p.x = _engPos.x + (r() - 0.5) * H * 0.03;
        p.y = _engPos.y + (r() - 0.5) * H * 0.03;
        p.z = _engPos.z + (r() - 0.5) * H * 0.03;
        p.vx = (r() - 0.5) * H * 0.02; p.vz = (r() - 0.5) * H * 0.02;
        p.vy = -H * 0.008 * r();                            // trail sags and billows gently
        p.life = 0; p.max = 3 + r() * 2.5;
      }
    }
    if (!trail || !trail.pts.visible) return;
    const pos = trail.geom.attributes.position.array, col = trail.geom.attributes.color.array;
    let alive = false;
    trail.parts.forEach((p, i) => {
      if (p.life < p.max) {
        p.life += dt; alive = true;
        p.vx *= (1 - dt * 0.4); p.vy *= (1 - dt * 0.4); p.vz *= (1 - dt * 0.4);
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      }
      const t = p.life / p.max;
      const b = t < 1 ? (t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88) * 0.5 : 0;
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      col[i * 3] = b * 0.82; col[i * 3 + 1] = b * 0.78; col[i * 3 + 2] = b * 0.74;   // warm-white fading grey
    });
    trail.geom.attributes.position.needsUpdate = true;
    trail.geom.attributes.color.needsUpdate = true;
    if (!alive && !burning) trail.pts.visible = false;
  }
  function clearTrail() {
    if (!trail) return;
    trail.parts.forEach(p => { p.life = 1; p.max = 1; p.y = -9999; });
    trail.pts.visible = false; trail.acc = 0;
  }

  function launchUpdate(dt) {
    if (launchPhase === "countdown") {        // count driven by the sim clock (throttle-proof)
      L.cdT = (L.cdT || 0) + dt;
      if (L.cdT >= 0.85) { L.cdT -= 0.85; tickCountdown(); }
    }
    if (launchPhase === "flight") {           // orbit / failed freeze the flight (no more falling)
      physics(dt);
      transformRocket();
    }
    if (L.relight > 0) L.relight = Math.max(0, L.relight - dt);
    updateTelemetry();
    setExhaust();
    updateWorld(dt);
    updateSmoke(dt);
    updateTrail(dt);
    updateVents(dt);
    updateDebris(dt);
    updateStageFx(dt);
    boosterUpdate(dt);
    driftClouds(dt);
    setRumble();
    launchCamera(dt);
  }

  const G = 0.04, THRUST = 0.34;                            // tuned for a fun, winnable ride

  function dropStage(i) {
    const st = activeRocket.launchStages[i];
    const jettison = (st && st.jettison) || [];
    if (!jettison.length || !current) return;
    // collect the visible meshes of the stage we are leaving behind
    const leaving = [];
    Object.values(current.componentMap).forEach(c => {
      if (jettison.indexOf(c.stage) >= 0) c.meshes.forEach(m => { if (m.visible !== false) leaving.push(m); });
    });
    const rec = activeRocket.recover;
    if (rec && st && st.key === rec.booster) startBoosterRecovery(leaving);   // fly it home instead of discarding it
    else spawnDebris(leaving, i);                                             // otherwise tumble away as debris
    leaving.forEach(m => { m.visible = false; });   // hide the originals on the vehicle
  }

  // clone the jettisoned meshes into a free-floating group that tumbles + falls + fades,
  // so a spent stage separates and drops away instead of just blinking out of existence.
  function spawnDebris(meshes, idx) {
    if (!meshes.length) return;
    const centroid = new THREE.Vector3();
    const parts = meshes.map(m => {
      m.updateWorldMatrix(true, false);
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      m.matrixWorld.decompose(p, q, s); centroid.add(p);
      return { m, p, q, s };
    });
    centroid.multiplyScalar(1 / parts.length);
    const g = new THREE.Group();
    parts.forEach(w => {
      const cl = w.m.clone();
      cl.position.copy(w.p).sub(centroid);   // relative to the centroid so the group tumbles in place
      cl.quaternion.copy(w.q); cl.scale.copy(w.s);
      cl.material = w.m.material.clone(); cl.material.transparent = true;  // clone mat so fading is isolated
      cl.visible = true;
      g.add(cl);
    });
    g.position.copy(centroid);
    scene.add(g);
    const H = current.height, sgn = idx % 2 === 0 ? 1 : -1;
    // real separation physics: the spent stage inherits the vehicle's motion, keeps climbing
    // for a beat, arcs over under gravity, and falls away behind the accelerating rocket
    debris.push({ group: g, life: 0, max: 3.6,
      vy: H * 0.25, vx: -H * 0.06, grav: H * 0.28,
      spinx: 0.35 * sgn, spinz: 0.22 });
  }
  function updateDebris(dt) {
    for (let i = debris.length - 1; i >= 0; i--) {
      const d = debris[i];
      d.life += dt;
      d.vy -= d.grav * dt;                      // ballistic: climbs, arcs over, falls away
      d.group.position.y += d.vy * dt;
      d.group.position.x += d.vx * dt;
      d.group.rotation.x += d.spinx * dt;
      d.group.rotation.z += d.spinz * dt;
      const k = Math.max(0, 1 - d.life / d.max);
      d.group.traverse(o => { if (o.material) o.material.opacity = k; });
      if (d.life >= d.max) {
        scene.remove(d.group);
        d.group.traverse(o => { if (o.material) o.material.dispose(); });  // geo is shared - don't dispose it
        debris.splice(i, 1);
      }
    }
  }
  function clearDebris() {
    debris.forEach(d => { scene.remove(d.group); d.group.traverse(o => { if (o.material) o.material.dispose(); }); });
    debris.length = 0;
  }

  // A short-lived additive-particle puff fired at the separation plane during staging.
  // (The pad `smoke` system is world-anchored at the ground, so this is a separate pool
  // that can burst anywhere the rocket happens to be.)
  let stageFx = null;
  function buildStageFx() {
    if (stageFx) return;
    const N = 46;
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({ map: SOFT_DOT, size: 20, sizeAttenuation: true, vertexColors: true,
      transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const pts = new THREE.Points(g, m); pts.renderOrder = 6; pts.frustumCulled = false; pts.visible = false;
    scene.add(pts);
    const parts = [];
    let s = 1337; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < N; i++) parts.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, max: 1 });
    stageFx = { pts: pts, geom: g, parts: parts, rnd: rnd };
  }
  function stagePuff(x, y, z, opts) {
    buildStageFx();
    const o = opts || {};
    stageFx.pts.visible = true;
    const R = current.height * (o.radius || 0.05);
    const tint = o.tint || [1, 0.9, 0.78];              // default warm gas; Max-Q passes cool white
    stageFx.parts.forEach(p => {
      const a = stageFx.rnd() * Math.PI * 2, r = stageFx.rnd();
      p.x = x + Math.cos(a) * R * r; p.y = y + (stageFx.rnd() - 0.5) * R; p.z = z + Math.sin(a) * R * r;
      const sp = (2 + stageFx.rnd() * 4) * (o.speed || 1);
      p.vx = Math.cos(a) * sp; p.vz = Math.sin(a) * sp; p.vy = (stageFx.rnd() - 0.3) * 2;
      p.life = 0; p.max = (0.6 + stageFx.rnd() * 0.5) * (o.linger || 1);
      p.cr = tint[0]; p.cg = tint[1]; p.cb = tint[2];
    });
  }
  function updateStageFx(dt) {
    if (!stageFx || !stageFx.pts.visible) return;
    const pos = stageFx.geom.attributes.position.array, col = stageFx.geom.attributes.color.array;
    let alive = false;
    stageFx.parts.forEach((p, i) => {
      if (p.life < p.max) {
        p.life += dt; alive = true;
        p.vx *= (1 - dt * 1.2); p.vz *= (1 - dt * 1.2); p.vy += dt * 0.5;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      }
      const t = p.life / p.max;
      const b = t < 1 ? (t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8) * 0.85 : 0;
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      col[i * 3] = b * (p.cr || 1); col[i * 3 + 1] = b * (p.cg || 0.9); col[i * 3 + 2] = b * (p.cb || 0.78);
    });
    stageFx.geom.attributes.position.needsUpdate = true;
    stageFx.geom.attributes.color.needsUpdate = true;
    if (!alive) stageFx.pts.visible = false;
  }
  /* ============================================================
     REUSABLE BOOSTER RECOVERY
     When a rocket defines `recover`, its first stage does not tumble
     away as debris. Instead we clone it into a controlled object and
     fly it back down through a scripted flip / boostback / descent /
     landing-burn sequence, landing it on the pad (Falcon 9 legs) or
     in the tower's arms (Starship catch). The upper stage carries on
     to orbit; the mission wraps up once BOTH are done.
     ============================================================ */
  let B = null;                 // active booster-recovery state, or null
  let boosterExhaust = null;    // the booster's landing/boostback flame

  function buildBoosterExhaust() {
    const grp = new THREE.Group();
    const geo = new THREE.ConeGeometry(1, 1, 20, 1, true);
    const plume = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff6a24, transparent: true, opacity: 0.85, side: THREE.FrontSide, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
    plume.rotation.x = Math.PI; plume.renderOrder = 8;
    const core = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffe6b0, transparent: true, opacity: 0.9, side: THREE.FrontSide, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
    core.rotation.x = Math.PI; core.renderOrder = 9;
    grp.add(plume); grp.add(core); grp.visible = false;
    grp.userData = { plume: plume, core: core };
    return grp;
  }
  function setBoosterExhaust(on, throttle) {
    if (!boosterExhaust) return;
    boosterExhaust.visible = !!on;
    if (!on) return;
    const H = current.height;
    const len = H * 0.14 * (0.7 + throttle * 0.5) * (1 + Math.sin(L.t * 38) * 0.06);
    const w = H * 0.026;
    const u = boosterExhaust.userData;
    u.plume.scale.set(w, len, w); u.plume.position.y = -len / 2;
    u.core.scale.set(w * 0.5, len * 0.6, w * 0.5); u.core.position.y = -len * 0.3;
  }

  // deployable landing legs for a returning booster: hinged so they fold up against the body
  // during flight and swing out for touchdown. Built fresh on the booster clone (the model's
  // stowed legs are hidden), and animated via each hinge's rotation.z.
  const LEG_FOLDED = 2.75, LEG_DEPLOYED = 0.62;
  function buildBoosterLegs(group, baseY, r) {
    const legMat = mat(0x14161c, 0.35, 0.6);
    const L = r * 3.6, hingeY = r * 1.0, legs = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const radial = new THREE.Group();
      radial.position.set(Math.cos(a) * r * 0.9, baseY + hingeY, Math.sin(a) * r * 0.9);
      radial.rotation.y = -a;
      const hinge = new THREE.Group(); radial.add(hinge);
      const strut = new THREE.Mesh(new THREE.BoxGeometry(r * 0.14, L, r * 0.14), legMat);
      strut.position.y = -L / 2; hinge.add(strut);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.26, r * 0.26, r * 0.12, 12), legMat);
      foot.position.y = -L; hinge.add(foot);
      hinge.rotation.z = LEG_FOLDED;                    // start stowed
      group.add(radial); legs.push(hinge);
    }
    // how far the DEPLOYED feet reach below the booster base, so we can stand on them, not sink in
    const drop = L * Math.cos(LEG_DEPLOYED) - hingeY;
    return { hinges: legs, drop: drop };
  }
  function setLegDeploy(f) {
    if (!B || !B.legs) return;
    const z = THREE.MathUtils.lerp(LEG_FOLDED, LEG_DEPLOYED, clamp01(f));
    B.legs.forEach(h => h.rotation.z = z);
  }

  function startBoosterRecovery(meshes) {
    if (!meshes.length) return;
    const centroid = new THREE.Vector3();
    const parts = meshes.map(m => {
      m.updateWorldMatrix(true, false);
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      m.matrixWorld.decompose(p, q, s); centroid.add(p);
      return { m: m, p: p, q: q, s: s };
    });
    centroid.multiplyScalar(1 / parts.length);
    const g = new THREE.Group();
    parts.forEach(w => {
      const cl = w.m.clone();
      cl.position.copy(w.p).sub(centroid);
      cl.quaternion.copy(w.q); cl.scale.copy(w.s);
      cl.material = w.m.material.clone();
      cl.visible = true;
      g.add(cl);
    });
    g.position.copy(centroid);
    scene.add(g);
    // The clones carry the vehicle's gravity-turn tilt baked into their transforms, so
    // measure the booster UPRIGHT (rotate the group to cancel the tilt, box it, rotate
    // back). A box taken in the tilted pose reads wide instead of tall and skews every
    // offset the landing math depends on.
    const tilt = (90 - L.pitch) * Math.PI / 180;
    g.rotation.z = tilt; g.updateMatrixWorld(true);
    const ubox = new THREE.Box3().setFromObject(g);
    g.rotation.z = 0;
    const baseOffset = centroid.y - ubox.min.y;       // centroid height above the engines (upright)
    const topOffset = ubox.max.y - centroid.y;        // centroid to the booster top (upright)
    // Fresh parts (the flame, the hinged landing legs) never had the baked tilt, so they
    // live in a counter-rotated mount that keeps them glued to the body through the flip.
    const mount = new THREE.Group();
    mount.rotation.z = -tilt;
    g.add(mount);
    boosterExhaust = buildBoosterExhaust();
    boosterExhaust.position.y = -baseOffset;          // flame right at the engine end
    const bf = activeRocket.launchStages[0].flame;    // match the booster's own flame colour
    if (bf) { boosterExhaust.userData.plume.material.color.setHex(bf.color); boosterExhaust.userData.core.material.color.setHex(bf.core); }
    mount.add(boosterExhaust);
    const mode = (activeRocket.recover && activeRocket.recover.mode) || "legs";
    let landX = 0, landY = baseOffset;                 // legs: base on the pad at world y 0
    if (mode === "catch" && PAD && PAD.armL) {
      landX = PAD.catchX;
      landY = PAD.catchArmY - topOffset * 0.6;         // hang from the tower arms near the booster top
      PAD.armL.visible = true; PAD.armR.visible = true; setCatchArms(0);   // arms open, waiting
    }
    // legs mode: hide the cloned stowed legs and add fresh hinged legs that deploy for landing
    let legs = null;
    if (mode === "legs") {
      g.traverse(o => { if (o.userData && o.userData.legPart) o.visible = false; });
      const bp = activeRocket.parts.find(pp => pp.id === (activeRocket.recover && activeRocket.recover.booster));
      const br = bp ? (bp.rb || bp.rt || 2) : 2;
      const lr = buildBoosterLegs(mount, ubox.min.y - centroid.y, br);
      legs = lr.hinges;
      // set down on the LANDING ZONE, not back on the launch mount (where the descent
      // path ran straight through the tower's swing arms), resting on the deployed legs
      landX = (PAD && PAD.lzX != null) ? PAD.lzX : -(current.height * 0.5);
      landY = 0.1 + baseOffset + Math.max(0, lr.drop);
    }
    B = {
      group: g, phase: "flip", t: 0, landed: false,
      x: centroid.x, y: centroid.y,
      // Peel-away velocity RELATIVE to what the eye sees: the live stage accelerates
      // ahead (its escape drift), so the spent booster falls back and down behind it.
      // A forward drift here used to slide the booster straight through the stage.
      vx: -current.height * 0.05, vy: current.height * 0.12,
      camHold: 2.2,                            // stay with the vehicle a beat before cutting away
      tFlip: mode === "catch" ? 3.6 : 2.4,     // a monster booster swings its nose around slowly
      rotZ: 0,                                 // eased attitude (phases only steer a target)
      halfH: baseOffset, landX: landX, landY: landY, armClose: 0,
      legs: legs, legDeploy: 0, tRet: 0,
      // sky continuity: the world altitude keeps flowing from wherever it was at
      // separation, descending no faster than a gentle rate (see updateWorld)
      skyA0: worldA,
      h0: Math.max(0.001, centroid.y - landY),
      skyRate: THREE.MathUtils.clamp(worldA / 13, 2.5, 5),
      // the cloned meshes carry the vehicle's gravity-turn tilt baked in; the flip
      // sweep accounts for it so the booster ends up truly upright
      tiltFix: tilt,
      mode: mode
    };
    callout("STAGE SEPARATION", "Booster peeling away for the trip home");
  }

  function setCatchArms(f) {
    if (!PAD || !PAD.armL) return;
    const z = THREE.MathUtils.lerp(PAD.armOpenZ, PAD.armClosedZ, clamp01(f));
    PAD.armL.position.z = -z; PAD.armR.position.z = z;
  }

  // wrap up the mission once BOTH the payload is in orbit and the booster is home (and, for a
  // tower catch, the arms have finished closing so the catch is actually seen).
  function maybeWrap() {
    if (!L.reachedOrbit) return;
    if (B && !B.landed) return;
    if (B && (B.landT || 0) < 3.4) return;              // linger on the recovered booster (dust settles)
    if (B && B.mode === "catch" && B.armClose < 1) return;
    if (launchPhase === "flight") winMission();
  }

  function landBooster() {
    B.landed = true; B.phase = "landed"; B.landT = 0;
    B.y = B.landY; B.group.position.set(B.landX, B.landY, B.group.position.z);
    B.rotZ = B.tiltFix;
    B.group.rotation.set(0, 0, B.tiltFix);              // exactly upright
    setBoosterExhaust(false);
    if (B.legs) { B.legDeploy = 1; setLegDeploy(1); }   // legs fully out for touchdown
    L.shake = 0.6; sfxThump();
    if (B.mode === "catch") {
      B.armClose = Math.max(B.armClose || 0, 0.0001);  // arms finish closing (animated below)
      callout("BOOSTER CAUGHT", "Held in the tower's arms");
      narrate("Caught", "The tower's arms close around the booster in mid air. No legs needed, it goes straight back on the stand for the next flight.");
    } else {
      burstSmoke(0.85, B.landX);                       // touchdown dust AT the landing zone
      callout("BOOSTER RECOVERED", "Standing tall on the pad");
      narrate("The booster is home", "Standing tall on its legs, minutes after doing the heavy lifting. Refurbish, refuel, fly again.");
    }
  }

  /* Kinematic flyback: real scene-scale gravity plus two guidance loops that make it
     fail-safe. A grid-fin controller steers B.vx so the booster always arrives over the
     landing spot, and the landing burn is solved in closed form at ignition so vertical
     speed reaches zero exactly at the deck (a real suicide burn, not a hover-down).
     All motion and rotation stay in the camera's x/y plane: the flip is a PITCH over
     the top (nose sweeps downrange-up-home), the way a real booster actually flips. */
  const B_G = () => current.height * 0.075;             // booster gravity
  const B_VT = () => current.height * 0.5;              // grid-fin terminal velocity
  const T_FLIP = 1.6, T_BB = 3.0, T_PITCH = 2.5, T_ENTRY = 1.0;

  function boosterUpdate(dt) {
    if (!B) return;
    if (B.camHold > 0) {                                // camera lingers on the vehicle at staging
      B.camHold -= dt;
      if (B.camHold <= 0) {                             // cutting to the booster now: re-anchor the
        B.skyA0 = worldA;                               // sky/site continuity to this exact moment
        B.h0 = Math.max(0.001, B.y - B.landY);
        B.skyRate = THREE.MathUtils.clamp(worldA / 13, 2.5, 5);
      }
    }
    if (B.landed) {                                     // caught/landed: hold a beat, then wrap up
      B.landT = (B.landT || 0) + dt;
      if (B.mode === "catch" && B.armClose > 0 && B.armClose < 1) {
        B.armClose = Math.min(1, B.armClose + dt * 1.5);
        setCatchArms(B.armClose);
      }
      maybeWrap();                                      // gated so we linger on the recovered booster
      return;
    }
    B.t += dt;
    const H = current.height, g = B.group;
    const catchMode = B.mode === "catch";
    let burn = false, throttle = 1;
    // horizontal "grid fin" guidance: ease vx toward whatever brings the booster over
    // the landing spot in the time remaining
    const steer = (gain) => {
      B.tRet = Math.max(1, B.tRet - dt);
      const vxReq = -(B.x - B.landX) / B.tRet;
      B.vx += (vxReq - B.vx) * Math.min(1, dt * gain);
      B.vx = THREE.MathUtils.clamp(B.vx, -H * 0.6, H * 0.6);
    };
    // catch approach discipline: a tower catch never lets the booster sink below the
    // tower until it is lined up over the arms, or it would slide sideways through the
    // steel. Hold nearly level, keep steering, then drop vertically between the arms.
    const catchHold = () => {
      if (!catchMode || !PAD || PAD.towerTop == null) return;
      if (B.y < PAD.towerTop + H * 0.25 && Math.abs(B.x - B.landX) > (PAD.alignR || H * 0.06)) {
        B.vy = Math.max(B.vy, -H * 0.025);
      }
    };
    // suicide-burn trigger: fires the moment the remaining height only just allows the
    // fall to be killed (checked from coast onward so it can never be skipped)
    const maybeLandingBurn = () => {
      if (B.vy >= 0) return false;
      const h = B.y - B.landY;
      if (h > (B.vy * B.vy) / (2 * 3 * B_G()) + H * 0.06) return false;
      B.phase = "landingBurn"; B.t = 0;
      B.burnA = (B.vy * B.vy) / (2 * Math.max(h, H * 0.01));   // exact decel to reach v=0 at the deck
      callout("LANDING BURN", catchMode ? "Easing into the tower's arms" : "One burn, straight to the deck");
      narrate("Landing burn", catchMode
        ? "One decisive burn, timed to hit zero speed right between the tower's arms."
        : "One decisive burn, timed to hit zero speed right at the deck. Too early wastes fuel, too late digs a crater.");
      return true;
    };
    // Smooth attitude: every phase only sets a TARGET angle and a turn rate, and the
    // booster eases toward it. Phase changes can never snap the rotation, and the
    // righting on the way home is one long slow roll instead of a sudden turn.
    let rotTarget = B.tiltFix, rotRate = 0.8;
    if (B.phase === "flip") {                           // engines off: ballistic peel-away while
      B.vy -= B_G() * dt;                               // the nose pitches over the top to point home
      rotTarget = B.tiltFix + Math.PI / 2;
      rotRate = catchMode ? 0.7 : 1.0;
      if (B.t >= (B.tFlip || T_FLIP)) {
        B.phase = "boostback"; B.t = 0; B.tRet = 11;
        callout("BOOSTBACK BURN", "Turning back " + (catchMode ? "toward the tower" : "toward the pad"));
        narrate("Boostback burn", "Engines forward, a hard burst against its own speed. That bends the arc back toward the launch site.");
      }
    } else if (B.phase === "boostback") {               // horizontal burn homing on the pad
      burn = true; throttle = 1;
      B.vy -= B_G() * dt;
      steer(1.6);
      rotTarget = B.tiltFix + Math.PI / 2; rotRate = 1.0;
      if (B.t >= T_BB) {
        B.phase = "coast"; B.t = 0;
        callout("GRID FINS DEPLOYED", "Steering home for landing");
        narrate("Coasting home", "Engines off, falling on a clean arc. Four grid fins bite the air to steer the rest of the way.");
      }
    } else if (B.phase === "coast") {                   // ballistic arc over the apex, righting itself
      B.vy -= B_G() * dt;
      steer(0.9);
      rotTarget = B.tiltFix; rotRate = 0.5;             // long gentle roll back upright
      catchHold();
      if (!maybeLandingBurn() && B.vy < 0 && (B.y - B.landY) < H * 1.7) {
        B.phase = "entryBurn"; B.t = 0;
        callout("ENTRY BURN", "Relighting to slow the fall");
        narrate("Entry burn", "A short relight softens the slam into thicker air. The booster brakes itself before the air does it the hard way.");
      }
    } else if (B.phase === "entryBurn") {               // brief braking relight
      burn = true; throttle = 0.7;
      rotTarget = B.tiltFix; rotRate = 0.7;
      B.vy = Math.min(B.vy + 1.6 * B_G() * dt, -H * 0.05);
      steer(0.9);
      catchHold();
      if (!maybeLandingBurn() && B.t >= T_ENTRY) { B.phase = "descent"; B.t = 0; }
    } else if (B.phase === "descent") {                 // gravity takes it again, fins steering
      rotTarget = B.tiltFix; rotRate = 0.9;
      B.vy = Math.max(B.vy - B_G() * dt, -B_VT());
      steer(0.9);
      catchHold();
      maybeLandingBurn();
    } else if (B.phase === "landingBurn") {             // closed loop: cannot miss the deck
      burn = true;
      rotTarget = B.tiltFix; rotRate = 1.6;
      B.vy = Math.min(B.vy + B.burnA * dt, -H * 0.02);  // decisive decel; the tiny floor kills any hover
      throttle = Math.min(1, 0.55 + Math.abs(B.vy) / B_VT() * 0.6);   // flame eases off as it slows
      B.vx = 0; B.x += (B.landX - B.x) * Math.min(1, dt * 2.5);
      if (B.legs) { B.legDeploy = clamp01(B.t / 1.4); setLegDeploy(smooth(B.legDeploy)); }
      if (catchMode) {                                  // arms start wrapping as it settles in
        B.armClose = Math.min(0.7, (B.armClose || 0) + dt * 0.45);
        setCatchArms(B.armClose);
      }
      if (B.y <= B.landY + H * 0.005) { landBooster(); return; }
    }
    B.rotZ += (rotTarget - B.rotZ) * Math.min(1, dt * rotRate);
    g.rotation.z = B.rotZ + (B.phase === "descent" ? 0.03 * Math.sin(L.t * 1.7) : 0);
    B.x += B.vx * dt; B.y += B.vy * dt;
    g.position.set(B.x, B.y, g.position.z);
    setBoosterExhaust(burn, throttle);
  }

  function clearBooster() {
    if (B && B.group) { scene.remove(B.group); B.group.traverse(o => { if (o.material) o.material.dispose(); }); }
    if (PAD && PAD.armL) { PAD.armL.visible = false; PAD.armR.visible = false; }
    B = null; boosterExhaust = null;
  }

  function advanceStage() {
    const stages = activeRocket.launchStages;
    if (L.stageIndex >= stages.length - 1) return;
    dropStage(L.stageIndex);
    L.stageIndex++; L.shake = 0.7;
    // make the separation feel alive instead of a hard cut: puff of debris gas at the
    // separation plane, a quick flash, a smooth flame relight, and a brief camera pull-back.
    const H = current.height, newKey = stages[L.stageIndex].key;
    const sepLocal = (current.stageRange[newKey] ? current.stageRange[newKey].base : 0) - H / 2;
    const pv = current.pivot.position;
    stagePuff(pv.x, pv.y + sepLocal, pv.z, { radius: 0.07, speed: 1.4 });
    // a beat later, ullage puffs settle the new stage's fuel before its engine lights
    setTimeout(() => {
      if (launchPhase === "flight" && current)
        stagePuff(current.pivot.position.x, current.pivot.position.y + sepLocal + H * 0.04,
          current.pivot.position.z, { radius: 0.035, speed: 0.7, tint: [0.9, 0.93, 1] });
    }, 240);
    const f = el("flash"); if (f) { f.style.opacity = "0.28"; setTimeout(() => f.style.opacity = "0", 130); }
    L.relight = 0.35; L.stageCam = 0.8;
    if (!B) callout("STAGE " + (L.stageIndex + 1) + " IGNITION", "Separation confirmed");   // recovery fires its own callout
    const stNew = stages[L.stageIndex];
    narrate("Staging · " + stNew.name, stNew.story || "The empty stage falls away and a lighter rocket with a fresh engine keeps building speed.");
    sfxThump();
  }

  function physics(dt) {
    if (L.reachedOrbit) return;              // upper stage parked in orbit, waiting on the booster
    const stages = activeRocket.launchStages;
    const stage = stages[L.stageIndex];
    // throttle: HARD is manual (W/S), EASY runs full
    if (difficulty === "hard") {
      if (keys["w"]) L.throttle = Math.min(1, L.throttle + dt * 0.8);
      if (keys["s"]) L.throttle = Math.max(0, L.throttle - dt * 0.9);
    } else { L.throttle = 1; }
    let acc = 0;
    if (launchPhase === "flight" && L.throttle > 0 && L.fuel[L.stageIndex] > 0) {
      acc = L.throttle * stage.thrust * THRUST;
      L.fuel[L.stageIndex] = Math.max(0, L.fuel[L.stageIndex] - (L.throttle / stage.burn) * dt);
    }
    if (!L.calls.meco && L.stageIndex === 0 && L.fuel[0] <= 0) {
      L.calls.meco = true; callout("MECO", "Main engine cutoff");
      narrate("Main engine cutoff", "Stage one's tanks are dry. Empty tanks are dead weight, so the rocket is about to let the whole stage go.");
    }
    // gravity turn onset: explain WHY the nose is tipping over (once, as it starts)
    if (!L.calls.gturn && launchPhase === "flight" && L.pitch < 85 && L.alt > 1.8) {
      L.calls.gturn = true;
      narrate("The gravity turn", "Watch the nose lean downrange. Reaching orbit is mostly about going sideways very fast, so the rocket trades climb for speed across the ground.");
    }
    // staging: EASY auto-stages on burnout; HARD leaves it to the player (Space / STAGE)
    if (L.fuel[L.stageIndex] <= 0 && difficulty === "easy" && L.stageIndex < stages.length - 1) advanceStage();
    // pitch program (gravity turn); HARD lets you nudge it with A/D.
    // Eases over between 0.8 and ~25 km so the arc reads gradual, not a low flat turn.
    const autoPitch = 90 - 80 * clamp01((L.alt - 0.8) / 24);
    if (difficulty === "hard") {
      if (keys["a"]) L.pitch += dt * 20;
      if (keys["d"]) L.pitch -= dt * 20;
      L.pitch += (autoPitch - L.pitch) * Math.min(1, dt * 0.5);
      L.pitch = Math.max(0, Math.min(96, L.pitch));
    } else { L.pitch = autoPitch; }
    const pr = L.pitch * Math.PI / 180;
    L.vy += (Math.sin(pr) * acc - G) * dt;
    L.vx += Math.cos(pr) * acc * dt;
    L.alt += L.vy * dt;
    L.down += L.vx * dt;                     // downrange distance actually flown (drives the visible arc)
    // after separation the live stage visibly pulls AWAY (its normal on-screen motion is
    // capped to stay framed, which used to leave it hanging beside the flyback booster)
    if (B) {
      L.escX = Math.min((L.escX || 0) + current.height * 0.5 * dt, current.height * 3.4);
      L.escY = Math.min((L.escY || 0) + current.height * 0.2 * dt, current.height * 1.5);
    }
    if (L.alt < 0) {
      L.alt = 0;
      if (L.vy < 0) {
        if (difficulty === "hard" && L.t > 3) { failMission("You fell back to the pad."); return; }
        L.vy = 0;
      }
    }
    L.gforce = acc > 0 ? 1 + (acc / G - 1) * 0.32 : 0;
    L.t += dt;
    if (!L.calls.maxq && L.alt > 1.4) {
      L.calls.maxq = true; callout("MAX-Q", "Peak aerodynamic pressure");
      narrate("Max Q", "The air is pushing back its hardest right now. That white flash is vapor squeezed out of the air as the rocket shoulders through.");
      // condensation cloud: a cool white vapor flash around the vehicle as it squeezes
      // through the thickest air, like the real transonic shock collar
      const pv = current.pivot.position;
      stagePuff(pv.x, pv.y + current.height * 0.12, pv.z,
        { radius: 0.08, speed: 1.8, linger: 0.7, tint: [0.95, 0.97, 1] });
      L.shake = Math.max(L.shake, 0.45);
    }
    // orbit reached? (EASY also completes once the tanks are dry above the line, so the
    // gentler pitch program can never leave an autopilot flight stuck short of the gate)
    const easyDone = difficulty === "easy" && L.alt > 60 && L.fuel.every(f => f <= 0.001);
    if (launchPhase === "flight" && ((L.alt > 60 && L.vx * 1000 > 6250) || easyDone)) {
      if (activeRocket.recover) {
        // upper stage is in orbit; deploy the payload and park it, then wait for the booster
        if (!L.reachedOrbit) {
          L.reachedOrbit = true; L.vy = 0;
          callout("PAYLOAD DEPLOYED", "Satellite released into orbit");
          narrate("Payload away", "Fast enough sideways to keep missing the Earth as it falls. That is all an orbit is.");
        }
        maybeWrap();                         // wraps up once the booster is home too
      } else { winMission(); return; }
    }
    // HARD can fail: out of usable fuel, falling, short of orbit
    if (difficulty === "hard" && launchPhase === "flight") {
      const anyFuel = L.fuel.some((f, idx) => idx >= L.stageIndex && f > 0.001);
      if (!anyFuel && L.vy < 0 && L.alt < 60) failMission("Out of fuel, short of orbit.");
    }
  }

  function winMission() {
    launchPhase = "orbit";
    L.alt = Math.max(L.alt, 120); L.vy = 0;   // hold a clean orbital altitude for the view
    // drop the escape drift and re-place the vehicle so the orbit reveal frames it cleanly
    L.escX = 0; L.escY = 0;
    if (current && Array.isArray(activeRocket.launchStages)) transformRocket();
    const rec = activeRocket.recover;
    callout(rec ? "MISSION COMPLETE" : "ORBIT ACHIEVED", rec ? "Payload in orbit and booster recovered" : "Beautiful flying, commander");
    guidance("");   // side result card carries the message; keep the rocket clear
    showResult(true); stopRumble();
  }
  function failMission(msg) {
    if (launchPhase === "failed") return;
    launchPhase = "failed";
    callout("MISSION FAILED", msg);
    guidance("");   // side result card carries the message; keep the rocket clear
    showResult(false); stopRumble();
  }

  // big broadcast mission callout (Max-Q, MECO, staging, orbit...)
  function callout(big, sub) {
    const c = el("callout"); if (!c) return;
    el("calloutBig").textContent = big;
    el("calloutSub").textContent = sub || "";
    c.classList.remove("show"); void c.offsetWidth; c.classList.add("show");
  }
  function showResult(win) {
    const r = el("result"); if (!r) return;
    const rec = activeRocket.recover;
    const recSub = rec && rec.mode === "catch"
      ? (activeRocket.name + " put its payload in orbit, and the tower caught the booster in mid air.")
      : (activeRocket.name + " put its payload in orbit and flew the booster home to land.");
    el("resultTitle").textContent = win ? (rec ? "Mission complete 🛰️" : "Orbit achieved 🌍") : "Mission failed";
    el("resultSub").textContent = win
      ? (rec ? recSub : (activeRocket.name + " delivered its payload to orbit."))
      : "The flight ended early. Try HARD again, or head back to explore.";
    r.classList.toggle("win", win); r.classList.add("show");
  }
  function hideResult() { const r = el("result"); if (r) r.classList.remove("show"); }

  const MAXRISE = () => current.height * 2.4;
  function transformRocket() {
    const rise = MAXRISE() * (1 - Math.exp(-L.alt / 3.2));  // asymptotic so it stays framed
    current.pivot.position.y = L.baseY + rise;
    // gravity turn, visibly: downrange distance maps to a sideways drift with the same
    // asymptotic trick so the arc stays framed, and the pitch program tilts the nose over.
    const drift = current.height * 3.0 * (1 - Math.exp(-(L.down || 0) / 26));
    current.pivot.position.x = (L.baseX || 0) + drift + (L.escX || 0);
    current.pivot.position.y += (L.escY || 0);
    current.pivot.rotation.z = -(90 - L.pitch) * Math.PI / 180;   // nose leans downrange
  }

  function stageRb(key) {
    const p = key && activeRocket.parts.find(pp => pp.id === key);
    return p ? (p.rb || p.rt || 4.5) : 4.5;
  }
  const DEFAULT_FLAME = { color: 0xff7326, core: 0xffe6b0, engines: 5, rExit: 1.6, len: 22, spread: 1.7 };
  function setExhaust() {
    if (!exhaust) return;
    const stages = activeRocket.launchStages;
    const stage = stages[L.stageIndex];
    const fl = (stage && stage.flame) || DEFAULT_FLAME;
    const on = launchPhase === "flight" && L.throttle > 0.02 && L.fuel[L.stageIndex] > 0;
    exhaust.visible = on;
    const units = exhaust.userData.units;
    if (!on) { units.forEach(u => { u.plume.visible = false; u.core.visible = false; }); return; }
    // Anchor the flame's wide end at the CURRENT stage's base. The rocket group sits at
    // -H/2 inside the pivot, so a group-local stage base maps to (base - H/2) in pivot space;
    // after a stage drops this keeps the plume at the live engines.
    const H = current.height;
    const key = stage && stage.key;
    const baseLocal = (key && current.stageRange[key]) ? current.stageRange[key].base : 0;
    const anchorY = baseLocal - H / 2;
    // relight ramp (staging): flame length grows 0 -> 1 over ~0.35s so the next engine "lights"
    const relight = L.relight > 0 ? clamp01(1 - L.relight / 0.35) : 1;
    // plumes swell as the air thins, like real vacuum expansion (width gently: a very
    // wide cone seen near end-on turns into an odd disc against the black)
    const vac = smooth(clamp01(worldA / 60));
    const pulse = (0.72 + L.throttle * 0.55) * relight * (1 + vac * 0.7);
    const width = fl.rExit * (0.9 + L.throttle * 0.2) * (1 + vac * 0.28);
    const ring = fl.spread;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      const active = i < fl.engines;
      u.plume.visible = active; u.core.visible = active;
      if (!active) continue;
      // engine layout: unit 0 centered, then an inner ring (up to 8) and an outer ring
      // beyond that, so big clusters (Merlin octaweb, Raptor wall) read as real geometry.
      let dx = 0, dz = 0;
      if (i > 0) {
        const inner = Math.min(fl.engines - 1, 8);
        if (i <= inner) {
          const a = (i - 1) / inner * Math.PI * 2 + Math.PI / 4;
          dx = Math.cos(a) * ring; dz = Math.sin(a) * ring;
        } else {
          const outerN = fl.engines - 1 - inner, j = i - 1 - inner;
          const a = j / outerN * Math.PI * 2;
          dx = Math.cos(a) * ring * 1.85; dz = Math.sin(a) * ring * 1.85;
        }
      }
      const flick = 1 + Math.sin(L.t * 38 + i * 1.7) * 0.06;   // per-engine flicker
      const len = fl.len * pulse * flick;
      // dense clusters (Super Heavy) dim each unit so the overlapping additive cones
      // keep their colour instead of stacking up to pure white
      const dense = Math.min(1, 5 / fl.engines);
      u.plume.material.opacity = 0.9 * (0.55 + 0.45 * dense);
      u.core.material.opacity = 0.85 * (0.4 + 0.6 * dense);
      u.plume.position.set(dx, anchorY - len / 2, dz);
      u.plume.scale.set(width, len, width);
      u.plume.material.color.setHex(fl.color);
      const clen = len * 0.6, cw = width * 0.46;
      u.core.position.set(dx, anchorY - clen / 2, dz);
      u.core.scale.set(cw, clen, cw);
      u.core.material.color.setHex(fl.core);
    }
  }

  function launchCamera(dt) {
    const p = current.pivot.position, H = current.height;
    L.shake = Math.max(0, L.shake - dt * 0.7);
    const sh = (L.shake * 0.6 + (launchPhase === "flight" ? 0.05 * L.throttle : 0)) * H * 0.05;
    // while a booster is flying home (or freshly landed, pre-wrap-up), the camera follows IT,
    // holding on the recovered booster until the mission wraps up and cuts to the orbit reveal.
    if (B && launchPhase !== "orbit" && B.camHold <= 0) {
      const bp = B.group.position;
      const bt = new THREE.Vector3(bp.x, bp.y + H * 0.06, bp.z);
      const bg = new THREE.Vector3(bp.x + H * 0.55, bp.y + H * 0.16, bp.z + H * 1.45);
      bg.x += Math.sin(L.t * 57) * sh; bg.y += Math.sin(L.t * 71) * sh;
      camera.up.set(0, 1, 0);
      camera.position.lerp(bg, Math.min(1, dt * 2.4));
      controls.target.lerp(bt, Math.min(1, dt * 3));
      camera.lookAt(controls.target); camera.clearViewOffset();
      return;
    }
    let target, goal, lerp, tLerp;
    if (launchPhase === "countdown") {
      // slow creeping dolly toward the pad while the count runs, broadcast style
      const k = 1 - clamp01(L.cd / 10);                // 0 at T-10 -> 1 at liftoff
      target = new THREE.Vector3(0, H * (0.45 - 0.12 * k), 0);
      goal = new THREE.Vector3(p.x + H * (0.85 - 0.25 * k), p.y + H * (0.16 - 0.06 * k), p.z + H * (1.5 - 0.35 * k));
      camera.up.set(0, 1, 0);
      camera.position.lerp(goal, Math.min(1, dt * 0.8));
      controls.target.lerp(target, Math.min(1, dt * 0.8));
      camera.lookAt(controls.target);
      camera.clearViewOffset();
      return;
    }
    if (launchPhase === "orbit") {
      // reward reveal: aim between the payload (top of the vehicle) and the curved Earth
      // below, and sit back far enough that BOTH fit — so the payload's nose is never clipped.
      const payTop = p.y + H * 0.5;
      const earthTop = (PAD && PAD.earth) ? PAD.earth.position.y + 1500 : 140;
      const midY = (payTop + earthTop) / 2;
      // Aim a touch above the midpoint and sit back farther, so even the tallest vehicle
      // (Starship) keeps its whole nose clear of the top edge while the Earth still fills the
      // lower frame. The old framing clipped Starship's payload tip off the top.
      target = new THREE.Vector3(p.x, midY + H * 0.1, p.z);
      goal = new THREE.Vector3(p.x + H * 0.45, midY + H * 0.42, p.z + H * 3.2);
      lerp = dt * 1.4; tLerp = dt * 1.4;              // slow, cinematic ease
      camera.up.set(0, 1, 0);
    } else {
      // side-tracking chase camera with two cinematic blends: a dramatic low angle for
      // the first seconds off the pad, and a downrange lean + gentle bank as the
      // gravity turn tips the rocket over.
      const lean = smooth(clamp01((90 - L.pitch) / 80));    // 0 upright -> 1 pitched over
      const lift = smooth(clamp01(L.t / 6));                // low-angle liftoff eases out by t=6
      target = new THREE.Vector3(
        p.x + H * 0.28 * lean,
        p.y + THREE.MathUtils.lerp(H * 0.22, -H * 0.04, lift) + H * 0.06 * lean,
        p.z);
      goal = new THREE.Vector3(
        p.x + H * (0.6 - 0.22 * lean),
        p.y + THREE.MathUtils.lerp(-H * 0.34, H * 0.1, lift) + H * 0.16 * lean,
        p.z + H * (1.72 + 0.55 * lean));
      lerp = dt * 3; tLerp = dt * 4;
      const bank = 0.1 * lean;                              // subtle roll into the turn
      camera.up.set(Math.sin(-bank), Math.cos(bank), 0);
    }
    // brief punch-IN at staging so the separation fills the frame, broadcast style
    if (L.stageCam > 0) {
      L.stageCam = Math.max(0, L.stageCam - dt);
      const e = Math.sin(Math.PI * (1 - L.stageCam / 0.8));   // 0 -> 1 -> 0 over the nudge
      const off = goal.clone().sub(target).multiplyScalar(1 - 0.12 * e);
      goal.copy(target).add(off);
    }
    goal.x += Math.sin(L.t * 57) * sh; goal.y += Math.sin(L.t * 71) * sh;
    camera.position.lerp(goal, Math.min(1, lerp));
    controls.target.lerp(target, Math.min(1, tLerp));
    camera.lookAt(controls.target);
    camera.clearViewOffset();
  }

  function updateTelemetry() {
    const spd = Math.sqrt(L.vy * L.vy + L.vx * L.vx) * 1000;
    el("tAlt").textContent = L.alt.toFixed(1) + " km";
    el("tSpd").textContent = Math.round(spd).toLocaleString() + " m/s";
    el("tVy").textContent = Math.round(L.vy * 1000).toLocaleString() + " m/s";
    el("tVx").textContent = Math.round(L.vx * 1000).toLocaleString() + " m/s";
    el("tG").textContent = L.gforce.toFixed(1) + " g";
    el("tStage").textContent = ["I", "II", "III", "IV"][L.stageIndex] || "III";
    el("fuelFill").style.width = Math.round((L.fuel[L.stageIndex] || 0) * 100) + "%";
    el("thrVal").textContent = Math.round(L.throttle * 100) + "%";
    el("throttle").value = Math.round(L.throttle * 100);
    // manual staging + steering only matter in HARD
    const sb = el("stageBtn");
    if (sb) {
      const canStage = L.stageIndex < activeRocket.launchStages.length - 1;
      sb.style.display = difficulty === "hard" ? "" : "none";
      sb.classList.toggle("ready", difficulty === "hard" && canStage && (L.fuel[L.stageIndex] || 0) < 0.16);
    }
    const sh = el("steerHint"); if (sh) sh.style.display = difficulty === "hard" ? "" : "none";
  }

  let resetting = false;
  function resetLaunch() {
    if (resetting || launchPhase === "idle") return;
    resetting = true;
    hideResult(); stopRumble();
    el("countdown").classList.remove("show");
    // fade to black, swap back to the dark explorer, fade in
    fadeThenTo(() => {
      launchPhase = "idle";
      el("cockpit").classList.remove("show");
      el("flash").style.opacity = "0";
      exhaust = null;
      if (stageFx) stageFx.pts.visible = false;
      // kill any particles still mid-life, or they freeze at their last frame and haunt
      // the explorer as grey smudges (their update loops only run during a launch)
      if (smoke) { smoke.parts.forEach(p => { p.life = 1; p.max = 1; }); smoke.pts.visible = false; }
      if (vents) { vents.parts.forEach(p => { p.life = 1; p.max = 1; }); vents.pts.visible = false; }
      clearTrail();
      clearDebris(); clearBooster();
      exitPad();
      EXPLORE_UI.forEach(id => { const e = el(id); if (e) e.style.display = ""; });
      showRocket(activeRocket);
    }, () => { resetting = false; });
  }

  /* ============================================================
     GO/NO-GO POLL  (gates the LAUNCH button)
     Real launches only fly when every station calls GO. First press
     of LAUNCH runs the poll; the button arms once all stations are
     green, and the next press lifts off. Resets per rocket + abort.
     ============================================================ */
  const CHECKS = [
    { name: "Weather",           detail: "Skies clear, no lightning near the pad" },
    { name: "Upper level winds", detail: "Wind shear aloft inside limits" },
    { name: "Range clear",       detail: "Airspace and ocean downrange are empty" },
    { name: "Vehicle systems",   detail: "Guidance, power and comms all green" },
    { name: "Propellant load",   detail: "Tanks full and pressures steady" },
    { name: "Flight computer",   detail: "Auto sequence ready to take over" }
  ];
  // the seventh station depends on what happens to the booster afterwards
  function recoveryCheck(r) {
    if (r.recover && r.recover.mode === "catch")
      return { name: "Catch tower", detail: "Chopstick arms open and standing by" };
    if (r.recover && r.recover.mode === "legs")
      return { name: "Landing zone", detail: "Booster landing pad clear downrange" };
    return { name: "Escape tower", detail: "Crew escape rocket armed and watching" };
  }
  let launchReady = false, clTimer = null;
  function resetChecklist() {
    launchReady = false;
    if (clTimer) { clearTimeout(clTimer); clTimer = null; }
    const cl = el("checklist");
    if (cl) cl.classList.remove("show", "armed");
    const sub = document.querySelector("#launchBtn .lb-sub");
    if (sub && activeRocket) sub.textContent = activeRocket.name + " · Ready to poll";
  }
  function runChecklist() {
    if (clTimer || launchReady || launchPhase !== "idle") return;
    const rows = CHECKS.concat([recoveryCheck(activeRocket)]);
    el("clRows").innerHTML = rows.map(c =>
      '<div class="cl-row"><span class="cl-name">' + c.name +
      '</span><span class="cl-status">STBY</span></div>').join("");
    el("clFoot").textContent = "Every station must call GO";
    const cl = el("checklist");
    cl.classList.remove("armed");
    cl.classList.add("show");
    el("panel").classList.add("swap");           // slide the info panel out of the way
    const sub = document.querySelector("#launchBtn .lb-sub");
    if (sub) sub.textContent = "Polling all stations";
    const els2 = Array.from(document.querySelectorAll("#clRows .cl-row"));
    let i = 0;
    function step() {
      if (i > 0) {
        const prev = els2[i - 1];
        prev.classList.remove("polling"); prev.classList.add("go");
        prev.querySelector(".cl-status").textContent = "GO";
      }
      if (i >= els2.length) {
        launchReady = true;
        cl.classList.add("armed");
        el("clFoot").textContent = "All stations report GO";
        if (sub) sub.textContent = activeRocket.name + " · All systems go";
        // every station is green: the auto sequence takes it from here, no second press
        clTimer = setTimeout(() => {
          clTimer = null;
          if (launchReady && launchPhase === "idle") startLaunch();
        }, 1100);
        return;
      }
      const row = els2[i];
      row.classList.add("polling");
      row.querySelector(".cl-status").textContent = "POLL";
      el("clFoot").textContent = rows[i].detail;
      i++;
      clTimer = setTimeout(step, 430);
    }
    step();
  }

  // going back to exploring (taking the rocket apart) stands the poll down
  function standDown() {
    if (!launchReady && !clTimer) return;
    resetChecklist();
    el("panel").classList.remove("swap");
  }

  el("launchBtn").addEventListener("click", () => { launchReady ? startLaunch() : runChecklist(); });
  el("abortBtn").addEventListener("click", resetLaunch);
  { const ca = el("cdAbort"); if (ca) ca.addEventListener("click", resetLaunch); }
  { const cs = el("cdSkip"); if (cs) cs.addEventListener("click", () => { if (launchPhase === "countdown") ignite(); }); }
  { const rr = el("resultReset"); if (rr) rr.addEventListener("click", resetLaunch); }
  // reread the paced mission commentary after the flight
  { const rl = el("resultLog"); if (rl) rl.addEventListener("click", () => {
      el("logSub").textContent = activeRocket.name + " · every call from the flight, in order";
      el("logList").innerHTML = (L.log || []).map(e =>
        "<li><b>" + e.title + (e.alt > 0.5 ? " · " + Math.round(e.alt) + " km" : "") + "</b><br>" + e.body + "</li>").join("");
      el("logOverlay").classList.add("show");
    }); }
  { const lc = el("logClose"); if (lc) lc.addEventListener("click", () => el("logOverlay").classList.remove("show")); }
  { const sb = el("stageBtn"); if (sb) sb.addEventListener("click", () => { if (launchPhase === "flight" && difficulty === "hard") advanceStage(); }); }

  // difficulty toggle (set before launch)
  function setDifficulty(d) {
    difficulty = d;
    document.body.classList.toggle("hard", d === "hard");   // lets mobile CSS hide the display-only throttle in EASY
    const b = el("diffBtn");
    if (b) { b.innerHTML = "Mode · <b>" + (d === "easy" ? "Easy" : "Hard") + "</b>"; b.classList.toggle("hard", d === "hard"); }
  }
  { const db = el("diffBtn"); if (db) db.addEventListener("click", () => setDifficulty(difficulty === "easy" ? "hard" : "easy")); }
  setDifficulty("easy");

  // graphics quality toggle (topbar): scales the launch cinematics to the hardware
  function setQuality(q) {
    QUALITY = q;
    try { localStorage.setItem("apogee_fx", q); } catch (e) {}
    const b = el("fxBtn");
    if (b) b.innerHTML = "FX · <b>" + (q === "high" ? "High" : "Low") + "</b>";
  }
  { const fb = el("fxBtn"); if (fb) fb.addEventListener("click", () => setQuality(QUALITY === "high" ? "low" : "high")); }
  setQuality(QUALITY);

  // manual throttle slider (HARD)
  { const th = el("throttle"); if (th) th.addEventListener("input", () => { if (difficulty === "hard" && launchPhase === "flight") L.throttle = th.value / 100; }); }

  // Esc aborts at any point in a launch (countdown, flight, orbit or failed).
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && launchPhase !== "idle") { resetLaunch(); return; }
    // skip the countdown straight to ignition (great for retrying HARD)
    if (launchPhase === "countdown" && (e.key === "Enter" || e.key === " " || e.code === "Space")) { ignite(); e.preventDefault(); return; }
    if (launchPhase === "idle") return;
    const k = (e.key || "").toLowerCase();
    if (k === "w" || k === "a" || k === "s" || k === "d") keys[k] = true;
    if ((k === " " || e.code === "Space") && launchPhase === "flight" && difficulty === "hard") { advanceStage(); e.preventDefault(); }
  });
  window.addEventListener("keyup", (e) => {
    const k = (e.key || "").toLowerCase();
    if (k === "w" || k === "a" || k === "s" || k === "d") keys[k] = false;
  });

  // X-ray cutaway toggle
  function setXray(v) {
    xray = v;
    const b = el("xrayBtn");
    if (b) b.classList.toggle("on", xray);
    if (xray) sfx("click");
  }
  { const xb = el("xrayBtn"); if (xb) xb.addEventListener("click", () => setXray(!xray)); }

  /* ============================================================
     POSTCARD  —  capture the current 3D frame as a shareable image
     ------------------------------------------------------------
     The compositor (buildPostcard) is deliberately reusable: the
     upcoming launch scorecard will hand it the same source frame
     plus a different overlay. Capture works WITHOUT the renderer's
     preserveDrawingBuffer (which costs frame-rate on some GPUs) by
     rendering and reading the pixels in one synchronous tick.
     ============================================================ */
  const hexCss = (n) => "#" + (n >>> 0).toString(16).padStart(6, "0").slice(-6);
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  // draw the captured WebGL frame onto a 2D canvas with a restrained overlay
  function buildPostcard(src, rocket) {
    const W = src.width, H = src.height;
    const out = document.createElement("canvas");
    out.width = W; out.height = H;
    const ctx = out.getContext("2d");
    ctx.drawImage(src, 0, 0, W, H);           // the rocket, exactly as framed on screen

    // ---- cinematic scrims + vignette so the overlay reads like a poster ----
    const topH = H * 0.24;
    const gt = ctx.createLinearGradient(0, 0, 0, topH);
    gt.addColorStop(0, "rgba(5,6,12,0.5)"); gt.addColorStop(1, "rgba(5,6,12,0)");
    ctx.fillStyle = gt; ctx.fillRect(0, 0, W, topH);

    const scrimH = H * 0.54;
    const g = ctx.createLinearGradient(0, H - scrimH, 0, H);
    g.addColorStop(0, "rgba(5,6,12,0)");
    g.addColorStop(0.55, "rgba(5,6,12,0.5)");
    g.addColorStop(1, "rgba(5,6,12,0.88)");
    ctx.fillStyle = g; ctx.fillRect(0, H - scrimH, W, scrimH);

    const vg = ctx.createRadialGradient(W / 2, H * 0.46, Math.min(W, H) * 0.33,
                                        W / 2, H * 0.5, Math.max(W, H) * 0.72);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.44)");
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

    const pad = Math.round(H * 0.058);
    const accent = rocket.accent != null ? hexCss(rocket.accent) : "#6f9bd0";
    const spaced = (px) => { if ("letterSpacing" in ctx) ctx.letterSpacing = px + "px"; };
    const nospace = () => { if ("letterSpacing" in ctx) ctx.letterSpacing = "0px"; };

    // thin inset frame + blueprint corner ticks for a technical, printed feel
    const inset = Math.round(H * 0.03);
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = Math.max(1, Math.round(H * 0.0013));
    ctx.strokeRect(inset, inset, W - inset * 2, H - inset * 2);
    const tick = Math.round(H * 0.022);
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(1, Math.round(H * 0.0016));
    [[inset, inset, 1, 1], [W - inset, inset, -1, 1], [inset, H - inset, 1, -1], [W - inset, H - inset, -1, -1]]
      .forEach(([cx, cy, sx, sy]) => {
        ctx.beginPath();
        ctx.moveTo(cx + sx * tick, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + sy * tick);
        ctx.stroke();
      });

    // ---- top-left wordmark:  APOGEE ·  (accent dot flourish) ----
    const wmF = Math.round(H * 0.0175);
    const wmY = inset + Math.round(H * 0.03);
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    spaced(Math.round(wmF * 0.22));
    ctx.font = '700 ' + wmF + 'px "Bricolage Grotesque Variable", sans-serif';
    ctx.fillStyle = "rgba(228,234,244,0.9)";
    ctx.fillText("APOGEE", pad, wmY);
    const rw = ctx.measureText("APOGEE").width;
    ctx.fillStyle = accent;
    ctx.fillText("·", pad + rw + Math.round(wmF * 0.35), wmY);
    nospace();

    // ---- bottom-left info block ----
    const eyebrowF = Math.round(H * 0.016);
    const nameF = Math.round(H * 0.058);
    const tagF  = Math.round(H * 0.0205);
    const labF  = Math.round(H * 0.013);
    const valF  = Math.round(H * 0.027);

    // flag emoji is dropped on purpose: Windows renders it as bare "US" letters.
    const meta = [rocket.org, rocket.years, rocket.status].filter(Boolean).join("  ·  ").toUpperCase();
    const tagText = rocket.claim || rocket.sub || "";
    const stats = [
      ["HEIGHT", rocket.height != null ? rocket.height + " m" : null],
      ["THRUST", rocket.thrust || null],
      ["PAYLOAD TO LEO", rocket.payloadLEO || null]
    ].filter(s => s[1]);

    // wrap the tagline to at most two lines within the left ~46% of the frame
    const tagFont = 'italic 500 ' + tagF + 'px "Hanken Grotesk Variable", sans-serif';
    function wrapText(text, font, maxW, maxLines) {
      ctx.font = font;
      const words = text.split(/\s+/), lines = []; let cur = "";
      for (const w of words) {
        const test = cur ? cur + " " + w : w;
        if (ctx.measureText(test).width <= maxW || !cur) cur = test;
        else { lines.push(cur); cur = w; if (lines.length === maxLines) break; }
      }
      if (lines.length < maxLines && cur) lines.push(cur);
      return lines.slice(0, maxLines);
    }
    const tagLines = tagText ? wrapText(tagText, tagFont, W * 0.46, 2) : [];

    // measure the whole block so we can bottom-anchor it above the pad
    const gEye = Math.round(eyebrowF * 0.8);
    const gName = Math.round(nameF * 0.24);
    const ruleH = Math.max(2, Math.round(nameF * 0.055));
    const gRule = Math.round(nameF * 0.32);
    const tagLH = Math.round(tagF * 1.4);
    const gTag = tagLines.length ? Math.round(tagF * 1.0) : 0;
    const gLab = Math.round(labF * 0.42);
    const blockH = eyebrowF + gEye + nameF + gName + ruleH + gRule
                 + tagLines.length * tagLH + gTag + labF + gLab + valF;
    let y = H - pad - blockH;

    ctx.textAlign = "left"; ctx.textBaseline = "top";

    // eyebrow: org / era / status in accent-tinted spaced caps
    spaced(Math.round(eyebrowF * 0.16));
    ctx.font = '700 ' + eyebrowF + 'px "Bricolage Grotesque Variable", sans-serif';
    ctx.fillStyle = accent;
    ctx.fillText(meta, pad, y);
    nospace();
    y += eyebrowF + gEye;

    // rocket name — flat, no glow (blueprint feel)
    const nameFont = '700 ' + nameF + 'px "Bricolage Grotesque Variable", sans-serif';
    ctx.font = nameFont;
    ctx.fillStyle = "#f6f8fc"; ctx.fillText(rocket.name, pad, y);
    const nameW = ctx.measureText(rocket.name).width;
    y += nameF + gName;

    // accent rule tinted to the rocket's own colour
    ctx.fillStyle = accent;
    ctx.fillRect(pad, y, Math.round(Math.min(nameW, W * 0.4) * 0.55), ruleH);
    y += ruleH + gRule;

    // tagline (the rocket's claim) — editorial italic
    if (tagLines.length) {
      ctx.font = tagFont; ctx.fillStyle = "rgba(206,214,228,0.92)";
      for (const line of tagLines) { ctx.fillText(line, pad, y); y += tagLH; }
      y += gTag;
    }

    // headline stats as a spec row with faint dividers between columns
    let x = pad;
    const colGap = Math.round(W * 0.042);
    const statTop = y, statH = labF + gLab + valF;
    let firstStat = true;
    for (const [label, value] of stats) {
      if (!firstStat) {
        ctx.fillStyle = "rgba(255,255,255,0.15)";
        ctx.fillRect(Math.round(x - colGap * 0.5), statTop + Math.round(statH * 0.04),
                     Math.max(1, Math.round(H * 0.001)), Math.round(statH * 0.92));
      }
      firstStat = false;
      spaced(Math.round(labF * 0.1));
      ctx.font = '600 ' + labF + 'px "Hanken Grotesk Variable", sans-serif';
      ctx.fillStyle = "#8f9ab2";
      ctx.fillText(label, x, statTop);
      const wl = ctx.measureText(label).width;
      nospace();
      ctx.font = '700 ' + valF + 'px "IBM Plex Mono", monospace';
      ctx.fillStyle = "#eef2f8";
      ctx.fillText(value, x, statTop + labF + gLab);
      x += Math.max(ctx.measureText(value).width, wl) + colGap;
    }

    // faint builder credit, bottom-right
    ctx.textAlign = "right"; ctx.textBaseline = "alphabetic";
    spaced(Math.round(H * 0.015 * 0.14));
    ctx.font = '600 ' + Math.round(H * 0.015) + 'px "Bricolage Grotesque Variable", sans-serif';
    ctx.fillStyle = "rgba(210,220,234,0.5)";
    ctx.fillText("BUILT BY HAN THU HEIN", W - pad, H - pad);
    nospace();

    return out;
  }

  function takePostcard() {
    if (!activeRocket) return;
    sfx("click");
    render();                                 // freshly draw the current frame...
    const card = buildPostcard(renderer.domElement, activeRocket);  // ...and read it this same tick
    const finish = (blob) => {
      if (!blob) { toast("Could not make the postcard, try again."); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = slug(activeRocket.name) + "-apogee.png";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      toast("Postcard saved");
    };
    if (card.toBlob) card.toBlob(finish, "image/png");
    else { const d = card.toDataURL("image/png"); fetch(d).then(r => r.blob()).then(finish); }
  }
  { const sh = el("shotBtn"); if (sh) sh.addEventListener("click", takePostcard); }
  { const shf = el("shotBtnFlight"); if (shf) shf.addEventListener("click", takePostcard); }

  /* ============================================================
     SUBTLE WEB AUDIO  (ambient hum + soft hover/click)
     Lazily created on the first user gesture (autoplay policy).
     Phase E extends this with countdown/ignition/staging sound.
     ============================================================ */
  let muted = false, actx = null, masterGain = null, ambientOn = false;
  function initAudio() {
    if (actx) { if (actx.state === "suspended") actx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    masterGain = actx.createGain();
    masterGain.gain.value = muted ? 0 : 1;
    masterGain.connect(actx.destination);
    startAmbient();
  }
  function startAmbient() {
    if (!actx || ambientOn) return;
    ambientOn = true;
    const bus = actx.createGain(); bus.gain.value = 0.05; bus.connect(masterGain);
    // a soft breathing pad from a few detuned low sines
    [[55, 0.7], [55.5, 0.6], [82.5, 0.35]].forEach(([f, vol], i) => {
      const o = actx.createOscillator(); o.type = "sine"; o.frequency.value = f;
      const g = actx.createGain(); g.gain.value = vol;
      o.connect(g); g.connect(bus); o.start();
      const lfo = actx.createOscillator(); lfo.frequency.value = 0.05 + i * 0.028;
      const lg = actx.createGain(); lg.gain.value = 0.22;
      lfo.connect(lg); lg.connect(g.gain); lfo.start();
    });
  }
  // short soft blip; kind = "hover" | "click"
  function sfx(kind) {
    if (!actx || muted) return;
    const now = actx.currentTime;
    const o = actx.createOscillator(), g = actx.createGain();
    o.connect(g); g.connect(masterGain);
    if (kind === "hover") {
      o.type = "sine"; o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.04, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
      o.start(now); o.stop(now + 0.13);
    } else {
      o.type = "triangle"; o.frequency.setValueAtTime(520, now);
      o.frequency.exponentialRampToValueAtTime(760, now + 0.06);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.08, now + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
      o.start(now); o.stop(now + 0.17);
    }
  }

  /* ---- launch audio (Phase E): countdown beeps, ignition rumble, staging ---- */
  let _noise = null;
  function noiseBuffer() {
    if (_noise) return _noise;
    const len = actx.sampleRate * 2;
    const b = actx.createBuffer(1, len, actx.sampleRate);
    const d = b.getChannelData(0);
    let s = 13579;
    for (let i = 0; i < len; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; }
    _noise = b; return b;
  }
  function playBeep(final) {
    if (!actx || muted) return;
    const now = actx.currentTime;
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = "square"; o.frequency.value = final ? 680 : 440;
    o.connect(g); g.connect(masterGain);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(final ? 0.12 : 0.05, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + (final ? 0.5 : 0.12));
    o.start(now); o.stop(now + (final ? 0.55 : 0.14));
  }
  let rumble = null;
  function startRumble() {
    if (!actx || rumble) return;
    const src = actx.createBufferSource(); src.buffer = noiseBuffer(); src.loop = true;
    const lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 170;
    const g = actx.createGain(); g.gain.value = 0.0001;
    src.connect(lp); lp.connect(g); g.connect(masterGain); src.start();
    const o = actx.createOscillator(); o.type = "sine"; o.frequency.value = 40;
    const og = actx.createGain(); og.gain.value = 0.0001;
    o.connect(og); og.connect(masterGain); o.start();
    rumble = { src, lp, g, o, og };
  }
  function setRumble() {
    if (!rumble || !actx) return;
    const air = clamp01(1 - (L.alt - 2) / 60);
    const on = launchPhase === "flight" && L.throttle > 0.02 && (L.fuel[L.stageIndex] || 0) > 0;
    const t = now2();
    rumble.g.gain.setTargetAtTime(on ? 0.16 * L.throttle * (0.35 + 0.65 * air) : 0.0001, t, 0.15);
    rumble.og.gain.setTargetAtTime(on ? 0.09 * L.throttle : 0.0001, t, 0.2);
  }
  function stopRumble() {
    if (!rumble || !actx) return;
    const r = rumble; rumble = null;
    try {
      r.g.gain.setTargetAtTime(0.0001, now2(), 0.1);
      r.og.gain.setTargetAtTime(0.0001, now2(), 0.1);
      setTimeout(() => { try { r.src.stop(); r.o.stop(); } catch (e) {} }, 320);
    } catch (e) {}
  }
  function sfxThump() {
    if (!actx || muted) return;
    const now = actx.currentTime;
    const src = actx.createBufferSource(); src.buffer = noiseBuffer();
    const lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 240;
    const g = actx.createGain(); src.connect(lp); lp.connect(g); g.connect(masterGain);
    g.gain.setValueAtTime(0.26, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
    src.start(now); src.stop(now + 0.5);
  }
  function now2() { return actx ? actx.currentTime : 0; }

  function setMuted(v) {
    muted = v;
    if (masterGain && actx) masterGain.gain.setTargetAtTime(muted ? 0 : 1, actx.currentTime, 0.02);
    const mb = el("muteBtn");
    if (mb) { mb.textContent = muted ? "Sound off" : "Sound on"; mb.style.opacity = muted ? "0.55" : ""; }
    const sb = el("soundBtn");
    if (sb) { sb.textContent = muted ? "♪ Muted" : "♪ Sound"; sb.style.opacity = muted ? "0.6" : ""; }
  }
  // Sound feature removed at Han's request. The audio helpers above are left in place but
  // dormant: nothing ever calls initAudio(), so the audio context is never created and every
  // sound function early-returns on the null `actx`. The Sound / mute buttons were removed too.

  /* ============================================================
     GENTLE FIRST-VISIT INTRO (coach marks, once per session)
     ============================================================ */
  const INTRO_STEPS = COARSE ? [
    ["Take it apart", "Tap the Take it apart button to lay the rocket out flat into a blueprint, then tap Rebuild it to stand it back up."],
    ["Tap a part to learn", "Tap any stage or piece to zoom in and read what it does. Hit X-ray up top to see every internal at once."],
    ["Then fly it", "When you are ready, press LAUNCH to ride Saturn V off the pad all the way to orbit."]
  ] : [
    ["Scroll to take it apart", "Scroll anywhere to lay the rocket out flat into a blueprint, then scroll back to stand it up."],
    ["Click a part to learn", "Click any stage or piece to zoom in and read what it does. Hit X-ray up top to see every internal at once."],
    ["Then fly it", "When you are ready, press LAUNCH to ride Saturn V off the pad all the way to orbit."]
  ];
  let introIdx = 0;
  function renderIntro() {
    el("introStep").textContent = "Getting started · " + (introIdx + 1) + " of " + INTRO_STEPS.length;
    el("introTitle").textContent = INTRO_STEPS[introIdx][0];
    el("introBody").textContent = INTRO_STEPS[introIdx][1];
    el("introDots").innerHTML = INTRO_STEPS.map((_, i) =>
      '<i class="' + (i === introIdx ? "on" : "") + '"></i>').join("");
    el("introNext").textContent = (introIdx === INTRO_STEPS.length - 1) ? "Explore" : "Next";
  }
  function introOutsideTap(e) {
    if (!e.target.closest(".intro-card")) endIntro();
  }
  function endIntro() {
    el("intro").classList.remove("show");
    document.removeEventListener("pointerdown", introOutsideTap, true);
    try { localStorage.setItem("rs_intro_seen", "1"); } catch (e) {}
  }
  function showIntro() {
    let seen = false;
    try { seen = localStorage.getItem("rs_intro_seen") === "1"; } catch (e) {}
    if (seen) return;
    introIdx = 0; renderIntro();
    el("intro").classList.add("show");
    document.addEventListener("pointerdown", introOutsideTap, true);
  }
  el("introNext").addEventListener("click", () => {
    sfx("click");
    if (introIdx < INTRO_STEPS.length - 1) { introIdx++; renderIntro(); }
    else endIntro();
  });
  el("introSkip").addEventListener("click", endIntro);

  // go
  buildDock();
  showRocket(ROCKETS.find(r => r.key === ACTIVE_KEYS[0]));
  animate();

  /* warm the postcard fonts so canvas text renders in them (not a fallback) */
  if (document.fonts && document.fonts.load) {
    document.fonts.load('700 40px "Bricolage Grotesque Variable"');
    document.fonts.load('500 20px "Hanken Grotesk Variable"');
    document.fonts.load('700 20px "IBM Plex Mono"');
  }

  /* ---- minimal boot loader: fill the bar smoothly, then dismiss ---- */
  (function bootSequence() {
    const loader = el("loader");
    if (!loader) return;
    const fill = el("bootFill"), status = el("bootStatus");
    let p = 0;
    function step() {
      p = Math.min(100, p + (8 + Math.random() * 16));
      if (fill) fill.style.width = Math.round(p) + "%";
      if (p < 100) {
        setTimeout(step, 90 + Math.random() * 90);
      } else {
        if (status) status.textContent = "Ready";
        setTimeout(() => { loader.classList.add("done"); showIntro(); }, 420);
      }
    }
    setTimeout(step, 220);
  })();
})();
