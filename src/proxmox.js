import fetch from 'node-fetch';
import https from 'https';

const agent = new https.Agent({ rejectUnauthorized: false });

function baseUrl() {
  const { PROXMOX_HOST, PROXMOX_PORT } = process.env;
  return `https://${PROXMOX_HOST}:${PROXMOX_PORT}/api2/json`;
}

function authHeader() {
  const { PROXMOX_USER, PROXMOX_TOKEN_NAME, PROXMOX_TOKEN_VALUE } = process.env;
  return { Authorization: `PVEAPIToken=${PROXMOX_USER}!${PROXMOX_TOKEN_NAME}=${PROXMOX_TOKEN_VALUE}` };
}

async function api(path) {
  const res = await fetch(`${baseUrl()}${path}`, {
    headers: authHeader(),
    agent,
  });
  if (!res.ok) throw new Error(`Proxmox API ${res.status}: ${path}`);
  const { data } = await res.json();
  return data;
}

export async function getNodes() {
  return api('/nodes');
}

export async function getNodeStatus(node) {
  return api(`/nodes/${node}/status`);
}

export async function getVMs(node) {
  const [qemu, lxc] = await Promise.all([
    api(`/nodes/${node}/qemu`).catch(() => []),
    api(`/nodes/${node}/lxc`).catch(() => []),
  ]);
  return [
    ...qemu.map(v => ({ ...v, type: 'qemu' })),
    ...lxc.map(v => ({ ...v, type: 'lxc' })),
  ];
}

export async function getAllVMs() {
  const nodes = await getNodes();
  const results = await Promise.all(nodes.map(n => getVMs(n.node)));
  return results.flat();
}
