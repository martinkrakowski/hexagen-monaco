export const LAYOUT_CONFIG = {
  CENTER_X: 400,
  CENTER_Y: 300,

  GROUP_SPACING: 1500,
  GROUP_MIN_WIDTH: 1400,
  GROUP_HEIGHT: 2200,

  ROOT_HEX_DIMENSION: 500,
  SATELLITE_HEX_DIMENSION: 360,

  HEX_POSITION_OFFSET_X: -300,
  HEX_POSITION_OFFSET_Y: -260,

  // Domain / UseCases column labels live INSIDE the hex, in the bottom half
  // of the FULL-WIDTH band (y=137.5 to y=362.5 for a 500x500 hex — see the
  // hexagon polygon points="50,5 95,27.5 95,72.5 50,95 5,72.5 5,27.5" in
  // BoundedContext.tsx). Below y=362.5 the hex tapers to a point; labels
  // placed there appear visually outside the hex shape even though they are
  // inside the bounding square. Positions are relative to the hex's top-left.
  //   west column center x = 125  -> label x = 125 - 70 = 55
  //   east column center x = 375  -> label x = 375 - 70 = 305
  //   bottom band y         = 340 (just above the y=362.5 taper line)
  DOMAIN_NODE_X: 55,
  DOMAIN_NODE_Y: 340,
  USECASES_NODE_X: 305,
  USECASES_NODE_Y: 340,

  // Satellite hexes are smaller (360x360). Same two-column layout, scaled.
  SATELLITE_DOMAIN_X: 30,
  SATELLITE_DOMAIN_Y: 240,
  SATELLITE_USECASES_X: 190,
  SATELLITE_USECASES_Y: 240,

  // Entity / UseCase cards are root-level nodes (no parentId) rendered south of
  // the bounded context, below the south-adapter stack. They stack vertically
  // in two columns spread wide enough that each column's edge-drop from
  // Domain / UseCases lands cleanly on the card's north handle:
  //   entity column:   hexX - 60 .. hexX + 120   (card width 180, center x=30)
  //   usecase column:  hexX + 380 .. hexX + 560 (card width 180, center x=470)
  // The widened x separation mirrors the user's hexagonal-architecture
  // guidance: driving (west-ish) and driven (east-ish) side children occupy
  // opposite halves of the canvas south of the hex.
  ENTITY_ROW_HEIGHT: 120,
  ENTITY_START_X: -60,
  ENTITY_START_Y: 1160, // hexY + 1160 -> first card at y=1160, ~48px below last south adapter at y=1112 (see SOUTH_OFFSET_BASE below)

  SATELLITE_ENTITY_START_X: -60,
  SATELLITE_ENTITY_START_Y: 980,

  USECASE_ROW_HEIGHT: 120,
  USECASE_X_OFFSET: 380,
  USECASE_START_Y: 960,

  SATELLITE_USECASE_X_OFFSET: 280,
  SATELLITE_USECASE_START_Y: 780,

  NORTH_OFFSET_BASE: 280,
  NORTH_OFFSET_STEP: 120,
  // Increased from 400 to push south-adapter stack further from hex bottom.
  // With 3 adapters at step 180:
  //   adapter 0: hexY + (600+80)          = hexY + 680  (spans [680, 752])
  //   adapter 2: hexY + (600+80+2*180)    = hexY + 1040 (spans [1040, 1112])
  //   entity 0:  hexY + 1160              gap = 48px
  SOUTH_OFFSET_BASE: 600,
  SOUTH_OFFSET_ADDITIONAL: 80,
  SOUTH_OFFSET_STEP: 180,

  // Default dimensions for adapter nodes (matches useElkLayout default)
  ADAPTER_NODE_WIDTH: 180,

  WEST_PORT_OFFSET_X: -550, // Increased from -480 to push further out
  EAST_PORT_OFFSET_X: 845, // Increased from 775 to push further out
  PORT_OFFSET_BASE_Y: -40,
  PORT_OFFSET_STEP_Y: 100,

  PEER_OFFSET_LEFT: -400,
  PEER_OFFSET_RIGHT: 100,
  PEER_Y_STEP: 300,
} as const;

export function staggerYFor(index: number): number {
  if (index === 0) return 0;
  return index % 2 === 0 ? 150 : -150;
}
