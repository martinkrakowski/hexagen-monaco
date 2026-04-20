const { TopologyChecker } = require('../../src/topology-checker');

describe('TopologyChecker', () => {
  let checker;

  beforeEach(() => {
    checker = new TopologyChecker();
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

    it('should detect self-loop edge as invalid', () => {
      const ast = {
        nodes: [{ id: 'node1', kind: 'TestNode', attributes: {} }],
        edges: [{ id: 'edge1', kind: 'TestEdge', source: 'node1', target: 'node1', attributes: {} }],
        invariants: {
          topology: [],
          cardinality: []
        }
      };

      const result = checker.check(ast);

      expect(result.valid).toBe(false);
      expect(result.violations.length).toBe(1);
      expect(result.violations[0].type).toBe('Acyclic');
      expect(result.violations[0].payload.appliesTo).toContain('TestEdge');
    });

    it('should detect disconnected nodes as invalid', () => {
      const ast = {
        nodes: [
          { id: 'node1', kind: 'TestNode', attributes: {} },
          { id: 'node2', kind: 'TestNode', attributes: {} }
        ],
        edges: [], // No edges connecting the nodes
        invariants: {
          topology: [],
          cardinality: []
        }
      };

      const result = checker.check(ast);

      expect(result.valid).toBe(false);
      expect(result.violations.length).toBe(1);
      expect(result.violations[0].type).toBe('Connected');
    });

    it('should return valid result for properly connected graph', () => {
      const ast = {
        nodes: [
          { id: 'node1', kind: 'TestNode', attributes: {} },
          { id: 'node2', kind: 'TestNode', attributes: {} }
        ],
        edges: [{ id: 'edge1', kind: 'TestEdge', source: 'node1', target: 'node2', attributes: {} }],
        invariants: {
          topology: [],
          cardinality: []
        }
      };

      const result = checker.check(ast);

      expect(result.valid).toBe(true);
      expect(result.violations).toEqual([]);
    });
  });
});