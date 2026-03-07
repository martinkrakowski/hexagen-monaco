import { NextResponse } from 'next/server';
import { downloadProjectAction } from '@/lib/wire';
import type { Project as WebProject } from '@hexagen/web-driver';

export async function POST(request: Request) {
  const body = await request.json();
  const project = body.project as WebProject;
  const result = await downloadProjectAction(project);
  return NextResponse.json(result, { status: result.success ? 200 : 500 });
}
