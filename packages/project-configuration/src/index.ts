// Root barrel - re-exports all public API of the package
// Domain models (entities + value objects)
export * from './domain/model';

// Application layer
export * from './application/ports/in'; // inbound ports
export * from './application/ports/out'; // outbound ports
export * from './application/use-cases'; // use cases

// Infrastructure / adapters
// - only public ones that drivers need
export * from './infrastructure/external-apis/jszip.adapter';
