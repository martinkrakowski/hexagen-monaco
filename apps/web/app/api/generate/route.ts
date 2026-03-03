import { NextResponse } from 'next/server';
import { generateProjectAction } from '@/lib/wire';
import type { ProjectConfig } from '@hexagen/project-configuration';

export async function POST(request: Request) {
  try {
    const spec = (await request.json()) as ProjectConfig;
    const tree = await generateProjectAction(spec);

    return NextResponse.json({ tree });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
