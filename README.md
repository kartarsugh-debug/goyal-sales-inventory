# Goyal Sales Inventory

## Included
- Admin login and role-based Viewer access
- Product Name, Brand Name, Product Code
- Pieces per Box, MRP, Rate
- Search by product/brand/code
- Export only the current search results to Excel (.xlsx)
- Admin-only product add/edit/delete
- Change history with old/new data and changed-by
- Admin user management
- Admin login/password change through Users & Access
- Logo upload
- Custom company/footer text
- SQLite database

## Default Admin
Login ID: `Goyal sales`
Password: `goyal@7250`

Change this password after first login from **Users & Access** by editing the admin user.

## Run on Windows
1. Install Node.js LTS.
2. Extract this ZIP.
3. Open Command Prompt in the extracted folder.
4. Run:
   `npm install`
5. Run:
   `npm start`
6. Open:
   `http://localhost:3000`

## Notes
- The SQLite database is created automatically as `inventory.db`.
- The default login is created only when the database has no users.
- For internet/public hosting, set a strong `SESSION_SECRET` environment variable and use HTTPS.
- The included browser Excel export uses SheetJS from jsDelivr. If you want a completely offline build, the server CSV export can be used or the SheetJS library can be bundled locally.
- This starter project is designed for a small business inventory. For a public production deployment, use a managed database, HTTPS, backups, and a strong session secret.
