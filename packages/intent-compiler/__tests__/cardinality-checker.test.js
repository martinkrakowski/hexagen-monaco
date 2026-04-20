const { CardinalityChecker } = require('../../src/cardinality-checker');

describe('CardinalityChecker', () => {
  let checker;

  beforeEach(() => {
    checker = new CardinalityChecker();
  });

  describe('check()', () => {
    it('should return valid result for empty AST', () => {
      const ast = {
        nodes: [],
        edges: [],
        invariants: {
          topology: [],
          cardinality: []
        }
      };

      const result = checker.check(ast);

      expect(result.valid).toBe(true);
      expect(result.violations).toEqual([]);
    });

    it('should detect Exactly invariant violation', () => {
      const ast = {
        nodes: [
          { id: 'node1', kind: 'TestNode', attributes: {} },
          { id: 'node2', kind: 'TestNode', attributes: {} }
        ], // 2 nodes but expecting exactly 1
        edges: [],
        invariants: {
          topology: [],
          cardinality: [
            {
              type: 'Exactly',
              payload: {
                nodeKind: 'TestNode',
                count: 1
              }
            }
          ]
        }
      };

      const result = checker.check(ast);

      expect(result.valid).toBe(false);
      expect(result.violations.length).toBe(1);
      expect(result.violations[0].type).toBe('Exactly');
      expect(result.violations[0].payload.nodeKind).toBe('TestNode');
      expect(result.violations[0].payload.count).toBe(1);
    });

    it('should detect AtLeast invariant violation', () => {
      const ast = {
        nodes: [
          { id: 'node1', kind: 'TestNode', attributes: {} }
        ], // 1 node but expecting at least 2
        edges: [],
        invariants: {
          topology: [],
          cardinality: [
            {
              type: 'AtLeast',
              payload: {
                nodeKind: 'TestNode',
                count: 2
              }
            }
          ]
        }
      };

      const result = checker.check(ast);

      expect(result.valid).toBe(false);
      expect(result.violations.length).toBe(1);
      expect(result.violations[0].type).toBe('AtLeast');
      expect(result.violations[0].payload.nodeKind).toBe('TestNode');
      expect(result.violations[0].payload.count).toBe(2);
    });

    it('should detect AtMost invariant violation', () => {
      const ast = {
        nodes: [
          { id: 'node1', kind: 'TestNode', attributes: {} },
          { id: 'node2', kind: 'TestNode', attributes: {} },
          { id: 'node3', kind: 'TestNode', attributes: {} }
        ], // 3 nodes but expecting at most 2
        edges: [],
        invariants: {
          topology: [],
          cardinality: [
            {
              type: 'AtMost',
              payload: {
                nodeKind: 'TestNode',
                count: 2
              }
            }
          ]
        }
      };

      const result = checker.check(ast);

      expect(result.valid).toBe(false);
      expect(result.violations.length).toBe(1);
      expect(result.violations[0].type).toBe('AtMost');
      expect(result.violations[0].payload.nodeKind).toBe('TestNode');
      expect(result.violations[0].payload.count).toBe(2);
    });

    it('should detect Between invariant violation', () => {
      const ast = {
        nodes: [
          { id: 'node1', kind: 'TestNode', attributes: {} }
        ], // 1 node but expecting between 2-4
        edges: [],
        invariants: {
          topology: [],
          cardinality: [
            {
              type: 'Between',
              payload: {
                nodeKind: 'TestNode',
                min: 2,
                max: 4
              }
            }
          ]
        }
      };

      const result = checker.check(ast);

      expect(result.valid).toBe(false);
      expect(result.violations.length).toBe(1);
      expect(result.violations[0].type).toBe('Between');
      expect(result.violations[0].payload.nodeKind).toBe('TestNode');
      expect(result.violations[0].payload.min).toBe(2);
      expect(result.violations[0].payload.max).toBe(4);
    });

    it('should return valid result when all invariants are satisfied', () => {
      const ast = {
        nodes: [
          { id: 'node1', kind: 'TestNode', attributes: {} },
          { id: 'node2', kind: 'TestNode', attributes: {} }
        ], // Exactly 2 nodes
        edges: [],
        invariants: {
          topology: [],
          cardinality: [
            {
              type: 'Exactly',
              payload: {
                nodeKind: 'TestNode',
                count: 2
              }
            },
            {
              type: 'AtLeast',
              payload: {
                nodeKind: 'TestNode',
                count: 1
              }
            },
            {
              type: 'AtMost',
              payload: {
                nodeKind: 'TestNode',
                count: 3
              }
            },
            {
              type: 'Between',
              payload: {
                nodeKind: 'TestNode',
                min: 1,
                max: 3
              }
            }
          ]
        }
      };

      const result = checker.check(ast);

      expect(result.valid).toBe(true);
      expect(result.violations).toEqual([]);
    });
  });
});