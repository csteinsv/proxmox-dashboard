import { Router } from 'express';
import { getNodes, getNodeStatus, getAllVMs } from '../proxmox.js';
import { evaluateVM } from '../alerts.js';

const router = Router();

router.get('/nodes', async (req, res, next) => {
  try {
    const nodes = await getNodes();
    const withStatus = await Promise.all(
      nodes.map(async n => {
        const status = await getNodeStatus(n.node).catch(() => ({}));
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
    // Sort by vmid ascending — stable order, never shuffled
    vms.sort((a, b) => a.vmid - b.vmid);
    const withAlerts = vms.map(vm => ({ ...vm, alert: evaluateVM(vm) }));
    res.json(withAlerts);
  } catch (err) {
    next(err);
  }
});

router.get('/health', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

export default router;
