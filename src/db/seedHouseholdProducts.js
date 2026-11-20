const starterProducts = [
  ['Rice', 'Rice and grains', 'kg'],
  ['Cooking oil', 'Condiments', 'bottle'],
  ['Salt', 'Condiments', 'pack'],
  ['Sugar', 'Kitchen essentials', 'kg'],
  ['Vinegar', 'Condiments', 'bottle'],
  ['Soy sauce (toyo)', 'Condiments', 'bottle', 'Soy sauce', 'Toyo'],
  ['Fish sauce (patis)', 'Condiments', 'bottle', 'Fish sauce', 'Patis'],
  ['Seasoning granules', 'Condiments', 'pack'],
  ['Pepper', 'Condiments', 'pack'],
  ['Garlic', 'Vegetables', 'kg'],
  ['Onion', 'Vegetables', 'kg'],
  ['Ginger', 'Vegetables', 'kg'],
  ['Canned sardines', 'Canned goods', 'can', 'Sardines'],
  ['Corned beef', 'Canned goods', 'can'],
  ['Beef loaf', 'Canned goods', 'can'],
  ['Instant noodles', 'Instant food', 'pack'],
  ['Powdered milk', 'Beverages', 'pack'],
  ['Biscuits', 'Snacks', 'pack', 'Biscuit'],
  ['Flour', 'Kitchen essentials', 'kg'],
  ['Cornstarch', 'Kitchen essentials', 'pack'],
  ['Catsup', 'Condiments', 'bottle', 'Ketchup'],
  ['Tomato sauce', 'Condiments', 'pack'],
  ['Laundry detergent bar', 'Cleaning supplies', 'bar'],
  ['Liquid laundry detergent', 'Cleaning supplies', 'bottle'],
  ['Bleach', 'Cleaning supplies', 'bottle'],
  ['Dishwashing liquid', 'Cleaning supplies', 'bottle'],
  ['Toilet bowl cleaner', 'Cleaning supplies', 'bottle'],
  ['Alcohol (70%)', 'Cleaning supplies', 'bottle'],
  ['Scrub pads', 'Cleaning supplies', 'piece'],
  ['Steel wool', 'Cleaning supplies', 'pack'],
  ['Sponges', 'Cleaning supplies', 'piece'],
  ['Bath soap', 'Personal care', 'bar'],
  ['Shampoo', 'Personal care', 'bottle'],
  ['Toothpaste', 'Personal care', 'tube'],
  ['Toothbrush', 'Personal care', 'piece'],
  ['Facial wash', 'Personal care', 'tube'],
  ['Deodorant', 'Personal care', 'piece'],
  ['Cotton buds', 'Personal care', 'pack'],
  ['Cotton balls', 'Personal care', 'pack'],
  ['Facial tissue', 'Personal care', 'pack'],
  ['Toilet paper', 'Personal care', 'roll'],
  ['Wet wipes', 'Personal care', 'pack'],
  ['Sanitary napkins', 'Personal care', 'pack'],
  ['Pantyliners', 'Personal care', 'pack'],
];

const seedKey = 'household-starter-products-v1';

export async function seedHouseholdProducts(db) {
  await db.withExclusiveTransactionAsync(async (tx) => {
    const applied = await tx.getFirstAsync('SELECT key FROM inventory_setup WHERE key = ?;', [seedKey]);
    if (applied) return;

    const existing = await tx.getAllAsync('SELECT name FROM products;');
    const names = new Set(existing.map(({ name }) => name.trim().toLowerCase()));
    const now = new Date().toISOString();

    for (const [name, category, unit, ...aliases] of starterProducts) {
      if ([name, ...aliases].some((label) => names.has(label.toLowerCase()))) continue;

      const id = 'starter-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '');
      await tx.runAsync(
        `INSERT INTO products (id, name, category, quantity, unit, min_threshold, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, 0, ?, ?);`,
        [id, name, category, unit, now, now]
      );
      names.add(name.toLowerCase());
    }

    await tx.runAsync('INSERT INTO inventory_setup (key) VALUES (?);', [seedKey]);
  });
}
