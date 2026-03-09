// apps/web/app/api/download/route.ts
// Endpoint to download a generated project as zip

import { NextResponse } from 'next/server';
import { getDownloadProject } from '@/lib/wire';
import type { Project as WebProject } from '@hexagen/web-driver';

// Explicit discriminated union (contract of DownloadProjectPort)
type DownloadResult =
  | { success: true; downloadUrl?: string; message: string }
  | { success: false; error: { message: string } };

// Type guard to narrow success branch
function isDownloadSuccess(
  result: DownloadResult
): result is { success: true; downloadUrl?: string; message: string } {
  return result.success === true;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const project = body.project as WebProject; // TODO: add zod validation later

    if (!project || !project.id) {
      return NextResponse.json(
        { success: false, message: 'Missing project or project.id' },
        { status: 400 }
      );
    }

    const downloadPort = getDownloadProject();
    const result = (await downloadPort.downloadProject(
      project
    )) as DownloadResult;

    if (isDownloadSuccess(result)) {
      return NextResponse.json({
        success: true,
        downloadUrl: result.downloadUrl,
        message: 'Project ready for download',
      });
    }

    // Narrowed: result is now { success: false; error: { message: string } }
    return NextResponse.json(
      { success: false, message: result.error.message || 'Download failed' },
      { status: 500 }
    );
  } catch (err) {
    console.error('Download route error:', err);
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}
