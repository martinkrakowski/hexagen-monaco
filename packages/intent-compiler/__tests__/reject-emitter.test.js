const { RejectEmitter } = require('../../src/reject-emitter');

describe('RejectEmitter', () => {
  let emitter;

  beforeEach(() => {
    emitter = new RejectEmitter();
  });

  describe('emit()', () => {
    it('should create a rejection with generated ID', () => {
      const rejection = emitter.emit('Test reason');

      expect(rejection.id).toBeDefined();
      expect(typeof rejection.id).toBe('string');
      expect(rejection.reason).toBe('Test reason');
      expect(rejection.severity).toBe('error');
    });

    it('should create a rejection with custom severity', () => {
      const rejection = emitter.emit('Test reason', 'warning');

      expect(rejection.severity).toBe('warning');
    });

    it('should create a rejection with gestureId', () => {
      const gestureId = 'test-gesture-id';
      const rejection = emitter.emit('Test reason', 'error', gestureId);

      expect(rejection.gestureId).toBe(gestureId);
    });
  });
});