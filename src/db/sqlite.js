import * as SQLite from 'expo-sqlite';

let databasePromise;

async function openDatabase() {
  const database = await SQLite.openDatabaseAsync('home_grocery_inventory.db');

  try {
    await database.execAsync('PRAGMA foreign_keys = ON;');
    return database;
  } catch (error) {
    await database.closeAsync().catch(() => {});
    throw error;
  }
}

export function getDatabase() {
  if (!databasePromise) {
    databasePromise = openDatabase().catch((error) => {
      databasePromise = undefined;
      throw error;
    });
  }

  return databasePromise;
}
