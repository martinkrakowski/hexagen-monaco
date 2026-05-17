import { test } from 'node:test';
import assert from 'node:assert';
import { useStagedGenerationStream } from '../useStagedGenerationStream';
import { renderHook, act } from '@testing-library/react-hooks/pure';

const originalFetch = global.fetch;

function createMockReadableStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < lines.length) {
        controller.enqueue(encoder.encode(lines[index] + '\n'));
        index++;
      } else {
        controller.close();
      }
    }
  });
}

function mockFetchWithSSE(responseLines: string[], status = 200) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    body: createMockReadableStream(responseLines),
  }) as unknown as Response;
}

test('parses stage-start event', async () => {
  const lines = ['{"type":"stage-start","stage":0,"label":"Context Extraction"}'];
  global.fetch = mockFetchWithSSE(lines);

  try {
    const { result } = renderHook(() => 
      useStagedGenerationStream({ endpoint: '/api/test', stageLabels: { 0: 'Context Extraction' } })
    );
    let generateResult: Awaited<ReturnType<typeof result.current.generate>> | undefined;
    
    await act(async () => {
      generateResult = await result.current.generate({ description: 'test' });
    });

    assert.strictEqual(generateResult?.phase, 'stage-0');
    assert.strictEqual(generateResult?.stepDetail, 'Context Extraction...');
  } finally {
    global.fetch = originalFetch;
  }
});

test('parses done event with manifest', async () => {
  const lines = ['{"type":"done","yaml":"test-manifest","contextCount":2,"portCount":3,"adapterCount":1}'];
  global.fetch = mockFetchWithSSE(lines);

  try {
    const { result } = renderHook(() => 
      useStagedGenerationStream({ endpoint: '/api/test', stageLabels: {} })
    );
    let generateResult: Awaited<ReturnType<typeof result.current.generate>> | undefined;

    await act(async () => {
      generateResult = await result.current.generate({ description: 'test' });
    });

    assert.strictEqual(generateResult?.phase, 'complete');
    assert.strictEqual(generateResult?.generatedManifest, 'test-manifest');
    assert.strictEqual(generateResult?.contextCount, 2);
    assert.strictEqual(generateResult?.portCount, 3);
    assert.strictEqual(generateResult?.adapterCount, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('handles SSE error event', async () => {
  const lines = ['{"type":"error","message":"LLM generation failed"}'];
  global.fetch = mockFetchWithSSE(lines);

  try {
    const { result } = renderHook(() => 
      useStagedGenerationStream({ endpoint: '/api/test', stageLabels: {} })
    );
    let generateResult: Awaited<ReturnType<typeof result.current.generate>> | undefined;

    await act(async () => {
      generateResult = await result.current.generate({ description: 'test' });
    });

    assert.strictEqual(generateResult?.phase, 'failed');
    assert.match(generateResult?.stepDetail || '', /LLM generation failed/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('handles HTTP error response', async () => {
  global.fetch = async () => ({
    ok: false,
    status: 500,
    text: async () => 'Internal Server Error',
  }) as unknown as Response;

  try {
    const { result } = renderHook(() => 
      useStagedGenerationStream({ endpoint: '/api/test', stageLabels: {} })
    );
    let generateResult: Awaited<ReturnType<typeof result.current.generate>> | undefined;

    await act(async () => {
      generateResult = await result.current.generate({ description: 'test' });
    });

    assert.strictEqual(generateResult?.phase, 'failed');
    assert.match(generateResult?.stepDetail || '', /Internal Server Error/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('aborts stream on cancel', async () => {
  const stream = new ReadableStream({
    start() { /* Keep stream open */ }
  });
  global.fetch = async () => ({ ok: true, body: stream }) as unknown as Response;

  try {
    const { result } = renderHook(() => 
      useStagedGenerationStream({ endpoint: '/api/test', stageLabels: {} })
    );
    let generatePromise: Promise<Awaited<ReturnType<typeof result.current.generate>>>;
    
    act(() => {
      generatePromise = result.current.generate({ description: 'test' });
    });
    act(() => result.current.cancel());

    const generateResult = await generatePromise!;
    assert.strictEqual(generateResult.phase, 'idle');
  } finally {
    global.fetch = originalFetch;
  }
});

test('attempts reconnection on reader error', async () => {
  let fetchCount = 0;

  global.fetch = async () => {
    fetchCount++;
    if (fetchCount === 1) {
      return {
        ok: true,
        body: new ReadableStream({
          pull() { throw new Error('Connection lost'); }
        })
      } as unknown as Response;
    }
    return {
      ok: true,
      body: createMockReadableStream(['{"type":"done","yaml":"test"}'])
    } as unknown as Response;
  };

  try {
    const { result } = renderHook(() => 
      useStagedGenerationStream({ endpoint: '/api/test', stageLabels: {} })
    );
    let generateResult: Awaited<ReturnType<typeof result.current.generate>> | undefined;

    await act(async () => {
      generateResult = await result.current.generate({ description: 'test' });
    });

    assert.strictEqual(fetchCount, 2);
    assert.strictEqual(generateResult?.phase, 'complete');
  } finally {
    global.fetch = originalFetch;
  }
});
