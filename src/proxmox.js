import fetch from 'node-fetch';
import https from 'https';

const agent = new https.Agent({ rejectUnauthorized: false });

function makeClient(host, port, tokenId, tokenSecret) {
  const base = `https://${host}:${port}/api2/json`;
  const headers = { Authorization: `PVEAPIToken=${tokenId}=${tokenSecret}` };
  return async function api(path) {
    const res = await fetch(`${base}${path}`, { headers, agent });
    if (!res.ok) throw new Error(`Proxmox API ${res.status}: ${path}`);
    const { data } = await res.json();
    return data;
  };
}

function getClusters() {
  const clusters = [
    {
      label: 'pve',
      api: makeClient(
        process.env.PROXMOX_HOST,
        process.env.PROXMOX_PORT || '8006',
        `${process.env.PROXMOX_USER}!${process.env.PROXMOX_TOKEN_NAME}`,
        process.env.PROXMOX_TOKEN_VALUE,
      ),
    },
  ];

  if (process.env.PVE2_HOST) {
    clusters.push({
      label: 'pve2',
      api: makeClient(
        process.env.PVE2_HOST,
        process.env.PVE2_PORT || '8006',
        process.env.PVE2_TOKEN_ID,
        process.env.PVE2_TOKEN_SECRET,
      ),
    });
  }

  return clusters;
}

async function getVMIPs(c, node, vmid, type) {
  try {
    if (type === 'lxc') {
      const ifaces = await c.api(`/nodes/${node}/lxc/${vmid}/interfaces`);
      return ifaces
        .filter(i => i.name !== 'lo')
        .flatMap(i => {
          const addrs = [];
          if (i.inet && !i.inet.startsWith('127.')) addrs.push(i.inet.split('/')[0]);
          return addrs;
        });
    } else {
      const data = await c.api(`/nodes/${node}/qemu/${vmid}/agent/network-get-interfaces`);
      return (data.result || [])
        .filter(i => i.name !== 'lo')
        .flatMap(i => (i['ip-addresses'] || [])
          .filter(a => a['ip-address-type'] === 'ipv4' && !a['ip-address'].startsWith('127.'))
          .map(a => a['ip-address'])
        );
    }
  } catch {
    return [];
  }
}

// Returns vmid (string) -> most recent backup ctime (unix seconds)
async function getLastBackups(c, nodes) {
  if (nodes.length === 0) return {};
  const node = nodes[0].node;

  const storages = await c.api(`/nodes/${node}/storage`).catch(() => []);
  const backupStorages = storages.filter(s =>
    (s.content || '').split(',').includes('backup')
  );

  const allFiles = await Promise.all(
    backupStorages.map(s =>
      c.api(`/nodes/${node}/storage/${s.storage}/content?content=backup`).catch(() => [])
    )
  );

  const map = {};
  for (const files of allFiles) {
    for (const f of files) {
      if (!f.vmid || !f.ctime) continue;
      const vmid = String(f.vmid);
      if (!map[vmid] || f.ctime > map[vmid]) map[vmid] = f.ctime;
    }
  }
  return map;
}

async function getNodeVMs(c, n) {
  const [qemu, lxc] = await Promise.all([
    c.api(`/nodes/${n.node}/qemu`).catch(() => []),
    c.api(`/nodes/${n.node}/lxc`).catch(() => []),
  ]);
  const vms = [
    ...qemu.map(v => ({ ...v, type: 'qemu', node: n.node, cluster: c.label })),
    ...lxc.map(v => ({ ...v, type: 'lxc', node: n.node, cluster: c.label })),
  ];
  return Promise.all(
    vms.map(async v => {
      if (v.status !== 'running') return { ...v, ips: [] };
      const ips = await getVMIPs(c, n.node, v.vmid, v.type);
      return { ...v, ips };
    })
  );
}

export async function getNodes() {
  const results = await Promise.all(
    getClusters().map(async c => {
      const nodes = await c.api('/nodes');
      return nodes.map(n => ({ ...n, cluster: c.label }));
    })
  );
  return results.flat();
}

export async function getNodeStatus(node, cluster) {
  const c = getClusters().find(c => c.label === cluster);
  if (!c) throw new Error(`Unknown cluster: ${cluster}`);
  return c.api(`/nodes/${node}/status`);
}

export async function getAllVMs() {
  const all = await Promise.all(
    getClusters().map(async c => {
      const nodes = await c.api('/nodes');
      const [perNode, lastBackups] = await Promise.all([
        Promise.all(nodes.map(n => getNodeVMs(c, n))),
        getLastBackups(c, nodes),
      ]);
      return perNode.flat().map(v => ({
        ...v,
        lastBackup: lastBackups[String(v.vmid)] ?? null,
      }));
    })
  );
  return all.flat();
}
