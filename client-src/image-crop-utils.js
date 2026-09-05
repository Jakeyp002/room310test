export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function coverTransform(imageWidth, imageHeight, canvasWidth, canvasHeight, zoom = 1, offsetX = 0, offsetY = 0) {
  const safeZoom = clamp(Number(zoom) || 1, 1, 3);
  const scale = Math.max(canvasWidth / imageWidth, canvasHeight / imageHeight) * safeZoom;
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  const maxOffsetX = Math.max(0, (width - canvasWidth) / 2);
  const maxOffsetY = Math.max(0, (height - canvasHeight) / 2);
  const boundedX = clamp(offsetX, -maxOffsetX, maxOffsetX);
  const boundedY = clamp(offsetY, -maxOffsetY, maxOffsetY);
  return {
    x: (canvasWidth - width) / 2 + boundedX,
    y: (canvasHeight - height) / 2 + boundedY,
    width,
    height,
    offsetX: boundedX,
    offsetY: boundedY,
    zoom: safeZoom
  };
}
