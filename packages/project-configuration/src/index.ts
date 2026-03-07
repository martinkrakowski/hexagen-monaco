export * from './domain';
export * from './application';
export * from './infrastructure';

// Explicit domain type exports for cross-context projection & driver use
export type { ProjectSpecification } from '@hexagen/shared/domain/project-specification';
