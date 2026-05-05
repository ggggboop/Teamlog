import type { MutableRefObject } from 'react';
import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { lineageData, lineageLinks } from './spatialLineageData';

export interface SpatialLineageViewportHandle {
  resetView: () => void;
}

export interface LoginActionsBridge {
  onOpenFullForm: () => void;
}

export interface SpatialLineageViewportProps {
  loginBridgeRef: MutableRefObject<LoginActionsBridge>;
  /** 로그인 상세 팝업이 열린 동안 수소(DK) 호버와 동일한 거리별 블러 유지 */
  loginOverlayActive?: boolean;
}

/** 휠로 쓰이던 최대 확대(translateZ) 기준의 70%로 고정 (max=200 → 140) */
export const SPATIAL_FIXED_TRANS_Z = Math.round(200 * 0.7);

const DK_LOGO_SRC = `${import.meta.env.BASE_URL}brand/dongkoo-dk-logo.png`;

type CamState = {
  currentRotX: number;
  currentRotZ: number;
  currentTransZ: number;
  panX: number;
  panY: number;
};

let state: CamState = {
  currentRotX: 45,
  currentRotZ: -15,
  currentTransZ: SPATIAL_FIXED_TRANS_Z,
  panX: 0,
  panY: 0,
};

function applyCameraTransform(camera: HTMLDivElement, s: CamState) {
  camera.style.transform = `translateZ(${s.currentTransZ}px) rotateX(${s.currentRotX}deg) rotateZ(${s.currentRotZ}deg) translateX(${s.panX}px) translateY(${s.panY}px)`;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/** 수소(DK)에 마우스 올렸을 때와 동일한 블러(거리·연결 반영) */
function applyHydrogenBlur(world: HTMLElement) {
  const hEl = world.querySelector('[data-id="h"]');
  if (!hEl) return;
  world.querySelectorAll('.sl-node-container').forEach((n) => {
    if (n !== hEl) {
      n.classList.remove('sl-blur-light', 'sl-blur-medium');
      n.classList.add('sl-blur-heavy');
    }
  });
  lineageLinks.forEach((l) => {
    if (l.source !== 'h' && l.target !== 'h') return;
    const relativeId = l.source === 'h' ? l.target : l.source;
    const relNode = world.querySelector(`[data-id="${relativeId}"]`);
    if (relNode) {
      relNode.classList.remove('sl-blur-heavy');
      relNode.classList.add('sl-blur-light');
    }
  });
}

function resetWorldBlur(world: HTMLElement) {
  world.querySelectorAll('.sl-node-container').forEach((n) => {
    n.classList.remove('sl-blur-heavy', 'sl-blur-light', 'sl-blur-medium');
    const z = parseFloat((n as HTMLElement).dataset.z ?? '0');
    if (z < -20) n.classList.add('sl-blur-medium');
    else if (z < 0) n.classList.add('sl-blur-light');
  });
}

function syncBlurAfterRender(world: HTMLElement, loginOverlayActive: boolean) {
  if (loginOverlayActive) {
    applyHydrogenBlur(world);
    return;
  }
  requestAnimationFrame(() => {
    const stackHovered = world.querySelector('.sl-login-stack:hover');
    if (stackHovered) applyHydrogenBlur(world);
    else resetWorldBlur(world);
  });
}

function renderScene(
  world: HTMLDivElement,
  camera: HTMLDivElement,
  opts: {
    bridge: MutableRefObject<LoginActionsBridge>;
    loginOverlayActiveRef: MutableRefObject<boolean>;
  }
) {
  const { loginOverlayActiveRef } = opts;
  world.innerHTML = '';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'sl-connections-layer');
  world.appendChild(svg);

  lineageLinks.forEach((link) => {
    const s = lineageData.find((n) => n.id === link.source);
    const t = lineageData.find((n) => n.id === link.target);
    if (!s || !t) return;

    if (link.type === 'descent') {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const sx = s.x + 2000;
      const sy = s.y + 2000;
      const tx = t.x + 2000;
      const ty = t.y + 2000;
      const cx1 = sx;
      const cy1 = sy + Math.abs(ty - sy) / 2;
      const cx2 = tx;
      const cy2 = ty - Math.abs(ty - sy) / 2;
      path.setAttribute('d', `M ${sx} ${sy} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${tx} ${ty}`);
      path.setAttribute('class', 'sl-link-path');
      if (s.z < 0 || t.z < 0) {
        path.style.opacity = '0.3';
        path.style.strokeWidth = '4';
      }
      svg.appendChild(path);
    } else if (link.type === 'marriage') {
      const bridge = document.createElement('div');
      bridge.className = 'sl-node-container';
      const mx = (s.x + t.x) / 2;
      const my = (s.y + t.y) / 2;
      const mz = Math.min(s.z, t.z) - 5;
      const dist = Math.sqrt((t.x - s.x) ** 2 + (t.y - s.y) ** 2);
      bridge.style.transform = `translate3d(${mx}px, ${my}px, ${mz}px)`;
      const inner = document.createElement('div');
      inner.className = 'sl-node sl-node-glass sl-bond-marriage';
      inner.style.width = `${dist + 20}px`;
      inner.style.height = '40px';
      inner.style.top = '-20px';
      inner.style.left = `-${(dist + 20) / 2}px`;
      bridge.appendChild(inner);
      world.appendChild(bridge);
    }
  });

  /* 수소(DK)는 마지막에 append — 동일 translateZ(예: He 40)일 때 DOM 순서로 앞에 그려지게 */
  const lineageRenderOrder = (() => {
    const rest = lineageData.filter((n) => n.id !== 'h');
    const h = lineageData.find((n) => n.id === 'h');
    return h ? [...rest, h] : rest;
  })();

  lineageRenderOrder.forEach((node) => {
    const el = document.createElement('div');
    el.className = 'sl-node-container';
    el.dataset.id = node.id;
    el.dataset.z = String(node.z);
    el.style.transform = `translate3d(${node.x}px, ${node.y}px, ${node.z}px)`;
    if (node.type === 'primary') el.classList.add('sl-node-container--primary');

    if (node.z < -20) el.classList.add('sl-blur-medium');
    else if (node.z < 0) el.classList.add('sl-blur-light');

    const isPrimary = node.type === 'primary';
    const isHydrogen = node.id === 'h';
    const nodeClass = isPrimary ? 'sl-node sl-node-blue' : 'sl-node sl-node-white';

    const displayName = isHydrogen ? '시작하기' : node.fullName;
    const displayRelation = node.relation;

    const visual = isHydrogen
      ? `<div class="sl-dk-logo-wrap"><img class="sl-dk-logo" src="${DK_LOGO_SRC}" alt="DK" width="42" height="42" draggable="false" /></div>`
      : `<div class="sl-avatar-initial">${node.name}</div>`;

    const infoPanelHtml = !isHydrogen
      ? `
      <div class="sl-meta-panel">
        <div class="sl-meta-item">
          <span class="sl-meta-label">Atomic No.</span>
          <span class="sl-meta-value">${node.atomicNo}</span>
        </div>
        <div class="sl-meta-item">
          <span class="sl-meta-label">Mass</span>
          <span class="sl-meta-value">${node.mass}</span>
        </div>
      </div>`
      : '';

    if (isHydrogen) {
      el.innerHTML = `
      <div class="sl-login-stack">
        <div class="${nodeClass}">
          <div class="sl-node-content">
            ${visual}
            <div class="sl-node-name sl-node-name--start">${displayName}</div>
          </div>
        </div>
      </div>`;

      const stack = el.querySelector('.sl-login-stack');
      const blueEl = el.querySelector('.sl-node-blue');
      const playTapFx = () => {
        if (!stack) return;
        stack.classList.remove('sl-dk-tap-fx');
        void stack.offsetWidth;
        stack.classList.add('sl-dk-tap-fx');
      };
      blueEl?.addEventListener('animationend', () => {
        stack?.classList.remove('sl-dk-tap-fx');
      });

      el.addEventListener('click', (e) => {
        if (loginOverlayActiveRef.current) return;
        e.stopPropagation();
        playTapFx();
        opts.bridge.current.onOpenFullForm();
      });
    } else {
      el.innerHTML = `
      <div class="${nodeClass}">
        <div class="sl-node-content">
          ${visual}
          <div class="sl-node-name">${displayName}</div>
          <div class="sl-node-relation">${displayRelation}</div>
        </div>
      </div>
      ${infoPanelHtml}`;
    }

    el.addEventListener('mouseenter', () => {
      if (loginOverlayActiveRef.current) {
        applyHydrogenBlur(world);
        return;
      }
      if (node.id === 'h') {
        applyHydrogenBlur(world);
        return;
      }
      world.querySelectorAll('.sl-node-container').forEach((n) => {
        if (n !== el) {
          n.classList.remove('sl-blur-light', 'sl-blur-medium');
          n.classList.add('sl-blur-heavy');
        }
      });
      lineageLinks.forEach((l) => {
        if (l.source !== node.id && l.target !== node.id) return;
        const relativeId = l.source === node.id ? l.target : l.source;
        const relNode = world.querySelector(`[data-id="${relativeId}"]`);
        if (relNode) {
          relNode.classList.remove('sl-blur-heavy');
          relNode.classList.add('sl-blur-light');
        }
      });
    });

    el.addEventListener('mouseleave', () => {
      if (loginOverlayActiveRef.current) {
        applyHydrogenBlur(world);
        return;
      }
      if (node.id === 'h') {
        resetWorldBlur(world);
        return;
      }
      world.querySelectorAll('.sl-node-container').forEach((n) => {
        n.classList.remove('sl-blur-heavy', 'sl-blur-light', 'sl-blur-medium');
        const z = parseFloat((n as HTMLElement).dataset.z ?? '0');
        if (z < -20) n.classList.add('sl-blur-medium');
        else if (z < 0) n.classList.add('sl-blur-light');
      });
    });

    world.appendChild(el);
  });

  applyCameraTransform(camera, state);
}

