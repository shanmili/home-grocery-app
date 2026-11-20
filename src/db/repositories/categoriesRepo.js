import { getDatabase } from '../sqlite';

export async function getCustomCategories() {
  const db = await getDatabase();
  const rows = await db.getAllAsync('SELECT name FROM custom_categories ORDER BY name COLLATE NOCASE;');
  return rows.map(({ name }) => name);
}

export async function addCustomCategory(name) {
  const db = await getDatabase();
  const result = await db.runAsync('INSERT OR IGNORE INTO custom_categories (name) VALUES (?);', [name.trim()]);
  return result.changes > 0;
}
