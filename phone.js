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

  // 센서 충돌 및 흔들림 방지
  let lastMotionAt = 0;
  let orientationTarget = 0;

  // 카툭튀로 인한 초기 기울기 보정값
  let neutralRoll = null;
  let neutralOrientation = null;

  function wrap(value) {
    return ((value + 180) % 360 + 360) % 360 - 180;
  }

  function onMotion(e) {
    const total = e.accelerationIncludingGravity;
    const linear = e.acceleration;

    if (!total) return;

    const x = total.x - (linear?.x ?? 0);
    const z = total.z - (linear?.z ?? 0);

    if (
      !Number.isFinite(x) ||
      !Number.isFinite(z) ||
      Math.hypot(x, z) < 0.5
    ) {
      return;
    }

    lastMotionAt = performance.now();

    if (!hasGravity) {
      hasGravity = true;
      clearTimeout(sensorTimer);
      hideUnavailable();
    }

    // 갤럭시 S23 기준: 화면이 하늘을 보면 z가 양수
    const roll = Math.atan2(x, z) * 180 / Math.PI;

    // 카툭튀로 생기는 초기 기울기를 0도로 보정
    if (neutralRoll === null) {
      neutralRoll = roll;
      previous = 0;
      unwrapped = 0;
      target = 0;
      return;
    }

    const relativeRoll = wrap(roll - neutralRoll);

    if (unwrapped === null) {
      unwrapped = relativeRoll;
    } else {
      unwrapped += wrap(
        relativeRoll - (previous ?? relativeRoll)
      );
    }

    previous = relativeRoll;

    target = Math.max(
      -180,
      Math.min(180, -2 * unwrapped)
    );
  }

  // Android fallback
  function onOrientation(e) {
    if (!Number.isFinite(e.gamma)) return;

    // devicemotion이 정상 작동하면 orientation은 무시
    if (performance.now() - lastMotionAt < 300) {
      return;
    }

    if (!hasGravity) {
      hasGravity = true;
      clearTimeout(sensorTimer);
      hideUnavailable();
    }

    // 카툭튀로 인한 초기 기울기를 0도로 보정
    if (neutralOrientation === null) {
      neutralOrientation = e.gamma;
      orientationTarget = 0;
      target = 0;
      return;
    }

    const relativeGamma = e.gamma - neutralOrientation;

    const nextTarget = Math.max(
      -180,
      Math.min(180, -2 * relativeGamma)
    );

    // 센서 지직거림 완화
    orientationTarget +=
      (nextTarget - orientationTarget) * 0.12;

    target = orientationTarget;
  }

  document.addEventListener('visibilitychange', () => {
    previous = null;
    unwrapped = null;
    neutralRoll = null;
    neutralOrientation = null;
    lastMotionAt = 0;
    orientationTarget = 0;
    target = 0;
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
      showUnavailable(
        'This browser cannot access motion sensors.'
      );
      return;
    }

    if (motionEnabled || pending) return;

    pending = true;
    enable.disabled = true;

    try {
      // iPhone Safari용 권한 요청
      if (
        hasMotion &&
        typeof DeviceMotionEvent.requestPermission === 'function'
      ) {
        const state =
          await DeviceMotionEvent.requestPermission();

        if (state !== 'granted') {
          showUnavailable(
            'Motion access is off. Allow it for this page, then try again.',
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

      if (hasOrientation) {
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
    } catch (error) {
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
