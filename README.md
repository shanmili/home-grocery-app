# home-grocery-app

Home Grocery Inventory is a shared family pantry app built with Expo. It saves stock changes in SQLite on each phone and syncs them with Supabase when connected.

## Phase 6 setup

1. In your Supabase project, enable the email/password provider and disable public sign-ups. In Authentication > Users, use Add User and select Auto Confirm User. For each family account, enter the internal alias below in the dashboard's email field and set a unique password. These are reserved example-domain aliases with no real inbox. Family members enter only their username and password in the app.

   | Username | Internal alias | Role |
   | --- | --- | --- |
   | sheila | mother@grocery.example.com | ADMIN |
   | shanmi | daughter@grocery.example.com | ADMIN |
   | shannen | sibling1@grocery.example.com | MEMBER |
   | drexel | sibling2@grocery.example.com | MEMBER |

   Usernames are case-insensitive. The app maps these usernames to the internal aliases in the table. Keep the aliases on the existing Supabase users so their account IDs and activity history are preserved. The project owner handles password recovery.
2. In the Supabase SQL Editor, run the SQL below once for each account. Replace the three sample values. Use ADMIN for Mother and the daughter. Use MEMBER for both younger siblings. Verify each execution returns exactly one row. This is a project-owner bootstrap step. Mobile accounts have no role-editing screen.
3. Copy .env.example to .env.local and enter the project URL and publishable key from your project's Connect or API Keys settings. The key begins with sb_publishable_. Never use a secret or service-role key here.
4. Restart Expo with `npm.cmd start -- --clear`. Open the Android app from Expo.

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object('grocery_role', 'ADMIN', 'grocery_name', 'Mother')
where lower(email) = lower('mother@grocery.example.com')
returning id, email, raw_app_meta_data ->> 'grocery_role' as grocery_role;
```

## Smoke test

- Try an incorrect password, then sign in with a configured username such as sheila. Also verify that uppercase letters and surrounding spaces in the username are accepted.
- Verify the account name and role in Settings. Restart the app and check session restoration.
- Sign out, check that Android Back cannot open the household screens, then sign in with the second role.
- Verify the existing inventory UI displays the expected controls for each role. Verify an account without grocery_role stays on the login screen.
- Verify that local inventory persists on the same device across account changes.

## Scope

The first sign-in needs internet. Session credentials persist in app-private Expo SQLite storage, which has no separate Keychain or Keystore encryption. An expired session may need internet to refresh after a restart. Supabase sign-out can also require connectivity.

This setup assumes one family per Supabase project. Inventory and history remain in the same local database on each device. New records use the Supabase account ID. Existing demo records retain their original IDs and cannot be attributed to new accounts automatically. Names for real accounts are learned on the device when each account signs in. PostgreSQL inventory policies and cross-device inventory synchronization come in Phases 7 and 8.

## Product catalog and expiration reminders

Open Inventory > Add product and type in the product name field to search the offline starter catalog. Choosing a match fills in its name, category, and unit. You can also type and save a custom product. The catalog is a list of suggestions and does not create stock records automatically.

Enter the package expiration date in YYYY-MM-DD format when adding or editing a product. Choosing Frozen Fish suggests a household reminder date 14 days from today. Use the package date when available. The 14-day reminder applies to frozen fish and is not a storage recommendation for raw refrigerated fish. Each inventory record has one date. Use separate records for batches with different dates.

Inventory and Dashboard show reminders for items with stock remaining, starting two days before the saved date. These are in-app reminders for the inventory on the current device.

## Phase 7 database security

The migration is supabase/migrations/202611200001_grocery_security.sql. Apply it once to the Home Grocery Inventory Supabase project. Use a migration deployment or run its contents in Supabase SQL Editor. The migration creates new tables and will stop without committing if those names are already in use. It does not import SQLite records.

Both family roles can read active inventory and the open shopping list. Admins can see archived products, completed purchases, and all activity. Members can see their own activity and can only apply negative stock changes. The database checks the current role in Supabase Auth and records the signed-in user's ID. The server keeps roles and passwords in their existing accounts.

The apply_grocery_change function accepts a transaction ID, an operation, an entity ID, and a JSON payload. Supported operations are create_product, edit_product, archive_product, adjust_quantity, add_shopping_item, and confirm_purchase. Product edits and archives require expected_version. Send quantity changes as delta. Use the same transaction ID and payload on retry. A replay returns the original result, so refresh before treating that result as the latest state. A linked purchase adds stock and closes the shopping item in one database transaction.

Phase 8 will connect the mobile SQLite queue to this function. For now the phone continues using its local inventory, including expiration reminders.

## Phase 8 family sync

Apply the Phase 7 and Phase 8 SQL files in supabase/migrations in timestamp order. Skip Phase 7 if it is already deployed. Then reload the app. On the admin phone with the inventory you want to share, open Settings > Family sync and choose Publish this device's inventory. Do this once for the household. Other phones automatically download the shared inventory on connection, on foregrounding, and about every 15 seconds while open. Settings also offers Sync now.

The initial upload includes active products and open manually added shopping items. Each phone keeps its earlier product and shopping lists in the local grocery_local_backup table, and earlier activity remains in that phone's history. Old edits are not replayed because their quantities are already reflected in the initial inventory on the publishing phone. Use the publishing phone that has the quantities you intend to share.

After setup, writes are saved locally together with their transaction IDs. The app retries transport failures with the same ID and applies quantity changes as deltas. Stale edits, insufficient stock, and stale purchase confirmations appear under Settings > Family sync and in activity history. Recheck the current inventory before entering a replacement change. A queued action is sent only under the account that originally saved it.

A signed-in user can keep making changes when the connection drops. A cold start with an expired Supabase session can still require connectivity to restore sign-in. Sync runs while the app is open.

## Installable Android APK

The EAS `preview` profile creates a standalone APK your family can open directly on Android. The package ID is `com.shanmi.homegroceryinventory`.

1. Verify the local build configuration from this project folder.

   ```powershell
   node --env-file=.env.local scripts/check-build-env.cjs
   ```

2. Sign in to Expo and link this project. Run `init` on the first setup, or when linking an existing EAS project whose ID is absent from the local Expo config.

   ```powershell
   npx.cmd eas-cli@latest login
   npx.cmd eas-cli@latest init
   ```

3. In the linked project's Expo dashboard, set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in the **preview** environment using the values from `.env.local`. Use the project URL and publishable key. These values are embedded in the APK. The build checks the configuration before installing dependencies.
4. Start the APK build. If this app has never had a signed standalone APK, EAS can generate its first signing key. Keep using the same signing key to install future updates over existing copies.

   ```powershell
   npx.cmd eas-cli@latest build --platform android --profile preview
   ```

5. Before moving from Expo Go, open **Settings > Family sync** on the admin phone with the inventory you want to share. Publish the inventory if it hasn't been published, and verify queued edits have synced. The standalone app has its own local storage.
6. Open the finished APK link on your Android phone, install it, and sign in with your existing family username and password. Test that the app opens with Metro stopped and that inventory and Pantry Quest history load. On a test item, make an offline quantity adjustment and verify it appears once on a second phone after reconnecting. Share the link with the rest of the family after these checks pass.
