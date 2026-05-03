/**
 * SVG compass labels (north, south, east, west) for hexagon visualization
 */
export function HexagonCompassLabels() {
  return (
    <g className="fill-muted-foreground">
      <text
        x="50"
        y="-3"
        textAnchor="middle"
        fontSize="4"
        fontFamily="monospace"
        letterSpacing="0.8"
        fontWeight="700"
      >
        APIs
      </text>
      <text
        x="50"
        y="104"
        textAnchor="middle"
        fontSize="4"
        fontFamily="monospace"
        letterSpacing="0.8"
        fontWeight="700"
      >
        EXTERNAL INTEGRATIONS
      </text>
      <text
        x="-2"
        y="52"
        textAnchor="end"
        fontSize="4"
        fontFamily="monospace"
        letterSpacing="0.8"
        fontWeight="700"
      >
        PRESENTATION
      </text>
      <text
        x="108"
        y="52"
        textAnchor="start"
        fontSize="4"
        fontFamily="monospace"
        letterSpacing="0.8"
        fontWeight="700"
      >
        STATE &amp; STORAGE
      </text>
    </g>
  );
}
