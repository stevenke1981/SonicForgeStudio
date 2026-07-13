import "@testing-library/jest-dom";
import { vi } from "vitest";

const canvasContext = {
  beginPath: vi.fn(),
  clearRect: vi.fn(),
  fill: vi.fn(),
  fillRect: vi.fn(),
  fillText: vi.fn(),
  lineTo: vi.fn(),
  moveTo: vi.fn(),
  roundRect: vi.fn(),
  setTransform: vi.fn(),
  stroke: vi.fn(),
  fillStyle: "",
  strokeStyle: "",
  font: "",
  lineWidth: 1,
};

HTMLCanvasElement.prototype.getContext = vi.fn(() => canvasContext) as unknown as typeof HTMLCanvasElement.prototype.getContext;
