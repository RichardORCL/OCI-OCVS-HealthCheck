# OCVS Health Check

A static website to walk through a health check for Oracle Cloud VMware Solution (OCVS), styled after the OCI Console.

## Usage

Run the bundled server (plain Python, no dependencies). It serves the site and persists checklist edits made in editor mode:

```powershell
python server.py 8080
# then browse to http://localhost:8080
```

A plain static file server (e.g. `python -m http.server`) also works for viewing and filling in the health check, but saving checklist edits from editor mode requires `server.py`.

To reach the site from other machines, allow inbound TCP 8080 through Windows Firewall once (elevated prompt):

```powershell
netsh advfirewall firewall add rule name="OCVS Health Check (HTTP 8080)" dir=in action=allow protocol=TCP localport=8080
```

Other machines can then browse to `http://<this-machine's-IP>:8080`. Note that statuses, comments and checklist edits are stored per browser (localStorage), so every visitor has their own working copy - use Export/Import from the hamburger menu to hand results over.

## Features

- One page per category (OCVS Inventory, Networking, Storage, Troubleshooting Processes, OCI Monitoring / Management Integration, Security), reachable via the navigation bar under the header.
- Each checklist item can be set to **Checked off**, **In progress** or **Needs attention** (or left as **Not checked**) and has a collapsible comments field for findings.
- Progress is saved automatically to the browser's localStorage.
- The hamburger menu in the top bar provides **Export results (JSON)**, **Import results** and **Reset all**.
- Every item has a feedback button (speech bubble): any user can leave feedback about the item's topic in a popup. Feedback is stored on the server (`data/feedback.json`) and is not visible to regular users; in editor mode the button shows a count badge on items that received feedback and clicking it lists all entries with timestamps, where each entry can be deleted.

## Editor mode

The hamburger menu has an **Editor** section. Choosing **Enable editor** asks for a password; once enabled you can:

- Add, edit and remove checklist items (including sub-items) on every category page. Outline numbering (a / i / 1) is recalculated automatically.
- Manage an item's reference links in the same inline editor: edit the display text and URL of existing links, remove them, or use **+ Add link** to attach new ones. URLs typed directly in an item's text are also rendered as clickable links automatically.
- Reorder items by dragging the dotted grip at the left edge of an item up or down; items can be reordered among their siblings (within the same parent).
- Add categories from the Overview page, and rename or delete a category from its page header.
- **Download checklist (JSON)** - downloads the current checklist as a backup copy.
- **Import checklist (JSON)** - replaces the entire checklist with a previously downloaded file (after confirmation) and saves it to the server for everyone.

Checklist edits are saved to the server (written to `data/healthcheck.json`), so they are shared with everyone using the tool - other visitors get the updated checklist when they load or refresh the page. The server verifies the editor password on every save. Statuses and comments remain per browser; use Export/Import to hand results over.

The default password is `ocvs-editor`. To change it, compute the SHA-256 hex digest of your new password (e.g. `node -e "console.log(require('crypto').createHash('sha256').update('newpassword').digest('hex'))"`) and put it in `EDITOR_PASSWORD_HASH` in both `js/app.js` and `server.py`.

## Structure

- `index.html` - app shell (top bar, hamburger menu, category navigation, content container, password modal)
- `css/styles.css` - OCI Console inspired styling
- `data/healthcheck.json` - the health check checklist definition (categories and items)
- `js/app.js` - data loading, hash router, rendering, persistence, export/import, editor mode
- `server.py` - serves the site and saves checklist edits (POST `/api/checklist`)

No build step or dependencies required (Python 3 for the server).
# OCI-OCVS-HealthCheck
