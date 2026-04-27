import { Router } from 'express';
import { getNodes, getNodeStatus, getAllVMs, getRecentTasks } from '../proxmox.js';
import { evaluateVM, pruneState } from '../alerts.js';

const router = Router();

router.get('/nodes', async (req, res, next) => {
  try {
    const nodes = await getNodes();
    const withStatus = await Promise.all(
      nodes.map(async n => {
        const status = await getNodeStatus(n.node, n.cluster).catch(() => ({}));
        return { ...n, ...status };
      })
    );
    res.json(withStatus);
  } catch (err) {
    next(err);
  }
});

router.get('/vms', async (req, res, next) => {
  try {
    const vms = await getAllVMs();
    vms.sort((a, b) => a.vmid - b.vmid);
    const withAlerts = vms.map(vm => ({ ...vm, alert: evaluateVM(vm) }));
    pruneState(vms.map(v => v.vmid));
    res.json(withAlerts);
  } catch (err) {
    next(err);
  }
});

router.get('/tasks', async (req, res, next) => {
  try {
    const nodes = await getNodes();
    // One representative node per cluster (first listed)
    const seen = new Set();
    const representatives = [];
    for (const n of nodes) {
      if (!seen.has(n.cluster)) {
        seen.add(n.cluster);
        representatives.push({ cluster: n.cluster, node: n.node });
      }
    }
    const results = await Promise.all(
      representatives.map(async ({ cluster, node }) => {
        const tasks = await getRecentTasks(node, cluster);
        return { cluster, node, tasks };
      })
    );
    res.json(results);
  } catch (err) {
    next(err);
  }
});

router.get('/health', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

export default router;
