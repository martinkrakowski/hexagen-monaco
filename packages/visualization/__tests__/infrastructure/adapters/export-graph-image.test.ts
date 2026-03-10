// Minimal test suite for IExportGraphImagePort in the visualization package.
import assert from 'node:assert';
import { FakeExportGraphImagePort } from '../../doubles/ports/export-graph-image.fake';

(async () => {
  // Default behavior – echo input
  const defaultFake = new FakeExportGraphImagePort();
  const input = { foo: 'bar' };
  const result = await defaultFake.execute(input);
  assert.deepStrictEqual(result, input, 'Default fake should return the input unchanged');

  // Custom behavior – transform the input
  const customFake = new FakeExportGraphImagePort();
  customFake.setBehavior(async (data) => ({ transformed: true, original: data }));
  const customInput = { baz: 42 };
  const customResult = await customFake.execute(customInput);
  assert.deepStrictEqual(customResult, { transformed: true, original: customInput }, 'Custom behavior should transform the input');

  console.log('✅ All IExportGraphImagePort tests passed.');
})();
