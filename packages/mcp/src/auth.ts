// Bearer token check (specs/mcp/transport.md): the presented token is compared
// in constant time with every configured secret, over equal-length digests.
import { createHash, timingSafeEqual } from "node:crypto";

export interface Token {
  readonly id: string;
  readonly secret: string;
}

const digest = (value: string) => createHash("sha256").update(value).digest();

export const authenticate = (
  tokens: ReadonlyArray<Token>,
  authorization: string | undefined,
): string | null => {
  const presented = /^Bearer (\S+)$/i.exec(authorization ?? "")?.[1];
  if (presented === undefined) return null;
  const hash = digest(presented);
  return tokens.reduce<string | null>(
    (found, token) =>
      timingSafeEqual(digest(token.secret), hash) ? token.id : found,
    null,
  );
};
