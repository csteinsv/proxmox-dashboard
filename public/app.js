const fmt = {
  pct: v => `${Math.round(v * 100)}%`,
  mb:  v => v >= 1024 ? `${(v/1024).toFixed(1)}G` : `${Math.round(v)}M`,
};

function barClass(pct) {
  if (pct > 0.8) return 'high';
  if (pct > 0.5) return 'mid';
  return 'low';
}

function backupBadge(ts) {
  if (!ts) return '<div class="backup-status red">No backup</div>';
  const ageDays = (Date.now() / 1000 - ts) / 86400;
  let label;
  if (ageDays < 1)      label = 'today';
  else if (ageDays < 2) label = '1d ago';
  else                  label = `${Math.floor(ageDays)}d ago`;
  const cls = ageDays > 14 ? 'red' : ageDays > 7 ? 'yellow' : 'green';
  return `<div class="backup-status ${cls}">Backed up: ${label}</div>`;
}

function metricRow(label, pct, valStr, clsOverride) {
  const cls = clsOverride ?? barClass(pct);
  return `
    <div class="metric-row">
      <span class="metric-label">${label}</span>
      <div class="bar-track"><div class="bar-fill ${cls}" style="width:${Math.round(pct*100)}%"></div></div>
      <span class="metric-val">${valStr}</span>
    </div>`;
}

function nodeCard(n) {
  const cpuPct  = n.cpu ?? 0;
  const memPct  = n.memory ? n.memory.used / n.memory.total : 0;
  const memUsed = n.memory ? n.memory.used / 1024 / 1024 : 0;
  const memTot  = n.memory ? n.memory.total / 1024 / 1024 : 0;
  return `
    <div class="card">
      <div class="card-header">
        <div class="status-dot ${n.status === 'online' ? 'running' : 'stopped'}"></div>
        <div>
          <div class="card-title">${n.node}</div>
          <div class="card-sub">Node &middot; ${n.cluster}</div>
        </div>
      </div>
      <div class="metrics">
        ${metricRow('CPU', cpuPct, fmt.pct(cpuPct))}
        ${metricRow('RAM', memPct, `${fmt.mb(memUsed)}/${fmt.mb(memTot)}`)}
      </div>
    </div>`;
}

function vmCard(v) {
  const cpuPct    = v.cpu ?? 0;
  const isBalloon = v.maxmem > 0 && v.mem > v.maxmem;
  const memPct    = v.maxmem ? Math.min(v.mem / v.maxmem, 1) : 0;
  const memUsed   = Math.min(v.mem ?? 0, v.maxmem ?? 0) / 1024 / 1024;
  const memTot    = (v.maxmem ?? 0) / 1024 / 1024;
  const ramVal    = `${fmt.mb(memUsed)}/${fmt.mb(memTot)}${isBalloon ? ' (balloon)' : ''}`;
  const status    = v.status ?? 'unknown';
  const badge     = v.type === 'lxc' ? 'CT' : 'VM';
  const alertCls  = !isBalloon && v.alert?.card ? `alert-${v.alert.card}` : '';
  return `
    <div class="card ${alertCls}">
      <div class="card-header">
        <div class="status-dot ${status}"></div>
        <div>
          <div class="card-title">${v.name ?? `${badge} ${v.vmid}`}</div>
          <div class="card-sub">${badge} ${v.vmid} &middot; ${status}</div>
        </div>
      </div>
      ${status === 'running' ? `<div class="metrics">
        ${metricRow('CPU', cpuPct, fmt.pct(cpuPct))}
        ${metricRow('RAM', memPct, ramVal, isBalloon ? 'neutral' : undefined)}
      </div>` : ''}
      ${v.ips?.length ? `<div class="vm-ips">${v.ips.map(ip => `<span class="vm-ip">${ip}</span>`).join('')}</div>` : ''}
      ${backupBadge(v.lastBackup)}
    </div>`;
}

let showAll = false;
let cachedVMs = [];

