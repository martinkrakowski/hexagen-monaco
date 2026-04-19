export interface MessageRendererProps {
  /** Raw Markdown string from AI response */
  content: string;

  /** Optional: override default prose size (responsive) */
  size?: "sm" | "base" | "lg";

  /** Optional: custom wrapper className (e.g., max-w limits, padding) */
  className?: string;

  /** Optional: theme override (respects parent context if not provided) */
  theme?: "light" | "dark" | "auto";

  /** Optional: callback when parsing fails gracefully */
  onRenderError?: (error: Error) => void;
}

export interface FormattedNode {
  /** Parsed React node tree (from react-markdown) */
  nodes: React.ReactNode;
  /** Metadata about the render (character count, has_code_blocks, etc.) */
  metadata: {
    characterCount: number;
    hasCodeBlocks: boolean;
    hasImages: boolean;
    renderTime: number;
  };
}
