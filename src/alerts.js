const SUSTAIN_MS = 5 * 60 * 1000;

const state = {};

function track(id, metric, crossed) {
  const now = Date.now();
  state[id] ??= {};
  state[id][metric] ??= { since: null };
  const s = state[id][metric];
  if (crossed) {
    if (s.since === null) s.since = now;
  } else {
    s.since = null;
  }
  return s.since === null ? null : now - s.since;
}

function level(elapsed, hasPending) {
  if (elapsed === null) return null;
  if (elapsed >= SUSTAIN_MS) return 'red';
  return hasPending ? 'yellow' : null;
}

function worst(...levels) {
  if (levels.includes('red')) return 'red';
  if (levels.includes('yellow')) return 'yellow';
  return null;
}

export function evaluateVM(vm) {
  const id = String(vm.vmid);

  const cpuPct  = vm.cpu ?? 0;
  const memPct  = vm.maxmem > 0 ? vm.mem / vm.maxmem : 0;
  const diskPct = vm.type === 'lxc' && vm.maxdisk > 0 ? vm.disk / vm.maxdisk : 0;

  const cpuElapsed  = track(id, 'cpu',  cpuPct  > 0.80);
  const memElapsed  = track(id, 'mem',  memPct  > 0.75);
  const diskElapsed = track(id, 'disk', diskPct > 0.75);

  const cpuLevel  = level(cpuElapsed,  false);
  const memLevel  = level(memElapsed,  true);
  const diskLevel = level(diskElapsed, true);

  const card = worst(cpuLevel, memLevel, diskLevel);

  const triggers = [];
  if (cpuLevel)  triggers.push({ metric: 'CPU',  level: cpuLevel,  value: cpuPct,  minutes: Math.floor(cpuElapsed  / 60000) });
  if (memLevel)  triggers.push({ metric: 'RAM',  level: memLevel,  value: memPct,  minutes: Math.floor(memElapsed  / 60000) });
  if (diskLevel) triggers.push({ metric: 'Disk', level: diskLevel, value: diskPct, minutes: Math.floor(diskElapsed / 60000) });

  return { card, triggers };
}
