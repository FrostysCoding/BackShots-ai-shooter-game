/* dev-only autoplay bot for regression runs; never referenced by index.html */

/* Grid pathfinder over the same colliders the player obeys, so the bot routes
   around cover instead of grinding into it. */
const NAV = (() => {
  const STEP = 0.5, W = Math.round(60 / STEP) + 1;
  const cell = v => Math.round((v + 30) / STEP);
  const world = c => c * STEP - 30;
  let free = null;
  function build(){
    free = new Uint8Array(W * W);
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++)
      free[j*W+i] = blocked(world(i), world(j), 0.35, 1.6, 0.42) ? 0 : 1;
  }
  /* BFS, returns the next waypoint toward (tx,tz) or null */
  return function nav(sx, sz, tx, tz){
    if (!free) build();
    const si = cell(sx), sj = cell(sz), ti = cell(tx), tj = cell(tz);
    if (si < 0 || sj < 0 || si >= W || sj >= W) return null;
    const start = sj*W + si, goal = tj*W + ti;
    const prev = new Int32Array(W*W).fill(-1);
    const q = [start]; prev[start] = start;
    let found = -1, best = Infinity, bestIdx = -1;
    for (let h = 0; h < q.length && h < 20000; h++){
      const cur = q[h], ci = cur % W, cj = (cur - ci) / W;
      const d2 = (ci-ti)*(ci-ti) + (cj-tj)*(cj-tj);
      if (d2 < best){ best = d2; bestIdx = cur; }
      if (cur === goal){ found = cur; break; }
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++){
        if (!di && !dj) continue;
        const ni = ci+di, nj = cj+dj;
        if (ni < 0 || nj < 0 || ni >= W || nj >= W) continue;
        const n = nj*W + ni;
        if (prev[n] !== -1 || !free[n]) continue;
        if (di && dj && (!free[cj*W+ni] || !free[nj*W+ci])) continue;
        prev[n] = cur; q.push(n);
      }
    }
    let node = found !== -1 ? found : bestIdx;
    if (node === -1 || node === start) return null;
    /* walk back to the step after start */
    let guard = 0;
    while (prev[node] !== start && prev[node] !== node && guard++ < 8000) node = prev[node];
    return [world(node % W), world((node - node % W) / W)];
  };
})();

/* err = radians of aim error per shot, react = pause after acquiring a target */
window.__human = function(err, react){
  err = err === undefined ? 0.018 : err;
  react = react === undefined ? 0.22 : react;
  clearInterval(window.__ai);
  let target = null, acquired = 0, side = 0, sideT = 0, wp = null, wpT = 0;
  window.__ai = setInterval(() => {
    if (G.over){ clearInterval(window.__ai); return; }
    if (!G.running) return;
    const dt = 0.05, P = player.pos;

    /* pick the nearest enemy with a clear line */
    let best = null, bd = 1e9;
    const eye = camera.position.clone();
    const R = new THREE.Raycaster();
    for (const e of enemies){
      if (e.dead) continue;
      const c = e.obj.position.clone(); c.y += 1.2;
      const d = c.distanceTo(eye);
      if (d > 45) continue;
      const dir = c.clone().sub(eye).normalize();
      R.set(eye, dir); R.far = d - 0.5;
      if (R.intersectObjects(worldSolid, false).length) continue;
      if (d < bd){ bd = d; best = e; }
    }
    if (best !== target){ target = best; acquired = 0; }
    acquired += dt;

    if (target){
      const c = target.obj.position.clone(); c.y += 1.25;
      const d = c.clone().sub(camera.position);
      const wantYaw = Math.atan2(-d.x, -d.z) + rand(-err, err);
      const wantPitch = Math.atan2(d.y, Math.hypot(d.x, d.z)) + rand(-err, err);
      let dy = wantYaw - player.yaw;
      while (dy > Math.PI) dy -= Math.PI*2;
      while (dy < -Math.PI) dy += Math.PI*2;
      player.yaw += dy * 0.34;
      player.pitch += (wantPitch - player.pitch) * 0.34;
      if (acquired > react){
        if (bd > 16 && !player.ads) setADS(true);
        if (bd < 10 && player.ads) setADS(false);
        const w = WEAPONS[player.weapon];
        if (w.mag <= 0) startReload();
        else { player.triggerHeld = true; player.clickBuf = 0.1; }
      }
      /* strafe while engaging */
      sideT -= dt;
      if (sideT <= 0){ side = Math.random() < 0.5 ? -1 : 1; sideT = rand(0.7, 1.6); }
      const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
      const sx = -fz * side, sz = fx * side;
      const step = 0.055;
      moveSlide(P, sx*step, sz*step, 0.36, player.height);
      if (bd > 12) moveSlide(P, fx*step, fz*step, 0.36, player.height);
    } else {
      player.triggerHeld = false;
      if (player.ads) setADS(false);
      /* route to the nearest living enemy */
      const alive = enemies.filter(e => !e.dead);
      if (!alive.length) return;
      let goal = alive[0], gd = 1e9;
      for (const e of alive){
        const d = Math.hypot(e.obj.position.x-P.x, e.obj.position.z-P.z);
        if (d < gd){ gd = d; goal = e; }
      }
      wpT -= dt;
      if (!wp || wpT <= 0 || Math.hypot(wp[0]-P.x, wp[1]-P.z) < 0.7){
        wp = NAV(P.x, P.z, goal.obj.position.x, goal.obj.position.z);
        wpT = 0.5;
      }
      if (wp){
        const dx = wp[0]-P.x, dz = wp[1]-P.z, d = Math.hypot(dx, dz) || 1;
        const step = 0.075;
        moveSlide(P, dx/d*step, dz/d*step, 0.36, player.height);
        const wantYaw = Math.atan2(-dx/d, -dz/d);
        let dy = wantYaw - player.yaw;
        while (dy > Math.PI) dy -= Math.PI*2;
        while (dy < -Math.PI) dy += Math.PI*2;
        player.yaw += dy * 0.18;
        player.pitch += (0 - player.pitch) * 0.2;
      }
    }
    /* stay on the deck */
    const g = groundAt(P.x, P.z, P.y + 1.2);
    if (g !== null && g < P.y + 0.7) P.y = g;
    const w = WEAPONS[player.weapon];
    if (w.mag <= 0 && player.reloadT <= 0) startReload();
  }, 50);
  return 'human bot running';
};
'bot ready';
