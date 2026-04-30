export interface AAD {
  readonly userId: string;
}

export function constructAAD(userId: string): AAD {
  return { userId };
}

export function aadToBuffer(aad: AAD): Buffer {
  return Buffer.from(aad.userId, "utf-8");
}
