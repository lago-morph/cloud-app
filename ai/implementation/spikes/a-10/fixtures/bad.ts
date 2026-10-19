// Must FAIL lint: `any`, `@ts-ignore`, unrelated `as` cast (CHECK-AC-002 shape).
export function f(x: any): number {
  // @ts-ignore
  const y: number = "s";
  return (x as unknown as number) + y;
}
