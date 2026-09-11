const SENSOR_WAIT_MS = 4000;

// Phone: gravity roll drives the book fold
function createPhoneScene(canvas) {
  const motionSheet = document.querySelector('.sheet--motion');
  const enable = motionSheet.querySelector('[data-action="enable"]');
  const renderer = createFold(canvas);

  let target = 0;
  let display = 0;
  let unwrapped = null;
  let previous = null;
  let hasGravity = false;
  let motionEnabled = false;
  let pending = false;
  let sensorTimer;

  function wrap(value) {
    return ((value + 180) % 360 + 360) % 360 - 180;
  }

  function onMotion(e) {
    const total = e.accelerationIncludingGravity;
if (!total) return;

const linear = e.acceleration;
const x = total.x - (linear?.x ?? 0);
const z = total.z - (linear?.z ?? 0);
    if (!Number.isFinite(x) || !Number.isFinite(z) || Math.hypot(x, z) < 0.5) return;

    if (!hasGravity) {
      hasGravity = true;
      clearTimeout(sensorTimer);
      hideUnavailable();
    }

    const roll = Math.atan2(x, -z) * 180 / Math.PI;
    if (unwrapped === null) {
      unwrapped = roll;
    } else {
      unwrapped += wrap(roll - (previous ?? wrap(unwrapped)));
    }
    previous = roll;

    target = Math.max(-180, Math.min(180, -2 * unwrapped));
  }

  document.addEventListener('visibilitychange', () => {
    previous = null;
  });

  function showGesture() {
    showHint('Face the screen toward the sky, then roll the phone left or right.');
  }

  // Motion permission
  async function enableMotion(fromTap = false) {
    if (!isSecureContext || typeof DeviceMotionEvent === 'undefined') {
      showUnavailable();
      return;
    }
    if (motionEnabled || pending) return;

    pending = true;
    enable.disabled = true;

    try {
      if (typeof DeviceMotionEvent.requestPermission === 'function') {
        const state = await DeviceMotionEvent.requestPermission();
        if (state !== 'granted') {
          showUnavailable('Motion access is off. Allow it for this page in Safari settings, then try again.', enableMotion);
          return;
        }
      }

      motionEnabled = true;
      if (motionSheet.open) motionSheet.close();
      window.addEventListener('devicemotion', onMotion);
      onboard(showGesture);
      sensorTimer = setTimeout(() => {
        if (!hasGravity) showUnavailable();
      }, SENSOR_WAIT_MS);
    } catch {
      if (fromTap) {
        showUnavailable('Motion access failed. Tap Enable motion to try again.', enableMotion);
      } else if (!motionSheet.open) {
        motionSheet.showModal();
      }
    } finally {
      pending = false;
      enable.disabled = false;
    }
  }

  enable.addEventListener('click', () => enableMotion(true));
  motionSheet.addEventListener('cancel', (e) => e.preventDefault());

  return {
    defaultImage: 'backgrounds/default.png',
    storageKey: 'background',
    renderer,
    live: () => hasGravity,
    start: () => enableMotion(),
    frame(dt) {
      display += (target - display) * (1 - Math.exp(-dt * FOLLOW));
      if (Math.abs(target - display) < 0.001) display = target;
      renderer.draw(Math.min(Math.abs(display) / 180, 1), display >= 0 ? 0 : 1);
    },
  };
}
