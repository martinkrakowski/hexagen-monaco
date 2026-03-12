export type Result<T, E = Error> = {
    success: true;
    value: T;
} | {
    success: false;
    error: E;
};
export declare function ok<T>(value: T): Result<T>;
export declare function err<E = Error>(error: E): Result<never, E>;
//# sourceMappingURL=result.d.ts.map