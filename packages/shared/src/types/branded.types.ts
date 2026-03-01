export type Branded<T, B> = T & { __brand: B };
export type UserId = Branded<string, 'UserId'>;