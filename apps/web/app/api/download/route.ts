/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { downloadProjectAction } from '@/lib/wire';

export async function POST(request: Request) {
  try {
    const tree = (await request.json()) as any;
    const zipBuffer = await downloadProjectAction(tree);

    // Convert Node.js Buffer to Uint8Array for NextResponse compatibility
    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename=generated-project.zip',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
