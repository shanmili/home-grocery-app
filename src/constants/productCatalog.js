export const PRODUCT_CATALOG = [
  { name: 'Pancit Canton', category: 'Instant food', unit: 'pack' },
  { name: 'Ramen Noodles', category: 'Instant food', unit: 'pack' },
  { name: 'Hot Chocolate', category: 'Beverages', unit: 'pack' },
  { name: 'Guard Shampoo', category: 'Personal care', unit: 'bottle' },
  { name: 'Kojic Soap', category: 'Personal care', unit: 'bar' },
  { name: 'Dishwashing Paste', category: 'Cleaning supplies', unit: 'tub' },
  { name: 'Zonrox Violet', category: 'Cleaning supplies', unit: 'bottle' },
  { name: 'Zonrox White', category: 'Cleaning supplies', unit: 'bottle' },
  { name: 'Domex', category: 'Cleaning supplies', unit: 'bottle' },
  { name: 'Biscuits', category: 'Snacks', unit: 'pack' },
  { name: 'Luping Wipes', category: 'Other household essentials', unit: 'pack' },
  { name: 'Small Facial Tissue', category: 'Other household essentials', unit: 'pack' },
  { name: 'Knorr Beef Cubes', category: 'Condiments', unit: 'pack' },
  { name: 'Knorr Chicken Cubes', category: 'Condiments', unit: 'pack' },
  { name: 'Knorr Shrimp Cubes', category: 'Condiments', unit: 'pack' },
  { name: 'Decolgen', category: 'Medicine', unit: 'tablet' },
  { name: 'Tuseran', category: 'Medicine', unit: 'capsule' },
  { name: 'Biogesic', category: 'Medicine', unit: 'tablet' },
  { name: 'Shannen’s Roll-on', category: 'Personal care', unit: 'bottle' },
  { name: 'Pond’s Day Serum Cream', category: 'Personal care', unit: 'jar' },
  { name: 'Frozen Fish', category: 'Frozen goods', unit: 'kg' },
];

export function findCatalogProducts(query) {
  const normalize = (text) => text.toLowerCase().replace(/['’]/g, '').replace(/-/g, ' ');
  const terms = normalize(query.trim()).split(/\s+/);
  if (!query.trim()) return PRODUCT_CATALOG.slice(0, 4);

  return PRODUCT_CATALOG.filter(({ name, category }) =>
    terms.every((term) => normalize(name + ' ' + category).includes(term))
  ).slice(0, 6);
}
