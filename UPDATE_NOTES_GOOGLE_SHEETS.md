# Shopping List — shopping mode, list builder and automatic sync

The main screen is for shopping: choose a list and store, mark items in the cart, and expand quick add when needed. Create / edit list opens a builder for creating, renaming and deleting lists, adding quantities, stores and notes, and editing existing items. Builder store selection carries forward to the next addition; shopping quick add defaults to Any Store.

## Automatic sharing

- Fetches on opening, returning to the app, reconnecting, and every 20 seconds while visible.
- Saves changes locally before sending. Offline changes persist in a versioned journal and retry on reconnect.
- Sends item/list operations instead of replacing all shared data. The server serializes writes using a script lock and rejects stale revisions so the client can rebase pending changes.
- Acknowledges operation IDs to make retries safe after a lost response. Patches do not recreate deleted items. Concurrent edits to different fields merge; the last accepted change to the same field wins.
- Serializes sync across same-origin browser tabs when Web Locks is available. Responses retain edits made while a request is in progress.
- Keeps prior v3 local storage intact. On first connection, a differing device copy remains recoverable as a separate list; it is never silently uploaded over the shared sheet.
- Sync controls show status and Retry sync. Destructive Pull / full-device Sync controls have been removed.

## Existing Google Apps Script endpoint

Project: Shopping List Sync (`1ka8pud7O_tgGEmMN7o-goU_4AJRJXOUdptovYMTu3HK8yEtgbY6VOhww`).
The app retains the endpoint ending `...LuyHF/exec`, upgraded from version 1 to version 3 on 2026-11-15. Existing execute-as and audience settings are retained.

`GOOGLE_APPS_SCRIPT_Code.gs` is the deployed protocol-2 source. It preserves Items and Lists, adds an operation/revision ledger in `_ShoppingSync`, and copies the historical Items tab before mapping store/category, deleted, list_id and creation timestamps. Unknown headers fail without clearing data. Legacy full-device saves are refused with an instruction to reopen the updated app.

No Supabase resources or other apps are involved.

## Validation and operations

Run `npm test` and `npm run build`. Tests cover two-device additions, field merge, stale deletion, retry deduplication, offline reload, edits during requests, lost responses, legacy recovery, list management, schema preservation, historical column migration, and identical server/client operation rules.

Keep the protocol-2 backend when reverting cosmetic UI changes. Do not restore the historical version-1 backend against migrated columns: its schema handling predates this preservation logic. The script version history and `_Items before autosync ...` tab retain the prior source/data for deliberate recovery.
