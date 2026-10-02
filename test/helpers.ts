import { validateRule } from '../src/core/validate.ts';
import type { RuleInput } from '../src/core/types.ts';

export function fairD6(id: string) {
  return { id, faces: [1, 2, 3, 4, 5, 6].map((v) => ({ value: v, weight: 1 })) };
}

export function makeRule(input: RuleInput) {
  return validateRule(input);
}
