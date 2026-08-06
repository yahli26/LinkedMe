import { GIFEncoder, quantize } from "../vendor/gifenc/gifenc.esm.js";

let encoder = null;
let width = 0;
let height = 0;
let expectedFrameCount = 0;
let encodedFrameCount = 0;
let maxColors = 256;

const RGB565_COLOR_COUNT = 65536;

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function rgb565Key(red, green, blue) {
  return ((red & 0xf8) << 8) | ((green & 0xfc) << 3) | (blue >> 3);
}

function nearestPaletteIndex(red, green, blue, palette, cache) {
  const key = rgb565Key(red, green, blue);
  const cachedIndex = cache[key];
  if (cachedIndex >= 0) return cachedIndex;

  let closestIndex = 0;
  let closestDistance = Infinity;
  for (let index = 0; index < palette.length; index += 1) {
    const color = palette[index];
    const redDifference = red - color[0];
    const greenDifference = green - color[1];
    const blueDifference = blue - color[2];
    const distance = redDifference * redDifference +
      greenDifference * greenDifference + blueDifference * blueDifference;
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  }

  cache[key] = closestIndex;
  return closestIndex;
}

/**
 * Maps RGBA pixels to a GIF palette with serpentine Floyd-Steinberg dithering.
 * Error diffusion is essential for gradients because GIF can only store 256
 * colors; nearest-color mapping alone turns gradual changes into visible bands.
 */
export function applyPaletteWithDithering(rgba, palette, frameWidth, frameHeight) {
  const indexedPixels = new Uint8Array(frameWidth * frameHeight);
  const paletteCache = new Int16Array(RGB565_COLOR_COUNT);
  paletteCache.fill(-1);

  // One padding pixel on either side removes boundary branches while diffusing.
  const errorRowLength = (frameWidth + 2) * 3;
  let currentErrors = new Float32Array(errorRowLength);
  let nextErrors = new Float32Array(errorRowLength);

  for (let y = 0; y < frameHeight; y += 1) {
    const leftToRight = y % 2 === 0;
    const startX = leftToRight ? 0 : frameWidth - 1;
    const endX = leftToRight ? frameWidth : -1;
    const direction = leftToRight ? 1 : -1;

    for (let x = startX; x !== endX; x += direction) {
      const pixelIndex = y * frameWidth + x;
      const rgbaIndex = pixelIndex * 4;
      const errorIndex = (x + 1) * 3;
      const red = clampByte(rgba[rgbaIndex] + currentErrors[errorIndex]);
      const green = clampByte(rgba[rgbaIndex + 1] + currentErrors[errorIndex + 1]);
      const blue = clampByte(rgba[rgbaIndex + 2] + currentErrors[errorIndex + 2]);
      const paletteIndex = nearestPaletteIndex(red, green, blue, palette, paletteCache);
      const color = palette[paletteIndex];
      indexedPixels[pixelIndex] = paletteIndex;

      const redError = red - color[0];
      const greenError = green - color[1];
      const blueError = blue - color[2];
      const forwardErrorIndex = errorIndex + direction * 3;
      const backwardErrorIndex = errorIndex - direction * 3;

      // Floyd-Steinberg weights: forward 7/16; next row 3/16, 5/16, 1/16.
      currentErrors[forwardErrorIndex] += redError * 7 / 16;
      currentErrors[forwardErrorIndex + 1] += greenError * 7 / 16;
      currentErrors[forwardErrorIndex + 2] += blueError * 7 / 16;
      nextErrors[backwardErrorIndex] += redError * 3 / 16;
      nextErrors[backwardErrorIndex + 1] += greenError * 3 / 16;
      nextErrors[backwardErrorIndex + 2] += blueError * 3 / 16;
      nextErrors[errorIndex] += redError * 5 / 16;
      nextErrors[errorIndex + 1] += greenError * 5 / 16;
      nextErrors[errorIndex + 2] += blueError * 5 / 16;
      nextErrors[forwardErrorIndex] += redError / 16;
      nextErrors[forwardErrorIndex + 1] += greenError / 16;
      nextErrors[forwardErrorIndex + 2] += blueError / 16;
    }

    const completedErrors = currentErrors;
    currentErrors = nextErrors;
    nextErrors = completedErrors;
    nextErrors.fill(0);
  }

  return indexedPixels;
}

function reply(id, type, payload = {}, transfer = []) {
  self.postMessage({ id, type, ...payload }, transfer);
}

function assertInitialized() {
  if (!encoder) throw new Error("The GIF encoder has not been initialized.");
}

self.addEventListener("message", (event) => {
  const message = event.data || {};
  const { id, type } = message;
  try {
    if (type === "init") {
      if (!Number.isInteger(message.width) || !Number.isInteger(message.height) ||
          message.width <= 0 || message.height <= 0 ||
          !Number.isInteger(message.frameCount) || message.frameCount <= 0) {
        throw new Error("GIF encoder dimensions or frame count are invalid.");
      }
      width = message.width;
      height = message.height;
      expectedFrameCount = message.frameCount;
      maxColors = Math.max(2, Math.min(256, message.maxColors || 256));
      encodedFrameCount = 0;
      encoder = GIFEncoder({ initialCapacity: 4 * 1024 * 1024 });
      reply(id, "ready");
      return;
    }

    if (type === "frame") {
      assertInitialized();
      if (message.frameIndex !== encodedFrameCount) {
        throw new Error("GIF frames were received out of order.");
      }
      const rgba = new Uint8ClampedArray(message.rgba);
      if (rgba.byteLength !== width * height * 4) {
        throw new Error("A rendered GIF frame has the wrong dimensions.");
      }
      const palette = quantize(rgba, maxColors, { format: "rgb565" });
      const indexedPixels = applyPaletteWithDithering(rgba, palette, width, height);
      encoder.writeFrame(indexedPixels, width, height, {
        palette,
        delay: message.delay,
        repeat: 0,
      });
      encodedFrameCount += 1;
      reply(id, "frame-complete", { frameIndex: message.frameIndex });
      return;
    }

    if (type === "finish") {
      assertInitialized();
      if (encodedFrameCount !== expectedFrameCount) {
        throw new Error("GIF encoding finished before all frames were received.");
      }
      encoder.finish();
      const bytes = encoder.bytes();
      encoder = null;
      reply(id, "finished", { bytes: bytes.buffer }, [bytes.buffer]);
      return;
    }

    throw new Error("Unknown GIF encoder worker message.");
  } catch (error) {
    reply(id, "error", {
      message: error instanceof Error ? error.message : "GIF encoding failed.",
    });
  }
});
