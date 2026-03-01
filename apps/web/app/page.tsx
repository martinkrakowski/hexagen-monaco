'use client';

import { useState } from 'react';
import type { FileTreeNode } from '@hexagen/project-configuration';

export default function Home() {
  const [specJson, setSpecJson] = useState(`{
  "id": "test-123",
  "name": "MyHexaGenProject",
  "description": "AI-powered monorepo",
  "boundedContexts": ["User", "Order", "Payment"],
  "version": "1.0.0"
}`);

  const [loading, setLoading] = useState(false);
  const [tree, setTree] = useState<FileTreeNode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    setTree(null);

    try {
      let spec;
      try {
        spec = JSON.parse(specJson);
      } catch {
        throw new Error('Invalid JSON in spec input');
      }

      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(spec),
      });

      const bodyText = await res.text();

      if (!res.ok) {
        let errMsg = `HTTP ${res.status}`;
        try {
          const errData = JSON.parse(bodyText);
          errMsg = errData.error || errMsg;
        } catch {
          errMsg += ` - ${bodyText.substring(0, 100)}`;
        }
        throw new Error(errMsg);
      }

      const data = JSON.parse(bodyText);
      setTree(data.tree);
    } catch (err) {
      setError((err as Error).message || 'Generation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!tree) return;

    try {
      setLoading(true);
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tree),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(
          `Download failed: ${res.status} - ${errorText.substring(0, 100)}`
        );
      }

      // Body is Blob — consume it once
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${tree.name || 'project'}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError((err as Error).message || 'Download error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main
      style={{
        padding: '2rem',
        maxWidth: '900px',
        margin: '0 auto',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h1>Hexagen Monaco v2 – Wizard</h1>
      <p>Edit spec → Generate tree → Download zip</p>

      <textarea
        value={specJson}
        onChange={(e) => setSpecJson(e.target.value)}
        rows={12}
        style={{
          width: '100%',
          fontFamily: 'monospace',
          padding: '1rem',
          borderRadius: '8px',
          border: '1px solid #ddd',
          background: '#f9f9f9',
          marginTop: '1rem',
        }}
      />

      <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem' }}>
        <button
          onClick={handleGenerate}
          disabled={loading}
          style={{
            padding: '0.75rem 1.5rem',
            background: loading ? '#ccc' : '#0070f3',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Generating...' : 'Generate Tree'}
        </button>

        {tree && (
          <button
            onClick={handleDownload}
            disabled={loading}
            style={{
              padding: '0.75rem 1.5rem',
              background: loading ? '#ccc' : '#10b981',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Zipping...' : 'Download ZIP'}
          </button>
        )}
      </div>

      {error && (
        <div
          style={{
            marginTop: '1.5rem',
            padding: '1rem',
            background: '#ffebee',
            borderRadius: '8px',
            color: '#c62828',
          }}
        >
          <strong>Error:</strong> {error}
        </div>
      )}

      {tree && (
        <div style={{ marginTop: '2rem' }}>
          <h2>Generated Tree:</h2>
          <pre
            style={{
              background: '#f5f5f5',
              padding: '1.5rem',
              borderRadius: '8px',
              overflow: 'auto',
              maxHeight: '500px',
              fontSize: '0.9rem',
            }}
          >
            {JSON.stringify(tree, null, 2)}
          </pre>
        </div>
      )}
    </main>
  );
}