export const SpatialLineageViewport = forwardRef<SpatialLineageViewportHandle, SpatialLineageViewportProps>(
  function SpatialLineageViewport({ loginBridgeRef, loginOverlayActive = false }, ref) {
    const viewportRef = useRef<HTMLDivElement>(null);
    const cameraRef = useRef<HTMLDivElement>(null);
    const worldRef = useRef<HTMLDivElement>(null);
    const loginOverlayActiveRef = useRef(loginOverlayActive);
    loginOverlayActiveRef.current = loginOverlayActive;
    /** DK 스택(노드+로그인 메뉴) 호버 시 시점을 정면(0°,0°)으로 부드럽게 맞춤 */
    const cameraFocusLoginRef = useRef(false);

    useImperativeHandle(ref, () => ({
      resetView: () => {
        state = {
          currentRotX: 45,
          currentRotZ: -15,
          currentTransZ: SPATIAL_FIXED_TRANS_Z,
          panX: 0,
          panY: 0,
        };
        if (cameraRef.current) applyCameraTransform(cameraRef.current, state);
      },
    }));

    useEffect(() => {
      const viewport = viewportRef.current;
      const camera = cameraRef.current;
      const world = worldRef.current;
      if (!viewport || !camera || !world) return;

      renderScene(world, camera, {
        bridge: loginBridgeRef,
        loginOverlayActiveRef,
      });

      syncBlurAfterRender(world, loginOverlayActiveRef.current);

      const updateCamera = () => {
        applyCameraTransform(camera, state);
      };

      const onMouseMoveViewport = (e: MouseEvent) => {
        if (cameraFocusLoginRef.current) return;
        const x = (e.clientX / window.innerWidth - 0.5) * 2;
        const y = (e.clientY / window.innerHeight - 0.5) * 2;
        state.currentRotX = 45 - y * 5;
        state.currentRotZ = -15 + x * 5;
        applyCameraTransform(camera, state);
      };

      const onMouseLeaveViewport = () => {
        cameraFocusLoginRef.current = false;
        updateCamera();
      };

      const loginStack = world.querySelector('.sl-login-stack');
      const onLoginStackEnter = () => {
        cameraFocusLoginRef.current = true;
      };
      const onLoginStackLeave = () => {
        cameraFocusLoginRef.current = false;
      };
      if (loginStack) {
        loginStack.addEventListener('mouseenter', onLoginStackEnter);
        loginStack.addEventListener('mouseleave', onLoginStackLeave);
      }

      let rafCancelled = false;
      let rafId = 0;
      const focusLerpLoop = () => {
        if (cameraFocusLoginRef.current) {
          state.currentRotX = lerp(state.currentRotX, 0, 0.14);
          state.currentRotZ = lerp(state.currentRotZ, 0, 0.14);
          applyCameraTransform(camera, state);
        }
        if (!rafCancelled) {
          rafId = requestAnimationFrame(focusLerpLoop);
        }
      };
      rafId = requestAnimationFrame(focusLerpLoop);

      viewport.addEventListener('mousemove', onMouseMoveViewport);
      viewport.addEventListener('mouseleave', onMouseLeaveViewport);

      updateCamera();

      return () => {
        rafCancelled = true;
        cancelAnimationFrame(rafId);
        if (loginStack) {
          loginStack.removeEventListener('mouseenter', onLoginStackEnter);
          loginStack.removeEventListener('mouseleave', onLoginStackLeave);
        }
        viewport.removeEventListener('mousemove', onMouseMoveViewport);
        viewport.removeEventListener('mouseleave', onMouseLeaveViewport);
      };
    }, [loginBridgeRef]);

    useEffect(() => {
      const world = worldRef.current;
      if (!world?.querySelector('[data-id="h"]')) return;
      syncBlurAfterRender(world, loginOverlayActiveRef.current);
    }, [loginOverlayActive]);

    return (
      <div ref={viewportRef} className="sl-viewport">
        <div ref={cameraRef} className="sl-camera">
          <div ref={worldRef} className="sl-world" />
        </div>
      </div>
    );
  }
);
