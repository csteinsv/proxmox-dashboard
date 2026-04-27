# Proxmox Dashboard

A lightweight self-hosted dashboard for monitoring two Proxmox VE clusters — node health, VM/container status, resource usage, and sustained-high alerts.

## Deployment

- **VM**: 115 (`proxmox-dashboard`) at `192.168.50.193`, user `ubuntu`
- **Project root**: `~/proxmox-dashboard`
- **Port**: 3000 (no reverse proxy; access directly at `http://192.168.50.193:3000`)
- **Process**: managed by systemd — `sudo systemctl restart proxmox-dashboard`
- **Logs**: `journalctl -u proxmox-dashboard -f`

## Tech Stack

- **Backend**: Node.js (ESM) + Express — `server.js` entry point
- **Frontend**: plain HTML, CSS, and vanilla JS — no build step, served as static files from `public/`
- **Proxmox API**: token-based auth over HTTPS (self-signed certs accepted)

## File Structure

```
proxmox-dashboard/
├── server.js               # Express entry point, mounts routes, serves public/
├── .env                    # Credentials — gitignored, must exist on the VM
├── deploy/
│   └── proxmox-dashboard.service  # systemd unit (copy to /etc/systemd/system/)
├── public/
│   ├── index.html          # Shell — two sections: Nodes and VMs & Containers
│   ├── app.js              # All frontend logic — card rendering, grouping, alerts
│   └── style.css           # Dark theme, card grid, metric bars
└── src/
    ├── proxmox.js          # Multi-cluster Proxmox API client
    ├── alerts.js           # Sustained-high CPU/RAM/disk alert state machine
    └── routes/
        └── api.js          # GET /api/nodes, /api/vms, /api/health
```

## Proxmox Clusters

| Label | Host | API endpoint |
|-------|------|-------------|
| `pve` | PVE1 | `192.168.50.10:8006` |
| `pve2` | PVE2 | `192.168.50.26:8006` |

Credentials live in `.env`. PVE2 is optional — omitting `PVE2_HOST` disables it.

## .env Format

```
PROXMOX_HOST=192.168.50.10
PROXMOX_PORT=8006
PROXMOX_USER=root@pam
PROXMOX_TOKEN_NAME=mcp-server
PROXMOX_TOKEN_VALUE=<token>
PORT=3000

PVE2_HOST=192.168.50.26
PVE2_PORT=8006
PVE2_TOKEN_ID=root@pam!mcp-server
PVE2_TOKEN_SECRET=<token>
```

## How It Works

- `/api/nodes` fetches node status from both clusters in parallel; each node is tagged with its `cluster` label
- `/api/vms` fetches QEMU VMs and LXC containers from every node across both clusters; each VM is tagged with `node` and `cluster`
- The frontend groups VM cards by `cluster/node` under labelled section headers
- Alerts fire after a metric stays above threshold for 5 minutes (yellow pending, red sustained)

## Known Quirks

### Windows VMs — balloon memory
Proxmox reports `mem > maxmem` for Windows VMs using balloon drivers. This is a Proxmox reporting artefact, not real memory pressure.

**Handling:**
- `alerts.js`: RAM alert tracking is suppressed when `vm.mem > vm.maxmem`
- `app.js`: `memUsed` is capped at `maxmem`; the RAM bar uses a neutral gray (`bar-fill.neutral`); the value shows `X/Y (balloon)`; the card border alert class is also suppressed client-side as a safety net

Do not remove this handling — it will cause false red alerts on every Windows VM.

## Current Status

- Both clusters (PVE1 + PVE2) live and returning data
- Alerts, balloon suppression, and node grouping all working
- Auto-starts on boot via systemd
- Source on GitHub: `git@github.com:csteinsv/proxmox-dashboard.git`
