import { NextResponse } from 'next/server';
import { generateProjectAction } from '../../../src/lib/wire';
import type { ProjectSpec } from '@hexagen/project-configuration';

export async function POST(request: Request) {
  try {
    const spec: ProjectSpec = await request.json();
    const tree = await generateProjectAction(spec);
    return NextResponse.json({ success: true, tree });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message || 'Internal error' },
      { status: 500 }
    );
  }
}
