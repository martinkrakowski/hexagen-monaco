/**
 * Layout configuration constants for hexagonal context map generation.
 *
 * All pixel values are canvas-coordinate-space. The `_OFFSET` constants
 * are relative to the hexagon center; absolute positions are computed
 * in the generators by combining these with context-specific base coords.
 *
 * Extracted from inline magic numbers to make visual tuning easier —
 * every position in the hexagonal layout routes through one of these
 * constants.
 */
export const LAYOUT_CONFIG = {
  // Viewport center (canvas coordinates)
  CENTER_X: 400,
  CENTER_Y: 300,

  // Group (monorepo boundary) dimensions
  GROUP_SPACING: 1500,
  GROUP_MIN_WIDTH: 1400,
  GROUP_HEIGHT: 2200,

  // Hexagon dimensions
  ROOT_HEX_DIMENSION: 500,
  SATELLITE_HEX_DIMENSION: 360,

  // Position offsets (relative to hex center)
  HEX_POSITION_OFFSET_X: -300,
  HEX_POSITION_OFFSET_Y: -260,

  // Inner node positions (inside root hexagon - 500px)
  DOMAIN_NODE_X: 110,
  DOMAIN_NODE_Y: 340,
  USECASES_NODE_X: 275,
  USECASES_NODE_Y: 340,

  // Satellite/peer hexagon inner node positions (360px hex)
  SATELLITE_DOMAIN_X: 100,
  SATELLITE_DOMAIN_Y: 280,
  SATELLITE_USECASES_X: 290,
  SATELLITE_USECASES_Y: 280,

  // Entity satellites positioning (root hex)
  ENTITY_ROW_HEIGHT: 120,
  ENTITY_START_X: -170,
  ENTITY_START_Y: 750,

  // Entity satellites positioning (satellite hex)
  SATELLITE_ENTITY_START_X: -220,
  SATELLITE_ENTITY_START_Y: 900,

  // Use case satellites positioning (root hex)
  USECASE_ROW_HEIGHT: 120,
  USECASE_X_OFFSET: -20,
  USECASE_START_Y: 750,

  // Use case satellites positioning (satellite hex)
  SATELLITE_USECASE_X_OFFSET: -20,
  SATELLITE_USECASE_START_Y: 900,

  // Adapter positions (north/south of hex)
  NORTH_OFFSET_BASE: 280,
  NORTH_OFFSET_STEP: 120,
  SOUTH_OFFSET_BASE: 600,
  SOUTH_OFFSET_ADDITIONAL: 80,
  SOUTH_OFFSET_STEP: 120,

  // Adapter label X positions — split by side to avoid overlap
  NORTH_ADAPTER_X_OFFSET: 330,
  SOUTH_ADAPTER_X_OFFSET: 460,

  // Port satellites (west/east driving/driven)
  WEST_PORT_OFFSET_X: -480,
  EAST_PORT_OFFSET_X: 775,
  PORT_OFFSET_BASE_Y: -40,
  PORT_OFFSET_STEP_Y: 100,

  // External peer positioning
  PEER_OFFSET_LEFT: -400,
  PEER_OFFSET_RIGHT: 100,
  PEER_Y_STEP: 300,
} as const;

/**
 * Y-axis stagger for bounded-context hexagons so edges don't overlap.
 * Pattern: index 0 → 0, then alternating +150 / -150 for 1, 2, 3, 4...
 * Extracted as a small helper so callers read intent instead of
 * deciphering the index-based ternary.
 */
export function staggerYFor(index: number): number {
  if (index === 0) return 0;
  return index % 2 === 0 ? 150 : -150;
}
