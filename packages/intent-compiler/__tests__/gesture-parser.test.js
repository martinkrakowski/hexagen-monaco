const { GestureParser } = require('../../src/gesture-parser');

// Mock data for testing
const testGesture = {
  id: 'test-gesture-1',
  type: 'TAP',
  payload: { x: 100, y: 200 }
};

describe('GestureParser', () => {
  let parser;

  beforeEach(() => {
    parser = new GestureParser();
  });

  describe('parse()', () => {
    it('should return a ParsedGesture with the input gesture', () => {
      const result = parser.parse(testGesture);

      expect(result.gesture).toBe(testGesture);
    });

    it('should return a ParsedGesture with a DomainAST', () => {
      const result = parser.parse(testGesture);

      expect(result.ast).toBeDefined();
      expect(result.ast.nodes).toEqual([]);
      expect(result.ast.edges).toEqual([]);
      expect(result.ast.invariants).toBeDefined();
      expect(result.ast.invariants.topology).toEqual([]);
      expect(result.ast.invariants.cardinality).toEqual([]);
    });

    it('should return a ParsedGesture with a confidence score', () => {
      const result = parser.parse(testGesture);

      expect(result.confidence).toBe(0.8);
    });
  });
});