# Shopping List Update - Google Sheets Backend

This is the Google Sheets / Apps Script version, not the Supabase version.

## Added

- Multiple shopping lists
- Protected default Home List
- Add special lists such as Camping, Special Dinner, Holidays, or Project Supplies
- Rename non-home lists
- Delete non-home lists and their items
- Store filtering still works inside the selected list
- No login, password, or household-code screen

## Required Apps Script update

Replace your current Google Apps Script `Code.gs` with the included file:

`GOOGLE_APPS_SCRIPT_Code.gs`

Then deploy a new version of the web app.

The script will create/use these tabs in the spreadsheet:

- `Items`
- `Lists`

Existing items that do not have a `list_id` will be treated as part of `Home List`.

## App files

Replace your current app files with this package, then run:

```bash
npm install
npm run dev
```

After testing:

```bash
git add .
git commit -m "Add multiple shopping lists"
git push
```

## Important

Do not run any Supabase SQL for this app. This version uses Google Sheets.
