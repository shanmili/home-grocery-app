import { PRODUCT_CATEGORIES } from './categories';

export function groupByProductCategory(items, getCategory) {
  const groups = new Map();
  for (const item of items) {
    const category = getCategory(item)?.trim() || 'Uncategorized';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(item);
  }
  return [...groups].sort(([left], [right]) => {
    const rank = (category) => {
      const index = PRODUCT_CATEGORIES.indexOf(category);
      return index === -1 ? PRODUCT_CATEGORIES.length : index;
    };
    return rank(left) - rank(right) || left.localeCompare(right);
  }).map(([title, data]) => ({ title, data }));
}
