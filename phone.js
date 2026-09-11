const SENSOR_WAIT_MS = 4000;

// Phone: gravity roll drives the book fold
function createPhoneScene(canvas) {
  const motionSheet = document.querySelector('.sheet--motion');
  const enable = motionSheet.querySelector('[data-action="enable"]');
  const renderer = createFold(canvas);

  const isAndroid = /Android/i.test(navigator.userAgent);

  let target = 0;
  let display = 0;
  let unwrapped = null;
  let previous = null;
  let hasGravity = false;
  let motionEnabled = false;
  let pending = false;
  let sensorTimer;
  let lastOrientationAt = 0;

  function wrap(value) {
    return ((value + 180) % 360 + 360) % 360 - 180;
  }

  function acceptRoll(roll) {
    if (!Number.isFinite(roll)) return;

    if (!hasGravity) {
      hasGravity = true;
      clearTimeout(sensorTimer);
      hideUnavailable();
    }

    if (unwrapped === null) {
      unwrapped = roll;
    } else {
      unwrapped += wrap(roll - (previous ?? wrap(unwrapped)));
    }

    previous = roll;

    target = Math.max(
      -180,
      Math.min(180, -2 * unwrapped)
    );
  }

  function onMotion(e) {
    const total = e.accelerationIncludingGravity;
    if (!total) return;

    /*
     * Android Chrome/Samsung Internet may return null for acceleration.
     * In that case use accelerationIncludingGravity directly.
     */
    if (isAndroid) {
      if (
        performance.now() - lastOrientationAt < 1000 ||
        !Number.isFinite(total.x) ||
        !Number.isFinite(total.z)
      ) {
        return;
      }

      if (Math.hypot(total.x, total.z) < 0.5) return;

      const roll = Math.atan2(total.x, -total.z) * 180 / Math.PI;
      acceptRoll(roll);
      return;
    }

    /*
     * Original iPhone path — unchanged.
     */
    const linear = e.acceleration;
    if (!linear) return;

    const x = total.x - linear.x;
    const z = total.z - linear.z;

    if (
      !Number.isFinite(x) ||
      !Number.isFinite(z) ||
      Math.hypot(x, z) < 0.5
    ) {
      return;
    }

    const roll = Math.atan2(x, -z) * 180 / Math.PI;
    acceptRoll(roll);
  }

  function onOrientation(e) {
    if (!isAndroid || !Number.isFinite(e.gamma)) return;

    lastOrientationAt = performance.now();

    /*
     * gamma is Android's left/right roll angle.
     * The original -2x mapping is preserved.
     */
    acceptRoll(e.gamma);
  }

  document.addEventListener('visibilitychange', () => {
    previous = null;
    unwrapped = null;
    lastOrientationAt = 0;
  });

  function showGesture() {
    showHint(
      'Face the screen toward the sky, then roll the phone left or right.'
    );
  }

  // Motion permission
  async function enableMotion(fromTap = false) {
    const hasMotion =
      typeof DeviceMotionEvent !== 'undefined';

    const hasOrientation =
      typeof DeviceOrientationEvent !== 'undefined';

    if (
      !isSecureContext ||
      (!hasMotion && !hasOrientation)
    ) {
      showUnavailable();
      return;
    }

    if (motionEnabled || pending) return;

    pending = true;
    enable.disabled = true;

    try {
      /*
       * iPhone Safari permission request.
       * Android does not normally require this permission prompt.
       */
      if (
        hasMotion &&
        typeof DeviceMotionEvent.requestPermission === 'function'
      ) {
        const state =
          await DeviceMotionEvent.requestPermission();

        if (state !== 'granted') {
          showUnavailable(
            'Motion access is off. Allow it for this page in browser settings, then try again.',
            enableMotion
          );
          return;
        }
      }

      motionEnabled = true;

      if (motionSheet.open) {
        motionSheet.close();
      }

      if (hasMotion) {
        window.addEventListener(
          'devicemotion',
          onMotion,
          { passive: true }
        );
      }

      if (isAndroid && hasOrientation) {
        window.addEventListener(
          'deviceorientation',
          onOrientation,
          { passive: true }
        );
      }

      onboard(showGesture);

      sensorTimer = setTimeout(() => {
        if (!hasGravity) {
          showUnavailable(
            'Motion sensor data was not received. Check browser permissions and try again.',
            enableMotion
          );
        }
      }, SENSOR_WAIT_MS);
    } catch {
      if (fromTap) {
        showUnavailable(
          'Motion access failed. Tap Enable motion to try again.',
          enableMotion
        );
      } else if (!motionSheet.open) {
        motionSheet.showModal();
      }
    } finally {
      pending = false;
      enable.disabled = false;
    }
  }

  window.addEventListener('pagehide', () => {
    window.removeEventListener(
      'devicemotion',
      onMotion
    );

    window.removeEventListener(
      'deviceorientation',
      onOrientation
    );
  });

  enable.addEventListener('click', () => {
    enableMotion(true);
  });

  motionSheet.addEventListener('cancel', (e) => {
    e.preventDefault();
  });

  return {
    defaultImage: 'backgrounds/default.png',
    storageKey: 'background',
    renderer,

    live: () => hasGravity,

    start: () => {
      enableMotion();
    },

    frame(dt) {
      /*
       * Original easing and rendering logic — unchanged.
       */
      display +=
        (target - display) *
        (1 - Math.exp(-dt * FOLLOW));

      if (Math.abs(target - display) < 0.001) {
        display = target;
      }

      renderer.draw(
        Math.min(Math.abs(display) / 180, 1),
        display >= 0 ? 0 : 1
      );
    },
  };
}
