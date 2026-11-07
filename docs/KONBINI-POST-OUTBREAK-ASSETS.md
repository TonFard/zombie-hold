# Post-Outbreak Konbini Asset Plan

## Scope and visual target

Build one scene: a Japanese neighborhood convenience store after an outbreak. The target is the exterior/interior composition in the supplied reference: a low, wide glass-fronted store, a faded blue-and-yellow fascia, a wet damaged forecourt, scattered debris, utility lines, and bicycles. The scene represents the abandoned aftermath only; there is no intact/pre-outbreak variant. Cars and trucks are out of scope. Road signs are in scope and should be modeled early.

Use meters and real-world scale. The dimensions below are starting targets for blockout; adjust as a group if the existing camera composition requires it. Keep each logical asset in a named collection and use separate meshes for moving parts, replaceable goods, and decals.

## Asset inventory

| Priority | Asset | Starting dimensions / parts | Surface and aftermath treatment | Interaction / placement |
| --- | --- | --- | --- | --- |
| P0 | Store shell and canopy | 13.0 m wide × 9.0 m deep × 3.4 m to roof (x −6.5…6.5, y −4.5…4.5); rear/left/right walls, front piers, lintel, roof deck, parapet, canopy slab + fascia | Concrete, painted metal, aged sealant, dust, water streaks; chipped fascia and a few bent trim pieces | Fixed building. The front wall is **built as piers + a lintel**, so the glazing bays and the sliding door sit in real openings instead of being covered by a solid slab. Wall, window, and door openings are gaps in the shell, never overlapping wall slabs. |
| P0 | Front glazing and sliding entrance | Opening 2.6 m wide × 2.72 m high; two glass leaves on a top rail and a bottom guide track, jambs, head track, handles and stops | Dirty safety glass, cracked/broken panes, tarnished aluminium; blood and hand marks as surface-conforming decals | Each leaf slides along its own track. Stops limit travel to the clear opening; leaves cannot pass through jambs or each other. Broken panes leave visible openings with shard pieces seated at frame edges. |
| P0 | Shelving / gondola | Modular bay 1.02 m wide × 0.42 m deep × 1.62 m high, 5 tiers at 0.34 m pitch; 4 uprights on feet, back panel, decks, price rails, top board, category strip | Powder-coated steel, scratched shelf lips, dusty perforated panels; a few shelves bent or empty | Bays are authored in their own local frame and placed by transform, so the deck always spans **exactly between the uprights' inner faces** and the back panel closes the rear plane — no part is buried in another. Modular bays join side-by-side at upright boundaries. Shelf stock rests on shelves; loose goods settle to the floor. |
| P0 | Drinks cooler | 4.0 m wide × 0.70 m deep × 2.05 m high (x −0.70…3.30, y 3.55…4.25); plinth, carcass back/top/bottom, side panels, interior back, 5 shelves, 4 glass doors, handles | Aged white enamel, rubber gasket, reflective dirty glass, weak interior light, condensation | Hinged doors rotate from frame-mounted hinges and stop before shelves or adjacent fixtures. Cooler goods sit on shelf surfaces and remain behind the glass. |
| P0 | Doorway / blood and grime decal set | Hand smears, narrow streaks, shoe transfers, dust, water runnels, tape residue | Separate alpha materials or projected textures; include dark dried and diluted red-brown variants | Decals must follow the receiving surface and be offset only enough to avoid z-fighting (about 1.5 mm); do not float as free-standing cards. Place blood where a person could reach or drag against the door/wall. |
| P0 | Road and forecourt | Street corner composition: front road along y = −11, side street from x = 12.5; asphalt slabs, corner kerb, kerb gutter with 7 drain grates, sidewalk, tactile paving, road markings, repair patches, puddles | Wet asphalt, patched cracks, puddles, mud, leaves, glass, paper and small rubble | Walkable surface with shallow puddles embedded in the asphalt material/mesh. The kerb, gutter and pavement are **separate slabs that butt against each other**; the gutter is a real channel cut out of the asphalt run rather than a strip laid over it. No stacked full-area surfaces. |
| P0 | Road signs | Guide board 3.6 m long on two galvanised posts with concrete base blocks; blue one-way plate; round plate on a post; blue name plate | Galvanised steel, faded enamel, rust around fasteners, dirt on lower faces | Separate pole, base block and plate: the post **stands on** its base block rather than passing through it. Place near curb/entrance without blocking the door or main walking path. Japanese road/parking markings are real geometry. |
| P1 | Utility pole and overhead cables | Pole 8.4 m visible height; base block, crossarm, insulators, transformer, junction box; three sagging 32 mm cables | Weathered concrete/wood, ceramic insulators, rusted fittings, sagging dark cable | Pole base seats on the sidewalk; the shaft starts at the top of the base. Cables terminate at insulators and sag with a catenary curve; never intersect the store roof. |
| P1 | Bicycle and rack | Bicycle approx. 1.7 m × 0.55 m × 1.05 m; frame tubes, fork, two wheels, saddle, handlebar, chain/cranks, kickstand; rack 1.8 m long | Scraped painted steel, rubber tyres, oxidised chain, faded basket/plastic | Wheel/tyre contact patches rest on pavement. Kickstand or rack supports the frame. Keep moving wheel meshes separate from the frame and avoid wheel/frame intersections. One tipped bicycle can lie against the rack with believable support points. |
| P1 | Drinks | Reusable can, slim can, PET bottle and glass bottle base meshes; typical heights 0.12–0.30 m | Aluminium, PET/glass, printed label variants, dents, missing caps and residue | Distinct instances placed upright on shelves or rolling/lying on ground. Labels are material variants, not extra overlapping geometry. |
| P1 | Snacks and convenience food | Chip bag, small pouch, cup noodle, bento tray, onigiri pack, cardboard snack box; roughly 0.08–0.28 m | Crinkled film, printed paper/plastic, transparent lids, dried food stains | Stock sits within shelf bounds; abandoned items may scatter on floor but must rest on the pavement and avoid floating. Use a small set of meshes with varied rotations and label materials. |
| P1 | Checkout and interior fixtures | Checkout counter 2.3 m × 0.65 m × 0.88 m (x 3.05…5.35, y −3.85…−3.20), POS register, scanner, counter display stand, 3 impulse-goods racks, 3 wall baskets, magazine rack | Laminated board, brushed metal, dusty plastic, cracked screen | Counter feet contact floor. Register and accessories sit on the counter top; display pieces remain within their supports. Keep clear paths from entrance into the store. |
| P1 | Debris and abandonment props | Collapsed cartons, plastic floor crates, shopping basket, fallen shelf stock, traffic cone, guardrail, litter bin, notice board, vending machine, AC outdoor unit | Damp cardboard, dirty plastic, concrete dust, leaves and paper | Each prop has a ground contact point or visibly rests against another prop. Do not use coincident/duplicated surfaces to imply debris piles. |
| P2 | Interior wall/ceiling details | Ceiling slab, 15 fluorescent housings + tubes, emergency exit sign, storage lockers with vents, back-of-house door | Yellowed plastic, dusty metal, occasional flicker/emergency glow | Mount to walls/ceiling with visible brackets or direct face contact. Conceal wiring along believable routes. No pre-outbreak alternate state. |