function renderVMsGrouped(vms) {
  const visible = showAll ? vms : vms.filter(v => v.status === 'running');
  const groups = new Map();
  for (const vm of visible) {
    const key = `${vm.cluster}/${vm.node}`;
    if (!groups.has(key)) groups.set(key, { cluster: vm.cluster, node: vm.node, vms: [] });
    groups.get(key).vms.push(vm);
  }
  if (groups.size === 0) return '<p class="loading">No running VMs.</p>';
  return [...groups.values()].map(g => {
    const mid  = Math.ceil(g.vms.length / 2);
    const colA = g.vms.slice(0, mid);
    const colB = g.vms.slice(mid);
    return `
      <div class="node-group">
        <div class="node-group-header">
          <span class="node-group-name">${g.node}</span>
          <span class="node-cluster-badge">${g.cluster}</span>
        </div>
        <div class="node-group-cols">
          <div class="card-grid">${colA.map(vmCard).join('')}</div>
          <div class="card-grid">${colB.map(vmCard).join('')}</div>
        </div>
      </div>`;
  }).join('');
}

function renderAlertsPanel(vms) {
  const panel = document.getElementById('alerts-panel');
  const list  = document.getElementById('alerts-list');

  const rows = [];
  for (const vm of vms) {
    if (!vm.alert?.triggers?.length) continue;
    const name = vm.name ?? `${vm.type === 'lxc' ? 'CT' : 'VM'} ${vm.vmid}`;
    for (const t of vm.alert.triggers) {
      const mins = t.minutes === 1 ? '1 minute' : `${t.minutes} minutes`;
      rows.push({
        level: t.level,
        html: `<div class="alert-row">
          <span class="alert-dot ${t.level}"></span>
          <span>${name} &middot; ${t.metric} &middot; ${Math.min(100, Math.round(t.value * 100))}% &middot; for ${mins}</span>
        </div>`,
      });
    }
  }

  if (rows.length === 0) {
    panel.classList.add('hidden');
    return;
  }

  rows.sort((a, b) => (a.level === 'red' ? -1 : 1) - (b.level === 'red' ? -1 : 1));
  panel.classList.remove('hidden');
  list.innerHTML = rows.map(r => r.html).join('');
}

function fmtTaskTime(ts) {
  const d = new Date(ts * 1000);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (d.toDateString() === now.toDateString()) return time;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time;
}

function renderLogPanel(tasks) {
  if (!tasks.length) return '<div class="log-row log-empty">No tasks found</div>';
  return tasks.map(t => {
    const statusCls = !t.status ? 'running' : t.status === 'OK' ? 'ok' : 'err';
    const statusTxt = t.status || 'running';
    const vmRef     = t.id ? `<span class="log-vmid">${t.id}</span>` : '';
    return `<div class="log-row">
      <span class="log-time">${fmtTaskTime(t.starttime)}</span>
      <span class="log-type">${t.type}</span>
      ${vmRef}
      <span class="log-status ${statusCls}">${statusTxt}</span>
    </div>`;
  }).join('');
}

async function refresh() {
  try {
    const [nodes, vms, taskClusters] = await Promise.all([
      fetch('/api/nodes').then(r => r.json()),
      fetch('/api/vms').then(r => r.json()),
      fetch('/api/tasks').then(r => r.json()),
    ]);

    vms.sort((a, b) => a.vmid - b.vmid);
    cachedVMs = vms;

    renderAlertsPanel(vms);
    document.getElementById('nodes').innerHTML = nodes.map(nodeCard).join('');
    document.getElementById('vms').innerHTML   = renderVMsGrouped(vms);

    for (const { cluster, tasks } of taskClusters) {
      const panel = document.getElementById(`log-${cluster}`);
      if (panel) {
        panel.querySelector('.log-header').textContent =
          cluster === 'pve' ? 'PVE1 — Recent Tasks' : 'PVE2 — Recent Tasks';
        panel.querySelector('.log-body').innerHTML = renderLogPanel(tasks);
      }
    }

    document.getElementById('last-updated').textContent =
      'Updated ' + new Date().toLocaleTimeString();
  } catch (e) {
    document.getElementById('nodes').innerHTML = `<p class="error">${e.message}</p>`;
  }
}

document.getElementById('toggle-btn').addEventListener('click', () => {
  showAll = !showAll;
  document.getElementById('toggle-btn').textContent = showAll ? 'Running only' : 'Show all';
  document.getElementById('vms').innerHTML = renderVMsGrouped(cachedVMs);
});

refresh();
setInterval(refresh, 10000);
