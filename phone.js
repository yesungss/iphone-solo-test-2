const SENSOR_WAIT_MS = 4000;
const SENSOR_STALE_MS = 1000;
const SENSOR_DISCOVERY_MS = 500;

// Phone: gravity roll drives the original book fold.
function createPhoneScene(canvas) {
  const motionSheet = document.querySelector('.sheet--motion');
  const enable = motionSheet.querySelector('[data-action="enable"]');
  const renderer = createFold(canvas);
  const android = /Android/i.test(navigator.userAgent);
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const preferredSource = android ? 'orientation' : 'motion';
  const samples = { motion: null, orientation: null };

  let target = 0;
  let display = 0;
  let previous = null;
  let unwrapped = null;
  let source = null;
  let consumed = null;
  let hasGravity = false;
  let motionEnabled = false;
  let pending = false;
  let startedAt = 0;
  let sensorTimer;
  let onboarded = false;

  function wrap(value) {
    return ((value + 180) % 360 + 360) % 360 - 180;
  }

  function screenAngle() {
    return (screen.orientation?.angle ?? window.orientation ?? 0) * Math.PI / 180;
  }

  function record(kind, x, y, z) {
    if (document.hidden || ![x, y, z].every(Number.isFinite)) return;
    const angle = screenAngle();
    // Screen angle is counter-clockwise from the natural device orientation.
    const across = x * Math.cos(angle) - y * Math.sin(angle);
    // When held upright, gravity cannot determine roll about the screen's
    // vertical axis. Hold the last pose instead of amplifying sensor noise.
    if (Math.hypot(across, z) < 0.1) return;
    samples[kind] = {
      roll: Math.atan2(-across, z) * 180 / Math.PI,
      at: performance.now(),
    };
    if (!hasGravity) {
      hasGravity = true;
      clearTimeout(sensorTimer);
      hideUnavailable();
    }
  }

  function onMotion(e) {
    const total = e.accelerationIncludingGravity;
    if (!total || ![total.x, total.y, total.z].every(Number.isFinite)) return;
    const linear = e.acceleration;
    // Use a complete vector from one source; null axes are not zero readings.
    const hasLinear = linear && [linear.x, linear.y, linear.z].every(Number.isFinite);
    const sign = ios ? -1 : 1;
    record('motion',
      sign * (total.x - (hasLinear ? linear.x : 0)) / 9.80665,
      sign * (total.y - (hasLinear ? linear.y : 0)) / 9.80665,
      sign * (total.z - (hasLinear ? linear.z : 0)) / 9.80665);
  }

  function onOrientation(e) {
    if (!Number.isFinite(e.beta) || !Number.isFinite(e.gamma)) return;
    const beta = e.beta * Math.PI / 180;
    const gamma = e.gamma * Math.PI / 180;
    // W3C Z-X'-Y'' rotation matrix, last row. Using gamma alone jumps at
    // Euler-angle boundaries and ignores portrait/landscape and pitch.
    record('orientation', -Math.cos(beta) * Math.sin(gamma),
      Math.sin(beta), Math.cos(beta) * Math.cos(gamma));
  }

  function updateTarget() {
    const now = performance.now();
    const fresh = (kind) => samples[kind] && now - samples[kind].at < SENSOR_STALE_MS;
    // Lock to one stream while it is healthy. Both streams use the same
    // absolute, screen-up reference, so fallback has no calibration offset.
    if (!source || !fresh(source)) {
      const next = fresh(preferredSource) ? preferredSource
        : (fresh('motion') ? 'motion' : (fresh('orientation') ? 'orientation' : null));
      if (!next) return;
      if (!source && next !== preferredSource && now - startedAt < SENSOR_DISCOVERY_MS) return;
      if (source !== next) {
        source = next;
        previous = null;
        unwrapped = null;
        consumed = null;
      }
    }
    const sample = samples[source];
    if (sample === consumed) return;
    consumed = sample;
    unwrapped = previous === null ? sample.roll : unwrapped + wrap(sample.roll - previous);
    // Do not accumulate complete revolutions and get stuck at the end stop.
    unwrapped = Math.max(-180, Math.min(180, unwrapped));
    previous = sample.roll;
    target = Math.max(-180, Math.min(180, -2 * unwrapped));
  }

  function resetReadings() {
    samples.motion = samples.orientation = null;
    previous = unwrapped = source = consumed = null;
    hasGravity = false;
    startedAt = performance.now();
    clearTimeout(sensorTimer);
  }

  function waitForSensor() {
    clearTimeout(sensorTimer);
    sensorTimer = setTimeout(() => {
      if (!hasGravity && !document.hidden) {
        showUnavailable('No motion readings. Allow motion sensors in this browser’s site settings, hold the screen toward the sky, then try again.', enableMotion);
      }
    }, SENSOR_WAIT_MS);
  }

  function detach() {
    window.removeEventListener('devicemotion', onMotion);
    window.removeEventListener('deviceorientation', onOrientation);
    motionEnabled = false;
    resetReadings();
  }

  function showGesture() {
    showHint('Face the screen toward the sky, then roll the phone left or right.');
  }

  async function enableMotion(fromTap = false) {
    if (pending) return;
    if (!isSecureContext) {
      showUnavailable('Motion sensors require HTTPS.');
      return;
    }
    const motion = typeof DeviceMotionEvent !== 'undefined' ? DeviceMotionEvent : null;
    const orientation = typeof DeviceOrientationEvent !== 'undefined' ? DeviceOrientationEvent : null;
    if (!motion && !orientation) {
      showUnavailable('This browser cannot access motion sensors.');
      return;
    }
    if (!fromTap && [motion, orientation].some((api) => typeof api?.requestPermission === 'function')) {
      if (!motionSheet.open) motionSheet.showModal();
      return;
    }

    pending = true;
    enable.disabled = true;
    detach();
    try {
      // Invoke both requests within the tap's user activation, before awaiting.
      const permission = (api) => !api ? Promise.resolve(false)
        : typeof api.requestPermission !== 'function' ? Promise.resolve(true)
          : api.requestPermission().then((state) => state === 'granted').catch(() => false);
      const [allowMotion, allowOrientation] = await Promise.all([permission(motion), permission(orientation)]);
      if (!allowMotion && !allowOrientation) {
        showUnavailable('Motion access is off. Allow motion sensors for this page, then try again.', enableMotion);
        return;
      }
      if (allowMotion) window.addEventListener('devicemotion', onMotion, { passive: true });
      if (allowOrientation) window.addEventListener('deviceorientation', onOrientation, { passive: true });
      motionEnabled = true;
      resetReadings();
      hideUnavailable();
      if (motionSheet.open) motionSheet.close();
      if (!onboarded) {
        onboarded = true;
        onboard(showGesture);
      }
      waitForSensor();
    } catch {
      showUnavailable('Motion access failed. Tap Enable motion to try again.', enableMotion);
    } finally {
      pending = false;
      enable.disabled = false;
    }
  }

  function resume() {
    resetReadings();
    if (motionEnabled && !document.hidden) waitForSensor();
  }
  document.addEventListener('visibilitychange', resume);
  // Keep listeners across BFCache: pagehide is also fired for cached pages.
  window.addEventListener('pagehide', () => resetReadings());
  window.addEventListener('pageshow', resume);
  if (screen.orientation?.addEventListener) screen.orientation.addEventListener('change', resume);
  else window.addEventListener('orientationchange', resume);
  enable.addEventListener('click', () => enableMotion(true));
  motionSheet.addEventListener('cancel', (e) => e.preventDefault());

  return {
    defaultImage: 'backgrounds/default.png',
    storageKey: 'background',
    renderer,
    live: () => hasGravity,
    start: () => enableMotion(),
    frame(dt) {
      updateTarget();
      // Exactly the original time-based follow and fold mapping (also at 120 Hz).
      display += (target - display) * (1 - Math.exp(-dt * FOLLOW));
      if (Math.abs(target - display) < 0.001) display = target;
      renderer.draw(Math.min(Math.abs(display) / 180, 1), display >= 0 ? 0 : 1);
    },
  };
}