## Interior layout (matches the supplied blueprint plan)

The store reads as a full konbini rather than a warehouse. The plan is:

| Run | Bays | Position | Notes |
| --- | --- | --- | --- |
| Left wall shelving | 7 | x = −6.09, y = −3.30 … 3.00, rotated 90° | Back panel faces the wall, product faces the aisle; back stops 20 mm clear of the wall face |
| Centre island (back-to-back) | 7 × 2 | x = −2.55 ± 0.21, y = −3.10 … 3.20 | Two mirrored modules whose back panels meet on the centre line, each showing product to its own aisle |
| Right-of-aisle run | 5 | x = 1.55, y = −3.30 … 0.90 | Faces the main aisle in front of the cooler |
| Right wall run | 3 | x = 6.09, y = 0.60 … 2.80 | Behind the cooler, facing the shop |
| Back wall dry-goods run | 3 | x = −4.00 … −1.80, y = 4.09 | Snack and dry goods along the rear |

Every tier carries a **facing row plus a back-up row** of product, which is what makes a real konbini shelf look full rather than like a display row. Roughly 10 % of slots are deliberately left empty to read as "somebody cleared this out".

## Modeling and assembly rules

1. Establish a shared coordinate plan before detailing: floor at Z=0, storefront facing the forecourt, all dimensions in meters, and pivots at useful physical points (hinge axis, wheel axle, sliding-door center, pole base).
2. Build openings into parent walls. Do not put a full wall behind a window, glass door, or doorway and then cover it with another object.
3. At joins, use explicit mating faces and small manufacturing clearance where parts move. Static surfaces should meet edge-to-edge or face-to-face; do not bury one full part inside another. Avoid coplanar duplicate faces that cause flicker. The build is audited automatically: `scripts/tools/konbini_scene/audit.py` shrinks every polygon by 1.5 mm along its own normal and runs a triangle-level BVH intersection test, so parts that merely *touch* are not reported while genuine interpenetration is.
4. Moving pieces need collision bounds and travel limits. Test sliding panels at fully open, half open, and closed; test cooler doors through their entire swing. Door leaves must not pass through jambs, glass, goods, or one another.
5. Keep decals on the target surface. Use UV/decal projection or conforming geometry with a minimal anti-z-fighting offset. Blood, dirt, and wet marks must not hover in front of the door, shelf, or ground.
6. Put goods on actual support surfaces and use gravity/contact logic for loose items. For bicycles and signs, model the support condition (tires/kickstand/rack and pole base) rather than balancing parts visually without contact.
7. Use real material response: roughness variation, subtle normal/bump detail, edge wear, and restrained reflections. Avoid uniformly glossy/plastic surfaces and avoid relying on color alone for realism.

