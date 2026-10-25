/* ============================================================
   rockets.js  —  the data behind the showcase
   ------------------------------------------------------------
   Each rocket is described as a list of PARTS. Every part has:
     - id / label        a name we show on hover
     - purpose           what it does, why it is there, and how
                         it helps the mission (shown in the tooltip)
     - a shape recipe    numbers the 3D engine uses to build it

   Nothing here is a downloaded model. The engine in main.js turns
   these numbers into geometry, so every part is copyright free and
   already labeled, which is what makes the hover tooltips possible.

   Shape kinds:
     stage   a straight or tapered body section (stacks upward)
     cone    a tapered section (stacks upward)
     nose    a pointed nose cone (stacks upward)
     boosters strap-on rockets placed around the base
     fins    stabiliser fins at the base
     nozzles engine bells under the base
     spire   a thin rod at the very top (escape tower)
     orbiter the Space Shuttle winged vehicle (special case)
   All sizes are in metres.
   ============================================================ */

const WHITE = 0xeef0f4, STEEL = 0xb8bcc0, ORANGE = 0xb65c29,
      DARK = 0x22252e, GREY = 0xb9bfca, BLACK = 0x14161c, SILVER = 0xd8dde6;

const ROCKETS = [
  /* ---------------------------------------------------------- */
  {
    key: "saturn-v",
    name: "Saturn V",
    org: "NASA", flag: "🇺🇸", years: "1967 to 1973", status: "Retired",
    height: 111, diameter: 10.1, mass: "2,970 t", thrust: "34.5 MN",
    payloadLEO: "140 t", accent: 0xffcf8a,
    sub: "The Moon rocket. The giant that launched the entire Apollo program.",
    claim: "The only rocket ever to carry humans to the surface of the Moon.",
    sizeVs: "Taller than the Statue of Liberty, torch and all.",
    engines: "5 x F-1", flights: "13 launches",
    facts: [
      "Every crewed Moon landing in history launched on a Saturn V.",
      "At liftoff it swallowed about 13 tonnes of propellant every second.",
      "Its F-1 is still the most powerful single chamber rocket engine ever flown.",
      "It launched 13 times and never lost a crew."
    ],
    missions: [
      ["Apollo 11", "Carried the first humans to land on the Moon in July 1969."],
      ["Apollo 8 to 17", "Launched every crewed Apollo mission, including all six Moon landings."],
      ["Skylab 1", "Launched America's first space station in a single throw in 1973."]
    ],
    build: [
      "Saturn V stacked three stages so it could shed dead weight as it climbed. Each stage burned, then dropped away, leaving a lighter vehicle to keep accelerating.",
      "The giant first stage ran on kerosene and liquid oxygen. The upper two stages switched to liquid hydrogen, a lighter fuel that gives more push per kilo once the rocket is already moving fast.",
      "Everything was built oversized on purpose. Sending three astronauts and a lander all the way to the Moon and back needed a truly enormous head start."
    ],
    // Launch simulator sequence. Each entry is a burning stage the player flies, in
    // order. `jettison` lists the stage-ids whose parts drop away when this stage is
    // spent. thrust/burn are tuned (not real units) for a fun, winnable ~1 min ride.
    // `flame` drives the cinematic per-stage exhaust: color/core tint, engine count
    // (clustered vs single), plume length (len) and width (rExit), and cluster spread.
    launchStages: [
      { key:"s-ic",  name:"Stage I  ·  S-IC",  thrust:1.0,  burn:12, jettison:["s-ic"],
        story:"Five F-1 engines drink thirteen tonnes of fuel a second to wrestle three thousand tonnes off the pad.",
        flame:{ color:0xff5a1e, core:0xffd27a, engines:5, rExit:2.8, len:20, spread:1.5 } },
      { key:"s-ii",  name:"Stage II  ·  S-II",  thrust:0.62, burn:16, jettison:["s-ii","interstage"],
        story:"Five hydrogen burning J-2s take over above the thick air, trading raw muscle for efficiency.",
        flame:{ color:0x7ab8ff, core:0xffffff, engines:5, rExit:2.1, len:15, spread:1.1 } },
      { key:"s-ivb", name:"Stage III  ·  S-IVB", thrust:0.34, burn:22, jettison:[],
        story:"One efficient J-2 eases the stack into orbit. On Apollo it later relit this same engine to push for the Moon.",
        flame:{ color:0xaad6ff, core:0xffffff, engines:1, rExit:1.8, len:16, spread:0 } }
    ],
    // Each part has a `stage` (which major segment it belongs to) so the engine
    // can explode by stage and reveal a stage's internals on deep zoom.
    // kind stage/cone/nose = an outer shell; kind internal = a hidden sub-component
    // (tank/engine) revealed when you focus that stage.
    parts: [
      // ---- outer shells, bottom to top (the historical components) ----
      { id:"s-ic", stage:"s-ic", label:"First Stage (S-IC)", kind:"stage", rb:5, rt:5, h:42, color:WHITE,
        purpose:"The first stage does one job: beat gravity off the pad. A rocket flies by throwing mass downward very fast, so the reaction pushes it up. This stage burns thirteen tonnes of propellant every second for about two and a half minutes, then drops away once its work is done. Click it to look inside." },
      { id:"s-ii", stage:"s-ii", label:"Second Stage (S-II)", kind:"stage", rb:5, rt:5, h:24.8, color:WHITE,
        purpose:"Once the air is thin, brute force matters less than efficiency. The second stage switches to hydrogen fuel, which squeezes more speed out of every kilo burned, and carries the rocket most of the way to orbital velocity. Click it to see the tanks and engines inside." },
      { id:"interstage", stage:"interstage", label:"S-II / S-IVB Interstage", kind:"cone", rb:5, rt:3.3, h:5, color:0xdfe2e8,
        purpose:"The metal skirt that links the second and third stages and takes the crushing loads of flight. It is a light shell wrapped around the gap, cast off the instant the stages part so not a gram of it is carried any higher than it has to be." },
      { id:"s-ivb", stage:"s-ivb", label:"Third Stage (S-IVB)", kind:"stage", rb:3.3, rt:3.3, h:13.9, color:WHITE,
        purpose:"The third stage fires twice. The first burn finishes the job of reaching orbit. Then it coasts, and later relights to add the final push that flings the spacecraft out of Earth orbit and toward the Moon. Click it to look inside." },
      { id:"iu", stage:"iu", label:"Instrument Unit", kind:"stage", rb:3.3, rt:3.3, h:2.6, color:0x1c1c1c, metal:0.2, rough:0.6,
        purpose:"The guidance brain. This ring of gyroscopes and computers always knows which way the rocket points and how fast it moves, then tells the engines how to angle their thrust to steer. Without it the rocket would tumble within seconds." },
      { id:"sla", stage:"sla", label:"Spacecraft-LM Adapter (SLA)", kind:"cone", rb:3.3, rt:2, h:8.5, color:WHITE,
        purpose:"A tapered shroud that both carries structural loads and hides the folded lunar lander inside. Its four panels swing open in space so the crew can turn around, dock, and pull the lander out. Click it to reveal the Lunar Module." },
      { id:"sm", stage:"sm", label:"Service Module (CSM)", kind:"stage", rb:2, rt:2, h:7, color:SILVER,
        purpose:"The utility trailer of the spacecraft. It holds the propellant, oxygen, water, power and the big engine that slows the ship into lunar orbit and later pushes it home. It is cast off just before the capsule reenters." },
      { id:"cm", stage:"cm", label:"Command Module (CSM)", kind:"cone", rb:2, rt:0.9, h:3.5, color:SILVER,
        purpose:"The only part that comes home. Its cone shape and blunt heat shield turn the searing energy of a 40,000 km/h reentry into a survivable ride for the three astronauts inside." },
      { id:"les", stage:"les", label:"Launch Escape System (LES)", kind:"nose", escape:true, rb:0.9, h:8, color:0xd23b3b,
        purpose:"A solid rocket motor on a lattice tower above the capsule. Its four canted nozzles fire sideways-down, so if a launch went wrong it could yank the crew cabin up and clear of the failing rocket in a heartbeat, faster than any ejection seat, then let it parachute down. It is jettisoned once the rocket is safely flying." },

      // ---- first stage surface, engines and structure (always visible) ----
      { id:"eng-f1", stage:"s-ic", label:"F-1 Engines (x5)", kind:"nozzles", count:5, r:1.4, h:4, spread:2.6, color:0x9a6a38, metal:0.8, rough:0.35,
        purpose:"Five F-1 engines, still the most powerful single chamber rocket engine ever flown. Each burns kerosene and liquid oxygen in a chamber, then the flared bell speeds the hot gas up as it expands, which is where the thrust comes from. The four outer engines swivel a few degrees to steer the whole rocket." },
      { id:"thrust-ic", stage:"s-ic", label:"Thrust Structure", kind:"thrust", color:0x3a3d45,
        purpose:"The strong frame at the base that the engines bolt onto. It has to take the entire push of all five engines, about 34 meganewtons, and spread that force evenly into the tank walls above without buckling." },
      { id:"fins-ic", stage:"s-ic", label:"Stabiliser Fins (x4)", kind:"fins", count:4, w:3.2, h:6, t:0.4, color:DARK,
        purpose:"Fins work like the feathers on an arrow. By adding drag at the very back they keep the centre of pressure behind the centre of mass, so the rocket naturally weathervanes into the airflow instead of tumbling." },
      { id:"roll", stage:"s-ic", label:"Black Roll Pattern", kind:"rollpattern", color:BLACK,
        purpose:"Not decoration. Ground tracking cameras locked onto this high contrast pattern to measure exactly how the rocket rolled and pitched in the first seconds, when engineers most needed to see it behaving." },
      { id:"flag", stage:"s-ic", label:"United States Markings", kind:"flag",
        purpose:"The flag and the words United States, placed high on the first stage where launch cameras and the crowds along the coast could all read them." },

      // ---- internal sub-components, revealed on deep zoom into a stage ----
      // colour code: LOX/oxidiser = blue, kerosene fuel = amber, hydrogen = teal,
      // engine bells = bronze, structure/bulkheads = steel, pressurant = brass.
      { id:"sic-lox", stage:"s-ic", label:"LOX Tank (S-IC)", kind:"internal", shape:"cyl", r:4.5, h:13, yFrac:0.7, color:0x3f92d2, metal:0.2, rough:0.45,
        purpose:"Liquid oxygen chilled below minus 180 degrees. Fuel cannot burn in space where there is no air, so a rocket must carry its own oxygen. This upper tank feeds it down to the engines. The rings around it are stringers that stiffen the thin walls." },
      { id:"sic-he", stage:"s-ic", label:"Helium Bottles (x4)", kind:"internal", shape:"sphere", r:0.55, yFrac:0.66, color:0xd9c15e, metal:0.7, rough:0.35,
        purpose:"Four big helium bottles sunk right inside the cold oxygen tank. The chill lets them hold far more gas, which is bled out as the tanks drain to keep them firm and pushing propellant to the engines." },
      { id:"sic-fuel", stage:"s-ic", label:"RP-1 Fuel Tank (S-IC)", kind:"internal", shape:"cyl", r:4.5, h:12, yFrac:0.24, color:0xd6883a, metal:0.2, rough:0.5,
        purpose:"Highly refined kerosene, stored at normal temperature so it is easy to handle. The engines pump fuel from here and oxygen from the tank above, mix them, and burn them. About two thirds of the whole rocket's launch weight is the propellant in these two tanks." },
      { id:"sii-lox", stage:"s-ii", label:"LOX Tank (S-II)", kind:"internal", shape:"cyl", r:4.5, h:5, yFrac:0.783, caps:"top", color:0x3f92d2, metal:0.2, rough:0.45,
        purpose:"The oxidiser for the second stage, sitting directly on top of the hydrogen tank. Stacking them and sharing one wall is the clever weight trick you can see just below." },
      { id:"sii-bulkhead", stage:"s-ii", label:"Common Bulkhead", kind:"internal", shape:"disc", r:4.5, yFrac:0.682, color:0xc4ccd8, metal:0.85, rough:0.3,
        purpose:"A single shared wall between the freezing hydrogen and oxygen tanks. Using one insulated dome instead of two separate tank ends saved several tonnes of structure, room that could be filled with propellant instead." },
      { id:"sii-lh2", stage:"s-ii", label:"Liquid Hydrogen Tank (S-II)", kind:"internal", shape:"cyl", r:4.5, h:14, yFrac:0.4, caps:"bot", color:0x54bd9c, metal:0.2, rough:0.45,
        purpose:"Liquid hydrogen is the lightest, most efficient fuel there is, but it must be kept near minus 250 degrees and it takes up a lot of room, which is why this tank is so large. It gives far more speed per kilo than kerosene." },
      { id:"sii-j2", stage:"s-ii", label:"J-2 Engines (x5)", kind:"internal", shape:"nozzles", count:5, r:0.7, h:2.4, spread:2.2, color:0x9a6a38, metal:0.8, rough:0.35,
        purpose:"Five hydrogen burning J-2 engines, tucked up inside the interstage at liftoff. Gentler than the F-1s but much more efficient, they are built for the near vacuum up high where a long bell can expand the exhaust fully." },
      { id:"sivb-lox", stage:"s-ivb", label:"LOX Tank (S-IVB)", kind:"internal", shape:"cyl", r:2.8, h:3.5, yFrac:0.759, caps:"top", color:0x3f92d2, metal:0.2, rough:0.45,
        purpose:"The third stage oxygen supply, again stacked above the hydrogen with a shared wall. Thick insulation keeps it from boiling away during the long quiet coast in orbit before the burn to the Moon." },
      { id:"sivb-bulkhead", stage:"s-ivb", label:"Common Bulkhead", kind:"internal", shape:"disc", r:2.8, yFrac:0.633, color:0xc4ccd8, metal:0.85, rough:0.3,
        purpose:"The same shared wall trick as the second stage, scaled down. One insulated dome separates the two propellants, saving weight on a stage that has to stay light enough to reach escape speed." },
      { id:"sivb-lh2", stage:"s-ivb", label:"Liquid Hydrogen Tank (S-IVB)", kind:"internal", shape:"cyl", r:2.9, h:6.5, yFrac:0.4, caps:"bot", color:0x54bd9c, metal:0.2, rough:0.45,
        purpose:"Hydrogen for both of the third stage's burns. Between them it has to survive hours in orbit without boiling off, so small ullage motors nudge the stage to settle the liquid before each relight." },
      { id:"sivb-j2", stage:"s-ivb", label:"J-2 Engine (S-IVB)", kind:"internal", shape:"nozzles", count:1, r:0.9, h:2.6, spread:0, color:0x9a6a38, metal:0.8, rough:0.35,
        purpose:"One J-2 that can shut down and relight, which almost no engine of its time could do. That restart is the whole trick of Apollo: reach orbit, coast, check everything, then fire again to leave for the Moon." },
      { id:"lm", stage:"sla", label:"Lunar Module (LM)", kind:"internal", shape:"lm", yFrac:0.42, color:0xdba22a, metal:0.4, rough:0.45,
        purpose:"The spidery lander, the only crewed craft built to fly solely in space and vacuum. Its lower half is a descent engine and legs for landing, its upper half a cabin with its own engine to lift back off the Moon to the waiting capsule." },

      // ---- upper stage detail (Instrument Unit, Service Module, Command Module) ----
      { id:"iu-avionics", stage:"iu", label:"Guidance Electronics", kind:"avionics", count:12, r:3.35, color:0x50565f, metal:0.5, rough:0.5,
        purpose:"The boxes packed around this ring are the rocket's nervous system: a stabilised platform of spinning gyroscopes that senses every tilt, a digital computer that decides the correct path, and the electronics that turn those decisions into commands to swivel the engines." },
      { id:"sm-fuel", stage:"sm", label:"SPS Fuel Tank", kind:"internal", shape:"cyl", r:0.85, h:2, yFrac:0.44, caps:"bot", color:0xd6883a, metal:0.2, rough:0.5,
        purpose:"Fuel for the service module's main engine. It uses hypergolic propellant, which ignites the instant it touches the oxidiser with no spark needed, so the engine can be trusted to light every time far from home." },
      { id:"sm-ox", stage:"sm", label:"SPS Oxidiser Tank", kind:"internal", shape:"cyl", r:0.85, h:1.8, yFrac:0.74, caps:"top", color:0x3f92d2, metal:0.2, rough:0.45,
        purpose:"The matching oxidiser for the main engine. Stored above the fuel, it is fed to the chamber by pressure rather than pumps, a simpler and more reliable setup for a burn that has to work on the far side of the Moon." },
      { id:"sm-he", stage:"sm", label:"Helium Pressurant Sphere", kind:"internal", shape:"sphere", r:0.5, yFrac:0.14, color:0xd9c15e, metal:0.7, rough:0.35,
        purpose:"High pressure helium that squeezes the propellant tanks and pushes fuel and oxidiser into the engine. With no pumps involved, this simple gas pressure is what makes the engine restartable and dependable." },
      { id:"sps", stage:"sm", label:"Service Propulsion Engine", kind:"internal", shape:"nozzles", count:1, r:0.9, h:2.8, spread:0, color:0x9a6a38, metal:0.8, rough:0.35,
        purpose:"The single big engine of the spacecraft. It brakes the ship into orbit around the Moon and, days later, fires again to break out of lunar orbit and head home. If it had failed to relight, the crew could not have returned, so it was kept as simple as possible." },
      { id:"sm-rcs", stage:"sm", label:"RCS Thruster Quads", kind:"rcs", r:2.05, yFrac:0.62, color:0x424852, metal:0.6, rough:0.4,
        purpose:"Small clusters of thrusters that fire in any direction to rotate and nudge the spacecraft. In the vacuum of space there is nothing to push against, so these little jets are the only way to turn, dock, and hold a steady attitude." },
      { id:"cm-heat", stage:"cm", label:"Heat Shield", kind:"heatshield", r:2, color:0x8a5a34, metal:0.3, rough:0.7,
        purpose:"The blunt base of the capsule. On reentry it deliberately faces forward so a shockwave of superheated air forms just ahead of it, carrying most of the heat away. The shield itself chars and slowly burns off, soaking up what is left and keeping the cabin survivable." },
      { id:"cm-rcs", stage:"cm", label:"Capsule Thrusters", kind:"rcs", r:1.55, yFrac:0.5, color:0x424852, metal:0.6, rough:0.4,
        purpose:"After the capsule separates for the final plunge, it has its own small thrusters to hold the heat shield pointed the right way and to roll the capsule so it can steer a little during reentry." }
    ]
  },

  /* ---------------------------------------------------------- */
  {
    key: "falcon-9",
    name: "Falcon 9",
    org: "SpaceX", flag: "🇺🇸", years: "2010 to present", status: "Active",
    height: 70, diameter: 3.7, mass: "549 t", thrust: "7.6 MN",
    payloadLEO: "22.8 t", accent: 0x8fd0ff,
    sub: "The workhorse of modern spaceflight, and the most flown rocket in the world today.",
    claim: "First orbital rocket to land its booster and fly it again.",
    sizeVs: "About 70 metres tall, roughly a 23 storey building.",
    engines: "9 x Merlin 1D", flights: "650+ launches",
    facts: [
      "One booster has launched and landed dozens of times and is still flying.",
      "SpaceX once turned a used booster around and flew it again just nine days later.",
      "It launches so often that SpaceX aims for well over a hundred flights a year.",
      "Flown expendably it lifts 22.8 tonnes, but it carries less when it saves fuel to fly the booster home."
    ],
    missions: [
      ["Crew Dragon", "Carries astronauts to and from the Space Station for NASA."],
      ["Starlink", "Launches batches of internet satellites, sometimes weekly."],
      ["Booster reuse", "The same first stage has flown and landed dozens of times."]
    ],
    build: [
      "Falcon 9 was designed from the start to come back. The first stage saves some fuel, relights its engines, and lands upright so it can be cleaned up and flown again.",
      "Nine identical engines share the workload. If one has trouble, the rocket can often finish the mission on the other eight, a safety trick the name itself points to.",
      "Reusing the expensive booster instead of throwing it away is what makes each launch far cheaper than older rockets of the same size."
    ],
    // two-stage flight; the first stage is recovered (flies back and lands on its legs)
    launchStages: [
      { key:"s1", name:"Stage 1  ·  Booster", thrust:1.0, burn:19, jettison:["s1"],
        story:"Nine Merlins share the load off the pad. The booster is quietly saving a splash of fuel for its ride home.",
        flame:{ color:0xff7a2e, core:0xffe6b0, engines:9, rExit:1.05, len:15, spread:1.05 } },
      { key:"s2", name:"Stage 2", thrust:0.6, burn:24, jettison:[],
        story:"A single vacuum Merlin with a huge nozzle takes over up where there is no air to push against.",
        flame:{ color:0xff8a3d, core:0xffffff, engines:1, rExit:0.95, len:14, spread:0 } }
    ],
    recover: { booster:"s1", mode:"legs" },
    parts: [
      // ---- First stage / booster (stage "s1") ----
      { id:"s1", stage:"s1", label:"First Stage", kind:"stage", rb:1.83, rt:1.83, h:42, color:WHITE,
        purpose:"Nine Merlin engines lift the rocket off the pad. This stage does the heavy early work, then separates and flies itself back to a landing to be reused." },
      { id:"n1", stage:"s1", label:"Merlin Engines (x9)", kind:"nozzles", count:9, r:0.42, h:1.6, spread:1.1, color:DARK,
        purpose:"Nine engines arranged in a circle around one in the middle. Sharing the job across many engines means the rocket can survive losing one and still reach orbit." },
      { id:"leg", stage:"s1", label:"Landing Legs (x4)", kind:"fins", leg:true, count:4, w:1.0, h:8, t:0.42, color:0x14161c, yBias:0.0,
        purpose:"Four carbon fibre legs stowed flat against the body during launch. Just before touchdown they swing out and lock, turning the booster into something that can stand upright on a pad or a drone ship at sea." },
      { id:"is", stage:"s1", label:"Interstage", kind:"stage", rb:1.83, rt:1.83, h:3, color:BLACK,
        purpose:"The dark collar that connects the two stages and holds them apart for a moment at separation. It also houses the grid fins that steer the booster home." },
      { id:"gf", stage:"s1", label:"Grid Fins (x4)", kind:"fins", grid:true, count:4, w:1.5, h:1.6, t:0.16, color:0x585d68, metal:0.65, rough:0.45, yBias:0.58,
        purpose:"Waffle shaped fins made of titanium that flip out during the fall back to Earth. Their lattice of little squares bites the air to steer the booster with pinpoint accuracy toward its landing spot." },
      { id:"oct", stage:"s1", label:"Octaweb", kind:"thrust", y:1.4, color:0x1c1e24, metal:0.5, rough:0.6,
        purpose:"The black eight sided frame at the very base that holds the nine engines together and spreads their enormous push evenly into the bottom of the tank." },
      { id:"s1-rp1", stage:"s1", label:"Kerosene Tank (S1)", kind:"internal", shape:"cyl", r:1.6, h:21, yFrac:0.28, caps:"both", color:0xd6883a, metal:0.3, rough:0.4,
        purpose:"The lower tank holds a highly refined kerosene called RP-1, much like jet fuel. It is dense and easy to store, so it packs a lot of energy into a slim booster." },
      { id:"s1-lox", stage:"s1", label:"Oxygen Tank (S1)", kind:"internal", shape:"cyl", r:1.6, h:15, yFrac:0.72, caps:"both", color:0x3f92d2, metal:0.3, rough:0.4,
        purpose:"The upper tank holds liquid oxygen, chilled colder than usual so even more of it fits. The engines mix it with the kerosene to burn, since there is no air to breathe in space." },
      { id:"s1-he", stage:"s1", label:"Helium Bottles (COPVs)", kind:"internal", shape:"sphere", r:0.5, yFrac:0.74, color:0xd9c15e, metal:0.7, rough:0.4,
        purpose:"Carbon wrapped bottles of high pressure helium, sunk right inside the cold oxygen tank. As propellant drains, the helium is released to keep the tanks firm and pushing fuel to the engines." },
      { id:"brand", stage:"s1", kind:"brand", text:"SpaceX", label:"SpaceX Livery",
        purpose:"The SpaceX name and a small United States flag painted up the side, the maker's mark on the most flown rocket in the world today." },
      // ---- Second stage (stage "s2") ----
      { id:"s2", stage:"s2", label:"Second Stage", kind:"stage", rb:1.83, rt:1.83, h:12, color:WHITE,
        purpose:"A single engine that lights after separation and carries the payload the rest of the way to orbit. It works in vacuum where there is no air at all." },
      { id:"s2-rp1", stage:"s2", label:"Kerosene Tank (S2)", kind:"internal", shape:"cyl", r:1.6, h:5, yFrac:0.30, caps:"both", color:0xd6883a, metal:0.3, rough:0.4,
        purpose:"A smaller kerosene tank for the upper stage. It only needs enough for the final push, since the heavy lifting is already done by the time this stage takes over." },
      { id:"s2-lox", stage:"s2", label:"Oxygen Tank (S2)", kind:"internal", shape:"cyl", r:1.6, h:4, yFrac:0.70, caps:"both", color:0x3f92d2, metal:0.3, rough:0.4,
        purpose:"The upper stage's liquid oxygen supply, feeding its single vacuum engine on the long, careful burn all the way up to orbit." },
      { id:"s2-he", stage:"s2", label:"Helium Bottles (S2)", kind:"internal", shape:"sphere", r:0.4, yFrac:0.7, color:0xd9c15e, metal:0.7, rough:0.4,
        purpose:"The upper stage carries its own helium bottles to keep its tanks pressurised during the long, quiet coast and burn out in space." },
      { id:"s2-mv", stage:"s2", label:"Merlin Vacuum Engine", kind:"internal", shape:"nozzles", count:1, r:0.9, h:3.6, spread:0, color:0x7a5636, metal:0.7, rough:0.45,
        purpose:"A single engine with a huge niobium alloy bell shaped for the emptiness of space. The metal glows dull orange in flight, and the big bell lets the exhaust spread fully where there is no air pushing back, squeezing out extra thrust." },
      // ---- Payload fairing (stage "fb") ----
      { id:"fb", stage:"fb", label:"Payload Fairing", kind:"stage", rb:1.83, rt:1.83, h:5.5, color:0xf4f6fa,
        purpose:"A protective nose shell around the satellite. It shields the cargo from air rushing past during the climb, then splits in two and drops away once above the atmosphere." },
      { id:"fn", stage:"fb", label:"Fairing Nose", kind:"nose", rb:1.83, rt:0, h:6, color:0xf4f6fa,
        purpose:"The pointed tip of the fairing. Its smooth curve lets the rocket cut through the lower atmosphere with as little drag and shaking as possible." },
      { id:"fb-sat", stage:"fb", label:"Payload (Satellite)", kind:"internal", shape:"sat", r:0.95, h:2.6, yFrac:0.5, wingLen:3.2, wingH:1.7, color:0xd9c15e, wing:0x27407e, metal:0.6, rough:0.4,
        purpose:"The cargo riding inside the nose, here a communications satellite. Its gold foil body holds the electronics, and two wings of solar panels fold out in orbit to power it. It could just as easily be a science probe, a telescope, or a Dragon capsule of astronauts." }
    ]
  },

  /* ---------------------------------------------------------- */
  {
    key: "starship",
    name: "Starship",
    org: "SpaceX", flag: "🇺🇸", years: "2023 to present", status: "In testing",
    height: 121, diameter: 9, mass: "5,000 t", thrust: "74 MN",
    payloadLEO: "100 t+", accent: 0xcdd6e4,
    sub: "The largest and most powerful rocket ever built, designed to be fully reusable, top to bottom.",
    claim: "Over twice the liftoff thrust of the Saturn V.",
    sizeVs: "The tallest rocket ever to fly, over 120 metres of steel.",
    engines: "33 x Raptor", flights: "In flight testing",
    facts: [
      "Its 33 booster engines make over twice the thrust of the Saturn V that flew Apollo to the Moon.",
      "It is built from shiny stainless steel, not the aluminium most rockets use.",
      "The giant booster flies home and gets plucked from the sky by two tower arms nicknamed the chopsticks.",
      "Its engines drink methane, a fuel that could one day be brewed on Mars."
    ],
    missions: [
      ["Artemis lander", "Chosen by NASA to land its astronauts on the Moon."],
      ["Mars ambitions", "Built around the goal of carrying large crews and cargo to Mars."],
      ["Full reuse", "Both the booster and the ship are meant to return and fly again."]
    ],
    build: [
      "Starship is made of stainless steel instead of the usual lightweight aluminium. Steel is cheap, strong when very cold, and holds up better to the heat of coming back from space.",
      "Two parts stack together. A huge booster called Super Heavy does the lifting, then the upper Ship carries the cargo onward and can even refuel in orbit for longer journeys.",
      "The whole point is that nothing gets thrown away. Both halves are designed to fly back and be caught or landed, so the same hardware can be reused many times."
    ],
    // two-stage flight; the booster flies back and is CAUGHT by the launch tower's arms
    launchStages: [
      { key:"sh", name:"Super Heavy Booster", thrust:1.0, burn:20, jettison:["sh"],
        story:"Thirty three Raptors burning methane, the most thrust ever flown. This booster will be back at the tower in minutes.",
        flame:{ color:0x8ec4ff, core:0xfff2e0, engines:21, rExit:1.45, len:22, spread:1.7 } },
      { key:"ship", name:"Starship", thrust:0.62, burn:24, jettison:[],
        story:"The Ship lights its own Raptors and carries on. A steel body built to fly again and again.",
        flame:{ color:0x9fd0ff, core:0xffffff, engines:6, rExit:1.5, len:17, spread:1.6 } }
    ],
    recover: { booster:"sh", mode:"catch" },
    parts: [
      // ---- Super Heavy booster (stage "sh") ----
      { id:"sh", stage:"sh", label:"Super Heavy Booster", kind:"stage", rb:4.5, rt:4.5, h:69, color:STEEL, metal:0.82, rough:0.44,
        purpose:"The bottom half and the muscle. Around thirty three Raptor engines fire at once to lift the entire vehicle, making it the most powerful rocket stage ever flown." },
      { id:"rn", stage:"sh", label:"Raptor Engines (x33)", kind:"nozzles", count:8, r:1.0, h:2.4, spread:2.8, color:0x2a2d36,
        purpose:"Engines that burn methane and oxygen, fuels that could one day be made on Mars. Packing dozens together gives enormous thrust and room to lose a few safely." },
      { id:"gf", stage:"sh", label:"Grid Fins (x4)", kind:"fins", grid:true, count:4, w:2.8, h:4.5, t:0.42, color:0x9aa2b0, metal:0.6, rough:0.45, yBias:0.56,
        purpose:"Waffle shaped steering fins near the top of the booster. They bite the air to guide it back toward the launch tower, which reaches out to catch the booster in mid air." },
      { id:"sh-ch4", stage:"sh", label:"Methane Tank (Booster)", kind:"internal", shape:"cyl", r:4.1, h:33.6, yFrac:0.283, caps:"bot", color:0x57c0c9, metal:0.3, rough:0.4,
        purpose:"The big lower tank holds liquid methane, the fuel. Methane is special because it could one day be made on Mars from the planet's air and ice, so a ship could refuel for the trip home." },
      { id:"sh-lox", stage:"sh", label:"Oxygen Tank (Booster)", kind:"internal", shape:"cyl", r:4.1, h:28, yFrac:0.73, caps:"top", color:0x3f92d2, metal:0.3, rough:0.4,
        purpose:"The upper tank holds liquid oxygen, chilled until it turns to liquid. The engines need it because fuel cannot burn without oxygen, and there is none to breathe out in space." },
      { id:"sh-bulk", stage:"sh", label:"Common Bulkhead (Booster)", kind:"internal", shape:"disc", r:4.05, yFrac:0.527, color:0xc4ccd8, metal:0.6, rough:0.5,
        purpose:"A single shared wall between the two tanks. Using one wall instead of two saves a lot of weight, which leaves more room for fuel." },
      { id:"hotring", stage:"sh", label:"Hot-Stage Ring", kind:"ring", r:4.62, h:2.4, gaps:14, at:67.6, color:0x3a3d45, metal:0.7, rough:0.45,
        purpose:"A vented steel ring on top of the booster. Starship lights the ship's engines while it is still attached, called hot staging, and this ring lets the fiery exhaust blast out through the gaps instead of cooking the booster below." },
      // ---- Ship / upper stage (stage "ship") ----
      { id:"ship", stage:"ship", label:"Starship (upper stage)", kind:"stage", rb:4.5, rt:4.5, h:30, color:STEEL, metal:0.82, rough:0.44,
        purpose:"The part that reaches orbit and beyond. It carries crew or cargo, can be refuelled in space, and is meant to land itself on the Moon, Mars, or back on Earth." },
      { id:"nc", stage:"ship", label:"Nose Cone", kind:"nose", rb:4.5, rt:0, h:20, color:STEEL, metal:0.82, rough:0.44,
        purpose:"A tall rounded nose that streamlines the ship and holds cargo or crew space up top. Its shape also helps the ship glide belly first through the air on the way down." },
      { id:"ship-tiles", stage:"ship", kind:"tiles", r:4.56, start:2.05, span:3.05, noseH:20, label:"Heat Shield Tiles",
        purpose:"Thousands of black hexagon tiles cover the belly side of the ship. They soak up the ferocious heat of reentry, glowing but not burning, so the bare steel underneath survives the plunge back through the air." },
      { id:"ff", stage:"ship", label:"Forward Flaps (x2)", kind:"fins", count:2, w:4, h:5, t:0.5, color:0x9aa2b0, yBias:0.78,
        purpose:"Wing like flaps that move like a skydiver's arms. During descent the ship falls sideways and shifts these flaps to balance and steer before flipping upright to land." },
      { id:"ship-ch4", stage:"ship", label:"Methane Tank (Ship)", kind:"internal", shape:"cyl", r:4.1, h:11.6, yFrac:0.293, caps:"bot", color:0x57c0c9, metal:0.3, rough:0.4,
        purpose:"The ship's own methane tank. Together with the oxygen above it, this is what powers the ship the rest of the way to orbit once the booster drops away." },
      { id:"ship-lox", stage:"ship", label:"Oxygen Tank (Ship)", kind:"internal", shape:"cyl", r:4.1, h:9, yFrac:0.64, caps:"top", color:0x3f92d2, metal:0.3, rough:0.4,
        purpose:"The ship's liquid oxygen tank, feeding its engines in the vacuum of space where the ship does the long, patient work of reaching orbit." },
      { id:"ship-bulk", stage:"ship", label:"Common Bulkhead (Ship)", kind:"internal", shape:"disc", r:4.05, yFrac:0.488, color:0xc4ccd8, metal:0.6, rough:0.5,
        purpose:"The shared wall between the ship's two tanks, the same clever weight saving trick used down in the booster." },
      { id:"ship-rap-sl", stage:"ship", label:"Sea-Level Raptors (x3)", kind:"internal", shape:"nozzles", count:3, r:0.62, h:1.5, spread:0.95, color:0x9a6a38, metal:0.8, rough:0.35,
        purpose:"Three ordinary Raptors clustered in the middle, built for the thick low air near the ground. These are the engines that steer and land the ship." },
      { id:"ship-rap-vac", stage:"ship", label:"Vacuum Raptors (x3)", kind:"internal", shape:"nozzles", count:3, r:1.05, h:2.9, spread:2.4, color:0x9a6a38, metal:0.8, rough:0.35,
        purpose:"Three Raptors with huge bells ringed around the outside. In the emptiness of space a big bell lets the exhaust spread fully, squeezing out extra push where the air can no longer hold it back." },
      { id:"ship-header", stage:"ship", label:"Landing Header Tanks", kind:"internal", shape:"cyl", r:1.0, h:3.6, yFrac:0.86, caps:"both", color:0x57c0c9, metal:0.3, rough:0.4,
        purpose:"Small tanks holding just enough propellant for the final flip and touchdown. Keeping them separate means the engines never gulp air from a nearly empty main tank at the worst moment." },
      { id:"ship-payload", stage:"nc", label:"Payload (Starlink)", kind:"internal", shape:"stack", r:2.6, h:5, count:9, yFrac:0.18, color:0x35507e, metal:0.5, rough:0.45,
        purpose:"The cargo bay up near the nose, here holding a stack of flat Starlink internet satellites. They are packed flat like a deck of cards and released a few at a time through a slot. It could just as easily carry a Moon lander, a telescope, or people." }
    ]
  },

  /* ---------------------------------------------------------- */
  {
    key: "sls",
    name: "Space Launch System",
    org: "NASA", flag: "🇺🇸", years: "2022 to present", status: "Active",
    height: 98, diameter: 8.4, mass: "2,600 t", thrust: "39 MN",
    payloadLEO: "95 t", accent: 0xffb27a,
    sub: "NASA's heavy lifter for the Artemis program, built to return astronauts to the Moon.",
    claim: "The most powerful rocket NASA has ever flown.",
    sizeVs: "About 98 metres tall, taller than a 30 storey building.",
    engines: "4 x RS-25 + 2 SRB", flights: "2 flights so far",
    facts: [
      "Each booster burns about 6 tonnes of solid fuel every second, and cannot be switched off once lit.",
      "Its four core engines flew on the Space Shuttle for decades. On SLS they fire once and drop into the ocean.",
      "On the pad the whole 2,600 tonne rocket stands on its two boosters, not on the core.",
      "It lifts off with about 15 percent more thrust than the Saturn V that flew Apollo.",
      "The orange core is not paint. It is bare spray on foam, left plain to save weight."
    ],
    missions: [
      ["Artemis I", "Flew an uncrewed Orion capsule around the Moon in 2022."],
      ["Artemis II", "Carried the first crew around the Moon since Apollo, in 2026."],
      ["Deep space cargo", "Designed to launch large payloads far beyond Earth orbit."]
    ],
    build: [
      "SLS reuses proven parts from the Space Shuttle era. Its main engines and side boosters are updated versions of hardware that flew for decades, which saved time and risk.",
      "The orange core is not painted. That is the bare foam insulation over the fuel tanks, kept plain to save the weight of paint on such a huge surface.",
      "Two five segment boosters provide more than three quarters of the liftoff punch. Each is a steel tube cast full of rubbery solid fuel around a hollow star shaped core, and once lit it simply burns until empty. After about two minutes they drop away into the ocean, leaving the four core engines to carry on."
    ],
    parts: [
      // ---- Core stage (stage "core") ----
      { id:"core", stage:"core", label:"Core Stage", kind:"stage", rb:4.1, rt:4.1, h:60, color:ORANGE, rough:0.85,
        purpose:"The orange backbone. It holds huge tanks of liquid hydrogen and oxygen and feeds four engines at its base, providing steady power all the way to orbit." },
      { id:"rs", stage:"core", label:"RS-25 Engines (x4)", kind:"nozzles", count:4, r:0.9, h:2.6, spread:1.7, color:0x2a2d36,
        purpose:"Four engines carried over from the Space Shuttle, now flying again. They are among the most efficient engines ever made, squeezing maximum push from every drop of fuel." },
      { id:"core-lh2", stage:"core", label:"Hydrogen Tank (Core)", kind:"internal", shape:"cyl", r:3.5, h:36, yFrac:0.32, caps:"both", color:0x54bd9c, metal:0.3, rough:0.4,
        purpose:"The vast lower tank holds liquid hydrogen chilled to minus 253 Celsius. It fills most of the core because hydrogen is so light and fluffy that you need an enormous volume of it." },
      { id:"core-lox", stage:"core", label:"Oxygen Tank (Core)", kind:"internal", shape:"cyl", r:3.5, h:13, yFrac:0.80, caps:"both", color:0x3f92d2, metal:0.3, rough:0.4,
        purpose:"The upper tank holds liquid oxygen for the four engines to burn with the hydrogen below. Oxygen is far denser, so its tank is much shorter even though it feeds the same engines." },
      { id:"core-inter", stage:"core", label:"Intertank (Core)", kind:"internal", shape:"disc", r:3.5, yFrac:0.62, color:0xc4ccd8, metal:0.6, rough:0.5,
        purpose:"The structural ring between the two tanks. It carries the load from the two side boosters into the core, so the whole stack holds together at liftoff." },
      { id:"core-feed", stage:"core", label:"Oxygen Feedline", kind:"internal", shape:"feedline", r:0.28, y0:0.06, y1:0.74, off:3.7, color:0x3f92d2, metal:0.5, rough:0.4,
        purpose:"This duct carries liquid oxygen from the tank at the top all the way down to the engines at the base. Because the oxygen tank sits above the huge hydrogen tank, the oxygen has to travel the length of the rocket to reach the engines." },
      // ---- Solid rocket boosters (stage "srb"): five-segment cutaway ----
      { id:"srb", stage:"srb", label:"Solid Rocket Boosters (x2)", kind:"srb", count:2, r:1.8, h:54, segments:5, color:WHITE, angle:0, grainColor:0x7d6b4a,
        purpose:"Two five segment solid rocket boosters, the biggest, most powerful solid rockets ever flown. Each is a steel tube packed with rubbery solid fuel. Together they give most of the punch off the pad, burn for about two minutes, then drop away into the ocean. Click to see how one is built inside.",
        grain:{ label:"Solid Propellant (APCP)", purpose:"The fuel is a rubbery block cast around a hollow channel that runs down the middle. It burns from that channel outward to the wall. The star shaped opening up top burns fast for a strong liftoff, then eases off as the rocket pushes through the thickest air. Once lit it cannot be shut off or throttled." },
        nozzle:{ label:"Gimbaling Nozzle", purpose:"The bell at the base swivels up to eight degrees to steer the whole rocket during the climb. It sits partly tucked up inside the booster to save length." },
        joints:{ label:"Field Joints", purpose:"Each booster ships as five segments that are stacked and joined during assembly. Every joint is sealed by rubber O-rings, redesigned to be leak proof after the lesson of Challenger." } },
      // ---- Upper stage (stage "icps") ----
      { id:"icps", stage:"icps", label:"Upper Stage (ICPS)", kind:"stage", rb:2.5, rt:2.5, h:13, color:WHITE,
        purpose:"A smaller stage that fires after the core is done. It gives Orion the final shove out of Earth orbit and onto a path toward the Moon." },
      { id:"icps-lh2", stage:"icps", label:"Hydrogen Tank (ICPS)", kind:"internal", shape:"cyl", r:2.2, h:5, yFrac:0.32, caps:"both", color:0x54bd9c, metal:0.3, rough:0.4,
        purpose:"The upper stage's own hydrogen supply for the long push toward the Moon, sipped slowly by a single very efficient engine." },
      { id:"icps-lox", stage:"icps", label:"Oxygen Tank (ICPS)", kind:"internal", shape:"cyl", r:2.2, h:3.5, yFrac:0.68, caps:"both", color:0x3f92d2, metal:0.3, rough:0.4,
        purpose:"The oxygen the upper stage engine needs to burn its hydrogen out beyond the reach of Earth's atmosphere." },
      { id:"icps-eng", stage:"icps", label:"RL10 Engine", kind:"internal", shape:"nozzles", count:1, r:0.6, h:2, spread:0, color:0x9a6a38, metal:0.8, rough:0.35,
        purpose:"A single small engine famous for its efficiency. It relights in space to nudge Orion onto a precise path around the Moon." },
      // ---- Orion spacecraft: service module + crew capsule + escape tower (stages "osm","orion") ----
      { id:"osm", stage:"osm", label:"Service Module (ESM)", kind:"stage", rb:2.6, rt:2.5, h:4, color:0xc9cdd6, metal:0.4, rough:0.5,
        purpose:"The powerhouse below the capsule, built in Europe. It holds the air, water, electricity and the main engine that pushes Orion around the Moon and back. Its four solar wings unfold once in space." },
      { id:"osm-eng", stage:"osm", label:"Service Module Engine", kind:"internal", shape:"nozzles", count:1, r:0.5, h:1.6, spread:0, color:0x9a6a38, metal:0.8, rough:0.35,
        purpose:"A single engine, carried over from the Space Shuttle, that does the big burns to enter and leave orbit around the Moon. Smaller thrusters around it handle gentle steering." },
      { id:"osm-panels", stage:"osm", label:"Solar Array Wings (x4)", kind:"panels", count:4, inner:2.7, len:6.2, wid:2.6, yFrac:0.5, angle:0.78, reveal:true, color:0x2a4a8c,
        purpose:"Four solar wings that fan out once Orion reaches space. They turn sunlight into the electricity that keeps the crew alive on the long trip to the Moon and back." },
      // ---- Agency logos on the (European built) service module fairing ----
      { id:"osm-nasa", stage:"osm", kind:"logo", logo:"meatball", r:2.55, w:1.4, yFrac:0.62, bg:"#c9cdd6",
        label:"NASA Insignia", purpose:"The round blue NASA meatball rides on the service module fairing, the emblem of the American half of the partnership that builds and flies Orion." },
      { id:"osm-esa", stage:"osm", kind:"logo", logo:"esa", r:2.55, w:1.5, yFrac:0.2, bg:"#c9cdd6",
        label:"ESA Logo", purpose:"The European Space Agency logo. Europe builds Orion's service module, the powerhouse that carries the air, water, power and main engine for the trip around the Moon." },
      { id:"orion", stage:"orion", label:"Crew Module", kind:"cone", rb:2.6, rt:1.7, h:4, color:SILVER, metal:0.5, rough:0.4,
        purpose:"The gumdrop shaped capsule the astronauts live in. It carries up to four crew to the Moon and is the only part that comes home, splashing down in the ocean under parachutes." },
      { id:"orion-heat", stage:"orion", label:"Heat Shield", kind:"heatshield", r:2.5, color:0x8a5a34, metal:0.3, rough:0.7,
        purpose:"A blunt shield on the base of the capsule. Coming home from the Moon it slams into the air so fast that this shield glows and slowly burns away to carry the heat off." },
      { id:"nc", stage:"orion", label:"Launch Escape Tower", kind:"nose", rb:1.7, rt:0, h:7, color:0xd23b3b,
        purpose:"A slim red tower with its own rocket on top of the capsule. If something went wrong at launch it could yank the crew capsule up and clear in an instant. It is dropped once the rocket is safely flying." }
    ]
  },

  /* ---------------------------------------------------------- */
  {
    key: "soyuz",
    name: "Soyuz",
    org: "Roscosmos", flag: "🇷🇺", years: "1966 to present", status: "Active",
    height: 46, diameter: 2.95, mass: "308 t", thrust: "4.1 MN",
    payloadLEO: "7 t", accent: 0xa8d8a0,
    sub: "The dependable workhorse of human spaceflight, and for years the only ride to the Space Station.",
    claim: "The most launched rocket family in history.",
    sizeVs: "About 46 metres tall, roughly a 15 storey building on the pad.",
    engines: "5 x RD-107/108 (20 chambers)", flights: "1,900+ launches",
    facts: [
      "Each of its four boosters is a complete little liquid rocket, with its own oxygen, kerosene and engine.",
      "All 32 of its nozzles light on the ground. Nothing has to start up in mid air.",
      "The four boosters peel away together in a burst called the Korolev cross.",
      "On the pad it hangs from four support arms that swing away as it climbs, instead of sitting on clamps.",
      "For years it was the only ride to the Space Station."
    ],
    missions: [
      ["Station crews", "Ferried astronauts of many nations to orbit for decades."],
      ["Progress cargo", "Regularly restocks the Space Station with food and fuel."],
      ["Proven record", "More launches than any other rocket family make it one of the most reliable ever."]
    ],
    build: [
      "Soyuz keeps a design that has barely changed since the 1960s because it simply works. Reliability came from repeating the same trusted layout on flight after flight.",
      "Four cone shaped boosters hug a central core. All of them light on the ground at once, and the four outer ones fall away in a neat cross shape once their fuel runs low.",
      "Every engine is lit before the rocket ever leaves the pad. There is no risky mid air ignition of the main engines, which removes one common way for a launch to fail."
    ],
    parts: [
      // ---- Core stage Block A (stage "core") ----
      { id:"core", stage:"core", label:"Core Stage (Block A)", kind:"stage", rb:1.35, rt:1.35, h:28, color:0x93a06f, rough:0.72,
        purpose:"The central column that keeps burning after the four boosters drop away. It carries the rocket through the middle part of the climb toward orbit." },
      { id:"n1", stage:"core", label:"Core Engine (RD-108)", kind:"nozzles", count:4, r:0.5, h:1.4, spread:1.0, color:0x2a2d36,
        purpose:"The central engine keeps burning after the four boosters drop away. Like them it uses four smaller chambers rather than one huge one. Simpler, well understood chambers are a big reason the rocket almost never fails." },
      { id:"core-kero", stage:"core", label:"Kerosene Tank (Core)", kind:"internal", shape:"cyl", r:1.15, h:14, yFrac:0.30, caps:"both", color:0xd6883a, metal:0.3, rough:0.4,
        purpose:"The lower tank holds kerosene, a refined fuel much like paraffin. It is safe to handle and store, which suits a rocket built for steady, reliable service." },
      { id:"core-lox", stage:"core", label:"Oxygen Tank (Core)", kind:"internal", shape:"cyl", r:1.15, h:10, yFrac:0.71, caps:"both", color:0x3f92d2, metal:0.3, rough:0.4,
        purpose:"The upper tank holds liquid oxygen for the engines to burn with the kerosene. Every Soyuz engine is lit on the ground, so nothing has to start mid air." },
      // ---- Strap-on boosters (stage "boost", solid grouping, no openable internals) ----
      { id:"boost", stage:"boost", label:"Strap-on Boosters (x4)", kind:"boosters", count:4, r:1.4, h:19, color:0x7f8c54, rough:0.72, taper:0.3, cone:0, angle:0,
        purpose:"Four tapered boosters clustered around the core, and here is the surprise: each one is a complete little liquid rocket, with its own oxygen and kerosene tanks and its own engine. They all light on the ground, then peel away together in the famous Korolev cross once empty. Click to open one up.",
        tanks:[
          { id:"lox", y0:0.36, y1:0.97, color:0x3f92d2, metal:0.3, rough:0.4, label:"Oxygen Tank (Booster)", purpose:"The pointed conical top holds the liquid oxygen, and its tapering shape is what gives each Soyuz booster that famous carrot silhouette. The oxygen feeds down to the engine at the base." },
          { id:"kero", y0:0.09, y1:0.36, color:0xd6883a, metal:0.3, rough:0.4, label:"Kerosene Tank (Booster)", purpose:"The stubby cylinder near the base holds kerosene, a refined paraffin like fuel. It burns with the oxygen from the tank above in the engine just below it." }
        ],
        engine:{ count:4, r:0.34, h:1.7, spread:0.62, label:"RD-107 Engine", purpose:"One engine with four combustion chambers fed by a single pump, plus small steering nozzles. Four smaller chambers are simpler and steadier than one huge one, a big reason Soyuz almost never fails." } },
      // ---- Upper stage (stage "up") ----
      { id:"up", stage:"up", label:"Upper Stage (Blok I)", kind:"cone", rb:1.35, rt:1.1, h:4, color:0x93a06f, rough:0.72,
        purpose:"The third stage. It fires high in the sky after the core drops away and places the spacecraft precisely into orbit. Click to look inside." },
      { id:"up-lox", stage:"up", label:"Oxygen Tank (Upper)", kind:"internal", shape:"cyl", r:0.98, h:1.5, yFrac:0.68, caps:"top", color:0x3f92d2, metal:0.3, rough:0.4,
        purpose:"The upper stage's own liquid oxygen, feeding its engine on the final push to orbit once the core has fallen away." },
      { id:"up-kero", stage:"up", label:"Kerosene Tank (Upper)", kind:"internal", shape:"cyl", r:0.98, h:1.3, yFrac:0.35, caps:"bot", color:0xd6883a, metal:0.3, rough:0.4,
        purpose:"Kerosene for the upper stage, burned with the oxygen above to nudge the spacecraft into a precise orbit." },
      { id:"up-eng", stage:"up", label:"RD-0110 Engine", kind:"internal", shape:"nozzles", count:4, r:0.26, h:0.95, spread:0.5, color:0x9a6a38, metal:0.8, rough:0.35,
        purpose:"An engine with four small chambers. It lights high in the sky after the core separates, the only Soyuz engine that has to start in flight rather than on the ground." },
      // ---- Payload fairing + Soyuz spacecraft (stage "fair") ----
      { id:"fair", stage:"fair", label:"Payload Fairing", kind:"stage", rb:1.45, rt:1.45, h:8, color:0xd2d5c8,
        purpose:"The nose shell that protects the crew capsule or cargo during the climb. It carries the small escape tower for crewed flights on its very tip." },
      { id:"nc", stage:"fair", label:"Nose Cone", kind:"nose", rb:1.45, rt:0, h:5, color:0xd2d5c8,
        purpose:"Gives the fairing its pointed, low drag shape so the rocket slices cleanly through the dense air near the ground." },
      { id:"les", stage:"les", label:"Launch Escape Tower", kind:"nose", escape:true, rb:0.72, h:6, color:0xb4bcc6,
        purpose:"A slim escape tower on the very tip, fitted for crewed flights. If a launch went wrong it could pull the crew capsule up and clear in a heartbeat, then parachute it down. It is dropped once the rocket is safely climbing." },
      { id:"soy-orbital", stage:"fair", label:"Orbital Module", kind:"internal", shape:"sphere", r:1.0, yFrac:0.74, color:0xb9c0cc, metal:0.4, rough:0.5,
        purpose:"The round room where the crew live and work in orbit. It has space for experiments and even a small toilet, and is left behind before coming home." },
      { id:"soy-descent", stage:"fair", label:"Descent Module", kind:"internal", shape:"cyl", r:0.95, h:2, yFrac:0.42, caps:"both", color:0x8a5a34, metal:0.3, rough:0.6,
        purpose:"The bell shaped capsule the crew ride back to Earth in. It is the only part built to survive the fiery plunge through the atmosphere and parachute down." },
      { id:"soy-service", stage:"fair", label:"Service Module", kind:"internal", shape:"cyl", r:1.0, h:2.2, yFrac:0.17, caps:"both", color:0x5e6b4a, metal:0.4, rough:0.55,
        purpose:"The engine room below the crew, wrapped in olive-green thermal blankets. It carries the propellant, oxygen, power and the engine for the trip, and its two solar wings unfold in orbit. It is left behind before the crew come home." },
      { id:"soy-panels", stage:"fair", label:"Solar Array Wings (x2)", kind:"panels", count:2, inner:1.5, len:4, wid:1.7, yFrac:0.17, angle:0, reveal:true, color:0x101826,
        purpose:"Two solar wings on the service module. They fan out in orbit to turn sunlight into electricity, keeping the spacecraft powered for its days in space." },
      // ---- Exterior livery: banded accents + Cyrillic markings (surface decals) ----
      { id:"soy-lattice", stage:"up", kind:"band", lattice:true, r:1.34, h:1.5, yFrac:0.05, color:0x171712,
        label:"Interstage Lattice", purpose:"The open black truss that joins the core to the upper stage. Leaving it an airy lattice sheds weight, and the upper engine actually lights while still inside it, firing straight through the gaps as the spent core drops away." },
      { id:"soy-orange", stage:"up", kind:"band", r:1.24, h:0.62, yFrac:0.46, color:0xcf6412, rough:0.7,
        label:"Orange Accent Band", purpose:"One of the bright orange bands ringing the airframe. They mark structural joints and give ground crews a clear reference, a splash of colour on the muted grey green body." },
      { id:"soy-darkband", stage:"fair", kind:"band", r:1.45, h:1.1, yFrac:0.05, color:0x3a3d34, rough:0.75,
        label:"Adapter Band", purpose:"The darker band at the base of the fairing, where the payload shroud meets the upper stage below it." },
      { id:"soy-mark", stage:"fair", kind:"soyuzmark", r:1.45, yFrac:0.58,
        label:"СОЮЗ Markings", purpose:"The rocket's name painted in red Cyrillic down the fairing, СОЮЗ, meaning union, alongside the Russian tricolour flag." }
    ]
  },

  /* ---------------------------------------------------------- */
  {
    key: "shuttle",
    name: "Space Shuttle",
    org: "NASA", flag: "🇺🇸", years: "1981 to 2011", status: "Retired",
    height: 56, diameter: 8.4, mass: "2,030 t", thrust: "30.1 MN",
    payloadLEO: "27.5 t", accent: 0xff9d6e,
    sub: "The first reusable spaceplane, a winged orbiter that launched like a rocket and landed like a glider.",
    claim: "The only winged spacecraft to fly crews to orbit and land on a runway.",
    sizeVs: "Stood 56 metres tall, about as high as an 18 storey building.",
    engines: "3 x RS-25 + 2 SRB", flights: "135 flights",
    facts: [
      "Its three main engines rode on the orbiter, not the tank, so the costly engines flew home and were reused.",
      "The big orange tank was the only major part thrown away each flight. Everything else came home.",
      "The two boosters together gave most of the liftoff thrust, then parachuted into the sea to fly again.",
      "It landed as the world's heaviest glider, coasting onto a runway with its engines already shut down.",
      "The orange is not paint. It is bare foam, left plain after the first two flights to save weight."
    ],
    missions: [
      ["Hubble Telescope", "Deployed and later repaired the famous space telescope in orbit."],
      ["Space Station", "Delivered most of the large modules that built the Station."],
      ["135 flights", "Flew for thirty years carrying crews of up to seven at a time."]
    ],
    build: [
      "The Shuttle broke the usual rocket shape. Instead of stacking straight up, a winged orbiter rode on the side of a giant fuel tank, flanked by two slim boosters.",
      "The orbiter had no fuel of its own for launch. It drank from the big orange tank, which was the only major part thrown away each flight and burned up on the way down.",
      "The two side boosters parachuted into the ocean to be fished out and reused, and the orbiter glided back to a runway, making most of the vehicle recoverable."
    ],
    parts: [
      // ---- External tank (stage "et") ----
      { id:"et", stage:"et", label:"External Tank", kind:"stage", rb:4.2, rt:4.2, h:40, color:ORANGE, rough:0.85,
        purpose:"The big orange tank that fed the orbiter's three engines with hydrogen and oxygen. It was the only large part not reused, burning up after each launch." },
      { id:"etn", stage:"et", label:"Tank Nose", kind:"nose", rb:4.2, rt:0, h:7, color:ORANGE, rough:0.85,
        purpose:"Streamlines the top of the tank and holds valves and sensors. Its shape reduced drag as the wide tank pushed up through the lower atmosphere." },
      { id:"et-lh2", stage:"et", label:"Hydrogen Tank", kind:"internal", shape:"cyl", r:3.6, h:24, yFrac:0.31, caps:"both", color:0x54bd9c, metal:0.3, rough:0.4,
        purpose:"The huge lower tank holds liquid hydrogen, the fuel. Hydrogen is the lightest gas of all, so it must be chilled to an incredible cold to squeeze it into a liquid. It fills most of the tank." },
      { id:"et-lox", stage:"et", label:"Oxygen Tank", kind:"internal", shape:"cyl", r:3.6, h:8, yFrac:0.82, caps:"both", color:0x3f92d2, metal:0.3, rough:0.4,
        purpose:"The smaller tank up in the nose holds liquid oxygen. Oxygen is heavy, so its tank is short. It sits up high so its weight helps balance the tall tank as the fuel drains away." },
      { id:"et-inter", stage:"et", label:"Intertank", kind:"internal", shape:"disc", r:3.6, yFrac:0.62, color:0xc4ccd8, metal:0.6, rough:0.5,
        purpose:"The ring of structure between the two tanks. It takes the push from the side boosters and spreads it into the tank walls without crushing them." },
      { id:"et-feed", stage:"et", label:"Oxygen Feedline", kind:"internal", shape:"feedline", r:0.26, y0:0.04, y1:0.76, off:3.9, color:0x3f92d2, metal:0.5, rough:0.4,
        purpose:"A wide pipe that carries liquid oxygen from the tank in the nose all the way down the outside of the tank to the orbiter's engines at the base. The tank has no engines of its own, so both propellants pipe across into the orbiter." },
      // ---- Solid rocket boosters (stage "srb"): four-segment, recoverable cutaway ----
      { id:"srb", stage:"srb", label:"Solid Rocket Boosters (x2)", kind:"srb", count:2, r:1.85, h:45, segments:4, color:WHITE, angle:90, grainColor:0x7d6b4a,
        purpose:"Two four segment solid rocket boosters, packed with rubbery solid fuel that cannot be shut off once lit. Together they gave most of the liftoff punch for two minutes. Unlike a throwaway booster, these parachuted into the sea and were fished out to fly again. Click to see inside.",
        grain:{ label:"Solid Propellant (APCP)", purpose:"The fuel is a rubbery block cast around a hollow channel down the middle. It burns from that channel outward to the wall. The star shaped opening up top burns fast for a strong liftoff, then eases off through the roughest air. Once lit it cannot be shut off or throttled." },
        nozzle:{ label:"Gimbaling Nozzle", purpose:"The bell at the base swivels up to eight degrees to steer the whole stack during the climb. It sits partly tucked up inside the booster to save length." },
        joints:{ label:"Field Joints", purpose:"The booster is built from four steel segments stacked and pinned together, each joint sealed by rubber O-rings. A seal failing in the cold caused the Challenger accident in 1986, and the joints were redesigned to be far safer afterward." },
        recovery:{ label:"Parachute Pack", purpose:"Tucked in the nose is the recovery gear: a small drogue chute followed by three huge main parachutes. They lowered the empty booster gently into the ocean, where ships towed it back to be refuelled and flown again." } },
      // ---- Orbiter (stage "orb") ----
      { id:"orb", stage:"orb", label:"Orbiter", kind:"orbiter", color:0xeef1f6,
        purpose:"The winged spaceplane that carried the crew and cargo. It launched like a rocket, worked in orbit like a spacecraft, and landed on a runway like a glider. Click to open the payload bay.",
        engines:{ label:"Main Engines (x3)", purpose:"Three RS-25 engines on the orbiter's tail. They drank hydrogen and oxygen piped over from the big tank, because the tank has no engines of its own. They were so good they now fly again on the SLS Moon rocket." },
        payload:{ color:0xcaa94a, label:"Payload (Satellite)", purpose:"The long bay behind the crew cabin carried the cargo: satellites, telescopes, even whole Space Station modules. The doors opened in orbit and a robot arm lifted the payload out." } }
    ]
  }
];

// make available to main.js
window.ROCKETS = ROCKETS;
