export function estimatedSurveyDirection(raw) {
  const values = Array.isArray(raw?.vec) ? raw.vec : [raw?.x, raw?.y, raw?.z];
  const direction = values.map(Number);
  const length = Math.hypot(...direction);
  if (direction.length !== 3 || direction.some((value) => !Number.isFinite(value)) || length < 1e-9) {
    return null;
  }
  return direction.map((value) => Number((value / length).toFixed(8)));
}

export function storedSurveyDirection(jaw, [x, y, z]) {
  return jaw === "upper" ? [-x, -y, z] : [x, y, -z];
}
