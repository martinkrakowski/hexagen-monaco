/**
 * Active editor window the grounded prompt is built against.
 */
export interface EditorState {
  filename: string;
  language: string;
  content: string;
  lineStart: number;
  lineEnd: number;
}
