import { NextResponse } from 'next/server';
import { downloadProjectAction } from '@/lib/wire';
import type { FileTreeNode } from '@hexagen/project-configuration';

export async function POST(request: Request) {
  try {
    const tree: FileTreeNode = await request.json();
    const blob = await downloadProjectAction(tree);
    return new NextResponse(blob, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${tree.name || 'project'}.zip"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message || 'Internal error' },
      { status: 500 }
    );
  }
}
