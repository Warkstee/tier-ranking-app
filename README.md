# Tier Ranking App

A browser-based app for ranking candidates into tiers using weighted scoring criteria. Drag candidates between tiers, score them against a custom rubric, and manage multiple saved rankings.

## Features

- **User authentication** — Sign up and log in with per-user accounts. Each user's rankings and data are completely isolated.
- **Tier ranking** — Drag-and-drop candidates into configurable tier lanes (S, A, B, C, D, F, etc.)
- **Weighted scoring** — Score candidates against a custom rubric with adjustable weights and score ranges
- **Rank display** — Overall weighted scores with rank and tie detection
- **Candidate management** — Add, edit, and delete candidates with image upload
- **Multiple rankings** — Save, load, export, import, and delete named rankings
- **In-browser configuration** — Edit tiers, scoring criteria, and score ranges without touching config files
- **AHP weight calculator** — Determine criteria weights through pairwise comparisons using the Analytic Hierarchy Process instead of manually entering numbers
- **Side-by-side comparison** — Drag one candidate onto another to open a comparison modal with images, descriptions, and full score tables
- **Shareable read-only links** — Generate a unique URL to share any ranking board — recipients can view tiers, candidates, and scores without an account
- **Undo (Ctrl+Z)** — Revert your most recent tier move, score change, or AHP adjustment with a single keystroke
- **Keyboard shortcuts** — Ctrl+S (Cmd+S on Mac) to save the current ranking
- **Auto-save** — Changes are saved automatically as you work

<p align="center">
  <img src="docs/sreenshot-dashboard-v1.png" width="30%" style="margin: 0 15px;" />
  <img src="docs/screenshot-app-main-v3.png" width="30%" style="margin: 0 15px;" />
  <img src="docs/screenshot-comparison-v2.png" width="30%" style="margin: 0 15px;" />
</p>

## Dashboard

The dashboard allows you to open, delete and create new rankings. Use the menu (burger icon, top-left) to :

| Action | Description |
|--------|-------------|
| **New Ranking File** | Start a fresh ranking with default tiers. Prompts for a name. |
| **Open File** | Browse and load any saved ranking. |
| **Upload File** | Load a ranking from a previously exported ZIP file. |
| **Delete File** | Remove a saved ranking. |

<p align="center">
  <img src="docs/screenshot-dashboard-menu-v1.png" width="40%" style="margin: 0 15px;" />
  <img src="docs/sreenshot-dashboard-new-ranking-v1.png" width="40%" style="margin: 0 15px;" />
</p>

## Configuration

The app ships with a default configuration. Open the menu (burger icon, top-left) to:

| Action | Description |
|--------|-------------|
| **Edit Criteria** | Add, remove, and reorder scoring criteria. Set weights and the score range (min/max). Use the calculator icon to open the AHP weight calculator for pairwise comparison-based prioritization. |
| **Edit Tiers** | Add, remove, and reorder tier lanes. |
| **Reset Scores & Rankings** | Reset all scores and move candidates back to the unranked pool. |

<p align="center">
  <img src="docs/screenshot-edit-criteria-v3.png" width="40%" style="margin: 0 15px;" />
  <img src="docs/screenshot-ahp-calculator-v2.png" width="40%" style="margin: 0 15px;" />
</p>

## Ranking File Options

Use the **File** menu (burger icon, top-left) to:

| Action | Description |
|--------|-------------|
| **Save File** | Save changes to the current ranking. |
| **Save As** | Save the current ranking under a new name. |
| **Download File** | Download a ZIP containing the ranking data and all candidate images. |
| **Share File** | Generate a shareable read-only link. Recipients can view the full ranking board with needing an account.|

<p align="center">
  <img src="docs/screenshot-ranking-menu-v1.png" width="40%" style="margin: 0 15px;" />
  <img src="docs/screenshot-share-ranking-v2.png" width="40%" style="margin: 0 15px;" />
</p>

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Ctrl+Z** (Cmd+Z on Mac) | Undo the most recent tier move, score change, or AHP slider adjustment |
| **Ctrl+S** (Cmd+S on Mac) | Save the current ranking (only triggers when there are unsaved changes) |

## Self-Hosted Deployment

Deploy on your local machine, or a remote server, using the pre-built image, via Docker. Create a directory with a `compose.yml` and the required data volumes:

```sh
mkdir tier-ranking-app && cd tier-ranking-app
```

Create `compose.yml`:

```yaml
services:
  tier-ranking-app:
    image: ghcr.io/warkstee/tier-ranking-app:latest
    build: .
    ports:
      - "4173:80"
    volumes:
      - ./data/candidates:/usr/share/nginx/html/assets/candidates
      - ./data/screenshots:/usr/share/nginx/html/assets/screenshots
      - db-data:/app/data
    environment:
      - DB_PATH=/app/data/tier-ranking.db
    restart: unless-stopped

volumes:
  db-data:
```

Then start the container:

```sh
docker compose up -d
```

Open `http://127.0.0.1:4173/` (local machine) / `http://<server-ip>:4173/` (remote server)

To update to a newer version:

```sh
docker compose pull
docker compose up -d
```

Make sure the port `4173` has been opened in the firewall

