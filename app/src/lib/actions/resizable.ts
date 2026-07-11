// Ported from design/layout-v3-fullscreen.html's drag() helper.
//
// Panel sizes are stored as flex-grow RATIOS (basis:0), not fixed pixels or
// percentages of the container. Fixed pixels are correct only at the zoom
// level they were dragged at -- browser zoom changes how many CSS pixels
// fit in the window, so a panel pinned to (say) "300px" stops being the
// same fraction of the window once zoom changes that count. Percentages
// have a subtler version of the same problem: they'd have to also account
// for the splitter's fixed 6px, which isn't part of either percentage --
// get that wrong and the two panels' percentages plus the splitter add up
// to more than 100%, overflowing the container. flex-grow sidesteps both:
// the browser reserves the splitter's fixed 6px first, then divides
// whatever's left between the two panels by ratio, automatically, at any
// container size.
export interface ResizableParams {
  axis: 'x' | 'y';
  min?: number;
}

export function resizable(handle: HTMLElement, params: ResizableParams) {
  let axis = params.axis;
  let min = params.min ?? 140;

  function onPointerDown(e: PointerEvent) {
    const growEl = handle.previousElementSibling as HTMLElement | null;
    const shrinkEl = handle.nextElementSibling as HTMLElement | null;
    if (!growEl || !shrinkEl) return;
    const sizeProp = axis === 'x' ? 'width' : 'height';

    handle.setPointerCapture(e.pointerId);
    const start = axis === 'x' ? e.clientX : e.clientY;
    const g0 = growEl.getBoundingClientRect()[sizeProp];
    const s0 = shrinkEl.getBoundingClientRect()[sizeProp];

    function apply(g: number, s: number) {
      growEl!.style.flex = g + ' 0 0';
      shrinkEl!.style.flex = s + ' 0 0';
    }
    apply(g0, s0);
    document.body.style.cursor = getComputedStyle(handle).cursor;

    function move(e: PointerEvent) {
      const pos = axis === 'x' ? e.clientX : e.clientY;
      const d = pos - start;
      let g = g0 + d;
      let s = s0 - d;
      if (g < min || s < min) return;
      apply(g, s);
    }
    function up() {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
    }
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  handle.addEventListener('pointerdown', onPointerDown);
  return {
    update(newParams: ResizableParams) {
      axis = newParams.axis;
      min = newParams.min ?? 140;
    },
    destroy() {
      handle.removeEventListener('pointerdown', onPointerDown);
    },
  };
}
