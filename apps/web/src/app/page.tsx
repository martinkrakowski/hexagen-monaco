import type { ProjectSpec } from '@hexagen/project-configuration';

export default function Page() {
  const myEntity: Partial<ProjectSpec> = { id: '123' };
  return <h1>HexagenMonaco Frontend. Using entity: {myEntity.id}</h1>;
}
