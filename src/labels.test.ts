import { describe, expect, it } from 'vitest';
import { mergeLabels, toLabel } from './index';
import {
  crawlJobEnqueueSchema,
  labelsSchema,
  mcpListQuerySchema,
} from './schemas/index';

describe('labels', () => {
  it('toLabel slugs section headers', () => {
    expect(toLabel('Banks - United States')).toBe('banks-united-states');
    expect(toLabel('Food & Drink')).toBe('food-and-drink');
    expect(toLabel('Café')).toBe('cafe');
    expect(toLabel('  !!  ')).toBeNull();
  });
  it('mergeLabels dedupes, slugs and caps', () => {
    expect(
      mergeLabels(['recipes', 'Cooking'], ['recipes', 'meal planning'])
    ).toEqual(['recipes', 'cooking', 'meal-planning']);
    expect(
      mergeLabels(Array.from({ length: 20 }, (_, i) => `l${i}`))
    ).toHaveLength(12);
  });
  it('schemas', () => {
    expect(labelsSchema.safeParse(['recipes', 'cooking']).success).toBe(true);
    expect(labelsSchema.safeParse(['Recipes']).success).toBe(false);
    expect(labelsSchema.safeParse(['a', 'a']).success).toBe(false);
    expect(
      mcpListQuerySchema.parse({ label: 'Recipes, cooking,,bad label' }).label
    ).toEqual(['recipes', 'cooking']);
    expect(
      crawlJobEnqueueSchema.safeParse({
        origins: ['https://x.com'],
        labels: ['recipes'],
      }).success
    ).toBe(true);
  });
});