## Review modes and delivery checkpoints

- **White model:** a dedicated neutral clay material mode that preserves object boundaries, silhouettes, and shadows. Use it to catch intersections, hovering decals, implausible contacts, and door travel before texturing.
- **Lighting preview:** keep a separate lighting setup/preset so white-model geometry can be reviewed under the intended moody overcast/dusk lighting without changing asset materials.
- **Textured render:** add aged materials and damage only after the white model passes. Check the storefront from the reference camera and inspect the door, shelf joins, bicycle supports, road-sign mounts, and ground contacts at close range.
- Export the approved Blender scene and runtime asset with stable object names; keep the post-outbreak scene as the only playable/rendered state.

## First delivery in this pass

The initial modeled package is generated by `scripts/tools/konbini_post_outbreak.py` and is exported as:

- `public/konbini/post-outbreak.glb` — the runtime scene, with no vehicles.
- `assets/blender/konbini-post-outbreak.blend` — editable source scene.
- `assets/blender/konbini-post-outbreak-white.png` — neutral clay review.
- `assets/blender/konbini-post-outbreak-lit.png` — post-outbreak material and lighting review.
- `assets/blender/konbini-post-outbreak-entrance.png` — the shop front from the pavement.
- `assets/blender/konbini-post-outbreak-interior.png` — the aisle between the left wall run and the centre island.
- `assets/blender/konbini-post-outbreak-plan.png` — orthographic plan used to check the layout against the blueprint.
- `assets/blender/konbini-post-outbreak-keyvisual.png` — reference key visual produced with the `image2-imagegen` skill from the Blender render.
- `assets/blender/konbini-post-outbreak-threeview.png` — technical three-view sheet produced with the `image2-imagegen` skill from the plan render.

The two sliding leaves are named `Door_Left_Panel` and `Door_Right_Panel`. Their `closed_x` and `open_x` metadata drive the preview's bounded opening motion, and the attached blood stains travel with their respective leaves. The page at `konbini.html` loads this package directly and exposes 灯光 / 白模 / 开门 / 自动旋转 review controls.

## Assembly audit

`scripts/tools/konbini_scene/audit.py` runs inside Blender after every build and writes its report to `.logs/konbini-audit.log`.

How it works: every polygon is pulled in by 1.5 mm along its own normal, the result is turned into a world-space `BVHTree`, and every candidate pair is tested with a real triangle-level intersection query. Pulling the surfaces in is what makes the test distinguish *touching* from *interpenetrating*: two panels that meet face to face no longer intersect once both have been shrunk, so they are not reported. A small allowlist covers the handful of joints that genuinely overlap by design (a rail welded into a post, a pole socketed into its base).

The current build reports **0 overlaps beyond the 4 mm assembly clearance** across 933 checked objects.
