/**
 * Secret locations per target, by SEC's naming convention (SEC-REQ-003, secrets.md §2 "Names").
 * CFG records them in the resolved configuration (CFG-REQ-004); SEC (B-10) reads secrets from
 * the same locations and may import `secretLocation` from here. AWS (`/<app>/<stage>/secrets/<name>`)
 * is added with the AWS target.
 */
import type { Target } from "../core/identity.js";

/** lowerCamelCase → UPPER_SNAKE_CASE: an underscore before each capital letter. */
export function upperSnake(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase();
}

/** Where secret `name` is stored on `target`. */
export function secretLocation(_target: Target, name: string): string {
  return `SECRET_${upperSnake(name)}`;
}
